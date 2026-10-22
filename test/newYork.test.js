const test = require("node:test");
const assert = require("node:assert/strict");
const { data } = require("./helpers");
const { nysTax, nycTax, nycSchoolTaxCredit, yonkersNonresidentTax, exactCalculation, newYorkLiability } = require("../lib/tax/newYork");

const ny = data("ny-income-tax");
const wh = data("ny-withholding");

// IT-2105-I (2026) NYS rate schedules transcribed independently: [over, base, rate].
const NYS = {
  single: [[0, 0, 0.039], [8500, 332, 0.044], [11700, 473, 0.0515], [13900, 586, 0.054], [80650, 4191, 0.059], [215400, 12141, 0.0685], [1077550, 71198, 0.0965], [5000000, 449714, 0.103], [25000000, 2509714, 0.109]],
  mfj: [[0, 0, 0.039], [17150, 669, 0.044], [23600, 953, 0.0515], [27900, 1174, 0.054], [161550, 8391, 0.059], [323200, 17928, 0.0685], [2155350, 143430, 0.0965], [5000000, 417939, 0.103], [25000000, 2477939, 0.109]],
  hoh: [[0, 0, 0.039], [12800, 499, 0.044], [17650, 712, 0.0515], [20900, 879, 0.054], [107650, 5564, 0.059], [269300, 15101, 0.0685], [1616450, 107381, 0.0965], [5000000, 433894, 0.103], [25000000, 2493894, 0.109]],
};

test("every NYS bracket boundary (below the recapture range)", () => {
  for (const [status, rows] of Object.entries(NYS)) {
    for (const [over, base, rate] of rows.slice(1)) {
      if (over > 100000) continue; // above $107,650 NYAGI the recapture worksheets apply (tested below)
      assert.equal(nysTax(ny, status, over + 100, over + 100).tax, Math.round((base + 100 * rate) * 100) / 100, `${status} just over ${over}`);
      assert.equal(nysTax(ny, status, over, over).tax, Math.round((rows[rows.findIndex((r) => r[0] === over) - 1][1] + (over - rows[rows.findIndex((r) => r[0] === over) - 1][0]) * rows[rows.findIndex((r) => r[0] === over) - 1][2]) * 100) / 100);
    }
  }
});

test("MFS uses the single schedule and QSS the joint schedule", () => {
  assert.equal(nysTax(ny, "mfs", 50000, 50000).tax, nysTax(ny, "single", 50000, 50000).tax);
  assert.equal(nysTax(ny, "qss", 50000, 50000).tax, nysTax(ny, "mfj", 50000, 50000).tax);
});

test("NYS benefit recapture worksheets (hand-computed from IT-2105-I)", () => {
  // Worksheet 7 phase-in: table tax 4,191 + 5.9% x 31,350 = 6,040.65; flat 5.9% x 112,000 = 6,608;
  // fraction (120,000 - 107,650) / 50,000 = 0.247 -> 6,040.65 + 567.35 x 0.247 = 6,180.79.
  assert.equal(nysTax(ny, "single", 112000, 120000).tax, 6180.79);
  // Worksheet 7 at NYAGI >= 157,650: flat 5.9%.
  assert.equal(nysTax(ny, "single", 150000, 158000).tax, 8850);
  // Worksheet 1 (joint) at NYAGI >= 157,650: flat 5.4%.
  assert.equal(nysTax(ny, "mfj", 150000, 170000).tax, 8100);
  // Worksheet 8: 12,141 + 6.85% x 76,600 + 567 + 2,047 x 1 = 20,002.10.
  assert.equal(nysTax(ny, "single", 292000, 300000).tax, 20002.1);
  // Worksheet 13 (head of household) partial phase: 15,101 + 6.85% x 10,700 + 787 + 2,559 x 0.4.
  assert.equal(nysTax(ny, "hoh", 280000, 289300).tax, Math.round((15101 + 0.0685 * 10700 + 787 + 2559 * 0.4) * 100) / 100);
  // NYAGI over $25 million: 10.9% of all taxable income.
  assert.equal(nysTax(ny, "mfj", 26000000, 26000000).tax, 2834000);
});

test("NYC resident tax brackets and school tax credit", () => {
  assert.equal(nycTax(ny, "single", 12000), Math.round(12000 * 0.03078 * 100) / 100);
  assert.equal(nycTax(ny, "single", 50000), 1812.75); // 858 + 3.819% x 25,000 (the $1,813 base starts above $50,000)
  assert.equal(nycTax(ny, "mfj", 100000), Math.round((3264 + 10000 * 0.03876) * 100) / 100);
  assert.equal(nycTax(ny, "hoh", 30000), 1029.87); // 443 + 3.762% x 15,600
  const credit = nycSchoolTaxCredit(ny, "mfj", 100000, 90000);
  assert.equal(credit.fixed, 125);
  assert.equal(credit.rateReduction, Math.round((37 + (90000 - 21600) * 0.00228) * 100) / 100);
  assert.equal(nycSchoolTaxCredit(ny, "single", 300000, 600000).total, 0);
});

test("Yonkers nonresident earnings tax exclusions", () => {
  assert.equal(yonkersNonresidentTax(ny, 3999), 0);
  assert.equal(yonkersNonresidentTax(ny, 8000), 25); // (8,000 - 3,000) x 0.5%
  assert.equal(yonkersNonresidentTax(ny, 25000), 120);
  assert.equal(yonkersNonresidentTax(ny, 40000), 200);
});

// Worked examples printed in NYS-50-T-NYS, NYS-50-T-NYC and NYS-50-T-Y (1/26).
const EXAMPLES = [
  ["nys", "single", "weekly", 400, 3, 8.01],
  ["nys", "single", "semimonthly", 5000, 1, 258.51],
  ["nys", "single", "monthly", 50000, 3, 3576.63],
  ["nys", "single", "daily", 750, 2, 44.1],
  ["nys", "married", "weekly", 400, 4, 6.69],
  ["nys", "married", "semimonthly", 5000, 3, 248.11],
  ["nys", "married", "monthly", 50000, 3, 3622.09],
  ["nys", "married", "daily", 750, 2, 44.58],
  ["nyc", "married", "weekly", 400, 4, 5.17],
  ["nyc", "married", "semimonthly", 5000, 3, 184.37],
  ["nyc", "married", "monthly", 50000, 3, 2068.73],
  ["nyc", "married", "daily", 750, 2, 29.43],
  ["nyc", "single", "weekly", 400, 3, 6.11],
  ["nyc", "single", "semimonthly", 5000, 1, 188.8],
  ["nyc", "single", "monthly", 50000, 3, 2070.5],
  ["nyc", "single", "daily", 750, 2, 29.51],
];

test("NY withholding reproduces every worked example in the official publications", () => {
  for (const [jurisdiction, maritalStatus, period, wages, allowances, expected] of EXAMPLES) {
    const { amount } = exactCalculation(wh[jurisdiction], { wages, period, maritalStatus, allowances });
    // The publications round intermediate steps; NYS single semimonthly Example 2 prints
    // 165 x 0.0753 as $12.43 (exactly 12.4245), so allow one cent.
    assert.ok(Math.abs(amount - expected) <= 0.01, `${jurisdiction} ${maritalStatus} ${period} ${wages}: ${amount} vs ${expected}`);
  }
});

test("Yonkers resident withholding = NYS exact calculation x 16.75% (NYS-50-T-Y examples)", () => {
  const cases = [["weekly", 400, 3, 1.34], ["semimonthly", 5000, 1, 43.3], ["monthly", 50000, 3, 599.08], ["daily", 750, 2, 7.39]];
  for (const [period, wages, allowances, expected] of cases) {
    const { unrounded } = exactCalculation(wh.yonkersResident, { wages, period, maritalStatus: "single", allowances });
    assert.equal(Math.round(unrounded * wh.yonkersResidentFactor * 100) / 100, expected);
  }
});

test("withholding above the Method II tables is reported as unavailable, not guessed", () => {
  const result = exactCalculation(wh.nys, { wages: 60000, period: "biweekly", maritalStatus: "single", allowances: 0 });
  assert.equal(result.amount, null);
});

test("nonresident NY tax is allocated by NY-source income", () => {
  const result = newYorkLiability(ny, { filingStatus: "single", residency: "nonresident", local: "none", federalAgi: 80000, nySubtractions: 40000, nySourceIncome: 20000 });
  // NYAGI 40,000; taxable 32,000; tax 586 + 5.4% x 18,100 = 1,563.40; ratio 0.5.
  assert.equal(result.nysTaxBeforeAllocation, 1563.4);
  assert.equal(result.nys, 781.7);
  assert.equal(result.nyc, null);
});
