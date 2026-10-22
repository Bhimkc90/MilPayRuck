// Federal military pay-table lookups (DFAS basic pay, BAS, DTMO BAH).
// Pure functions over a validated snapshot; no tax logic here.

const { completedYears, completedMonths } = require("./dates");

const GRADES = [
  "E-1", "E-2", "E-3", "E-4", "E-5", "E-6", "E-7", "E-8", "E-9",
  "W-1", "W-2", "W-3", "W-4", "W-5",
  "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "O-8", "O-9", "O-10",
  "O-1E", "O-2E", "O-3E",
];

class PayRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "PayRuleError";
  }
}

const columnIndex = (columns, years) => {
  let index = -1;
  columns.forEach((threshold, position) => {
    if (years >= threshold) index = position;
  });
  return index;
};

// Monthly basic pay for a grade on a given date, using cumulative service from the
// pay entry base date. Service is counted in completed years, so the rate changes on
// the anniversary date itself.
const monthlyBasicPay = (payData, grade, serviceStartDate, onDate, { activeDutyMonths } = {}) => {
  if (!GRADES.includes(grade)) throw new PayRuleError(`Unknown pay grade ${grade}`);
  const years = completedYears(serviceStartDate, onDate);
  if (years < 0) throw new PayRuleError(`Service start date ${serviceStartDate} is after ${onDate}`);

  if (grade === "E-1" && activeDutyMonths !== undefined && activeDutyMonths < 4) {
    return { amount: payData.e1UnderFourMonths, years, column: "E-1 under 4 months" };
  }

  const columns = payData.yearsOfServiceColumns;
  const index = columnIndex(columns, years);
  const amount = payData.basicPay[grade][index];
  if (amount === null || amount === undefined) {
    const first = payData.basicPay[grade].findIndex((value) => value !== null);
    throw new PayRuleError(
      `DFAS publishes no ${grade} rate below ${columns[first]} years of service (service on ${onDate}: ${years} years).`
    );
  }
  const label = columns[index] < 2 ? "2 or less" : `Over ${columns[index]}`;
  return { amount, years, column: label };
};

const activeDutyMonthsOn = (serviceStartDate, onDate) => completedMonths(serviceStartDate, onDate);

const monthlyBas = (payData, grade) => (grade.startsWith("E") ? payData.bas.enlisted : payData.bas.officer);

const bahGradeKey = (grade) => (/^O-(8|9|10)$/.test(grade) ? "O-7" : grade);

const monthlyBah = (bahData, housingArea, grade, withDependents) => {
  const table = withDependents ? bahData.withDependents : bahData.withoutDependents;
  const area = table[housingArea];
  if (!area) throw new PayRuleError(`No 2026 BAH rate for housing area ${housingArea}`);
  const amount = area.rates[bahGradeKey(grade)];
  if (!amount) throw new PayRuleError(`No BAH rate for ${grade} in ${housingArea}`);
  return { amount, areaName: area.name };
};

// One drill period pays 1/30 of monthly basic pay, rounded to the cent as in the
// DFAS drill pay tables.
const drillPeriodPay = (monthlyBasic) => Math.round((monthlyBasic / 30) * 100) / 100;

module.exports = {
  GRADES,
  PayRuleError,
  monthlyBasicPay,
  activeDutyMonthsOn,
  monthlyBas,
  monthlyBah,
  drillPeriodPay,
};
