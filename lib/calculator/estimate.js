// Builds a pay and tax estimate from parsed input. Pay (lib/pay), tax (lib/tax) and
// official data (lib/data) stay separate; this module only wires them together and
// records assumptions, gated items, and the dataset versions used.

const { activeDuty, drill, stateActiveDuty, additionalPayments } = require("../pay/payModes");
const { PayRuleError } = require("../pay/militaryPay");
const { treatmentFor } = require("../tax/treatment");
const { federalLiability, withholdingForPayment, supplementalFlatWithholding } = require("../tax/federal");
const { createFicaTracker, additionalMedicareLiability } = require("../tax/fica");
const { newYorkLiability, newYorkWithholding, supplementalWithholding } = require("../tax/newYork");
const { DataUnavailableError } = require("../data/datasetStore");

const cents = (value) => Math.round(value * 100) / 100;
const sum = (values) => cents(values.reduce((total, value) => total + (value || 0), 0));
const usd = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DATASETS = {
  pay: "dfas-military-pay",
  bah: "dtmo-bah-ny",
  irs: "irs-federal-tax",
  ny: "ny-income-tax",
  wh: "ny-withholding",
  sad: "ny-sad-rules",
};

const loadData = (store, taxYear) => {
  const data = {};
  const meta = [];
  const warnings = [];
  const missing = [];
  for (const [key, datasetId] of Object.entries(DATASETS)) {
    try {
      const entry = store.get(datasetId, taxYear);
      data[key] = entry.data;
      meta.push(entry.meta);
      warnings.push(...entry.warnings);
    } catch (error) {
      if (!(error instanceof DataUnavailableError)) throw error;
      missing.push({ datasetId, reason: error.reason });
    }
  }
  return { data, meta, warnings, missing };
};

const buildPay = (input, data) => {
  const common = { grade: input.grade, serviceStartDate: input.serviceStartDate, taxYear: input.taxYear };
  if (input.mode === "active") {
    if (input.bah.source === "locality" && !input.ordersAtLeast30Days) {
      throw new PayRuleError("Locality BAH applies to orders of 30 days or more. Reserve-component orders under 30 days use BAH RC/T, which is not modeled; enter BAH manually or choose none.");
    }
    return activeDuty({ ...common, periods: input.periods, bah: input.bah, basEligible: input.basEligible }, data);
  }
  if (input.mode === "drill") {
    return drill({ ...common, drills: input.drills, payLagDays: input.drillPayLagDays }, data);
  }
  return stateActiveDuty({
    ...common,
    periods: input.periods,
    bah: input.bah,
    basEligible: input.basEligible,
    firstPayDate: input.sadFirstPayDate,
    payLagDays: input.sadPayLagDays,
  }, data);
};

// Pub 15 aggregate method: supplemental wages paid with regular wages are withheld as one payment.
const mergeSameDayPayments = (events, method) => {
  if (method !== "aggregate") return events;
  const merged = [];
  for (const event of events) {
    const match = merged.find((other) => other.date === event.date && other.payer === event.payer);
    if (match) {
      match.components.push(...event.components);
      match.coverage = `${match.coverage}; ${event.coverage}`;
      match.stream = "regular";
      match.combined = true;
    } else {
      merged.push({ ...event, components: [...event.components] });
    }
  }
  return merged;
};

const estimate = (input, store, { today = new Date() } = {}) => {
  const { data, meta, warnings, missing } = loadData(store, input.taxYear);
  if (missing.length) {
    return {
      status: "blocked",
      taxYear: input.taxYear,
      blocked: missing,
      availableYears: store.availableYears(),
      message: `Tax year ${input.taxYear} cannot be calculated: no validated official data for ${missing.map((m) => m.datasetId).join(", ")}. Rates from another year are never substituted.`,
    };
  }

  const profile = {
    ...input.profile,
    mode: input.mode,
    nyResidency: input.nyResidency,
  };
  const assumptions = [];
  const gated = [];
  const pay = buildPay(input, data);
  const additional = additionalPayments(input.additional, input.taxYear);
  const events = mergeSameDayPayments(
    [...pay.events, ...additional.events].sort((a, b) => a.date.localeCompare(b.date) || (a.stream === "regular" ? -1 : 1)),
    input.mode === "sad" ? input.supplementalMethod : "separate"
  );
  if (events.length === 0) {
    throw new PayRuleError(`No payments fall in ${input.taxYear} for the dates entered.`);
  }

  const tradRate = input.tradRetirementPercent / 100;
  const ficaTracker = createFicaTracker(data.irs, { DFAS: input.mode === "sad" ? 0 : input.priorYtdWages, NYS: input.mode === "sad" ? input.priorYtdWages : 0 });
  const unresolvedTracker = createFicaTracker(data.irs, {});
  const withholdLocal = (payer) => (payer === "NYS" ? input.localResidency : "none");

  const rows = events.map((event) => {
    const components = event.components.map((component) => ({ ...component, treatment: treatmentFor(component.kind, profile) }));
    const gross = sum(components.map((c) => c.amount));
    const retirement = cents(sum(components.filter((c) => c.treatment.retirementBase).map((c) => c.amount)) * tradRate);
    const section125 = event.stream === "regular" ? Math.min(input.section125PerPay, gross) : 0;
    const afterTax = event.stream === "regular" ? input.afterTaxPerPay : 0;
    const pick = (field, status) => sum(components.filter((c) => c.treatment[field].status === status).map((c) => c.amount));
    const retirementShare = (field, status) => cents(sum(components.filter((c) => c.treatment[field].status === status && c.treatment.retirementBase).map((c) => c.amount)) * tradRate);

    const federalWages = Math.max(0, cents(pick("federal", "taxable") - retirementShare("federal", "taxable") - section125));
    const nyWages = Math.max(0, cents(pick("ny", "taxable") - retirementShare("ny", "taxable") - section125));
    const ficaSubject = Math.max(0, cents(pick("fica", "subject") - section125));
    const ficaUnresolved = Math.max(0, cents(pick("fica", "unresolved")));
    const yonkersNonresidentWages = input.worksInYonkers && input.localResidency !== "yonkers" && event.payer === "NYS"
      ? Math.max(0, pick("yonkersNonresident", "taxable"))
      : 0;

    const separateSupplemental = event.stream === "supplemental" && input.supplementalMethod === "flat";
    const federalWithholding = separateSupplemental
      ? supplementalFlatWithholding(data.irs, federalWages)
      : withholdingForPayment(data.irs, { wages: federalWages, period: event.period, w4: input.w4 });

    const withholdNys = event.payer === "NYS" ? nyWages > 0 : input.nyResidency === "resident" && nyWages > 0;
    const nyArgs = {
      wages: nyWages,
      period: event.period,
      maritalStatus: input.nyWithholding.maritalStatus,
      nysAllowances: input.nyWithholding.nysAllowances,
      nycAllowances: input.nyWithholding.nycAllowances,
      withholdNys,
      local: withholdLocal(event.payer),
      yonkersNonresidentWages,
      extra: { nys: event.stream === "regular" ? input.nyWithholding.extraNys : 0 },
    };
    const nyWithholding = separateSupplemental
      ? supplementalWithholding(data.wh, { amount: nyWages, withholdNys, local: nyArgs.local, yonkersNonresident: yonkersNonresidentWages > 0 })
      : newYorkWithholding(data.wh, data.ny, nyArgs);

    const fica = ficaTracker.withhold(event.payer, ficaSubject);
    const ficaIfApplied = ficaUnresolved > 0 ? unresolvedTracker.withhold(event.payer, ficaUnresolved) : null;
    const ficaTotal = sum([fica.socialSecurity, fica.medicare, fica.additionalMedicare]);
    const unavailable = [nyWithholding.nys, nyWithholding.nyc, nyWithholding.yonkers].some((value) => value === null);
    const taxes = sum([federalWithholding, nyWithholding.nys, nyWithholding.nyc, nyWithholding.yonkers, ficaTotal]);
    const net = cents(gross - retirement - section125 - afterTax - taxes);

    return {
      date: event.date,
      payer: event.payer,
      period: event.period,
      stream: event.stream,
      combined: Boolean(event.combined),
      coverage: event.coverage,
      components,
      gross,
      pretax: { retirement, section125 },
      taxableWages: { federal: federalWages, ny: nyWages, fica: ficaSubject, ficaUnresolved, yonkersNonresident: yonkersNonresidentWages },
      withholding: {
        federal: federalWithholding,
        nys: nyWithholding.nys,
        nyc: nyWithholding.nyc,
        yonkers: nyWithholding.yonkers,
        socialSecurity: fica.socialSecurity,
        medicare: fica.medicare,
        additionalMedicare: fica.additionalMedicare,
        method: separateSupplemental ? "supplemental flat rates" : `${event.period} percentage/exact method`,
        notes: nyWithholding.notes,
      },
      ficaIfApplied: ficaIfApplied && sum([ficaIfApplied.socialSecurity, ficaIfApplied.medicare, ficaIfApplied.additionalMedicare]),
      afterTax,
      net,
      netIfFicaApplied: ficaIfApplied ? cents(net - sum([ficaIfApplied.socialSecurity, ficaIfApplied.medicare, ficaIfApplied.additionalMedicare])) : null,
      withholdingUnavailable: unavailable,
    };
  });

  // ---- Annual totals and liability ----
  const allComponents = rows.flatMap((row) => row.components);
  const byKind = {};
  for (const component of allComponents) {
    byKind[component.label] = cents((byKind[component.label] || 0) + component.amount);
  }
  const totals = {
    gross: sum(rows.map((r) => r.gross)),
    retirement: sum(rows.map((r) => r.pretax.retirement)),
    section125: sum(rows.map((r) => r.pretax.section125)),
    afterTax: sum(rows.map((r) => r.afterTax)),
    federalWages: sum(rows.map((r) => r.taxableWages.federal)),
    nyWages: sum(rows.map((r) => r.taxableWages.ny)),
    ficaWages: sum(rows.map((r) => r.taxableWages.fica)),
    ficaUnresolvedWages: sum(rows.map((r) => r.taxableWages.ficaUnresolved)),
    yonkersNonresidentWages: sum(rows.map((r) => r.taxableWages.yonkersNonresident)),
    withholding: {
      federal: sum(rows.map((r) => r.withholding.federal)),
      nys: sum(rows.map((r) => r.withholding.nys)),
      nyc: sum(rows.map((r) => r.withholding.nyc)),
      yonkers: sum(rows.map((r) => r.withholding.yonkers)),
      socialSecurity: sum(rows.map((r) => r.withholding.socialSecurity)),
      medicare: sum(rows.map((r) => r.withholding.medicare)),
      additionalMedicare: sum(rows.map((r) => r.withholding.additionalMedicare)),
    },
    ficaIfApplied: sum(rows.map((r) => r.ficaIfApplied)),
    net: sum(rows.map((r) => r.net)),
  };
  totals.netIfFicaApplied = totals.ficaUnresolvedWages > 0 ? cents(totals.net - totals.ficaIfApplied) : null;

  const federal = federalLiability(data.irs, {
    filingStatus: input.filingStatus,
    wages: totals.federalWages,
    otherWages: input.otherWages,
    otherIncome: input.otherIncome,
    itemizedDeductions: input.itemizedDeductions,
    qualifyingChildren: input.qualifyingChildren,
    otherDependents: input.otherDependents,
  });
  const medicareWagesForLiability = totals.ficaWages + (input.filingStatus === "mfj" ? input.otherWages : 0);
  const additionalMedicare = additionalMedicareLiability(data.irs, input.filingStatus, medicareWagesForLiability);

  let newYork = null;
  if (input.nyResidency === "part-year") {
    gated.push({
      item: "New York, NYC and Yonkers liability",
      reason: "Part-year residency requires IT-203 income accrual and allocation between periods, which is not modeled.",
      authorityNeeded: "IT-203 and IT-203-I part-year resident rules (and your move dates).",
    });
  } else {
    const fedTaxableNyExcluded = allComponents.filter((c) => c.treatment.federal.status === "taxable" && c.treatment.ny.status === "excluded");
    const nySubtractions = cents(fedTaxableNyExcluded.reduce((total, c) => total + c.amount * (c.treatment.retirementBase ? 1 - tradRate : 1), 0));
    const nySourceIncome = input.nyResidency === "nonresident" ? cents(totals.nyWages + input.otherNySourceIncome) : null;
    const localExcludedIncome = sum(allComponents.filter((c) => c.treatment.ny.status === "taxable" && c.treatment.local.status === "excluded").map((c) => c.amount));
    newYork = newYorkLiability(data.ny, {
      filingStatus: input.filingStatus,
      residency: input.nyResidency,
      local: input.localResidency,
      federalAgi: federal.agi,
      nySubtractions,
      nySourceIncome,
      dependents: input.qualifyingChildren + input.otherDependents,
      claimedAsDependent: input.claimedAsDependent,
      localExcludedIncome,
      yonkersNonresidentWages: totals.yonkersNonresidentWages,
    });
    newYork.subtractions = nySubtractions;
  }

  const liability = {
    federalIncomeTax: federal.incomeTaxAfterCredits,
    additionalMedicareTax: additionalMedicare,
    nys: newYork ? newYork.nysAfterCredits : null,
    nyc: newYork && newYork.nyc ? cents(newYork.nyc.tax) : 0,
    yonkers: newYork && newYork.yonkers ? newYork.yonkers.tax : 0,
  };
  const comparisons = {
    federal: cents(totals.withholding.federal + totals.withholding.additionalMedicare - liability.federalIncomeTax - liability.additionalMedicareTax),
    nys: liability.nys === null ? null : cents(totals.withholding.nys - liability.nys),
    nyc: cents(totals.withholding.nyc - liability.nyc),
    yonkers: cents(totals.withholding.yonkers - liability.yonkers),
  };

  // ---- Monthly views: actual calendar totals vs. averages ----
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const inMonth = rows.filter((row) => row.date.slice(5, 7) === month);
    return {
      month: `${input.taxYear}-${month}`,
      payments: inMonth.length,
      gross: sum(inMonth.map((r) => r.gross)),
      withholding: sum(inMonth.map((r) => sum([r.withholding.federal, r.withholding.nys, r.withholding.nyc, r.withholding.yonkers, r.withholding.socialSecurity, r.withholding.medicare, r.withholding.additionalMedicare]))),
      net: sum(inMonth.map((r) => r.net)),
    };
  });
  const average = {
    gross: cents(totals.gross / 12),
    net: cents(totals.net / 12),
  };

  // ---- Assumptions, gates, missing information ----
  const flagged = new Map();
  for (const component of allComponents) {
    for (const field of ["federal", "ny", "local", "fica"]) {
      const { basis, note } = component.treatment[field];
      if (basis === "assumed" || basis === "unresolved" || basis === "general-rule") {
        flagged.set(`${component.label}|${field}|${note}`, { component: component.label, tax: field, basis, note });
      }
    }
  }
  if (totals.ficaUnresolvedWages > 0) {
    gated.push({
      item: "Social Security/Medicare on SAD or additional payments",
      reason: `${usd(totals.ficaUnresolvedWages)} of pay has unverified payroll-tax treatment. Net pay is shown without these taxes and, separately, as if they applied.`,
      authorityNeeded: "DMNA/NYS Comptroller payroll guidance on FICA for SAD (NY Section 218 agreement), or your SAD pay statement.",
    });
  }
  if (rows.some((r) => r.withholdingUnavailable)) {
    gated.push({ item: "NY withholding for very large payments", reason: "Net wages exceed the Method II tables; Method III is not modeled.", authorityNeeded: "NYS-50-T Method III" });
  }
  if (input.mode !== "sad" && input.localResidency !== "none") {
    assumptions.push("DFAS withholds state income tax under state agreements; NYC/Yonkers tax is not withheld from military pay in this estimate and may be due when you file.");
  }
  if (input.mode === "sad" && profile.sadOrdersAuthority === "unknown") {
    assumptions.push("SAD orders authority is unknown, so SAD pay is treated as NY-taxable; if your orders cite Military Law sec. 6.1, NY (and NYC/Yonkers resident) tax would be lower.");
  }
  if (additional.events.length) {
    assumptions.push(`Additional payment: ${additional.events.length} payment(s) of ${usd(input.additional.amount)} every ${input.additional.intervalDays} days in ${input.taxYear}. This is a user-reported arrangement. The DMNA 2025 Annual Report confirms a $2,000 special-duty bonus every two weeks for personnel working in the prisons; individual eligibility, dates and tax treatment were not verified.`);
    if (input.supplementalMethod === "aggregate") assumptions.push("Additional payments paid on a SAD payday are withheld together with that paycheck (Pub 15 aggregate method); otherwise as a separate biweekly payment.");
  }
  assumptions.push(
    "Federal withholding uses Pub 15-T Worksheet 1A with the Form W-4 entries provided; a biweekly payroll annualizes over 26 periods even in a 27-payment year, so extra paychecks can change the withheld total.",
    "Liability is computed on the full year; withholding is computed paycheck by paycheck. The difference is an estimated refund or balance due, not a payroll figure.",
    ...pay.notes,
    ...additional.notes
  );

  const missingInformation = [];
  if (input.mode === "sad" && profile.sadPayrollTax === "unresolved") missingInformation.push("Whether Social Security/Medicare are withheld from your SAD pay (see a SAD pay statement).");
  if (input.mode === "sad" && profile.sadOrdersAuthority === "unknown") missingInformation.push("The Military Law section your SAD orders cite (sec. 6.1 or other).");
  if (input.mode === "sad") missingInformation.push("DMNA SAD payroll calendar and pay lag (the schedule entered is used as-is).");
  if (input.otherWages === 0 && input.filingStatus === "mfj") missingInformation.push("Spouse wages (enter as other wages if any) - joint liability depends on combined income.");

  const notModeled = [
    ...data.ny.notModeled,
    ...data.ny.nyc.notModeled,
    "Federal: itemized deduction details, senior/tip/overtime deductions, education and other credits, AMT, combat-zone exclusion, Roth/TSP limits",
    "Special and incentive pays, bonuses other than the additional payment entered, and BAH RC/T",
  ];

  return {
    status: "ok",
    generatedAt: today.toISOString(),
    taxYear: input.taxYear,
    mode: input.mode,
    rows,
    rates: pay.rates,
    allowances: pay.allowances || null,
    additionalDates: additional.dates,
    totals,
    byComponent: byKind,
    federal,
    newYork,
    liability,
    comparisons,
    monthly,
    average,
    assumptions,
    gated,
    flaggedTreatments: [...flagged.values()],
    missingInformation,
    notModeled,
    sources: meta,
    dataWarnings: warnings,
  };
};

module.exports = { estimate, DATASETS };
