const test = require("node:test");
const assert = require("node:assert/strict");
const { everyNDays, thirtyDayWeight, completedYears, daysInMonth, parseDate } = require("../lib/pay/dates");

test("every 14 days from Jan 1, 2026 gives 27 payments ending Dec 31", () => {
  const dates = everyNDays("2026-01-01", 14, "2026-01-01", "2026-12-31");
  assert.equal(dates.length, 27);
  assert.deepEqual(dates.slice(0, 4), ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12"]);
  assert.equal(dates[26], "2026-12-31");
});

test("every 14 days from Jan 2, 2026 gives 26 payments (the 27th lands on Jan 1, 2027)", () => {
  const dates = everyNDays("2026-01-02", 14, "2026-01-01", "2026-12-31");
  assert.equal(dates.length, 26);
  assert.equal(dates[25], "2026-12-18");
  assert.deepEqual(everyNDays("2026-01-02", 14, "2027-01-01", "2027-01-01"), ["2027-01-01"]);
});

test("leap year 2028: a Jan 2 start still yields 27 payments", () => {
  const dates = everyNDays("2028-01-02", 14, "2028-01-01", "2028-12-31");
  assert.equal(dates.length, 27);
  assert.equal(dates[26], "2028-12-31");
});

test("a schedule that started last year continues on its own 14-day cycle", () => {
  const dates = everyNDays("2025-12-19", 14, "2026-01-01", "2026-02-28");
  assert.deepEqual(dates, ["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27"]);
});

test("14-day payments are not twice a month: some months get three", () => {
  const dates = everyNDays("2026-01-02", 14, "2026-01-01", "2026-12-31");
  const perMonth = {};
  dates.forEach((date) => { perMonth[date.slice(0, 7)] = (perMonth[date.slice(0, 7)] || 0) + 1; });
  assert.equal(perMonth["2026-01"], 3); // Jan 2, 16, 30
  assert.equal(perMonth["2026-07"], 3); // Jul 3, 17, 31
  assert.equal(perMonth["2026-02"], 2);
});

test("30-day convention: every full month weighs exactly 30 days", () => {
  for (const year of [2026, 2028]) {
    for (let month = 1; month <= 12; month += 1) {
      let total = 0;
      for (let day = 1; day <= daysInMonth(year, month); day += 1) {
        total += thirtyDayWeight(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      }
      assert.equal(total, 30, `${year}-${month}`);
    }
  }
  assert.equal(thirtyDayWeight("2026-01-31"), 0);
  assert.equal(thirtyDayWeight("2026-02-28"), 3);
  assert.equal(thirtyDayWeight("2028-02-29"), 2);
});

test("completed years change on the anniversary date", () => {
  assert.equal(completedYears("2022-03-20", "2026-03-19"), 3);
  assert.equal(completedYears("2022-03-20", "2026-03-20"), 4);
});

test("invalid calendar dates are rejected", () => {
  assert.throws(() => parseDate("2026-02-30"));
  assert.throws(() => parseDate("03/01/2026"));
});
