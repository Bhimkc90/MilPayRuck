// Federal income tax: annual liability (Rev. Proc. 2025-32) and per-paycheck withholding
// (Pub 15-T Worksheet 1A, Annual Percentage Method). Liability and withholding are kept
// separate on purpose: withholding is an estimate of what payroll deducts, not the tax owed.

const cents = (value) => Math.round(value * 100) / 100;

const scheduleFor = (irs, filingStatus) => {
  const schedule = irs.brackets[filingStatus];
  if (!schedule) throw new Error(`Unsupported federal filing status ${filingStatus}`);
  return schedule.sameAs ? irs.brackets[schedule.sameAs] : schedule;
};

// Progressive tax: each rate applies only to income inside its bracket.
const taxFromBrackets = (irs, filingStatus, taxableIncome) => {
  const { thresholds, publishedBase } = scheduleFor(irs, filingStatus);
  const { rates } = irs.brackets;
  if (taxableIncome <= 0) return { tax: 0, marginalRate: rates[0], bracketIndex: 0 };
  let index = 0;
  thresholds.forEach((threshold, position) => {
    if (taxableIncome > threshold) index = position;
  });
  return {
    tax: cents(publishedBase[index] + (taxableIncome - thresholds[index]) * rates[index]),
    marginalRate: rates[index],
    bracketIndex: index,
  };
};

const childCredits = (irs, filingStatus, agi, incomeTax, earnedIncome, children, otherDependents) => {
  const rules = irs.credits;
  const maximum = children * rules.childTaxCreditPerChild + otherDependents * rules.otherDependentCredit;
  if (maximum === 0) return { maximum: 0, reduction: 0, nonrefundable: 0, refundable: 0 };
  const threshold = filingStatus === "mfj" ? rules.phaseOutThreshold.mfj : rules.phaseOutThreshold.others;
  const reduction = agi > threshold ? Math.ceil((agi - threshold) / 1000) * rules.phaseOutPer1000 : 0;
  const allowed = Math.max(0, maximum - reduction);
  const nonrefundable = Math.min(allowed, incomeTax);
  const childPortionLeft = Math.max(0, Math.min(allowed, children * rules.childTaxCreditPerChild) - nonrefundable);
  const refundable = Math.min(
    childPortionLeft,
    children * rules.refundablePerChild,
    Math.max(0, (earnedIncome - rules.refundableEarnedIncomeFloor) * rules.refundableRate)
  );
  return { maximum, reduction, nonrefundable: cents(nonrefundable), refundable: cents(refundable) };
};

const federalLiability = (irs, input) => {
  const {
    filingStatus, wages, otherWages = 0, otherIncome = 0, adjustments = 0,
    itemizedDeductions = 0, qualifyingChildren = 0, otherDependents = 0,
  } = input;
  const agi = Math.max(0, wages + otherWages + otherIncome - adjustments);
  const standardDeduction = irs.standardDeduction[filingStatus];
  const deduction = Math.max(standardDeduction, itemizedDeductions);
  const taxableIncome = Math.max(0, agi - deduction);
  const { tax, marginalRate } = taxFromBrackets(irs, filingStatus, taxableIncome);
  const credits = childCredits(irs, filingStatus, agi, tax, wages + otherWages, qualifyingChildren, otherDependents);
  const incomeTaxAfterCredits = cents(tax - credits.nonrefundable - credits.refundable);
  return {
    agi: cents(agi),
    deductionUsed: deduction === standardDeduction ? "standard" : "itemized",
    deduction,
    taxableIncome: cents(taxableIncome),
    taxBeforeCredits: tax,
    marginalRate,
    effectiveRateOnTaxable: taxableIncome > 0 ? tax / taxableIncome : 0,
    credits,
    incomeTaxAfterCredits,
  };
};

// Pub 15-T Worksheet 1A for a 2020-or-later Form W-4.
const withholdingForPayment = (irs, { wages, period, w4 }) => {
  const periods = irs.withholding.payPeriodsPerYear[period];
  if (!periods) throw new Error(`Unsupported pay period ${period}`);
  const status = w4.filingStatus === "mfj" || w4.filingStatus === "qss" ? "mfj" : w4.filingStatus === "hoh" ? "hoh" : "single";
  const annual = wages * periods + (w4.otherIncome || 0);
  const line1g = w4.multipleJobs ? 0 : status === "mfj" ? irs.withholding.line1g.mfj : irs.withholding.line1g.others;
  const adjusted = Math.max(0, annual - (w4.deductions || 0) - line1g);
  const table = irs.withholding.tables[w4.multipleJobs ? "checkbox" : "standard"][status];
  const row = table.find(([atLeast, lessThan]) => adjusted >= atLeast && (lessThan === null || adjusted < lessThan));
  const tentativeAnnual = row[2] + (adjusted - row[0]) * row[3];
  const tentative = tentativeAnnual / periods;
  const afterCredits = Math.max(0, tentative - (w4.credits || 0) / periods);
  return cents(afterCredits + (w4.extraWithholding || 0));
};

const supplementalFlatWithholding = (irs, amount) => cents(amount * irs.withholding.supplementalFlatRate);

module.exports = { taxFromBrackets, federalLiability, withholdingForPayment, supplementalFlatWithholding, childCredits };
