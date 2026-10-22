// End-to-end scenarios through input parsing, pay, tax, and gating.
const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");
const { InputError } = require("../lib/calculator/inputs");

const SAD_YEAR = {
  mode: "sad", taxYear: "2026", grade: "E-4", serviceStartDate: "2020-01-01",
  periods: "2026-01-01 to 2026-12-31", sadFirstPayDate: "2026-01-02",
  additionalEnabled: "on", additionalAmount: "2000", additionalFirstDate: "2026-01-02",
  filingStatus: "single", nyResidency: "resident", localResidency: "none", sadWithinNy: "on",
};

test("additional payment defaults to $2,000 every 14 days and is taxed by default", () => {
  const result = run(SAD_YEAR);
  assert.equal(result.additionalDates.length, 26);
  assert.equal(result.byComponent["Additional payment (user-reported)"], 52000);
  const bonus = result.rows[0].components.find((c) => c.kind === "additional");
  assert.equal(bonus.treatment.federal.status, "taxable");
  assert.equal(bonus.treatment.federal.basis, "assumed");
  assert.equal(bonus.treatment.ny.status, "taxable");
});

test("tax-free additional payment is only applied when explicitly selected, per tax", () => {
  const result = run({ ...SAD_YEAR, additionalFederal: "excluded", additionalNy: "taxable" });
  const withBonus = run(SAD_YEAR);
  assert.equal(withBonus.totals.federalWages - result.totals.federalWages, 52000);
  assert.equal(result.totals.nyWages, withBonus.totals.nyWages);
});

test("SAD payroll tax unresolved: gated, net shown both ways", () => {
  const result = run(SAD_YEAR);
  assert.equal(result.totals.withholding.socialSecurity, 0);
  assert.ok(result.totals.ficaIfApplied > 0);
  assert.ok(result.totals.netIfFicaApplied < result.totals.net);
  assert.ok(result.gated.some((g) => /Social Security/.test(g.item)));
  const subject = run({ ...SAD_YEAR, sadPayrollTax: "subject" });
  // Withheld per paycheck and rounded each time, so compare within a few cents.
  assert.ok(Math.abs(subject.totals.withholding.socialSecurity - Math.min(subject.totals.ficaWages, 184500) * 0.062) < 0.5);
});

test("SAD under Military Law 6.1 within NY: S-126 removes SAD pay from NY and NYC tax", () => {
  const unknown = run({ ...SAD_YEAR, localResidency: "nyc", additionalEnabled: "" });
  const s126 = run({ ...SAD_YEAR, localResidency: "nyc", additionalEnabled: "", sadOrdersAuthority: "6.1" });
  assert.ok(unknown.liability.nys > 0 && unknown.liability.nyc > 0);
  assert.equal(s126.newYork.nyagi, 0);
  assert.equal(s126.liability.nyc, 0);
  assert.ok(s126.federal.incomeTaxAfterCredits > 0, "S-126 does not change federal tax");
  assert.ok(unknown.missingInformation.some((m) => /6\.1/.test(m)));
});

test("SAD outside NY does not get S-126 even with 6.1 orders", () => {
  const result = run({ ...SAD_YEAR, additionalEnabled: "", sadOrdersAuthority: "6.1", sadWithinNy: "" });
  assert.ok(result.newYork.nyagi > 0);
});

test("SAD allowances are not automatically excluded like federal BAH/BAS", () => {
  const result = run({ ...SAD_YEAR, additionalEnabled: "", bahSource: "locality", housingArea: "NY219", basEligible: "on" });
  const allowance = result.rows[0].components.find((c) => c.kind === "sad-allowance");
  assert.equal(allowance.treatment.federal.status, "taxable");
  assert.equal(result.totals.federalWages, result.totals.gross);
});

test("federal active duty: BAH/BAS excluded, basic pay subject to FICA", () => {
  const result = run({ mode: "active", taxYear: "2026", grade: "E-5", serviceStartDate: "2020-01-01", periods: "2026-01-01 to 2026-12-31", bahSource: "locality", housingArea: "NY219", withDependents: "yes", basEligible: "on", ordersAtLeast30Days: "on", additionalEnabled: "", filingStatus: "single", nyResidency: "resident" });
  assert.equal(result.totals.federalWages, 12 * 4110);
  assert.equal(result.totals.ficaWages, 12 * 4110);
  assert.equal(result.totals.gross, 115883.4); // 12 x (4,110.00 + 5,070 + 476.95)
  assert.equal(result.rows.length, 24);
  assert.throws(() => run({ mode: "active", taxYear: "2026", grade: "E-5", serviceStartDate: "2020-01-01", periods: "2026-06-01 to 2026-06-14", bahSource: "locality", additionalEnabled: "" }), /BAH RC\/T/);
});

test("active duty NY nonresident: military pay is not NY income; stationed in Yonkers owes no Yonkers tax", () => {
  const result = run({ mode: "active", taxYear: "2026", grade: "E-5", serviceStartDate: "2020-01-01", periods: "2026-01-01 to 2026-12-31", additionalEnabled: "", filingStatus: "single", nyResidency: "nonresident", worksInYonkers: "on" });
  assert.equal(result.liability.nys, 0);
  assert.equal(result.liability.yonkers, 0);
  assert.equal(result.totals.withholding.nys, 0);
});

test("NY militia on Title 10 non-training orders in NY: S-126 applies; otherwise NY resident pay is taxed", () => {
  const base = { mode: "active", taxYear: "2026", grade: "O-3", serviceStartDate: "2018-01-01", periods: "2026-01-01 to 2026-06-30", additionalEnabled: "", filingStatus: "mfj", nyResidency: "resident" };
  assert.ok(run(base).liability.nys > 0);
  assert.equal(run({ ...base, nyOrganizedMilitia: "on", title10NonTrainingInNy: "on" }).newYork.nyagi, 0);
});

test("drill pay is NY-taxable for residents (training is excluded from S-126)", () => {
  const result = run({ mode: "drill", taxYear: "2026", grade: "E-6", serviceStartDate: "2016-01-01", drills: "2026-02-07, 2\n2026-02-08, 2", additionalEnabled: "", filingStatus: "single", nyResidency: "resident", otherWages: "60000" });
  assert.equal(result.newYork.subtractions, 0);
  assert.ok(result.liability.nys > 0);
});

test("Yonkers resident surcharge is 16.75% of NYS tax; Yonkers nonresident SAD work is taxed at 0.5% after exclusion", () => {
  const resident = run({ ...SAD_YEAR, additionalEnabled: "", localResidency: "yonkers" });
  assert.equal(resident.liability.yonkers, Math.round(resident.liability.nys * 0.1675 * 100) / 100);
  const nonresident = run({ ...SAD_YEAR, additionalEnabled: "", worksInYonkers: "on" });
  assert.equal(nonresident.newYork.yonkers.type, "nonresident earnings tax");
  assert.equal(nonresident.liability.yonkers, Math.round(nonresident.totals.yonkersNonresidentWages * 0.005 * 100) / 100);
});

test("NYC tax only for NYC residents; ZIP code is not an input", () => {
  const nyc = run({ ...SAD_YEAR, additionalEnabled: "", localResidency: "nyc" });
  const upstate = run({ ...SAD_YEAR, additionalEnabled: "" });
  assert.ok(nyc.liability.nyc > 0);
  assert.equal(upstate.liability.nyc, 0);
  assert.throws(() => run({ ...SAD_YEAR, nyResidency: "nonresident", localResidency: "nyc" }), InputError);
});

test("part-year residency gates only the NY calculation", () => {
  const result = run({ ...SAD_YEAR, additionalEnabled: "", nyResidency: "part-year" });
  assert.equal(result.newYork, null);
  assert.equal(result.liability.nys, null);
  assert.ok(result.federal.incomeTaxAfterCredits > 0);
  assert.ok(result.gated.some((g) => /New York/.test(g.item)));
});

test("filing statuses all calculate", () => {
  for (const filingStatus of ["single", "mfj", "mfs", "hoh", "qss"]) {
    const result = run({ ...SAD_YEAR, filingStatus, qualifyingChildren: filingStatus === "hoh" ? "1" : "0" });
    assert.equal(result.status, "ok");
  }
});

test("liability and withholding are reported separately; annual / periods is not presented as withholding", () => {
  const result = run(SAD_YEAR);
  const perPeriod = result.rows.map((r) => r.withholding.federal);
  assert.ok(new Set(perPeriod).size > 1 || result.rows.length === 1);
  assert.notEqual(result.totals.withholding.federal, result.liability.federalIncomeTax);
});

test("monthly view: calendar totals differ from the average when a month has three payments", () => {
  const result = run({ ...SAD_YEAR, sadFirstPayDate: "2026-01-02" });
  const january = result.monthly.find((m) => m.month === "2026-01");
  assert.equal(january.payments, 3);
  assert.ok(january.net > result.average.net);
});

test("a tax year without validated data is blocked rather than using 2026 rates", () => {
  const result = run({ ...SAD_YEAR, taxYear: "2027", periods: "2027-01-01 to 2027-03-31", sadFirstPayDate: "2027-01-08", additionalFirstDate: "2027-01-08" });
  assert.equal(result.status, "blocked");
  assert.equal(result.blocked.length, 6);
});

test("input validation rejects malformed or identifying-data-free bad input", () => {
  assert.throws(() => run({ ...SAD_YEAR, periods: "March to June" }), InputError);
  assert.throws(() => run({ ...SAD_YEAR, sadFirstPayDate: "" }), InputError);
  assert.throws(() => run({ ...SAD_YEAR, grade: "E-10" }), InputError);
  assert.throws(() => run({ ...SAD_YEAR, additionalFirstDate: "" }), InputError);
});
