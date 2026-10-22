const test = require("node:test");
const assert = require("node:assert/strict");
const { data } = require("./helpers");
const { activeDuty, drill, stateActiveDuty, additionalPayments } = require("../lib/pay/payModes");
const { PayRuleError } = require("../lib/pay/militaryPay");

const bundle = { pay: data("dfas-military-pay"), bah: data("dtmo-bah-ny"), sad: data("ny-sad-rules") };
const total = (events, kind) => Math.round(events.flatMap((e) => e.components).filter((c) => !kind || c.kind === kind).reduce((s, c) => s + c.amount, 0) * 100) / 100;

test("active duty full year: 24 DFAS paydays, 12 x monthly basic, December paid Dec 31", () => {
  const result = activeDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-01-01", end: "2026-12-31" }], bah: { source: "none" }, basEligible: true }, bundle);
  assert.equal(result.events.length, 24);
  assert.equal(total(result.events, "basic"), 12 * 3815.4);
  assert.equal(total(result.events, "bas"), 12 * 476.95);
  assert.equal(result.events.at(-1).date, "2026-12-31");
  assert.equal(result.events.find((e) => e.date === "2026-04-01").coverage.startsWith("2026-03-16"), true);
});

test("active duty partial month: 31st unpaid, February credited to 30", () => {
  const march = activeDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-03-10", end: "2026-03-31" }], bah: { source: "none" } }, bundle);
  // Days 10-30 = 21 paid days; 3815.40 / 30 = 127.18 per day.
  assert.equal(total(march.events), 21 * 127.18);
  const feb = activeDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-02-15", end: "2026-02-28" }], bah: { source: "none" } }, bundle);
  assert.equal(total(feb.events), 16 * 127.18);
});

test("active duty rate change on the service anniversary mid-month", () => {
  const result = activeDuty({ grade: "E-4", serviceStartDate: "2022-03-20", taxYear: 2026, periods: [{ start: "2026-03-01", end: "2026-03-31" }], bah: { source: "none" } }, bundle);
  const [mid, end] = result.events;
  // Days 1-15 at Over 3 (3482.40/30 = 116.08); days 16-19 at 116.08 and 20-30 at Over 4 (3658.50/30 = 121.95).
  assert.equal(mid.components[0].amount, 1741.2);
  assert.equal(end.components[0].amount, 1805.77);
  assert.deepEqual(result.rates.map((r) => r.amount), [3482.4, 3658.5]);
});

test("active duty BAH by housing area is prorated with basic pay", () => {
  const result = activeDuty({ grade: "E-5", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-06-01", end: "2026-06-30" }], bah: { source: "locality", housingArea: "NY219", withDependents: true } }, bundle);
  assert.equal(total(result.events, "bah"), 5070);
});

test("drill: four periods match the DFAS '4 Drills' amount", () => {
  const result = drill({ grade: "E-5", serviceStartDate: "2022-01-01", taxYear: 2026, drills: [{ date: "2026-03-14", periods: 2 }, { date: "2026-03-15", periods: 2 }] }, bundle);
  // DFAS 2026 drill table: E-5 Over 4, 4 drills = $526.24.
  assert.equal(total(result.events), 526.24);
});

test("drill paid in the next year is excluded from this tax year", () => {
  const result = drill({ grade: "E-5", serviceStartDate: "2022-01-01", taxYear: 2026, payLagDays: 10, drills: [{ date: "2026-12-26", periods: 4 }, { date: "2026-06-06", periods: 4 }] }, bundle);
  assert.equal(result.events.length, 1);
  assert.match(result.notes.join(" "), /next tax year/);
});

test("SAD pays the $125/day minimum when federal-equivalent pay is lower", () => {
  const result = stateActiveDuty({ grade: "E-1", serviceStartDate: "2024-01-01", taxYear: 2026, periods: [{ start: "2026-04-01", end: "2026-04-14" }], bah: { source: "none" }, basEligible: false, firstPayDate: "2026-04-17" }, bundle);
  // E-1: 2407.20 / 30 = 80.24 per day < $125, so 14 x 125.
  assert.equal(total(result.events), 1750);
  assert.equal(result.events[0].components[0].kind, "sad-minimum");
});

test("SAD pays federal-equivalent pay and allowances per calendar day when higher than $125", () => {
  const result = stateActiveDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-05-01", end: "2026-05-31" }], bah: { source: "locality", housingArea: "NY219", withDependents: false }, basEligible: true, firstPayDate: "2026-05-08" }, bundle);
  // (3815.40 + 4833 + 476.95) / 30 per day x 31 calendar days (no 30-day convention on SAD).
  // Each paycheck is rounded to the cent, so allow one cent per paycheck.
  assert.ok(Math.abs(total(result.events) - (3815.4 + 4833 + 476.95) / 30 * 31) <= 0.03);
  assert.deepEqual(result.events.map((e) => e.date), ["2026-05-08", "2026-05-22", "2026-06-05"]);
});

test("SAD days paid after Dec 31 are excluded and reported", () => {
  const result = stateActiveDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-12-01", end: "2026-12-31" }], bah: { source: "none" }, firstPayDate: "2026-01-02" }, bundle);
  assert.equal(result.events.at(-1).date, "2026-12-18");
  assert.match(result.notes.join(" "), /13 SAD day\(s\) would be paid after 2026-12-31/);
});

test("additional payment: $2,000 every 14 days, 27 dates when the cycle starts Jan 1", () => {
  const result = additionalPayments({ enabled: true, amount: 2000, firstDate: "2026-01-01", intervalDays: 14 }, 2026);
  assert.equal(result.events.length, 27);
  assert.equal(total(result.events), 54000);
  const capped = additionalPayments({ enabled: true, amount: 2000, firstDate: "2026-01-01", intervalDays: 14, endDate: "2026-03-31" }, 2026);
  assert.deepEqual(capped.dates, ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26", "2026-03-12", "2026-03-26"]);
});

test("invalid pay inputs are refused", () => {
  assert.throws(() => additionalPayments({ enabled: true, amount: 0, firstDate: "2026-01-01" }, 2026), PayRuleError);
  assert.throws(() => stateActiveDuty({ grade: "E-4", serviceStartDate: "2020-01-01", taxYear: 2026, periods: [{ start: "2026-05-01", end: "2026-04-01" }], firstPayDate: "2026-05-08" }, bundle), PayRuleError);
});
