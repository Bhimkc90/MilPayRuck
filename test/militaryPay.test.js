const test = require("node:test");
const assert = require("node:assert/strict");
const { data } = require("./helpers");
const oracle = require("./fixtures/dfasDrillOracle");
const { monthlyBasicPay, drillPeriodPay, monthlyBah, monthlyBas, PayRuleError } = require("../lib/pay/militaryPay");

const pay = data("dfas-military-pay");
const startForYears = (years) => `${2026 - years}-01-01`;

test("drill pay (basic / 30) matches every DFAS 2026 enlisted drill-table cell", () => {
  for (const [grade, cells] of Object.entries(oracle)) {
    if (grade === "knownDefects") continue;
    for (const [years, expected] of Object.entries(cells)) {
      const { amount } = monthlyBasicPay(pay, grade, startForYears(Number(years)), "2026-06-01");
      assert.equal(drillPeriodPay(amount), expected, `${grade} over ${years}`);
    }
  }
});

test("known DFAS drill-table defect (E-1 Over 26+) is not reproduced", () => {
  for (const [years, published] of Object.entries(oracle.knownDefects["E-1"])) {
    const { amount } = monthlyBasicPay(pay, "E-1", startForYears(Number(years)), "2026-06-01");
    assert.equal(drillPeriodPay(amount), 80.24);
    assert.notEqual(drillPeriodPay(amount), published);
  }
});

test("service-column boundaries switch on the anniversary", () => {
  assert.equal(monthlyBasicPay(pay, "E-5", "2024-06-01", "2026-05-31").amount, 3342.9);
  assert.equal(monthlyBasicPay(pay, "E-5", "2024-06-01", "2026-06-01").amount, 3598.2);
  assert.equal(monthlyBasicPay(pay, "O-3", "2006-01-01", "2026-01-01").amount, 9004.2);
  assert.equal(monthlyBasicPay(pay, "W-5", "2006-01-01", "2026-01-01").amount, 10169.7);
});

test("grades with no published rate at low service are refused, not guessed", () => {
  assert.throws(() => monthlyBasicPay(pay, "E-9", "2018-01-01", "2026-06-01"), PayRuleError);
  assert.throws(() => monthlyBasicPay(pay, "O-1E", "2024-01-01", "2026-06-01"), PayRuleError);
  assert.throws(() => monthlyBasicPay(pay, "W-5", "2010-01-01", "2026-06-01"), PayRuleError);
});

test("E-1 under 4 months and general officer caps", () => {
  assert.equal(monthlyBasicPay(pay, "E-1", "2026-03-01", "2026-06-15", { activeDutyMonths: 3 }).amount, 2225.7);
  assert.equal(monthlyBasicPay(pay, "E-1", "2026-03-01", "2026-07-01", { activeDutyMonths: 4 }).amount, 2407.2);
  assert.equal(monthlyBasicPay(pay, "O-10", "1990-01-01", "2026-06-01").amount, 18999.9);
  assert.equal(monthlyBasicPay(pay, "O-6", "1980-01-01", "2026-06-01").amount, 15408.3);
});

test("BAS and BAH lookups", () => {
  assert.equal(monthlyBas(pay, "E-4"), 476.95);
  assert.equal(monthlyBas(pay, "W-2"), 328.48);
  const bah = data("dtmo-bah-ny");
  assert.equal(monthlyBah(bah, "NY219", "E-5", true).amount, 5070);
  assert.equal(monthlyBah(bah, "NY219", "O-9", false).amount, monthlyBah(bah, "NY219", "O-7", false).amount);
  assert.throws(() => monthlyBah(bah, "TX270", "E-5", true), PayRuleError);
});
