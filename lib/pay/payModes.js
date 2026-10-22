// Gross pay by mode. Each mode returns payment events ({ date, payer, period, components })
// for one tax year. Components carry a `kind`; tax treatment is decided in lib/tax.

const { addDays, eachDay, everyNDays, thirtyDayWeight, daysInMonth } = require("./dates");
const {
  monthlyBasicPay, activeDutyMonthsOn, monthlyBas, monthlyBah, drillPeriodPay, PayRuleError,
} = require("./militaryPay");

const cents = (value) => Math.round(value * 100) / 100;
const yearBounds = (taxYear) => ({ from: `${taxYear}-01-01`, to: `${taxYear}-12-31` });

const inPeriods = (periods, day) => periods.some(({ start, end }) => day >= start && day <= end);

const validatePeriods = (periods, label) => {
  if (!Array.isArray(periods) || periods.length === 0) throw new PayRuleError(`${label}: at least one duty period is required`);
  for (const { start, end } of periods) {
    if (!start || !end || end < start) throw new PayRuleError(`${label}: each period needs a start and an end on or after it`);
  }
};

const notesForOutsideYear = (periods, taxYear, label) => {
  const { from, to } = yearBounds(taxYear);
  return periods.some(({ start, end }) => start < from || end > to)
    ? [`${label} days outside ${taxYear} are not included; their pay belongs to another tax year and uses that year's rates.`]
    : [];
};

const allowanceRates = (input, data) => {
  const result = { bah: 0, bas: 0, bahSource: "none", bahArea: null };
  if (input.basEligible) result.bas = monthlyBas(data.pay, input.grade);
  const bah = input.bah || { source: "none" };
  if (bah.source === "locality") {
    const { amount, areaName } = monthlyBah(data.bah, bah.housingArea, input.grade, bah.withDependents);
    Object.assign(result, { bah: amount, bahSource: "locality", bahArea: `${bah.housingArea} ${areaName}` });
  } else if (bah.source === "manual") {
    if (!(bah.manualMonthly >= 0)) throw new PayRuleError("Manual BAH amount must be zero or more");
    Object.assign(result, { bah: bah.manualMonthly, bahSource: "manual" });
  }
  return result;
};

const basicFor = (input, data, day) =>
  monthlyBasicPay(data.pay, input.grade, input.serviceStartDate, day, {
    activeDutyMonths: input.grade === "E-1" ? activeDutyMonthsOn(input.serviceStartDate, day) : undefined,
  });

// Federal active duty: DFAS pays twice a month. Days 1-15 are paid on the mid-month
// payday and day 16 to month end on the end-of-month payday published for the year.
const activeDuty = (input, data) => {
  validatePeriods(input.periods, "Active duty");
  const allowances = allowanceRates(input, data);
  const rateHistory = new Map();
  const events = [];

  for (const { month, mid, end } of data.pay.activeDutyPaydays.months) {
    const prefix = `${input.taxYear}-${String(month).padStart(2, "0")}`;
    const last = daysInMonth(input.taxYear, month);
    const windows = [
      { date: mid, from: `${prefix}-01`, to: `${prefix}-15` },
      { date: end, from: `${prefix}-16`, to: `${prefix}-${last}` },
    ].map((window) => {
      let basic = 0;
      let paidDays = 0;
      for (const day of eachDay(window.from, window.to)) {
        if (!inPeriods(input.periods, day)) continue;
        const weight = thirtyDayWeight(day);
        const rate = basicFor(input, data, day);
        rateHistory.set(`${rate.amount}|${rate.column}`, rate);
        basic += (rate.amount / 30) * weight;
        paidDays += weight;
      }
      return { ...window, paidDays, raw: { basic, bah: (allowances.bah / 30) * paidDays, bas: (allowances.bas / 30) * paidDays } };
    });

    // Round each month once, then split it, so a full month pays exactly the monthly rate.
    const monthTotal = (key) => cents(windows[0].raw[key] + windows[1].raw[key]);
    const firstHalf = (key) => cents(windows[0].raw[key]);
    const amounts = (index, key) => (index === 0 ? firstHalf(key) : cents(monthTotal(key) - firstHalf(key)));

    windows.forEach((window, index) => {
      if (window.paidDays === 0) return;
      const components = [{ kind: "basic", label: "Basic pay", amount: amounts(index, "basic") }];
      if (allowances.bah) components.push({ kind: "bah", label: `BAH (${allowances.bahSource === "manual" ? "entered amount" : allowances.bahArea})`, amount: amounts(index, "bah") });
      if (allowances.bas) components.push({ kind: "bas", label: "BAS", amount: amounts(index, "bas") });
      events.push({
        date: window.date,
        payer: "DFAS",
        period: "semimonthly",
        stream: "regular",
        coverage: `${window.from} to ${window.to} (${window.paidDays} pay days on the 30-day basis)`,
        components,
      });
    });
  }

  return {
    events,
    rates: [...rateHistory.values()],
    allowances,
    notes: [
      ...notesForOutsideYear(input.periods, input.taxYear, "Active duty"),
      "Partial months use the DoD 30-day month convention: 1/30 of the monthly rate per day, no pay for the 31st, and the last day of February credited up to 30 days.",
    ],
  };
};

// Inactive duty training: each drill period pays 1/30 of monthly basic pay.
const drill = (input, data) => {
  if (!Array.isArray(input.drills) || input.drills.length === 0) throw new PayRuleError("Drill: enter at least one drill date");
  const { from, to } = yearBounds(input.taxYear);
  const lag = input.payLagDays || 0;
  const events = [];
  const notes = [];
  const rateHistory = new Map();

  for (const { date, periods } of input.drills) {
    if (!(Number.isInteger(periods) && periods >= 1 && periods <= 4)) throw new PayRuleError(`Drill ${date}: periods must be 1 to 4 per day`);
    if (date < from || date > to) {
      notes.push(`Drill on ${date} is outside ${input.taxYear} and was not included.`);
      continue;
    }
    const paidOn = addDays(date, lag);
    if (paidOn > to) {
      notes.push(`Drill on ${date} is expected to be paid on ${paidOn}, in the next tax year, so it is not included.`);
      continue;
    }
    const rate = basicFor(input, data, date);
    rateHistory.set(`${rate.amount}|${rate.column}`, rate);
    const perPeriod = drillPeriodPay(rate.amount);
    events.push({
      date: paidOn,
      payer: "DFAS",
      period: "monthly",
      stream: "regular",
      coverage: `${periods} drill period(s) on ${date} at $${perPeriod.toFixed(2)} each`,
      components: [{ kind: "drill", label: "Drill pay", amount: cents(perPeriod * periods) }],
    });
  }

  return {
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    rates: [...rateHistory.values()],
    notes: [
      ...notes,
      `Drill pay is assumed to be paid ${lag} day(s) after the drill date; DFAS reserve pay timing varies.`,
      "Drill pay withholding uses the monthly payroll period as an assumption; DFAS reserve withholding periods were not verified.",
    ],
  };
};

// New York State active duty (Military Law sec. 210(1)): for each day or part of a day,
// the federal pay and allowances of the same grade and service, or $125, whichever is greater.
const stateActiveDuty = (input, data) => {
  validatePeriods(input.periods, "State active duty");
  if (!input.firstPayDate) throw new PayRuleError("State active duty: enter the first SAD pay date");
  const { from, to } = yearBounds(input.taxYear);
  const lag = input.payLagDays || 0;
  const minimum = data.sad.sadDailyMinimum;
  const allowances = allowanceRates(input, data);
  const paydays = everyNDays(input.firstPayDate, 14, input.firstPayDate, addDays(to, 400));
  const byPayday = new Map();
  const notes = [...notesForOutsideYear(input.periods, input.taxYear, "SAD")];
  const rateHistory = new Map();
  let minimumDays = 0;
  let deferredDays = 0;

  for (const { start, end } of input.periods) {
    const first = start < from ? from : start;
    const last = end > to ? to : end;
    for (const day of first <= last ? eachDay(first, last) : []) {
      const earliest = addDays(day, lag);
      const payday = paydays.find((date) => date >= earliest);
      if (!payday || payday > to) {
        deferredDays += 1;
        continue;
      }
      const rate = basicFor(input, data, day);
      rateHistory.set(`${rate.amount}|${rate.column}`, rate);
      const basicDaily = rate.amount / 30;
      const allowanceDaily = (allowances.bah + allowances.bas) / 30;
      const entry = byPayday.get(payday) || { basic: 0, allowance: 0, minimum: 0, days: 0, from: day, to: day };
      if (basicDaily + allowanceDaily >= minimum) {
        entry.basic += basicDaily;
        entry.allowance += allowanceDaily;
      } else {
        entry.minimum += minimum;
        minimumDays += 1;
      }
      entry.days += 1;
      entry.to = day;
      byPayday.set(payday, entry);
    }
  }

  if (deferredDays) notes.push(`${deferredDays} SAD day(s) would be paid after ${to} under the schedule entered and are not included in ${input.taxYear}.`);
  if (minimumDays) notes.push(`${minimumDays} SAD day(s) paid at the $${minimum}/day statutory minimum because federal-equivalent pay and allowances were lower.`);

  const events = [...byPayday.entries()].map(([date, entry]) => {
    const components = [];
    if (entry.basic) components.push({ kind: "sad-basic", label: "SAD pay (federal-equivalent basic pay)", amount: cents(entry.basic) });
    if (entry.allowance) components.push({ kind: "sad-allowance", label: "SAD allowances (federal-equivalent BAH/BAS)", amount: cents(entry.allowance) });
    if (entry.minimum) components.push({ kind: "sad-minimum", label: `SAD pay at $${minimum}/day minimum`, amount: cents(entry.minimum) });
    return {
      date,
      payer: "NYS",
      period: "biweekly",
      stream: "regular",
      coverage: `${entry.days} SAD day(s), ${entry.from} to ${entry.to}`,
      components,
    };
  });

  return {
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    rates: [...rateHistory.values()],
    allowances,
    notes: [
      ...notes,
      "SAD pay is counted per calendar day of duty; the daily federal equivalent is the monthly rate / 30 (DMNA's exact conversion was not published in the sources retrieved).",
      `Each SAD paycheck is assumed to cover days up to ${lag} day(s) before its pay date, every 14 days from ${input.firstPayDate}; the DMNA payroll calendar was not verified.`,
    ],
  };
};

const additionalPayments = (input, taxYear) => {
  if (!input || !input.enabled) return { events: [], dates: [], notes: [] };
  if (!(input.amount > 0)) throw new PayRuleError("Additional payment amount must be greater than zero");
  if (!input.firstDate) throw new PayRuleError("Additional payment: enter the first payment date");
  const { from, to } = yearBounds(taxYear);
  const last = input.endDate && input.endDate < to ? input.endDate : to;
  const dates = everyNDays(input.firstDate, input.intervalDays || 14, from, last);
  return {
    dates,
    events: dates.map((date) => ({
      date,
      payer: "NYS",
      period: "biweekly",
      stream: "supplemental",
      coverage: `Additional payment every ${input.intervalDays || 14} days from ${input.firstDate}`,
      components: [{ kind: "additional", label: input.label || "Additional payment", amount: cents(input.amount) }],
    })),
    notes: [`${dates.length} additional payment date(s) fall in ${taxYear} (every ${input.intervalDays || 14} days from ${input.firstDate}${input.endDate ? ` through ${input.endDate}` : ""}).`],
  };
};

module.exports = { activeDuty, drill, stateActiveDuty, additionalPayments };
