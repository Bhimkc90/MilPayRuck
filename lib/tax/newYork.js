// New York State, New York City, and Yonkers income taxes.
// Liability follows IT-2105-I (2026) rate schedules and tax computation worksheets;
// withholding follows NYS-50-T-NYS / -NYC / -Y Method II (exact calculation).

const cents = (value) => Math.round(value * 100) / 100;

const scheduleTax = (schedule, income) => {
  if (income <= 0) return 0;
  let index = 0;
  schedule.thresholds.forEach((threshold, position) => {
    if (income > threshold) index = position;
  });
  return schedule.publishedBase[index] + (income - schedule.thresholds[index]) * schedule.rates[index];
};

const roundTo4 = (value) => Math.round(value * 10000) / 10000;

// NYS tax including the supplemental tax ("benefit recapture") for NYAGI over $107,650.
const nysTax = (ny, filingStatus, taxableIncome, nyagi) => {
  const key = ny.statusMap[filingStatus];
  const schedule = ny.nys.schedules[key];
  const recapture = ny.nys.recapture;
  const tableTax = scheduleTax(schedule, taxableIncome);
  if (taxableIncome <= 0) return { tax: 0, method: "rate schedule" };
  if (nyagi <= recapture.appliesAboveNyagi) return { tax: cents(tableTax), method: "rate schedule" };
  if (nyagi > recapture.flatRateAllIncomeAboveNyagi) {
    return { tax: cents(taxableIncome * recapture.flatRateAllIncome), method: "flat rate (NYAGI over $25,000,000)" };
  }

  const { first, later } = recapture.worksheets[key];
  if (taxableIncome <= first.maxTaxableIncome) {
    const flat = taxableIncome * first.flatRate;
    if (nyagi >= recapture.appliesAboveNyagi + recapture.phaseWidth) {
      return { tax: cents(flat), method: `tax computation worksheet ${first.worksheet} (flat ${(first.flatRate * 100).toFixed(2)}%)` };
    }
    const fraction = roundTo4((nyagi - recapture.appliesAboveNyagi) / recapture.phaseWidth);
    return {
      tax: cents(tableTax + (flat - tableTax) * fraction),
      method: `tax computation worksheet ${first.worksheet} (phase-in ${fraction})`,
    };
  }

  const sheet = later.find((candidate) => taxableIncome > candidate.taxableIncomeOver && taxableIncome <= candidate.maxTaxableIncome);
  if (!sheet || nyagi <= sheet.taxableIncomeOver) {
    throw new Error("NYAGI/taxable income combination is outside the IT-2105-I worksheets");
  }
  const fraction = roundTo4(Math.min(nyagi - sheet.taxableIncomeOver, recapture.phaseWidth) / recapture.phaseWidth);
  return {
    tax: cents(tableTax + sheet.recaptureBase + sheet.incrementalBenefit * fraction),
    method: `tax computation worksheet ${sheet.worksheet}`,
  };
};

const nycTax = (ny, filingStatus, cityTaxableIncome) =>
  cents(scheduleTax(ny.nyc.schedules[ny.statusMap[filingStatus]], cityTaxableIncome));

const nycSchoolTaxCredit = (ny, filingStatus, federalAgi, cityTaxableIncome) => {
  const rules = ny.nyc.schoolTaxCredit;
  const key = ny.statusMap[filingStatus];
  const fixed = federalAgi <= rules.fixed.maxIncome ? (key === "mfj" ? rules.fixed.mfj : rules.fixed.others) : 0;
  let rateReduction = 0;
  if (cityTaxableIncome > 0 && cityTaxableIncome <= rules.rateReduction.maxCityTaxableIncome) {
    const tier = rules.rateReduction[key];
    rateReduction = cityTaxableIncome <= tier.firstTier
      ? cityTaxableIncome * tier.firstRate
      : tier.base + (cityTaxableIncome - tier.firstTier) * tier.secondRate;
  }
  return { fixed, rateReduction: cents(rateReduction), total: cents(fixed + rateReduction) };
};

const yonkersExclusion = (ny, annualWages) =>
  ny.yonkers.nonresidentExclusions.find(({ over, notOver }) => annualWages > over && (notOver === null || annualWages <= notOver)) ||
  ny.yonkers.nonresidentExclusions[0];

const yonkersNonresidentTax = (ny, annualWages) => {
  const bracket = yonkersExclusion(ny, annualWages);
  if (!annualWages || bracket.noTax) return 0;
  return cents((annualWages - bracket.exclusion) * ny.yonkers.nonresidentEarningsTaxRate);
};

// Annual NYS/NYC/Yonkers liability.
// residency: "resident" | "nonresident"; local: "none" | "nyc" | "yonkers".
const newYorkLiability = (ny, input) => {
  const {
    filingStatus, residency, local, federalAgi, nySubtractions, nyAdditions = 0, nySourceIncome,
    dependents = 0, claimedAsDependent = false, localExcludedIncome = 0, yonkersNonresidentWages = 0,
  } = input;
  const nyagi = Math.max(0, federalAgi + nyAdditions - nySubtractions);
  const standard = claimedAsDependent && filingStatus === "single"
    ? ny.nys.standardDeduction.singleDependent
    : ny.nys.standardDeduction[filingStatus];
  const taxableIncome = Math.max(0, nyagi - standard - dependents * ny.nys.dependentExemption);
  const base = nysTax(ny, filingStatus, taxableIncome, nyagi);

  let nysLiability = base.tax;
  let allocation = null;
  if (residency === "nonresident") {
    const ratio = nyagi > 0 ? Math.min(1, Math.max(0, nySourceIncome / nyagi)) : 0;
    allocation = { nySourceIncome: cents(nySourceIncome), ratio: roundTo4(ratio) };
    nysLiability = cents(base.tax * allocation.ratio);
  }

  const result = {
    nyagi: cents(nyagi),
    standardDeduction: standard,
    dependentExemptions: dependents * ny.nys.dependentExemption,
    taxableIncome: cents(taxableIncome),
    nysTaxBeforeAllocation: base.tax,
    method: base.method,
    allocation,
    nys: nysLiability,
    nyc: null,
    yonkers: null,
  };

  if (residency === "resident" && local === "nyc") {
    const cityTaxable = Math.max(0, taxableIncome - localExcludedIncome);
    const tax = nycTax(ny, filingStatus, cityTaxable);
    const credit = nycSchoolTaxCredit(ny, filingStatus, federalAgi, cityTaxable);
    result.nyc = { taxableIncome: cents(cityTaxable), tax, schoolTaxCredit: credit };
    // The NYC school tax credit is claimed in the New York State column (IT-2105-I line 20).
    result.nysAfterCredits = cents(nysLiability - credit.total);
  } else {
    result.nysAfterCredits = nysLiability;
  }

  if (residency === "resident" && local === "yonkers") {
    const surchargeBase = Math.max(0, result.nysAfterCredits);
    result.yonkers = { type: "resident surcharge", tax: cents(surchargeBase * ny.yonkers.residentSurchargeRate) };
  } else if (yonkersNonresidentWages > 0) {
    result.yonkers = { type: "nonresident earnings tax", wages: cents(yonkersNonresidentWages), tax: yonkersNonresidentTax(ny, yonkersNonresidentWages) };
  }
  return result;
};

// NYS-50-T Method II exact calculation for one payment.
const exactCalculation = (block, { wages, period, maritalStatus, allowances }) => {
  const allowance = block.allowances[period][maritalStatus];
  const net = wages - (allowance.deduction + allowances * allowance.perExemption);
  if (net <= 0) return { amount: 0, unrounded: 0 };
  const row = block.exactCalculation[maritalStatus][period].find(
    (candidate) => net >= candidate.atLeast && (candidate.lessThan === null || net < candidate.lessThan)
  );
  if (!row || row.unsupported) return { amount: null, unsupported: "Net wages exceed Method II tables (Method III not modeled)" };
  const unrounded = row.add + (net - row.subtract) * row.rate;
  return { amount: cents(unrounded), unrounded };
};

const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, daily: 260 };

const newYorkWithholding = (wh, ny, input) => {
  const { wages, period, maritalStatus, nysAllowances, nycAllowances, withholdNys, local, yonkersNonresidentWages = 0, extra = {} } = input;
  const result = { nys: 0, nyc: 0, yonkers: 0, notes: [] };
  if (withholdNys && wages > 0) {
    const nys = exactCalculation(wh.nys, { wages, period, maritalStatus, allowances: nysAllowances });
    if (nys.amount === null) result.notes.push(`NYS: ${nys.unsupported}`);
    result.nys = nys.amount === null ? null : cents(nys.amount + (extra.nys || 0));
    if (local === "yonkers") {
      const yonkers = exactCalculation(wh.yonkersResident, { wages, period, maritalStatus, allowances: nysAllowances });
      // NYS-50-T-Y examples apply 16.75% to the unrounded Method II amount.
      result.yonkers = yonkers.amount === null ? null : cents(yonkers.unrounded * wh.yonkersResidentFactor + (extra.yonkers || 0));
    }
  }
  if (local === "nyc" && wages > 0) {
    const nyc = exactCalculation(wh.nyc, { wages, period, maritalStatus, allowances: nycAllowances });
    if (nyc.amount === null) result.notes.push(`NYC: ${nyc.unsupported}`);
    result.nyc = nyc.amount === null ? null : cents(nyc.amount + (extra.nyc || 0));
  }
  if (yonkersNonresidentWages > 0) {
    // NYS-50-T-Y Method VIII: annualize, subtract the exclusion, apply 0.50%, de-annualize.
    const periods = PERIODS_PER_YEAR[period];
    const annual = yonkersNonresidentWages * periods;
    result.yonkers = cents(yonkersNonresidentTax(ny, annual) / periods);
  }
  return result;
};

const supplementalWithholding = (wh, { amount, withholdNys, local, yonkersNonresident }) => ({
  nys: withholdNys ? cents(amount * wh.supplementalRates.nys) : 0,
  nyc: local === "nyc" ? cents(amount * wh.supplementalRates.nyc) : 0,
  yonkers: local === "yonkers" && withholdNys
    ? cents(amount * wh.supplementalRates.yonkersResident)
    : yonkersNonresident ? cents(amount * wh.supplementalRates.yonkersNonresident) : 0,
  notes: [],
});

module.exports = {
  scheduleTax,
  nysTax,
  nycTax,
  nycSchoolTaxCredit,
  yonkersNonresidentTax,
  newYorkLiability,
  exactCalculation,
  newYorkWithholding,
  supplementalWithholding,
};
