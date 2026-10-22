const test = require("node:test");
const assert = require("node:assert/strict");
const { data, progressive } = require("./helpers");
const { taxFromBrackets, federalLiability, withholdingForPayment, supplementalFlatWithholding } = require("../lib/tax/federal");
const { createFicaTracker, additionalMedicareLiability } = require("../lib/tax/fica");

const irs = data("irs-federal-tax");
const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
// Rev. Proc. 2025-32 sec. 3.01 thresholds, transcribed independently of the snapshot.
const THRESHOLDS = {
  single: [0, 12400, 50400, 105700, 201775, 256225, 640600],
  mfs: [0, 12400, 50400, 105700, 201775, 256225, 384350],
  mfj: [0, 24800, 100800, 211400, 403550, 512450, 768700],
  qss: [0, 24800, 100800, 211400, 403550, 512450, 768700],
  hoh: [0, 17700, 67450, 105700, 201750, 256200, 640600],
};

test("every federal bracket boundary for every filing status", () => {
  for (const [status, thresholds] of Object.entries(THRESHOLDS)) {
    for (const boundary of thresholds.slice(1)) {
      for (const income of [boundary - 1, boundary, boundary + 1]) {
        assert.equal(taxFromBrackets(irs, status, income).tax, progressive(thresholds, RATES, income), `${status} at ${income}`);
      }
    }
  }
});

test("published Rev. Proc. amounts at bracket tops", () => {
  assert.equal(taxFromBrackets(irs, "mfj", 100800).tax, 11600);
  assert.equal(taxFromBrackets(irs, "hoh", 640600).tax, 191171);
  assert.equal(taxFromBrackets(irs, "single", 640600).tax, 192979.25);
  assert.equal(taxFromBrackets(irs, "mfs", 384350).tax, 103291.75);
});

test("progressive tax is not a flat rate on all income", () => {
  const { tax, marginalRate } = taxFromBrackets(irs, "single", 60000);
  assert.equal(marginalRate, 0.22);
  assert.ok(tax < 60000 * 0.22);
  assert.equal(tax, 1240 + 4560 + 9600 * 0.22);
});

test("standard deductions by filing status (Rev. Proc. 2025-32 sec. 3.14)", () => {
  const expected = { single: 16100, mfs: 16100, mfj: 32200, qss: 32200, hoh: 24150 };
  for (const [status, deduction] of Object.entries(expected)) {
    assert.equal(federalLiability(irs, { filingStatus: status, wages: 50000 }).taxableIncome, 50000 - deduction);
  }
});

test("child tax credit: $2,200 per child, phase-out at $200k/$400k, refundable portion capped", () => {
  const joint = federalLiability(irs, { filingStatus: "mfj", wages: 120000, qualifyingChildren: 2 });
  assert.equal(joint.credits.nonrefundable, 4400);
  const phased = federalLiability(irs, { filingStatus: "single", wages: 210500, qualifyingChildren: 1 });
  assert.equal(phased.credits.reduction, 550); // $10,500 over -> 11 x $50
  const low = federalLiability(irs, { filingStatus: "hoh", wages: 20000, qualifyingChildren: 2 });
  // Tax is $0 after the deduction, so only the refundable part applies: min(2 x 1,700, 15% x (20,000 - 2,500)).
  assert.equal(low.credits.refundable, 2625);
});

// Pub 15-T (2026) wage-bracket rows (manual-payroll tables): an independent IRS table.
// Each row is [at least, less than, MFJ std, MFJ box, HoH std, HoH box, Single std, Single box].
const WAGE_BRACKET_ROWS = {
  biweekly: [[1285, 1305, 6, 72, 37, 93, 72, 115], [3095, 3125, 206, 345, 248, 458, 345, 530], [3455, 3485, 249, 424, 291, 544, 424, 616]],
  semimonthly: [[1250, 1265, 0, 60, 25, 83, 60, 105], [3100, 3135, 192, 318, 239, 436, 318, 513], [3310, 3345, 218, 364, 264, 486, 364, 564]],
};

test("percentage-method withholding agrees with Pub 15-T wage-bracket tables within table rounding", () => {
  for (const [period, rows] of Object.entries(WAGE_BRACKET_ROWS)) {
    for (const [low, high, ...amounts] of rows) {
      const wages = (low + high) / 2;
      const cases = [["mfj", false], ["mfj", true], ["hoh", false], ["hoh", true], ["single", false], ["single", true]];
      cases.forEach(([filingStatus, multipleJobs], index) => {
        const withheld = withholdingForPayment(irs, { wages, period, w4: { filingStatus, multipleJobs } });
        assert.ok(Math.abs(withheld - amounts[index]) <= 1, `${period} ${low}-${high} ${filingStatus}${multipleJobs ? " box" : ""}: ${withheld} vs ${amounts[index]}`);
      });
    }
  }
});

test("W-4 step 3 credits, 4(a), 4(b), 4(c) adjust withholding per Worksheet 1A", () => {
  const base = withholdingForPayment(irs, { wages: 4000, period: "biweekly", w4: { filingStatus: "single" } });
  assert.equal(withholdingForPayment(irs, { wages: 4000, period: "biweekly", w4: { filingStatus: "single", credits: 2600 } }), Math.round((base - 100) * 100) / 100);
  assert.equal(withholdingForPayment(irs, { wages: 4000, period: "biweekly", w4: { filingStatus: "single", extraWithholding: 25 } }), base + 25);
  assert.ok(withholdingForPayment(irs, { wages: 4000, period: "biweekly", w4: { filingStatus: "single", deductions: 26000 } }) < base);
  assert.ok(withholdingForPayment(irs, { wages: 4000, period: "biweekly", w4: { filingStatus: "single", otherIncome: 26000 } }) > base);
});

test("supplemental flat rate is 22%", () => {
  assert.equal(supplementalFlatWithholding(irs, 2000), 440);
});

test("Social Security stops at the $184,500 wage base; Additional Medicare starts over $200,000", () => {
  const tracker = createFicaTracker(irs, { NYS: 180000 });
  const crossing = tracker.withhold("NYS", 10000);
  assert.equal(crossing.socialSecurity, 4500 * 0.062);
  assert.equal(crossing.medicare, 145);
  assert.equal(crossing.additionalMedicare, 0);
  const over = tracker.withhold("NYS", 20000);
  assert.equal(over.socialSecurity, 0);
  assert.equal(over.additionalMedicare, 90); // 10,000 over $200,000 x 0.9%
  const otherPayer = tracker.withhold("DFAS", 1000);
  assert.equal(otherPayer.socialSecurity, 62); // wage base is tracked per employer
});

test("Additional Medicare liability thresholds by filing status", () => {
  assert.equal(additionalMedicareLiability(irs, "mfj", 260000), 90);
  assert.equal(additionalMedicareLiability(irs, "mfs", 135000), 90);
  assert.equal(additionalMedicareLiability(irs, "single", 210000), 90);
  assert.equal(additionalMedicareLiability(irs, "hoh", 200000), 0);
});
