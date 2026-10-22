// Calendar helpers. All dates are UTC calendar days in "YYYY-MM-DD" form so that
// time zones and daylight-saving changes can never shift a payment date.

const DAY_MS = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (value) => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new Error(`Invalid date "${value}" (use YYYY-MM-DD)`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date "${value}"`);
  }
  return date;
};

const formatDate = (date) => date.toISOString().slice(0, 10);
const addDays = (value, days) => formatDate(new Date(parseDate(value).getTime() + days * DAY_MS));
const daysBetween = (from, to) => Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const yearOf = (value) => Number(value.slice(0, 4));
const monthOf = (value) => Number(value.slice(5, 7));
const dayOf = (value) => Number(value.slice(8, 10));

const eachDay = function* (start, end) {
  for (let day = start; day <= end; day = addDays(day, 1)) yield day;
};

// Every `intervalDays` days starting on `firstDate`, returning the dates within [from, to].
// A 14-day cycle is not "twice a month": most years have 26 such dates and some have 27.
const everyNDays = (firstDate, intervalDays, from, to) => {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) throw new Error("Interval must be a positive whole number of days");
  const dates = [];
  const offset = daysBetween(firstDate, from);
  const skipped = offset > 0 ? Math.ceil(offset / intervalDays) : 0;
  for (let date = addDays(firstDate, skipped * intervalDays); date <= to; date = addDays(date, intervalDays)) {
    if (date >= from) dates.push(date);
  }
  return dates;
};

// DoD FMR 30-day month convention for partial-month entitlements: each day is 1/30 of the
// monthly rate, the 31st is not paid, and the last day of February is credited with the
// days needed to reach 30. A full month therefore always pays exactly the monthly rate.
const thirtyDayWeight = (value) => {
  const day = dayOf(value);
  const month = monthOf(value);
  if (day === 31) return 0;
  if (month === 2) {
    const last = daysInMonth(yearOf(value), 2);
    if (day === last) return 30 - last + 1;
  }
  return 1;
};

const completedYears = (from, on) => {
  const start = parseDate(from);
  const end = parseDate(on);
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const anniversaryPassed =
    end.getUTCMonth() > start.getUTCMonth() ||
    (end.getUTCMonth() === start.getUTCMonth() && end.getUTCDate() >= start.getUTCDate());
  if (!anniversaryPassed) years -= 1;
  return years;
};

const completedMonths = (from, on) => {
  const start = parseDate(from);
  const end = parseDate(on);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return months;
};

module.exports = {
  parseDate,
  formatDate,
  addDays,
  daysBetween,
  daysInMonth,
  eachDay,
  everyNDays,
  thirtyDayWeight,
  completedYears,
  completedMonths,
  yearOf,
  monthOf,
  dayOf,
};
