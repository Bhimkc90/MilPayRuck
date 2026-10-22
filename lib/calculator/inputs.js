// Parses and validates calculator form input. Only fields the calculation needs are read;
// no identifiers (SSN, DoD ID, bank data) are accepted, and nothing is stored.

const { parseDate, daysBetween } = require("../pay/dates");
const { GRADES } = require("../pay/militaryPay");

const MODES = ["active", "drill", "sad"];
const FILING_STATUSES = ["single", "mfj", "mfs", "hoh", "qss"];

const DEFAULTS = {
  mode: "sad",
  taxYear: "2026",
  grade: "E-4",
  serviceStartDate: "",
  periods: "",
  drills: "",
  drillPayLagDays: "0",
  bahSource: "none",
  housingArea: "NY219",
  withDependents: "no",
  bahManual: "",
  basEligible: "",
  ordersAtLeast30Days: "on",
  sadFirstPayDate: "",
  sadPayLagDays: "0",
  sadOrdersAuthority: "unknown",
  sadWithinNy: "on",
  sadPayrollTax: "unresolved",
  sadAllowanceFederal: "taxable",
  nyOrganizedMilitia: "on",
  title10NonTrainingInNy: "",
  additionalEnabled: "on",
  additionalLabel: "Additional payment (user-reported)",
  additionalAmount: "2000",
  additionalFirstDate: "",
  additionalIntervalDays: "14",
  additionalEndDate: "",
  additionalFederal: "taxable",
  additionalNy: "taxable",
  additionalLocal: "taxable",
  additionalFica: "same-as-sad",
  supplementalMethod: "aggregate",
  filingStatus: "single",
  qualifyingChildren: "0",
  otherDependents: "0",
  claimedAsDependent: "",
  otherWages: "0",
  otherIncome: "0",
  itemizedDeductions: "0",
  otherNySourceIncome: "0",
  nyResidency: "resident",
  localResidency: "none",
  worksInYonkers: "",
  w4Step2: "",
  w4Credits: "0",
  w4OtherIncome: "0",
  w4Deductions: "0",
  w4Extra: "0",
  nyWithholdingStatus: "single",
  nysAllowances: "0",
  nycAllowances: "0",
  nyExtra: "0",
  priorYtdWages: "0",
  tradRetirementPercent: "0",
  section125PerPay: "0",
  afterTaxPerPay: "0",
};

class InputError extends Error {
  constructor(errors) {
    super(errors.join(" "));
    this.name = "InputError";
    this.errors = errors;
  }
}

const parseInput = (body = {}) => {
  const raw = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (body[key] !== undefined) raw[key] = String(body[key]).trim().slice(0, 4000);
  }
  // Unchecked checkboxes are absent from a submitted form.
  if (body.__submitted) {
    for (const key of ["basEligible", "ordersAtLeast30Days", "sadWithinNy", "nyOrganizedMilitia", "title10NonTrainingInNy",
      "additionalEnabled", "claimedAsDependent", "worksInYonkers", "w4Step2"]) {
      raw[key] = body[key] ? "on" : "";
    }
  }

  const errors = [];
  const oneOf = (key, allowed) => {
    if (!allowed.includes(raw[key])) errors.push(`${key} must be one of ${allowed.join(", ")}.`);
    return raw[key];
  };
  const number = (key, { min = 0, max = 10000000, integer = false } = {}) => {
    const value = Number(raw[key] === "" ? 0 : raw[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      errors.push(`${key} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
      return 0;
    }
    return value;
  };
  const date = (key, { required = false } = {}) => {
    if (!raw[key]) {
      if (required) errors.push(`${key} is required.`);
      return null;
    }
    try {
      parseDate(raw[key]);
      return raw[key];
    } catch (error) {
      errors.push(`${key}: ${error.message}.`);
      return null;
    }
  };
  const checked = (key) => raw[key] === "on" || raw[key] === "true";

  const parsePeriods = (text, label) => {
    const periods = [];
    text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50).forEach((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|-|–|,)\s*(\d{4}-\d{2}-\d{2})$/i);
      if (!match) {
        errors.push(`${label}: "${line}" should look like 2026-03-01 to 2026-06-30.`);
        return;
      }
      try {
        parseDate(match[1]);
        parseDate(match[2]);
      } catch (error) {
        errors.push(`${label}: ${error.message}.`);
        return;
      }
      if (match[2] < match[1]) errors.push(`${label}: ${line} ends before it starts.`);
      else if (daysBetween(match[1], match[2]) > 800) errors.push(`${label}: ${line} is longer than the supported range.`);
      else periods.push({ start: match[1], end: match[2] });
    });
    return periods;
  };

  const parseDrills = (text) => {
    const drills = [];
    text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 200).forEach((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*(?:,|\s)\s*(\d)$/);
      if (!match) {
        errors.push(`Drills: "${line}" should look like 2026-03-14, 2 (date, drill periods).`);
        return;
      }
      try {
        parseDate(match[1]);
        drills.push({ date: match[1], periods: Number(match[2]) });
      } catch (error) {
        errors.push(`Drills: ${error.message}.`);
      }
    });
    return drills;
  };

  const mode = oneOf("mode", MODES);
  const input = {
    raw,
    mode,
    taxYear: number("taxYear", { min: 2000, max: 2100, integer: true }),
    grade: oneOf("grade", GRADES),
    serviceStartDate: date("serviceStartDate", { required: true }),
    filingStatus: oneOf("filingStatus", FILING_STATUSES),
    qualifyingChildren: number("qualifyingChildren", { max: 20, integer: true }),
    otherDependents: number("otherDependents", { max: 20, integer: true }),
    claimedAsDependent: checked("claimedAsDependent"),
    otherWages: number("otherWages"),
    otherIncome: number("otherIncome", { min: -3000 }),
    itemizedDeductions: number("itemizedDeductions"),
    otherNySourceIncome: number("otherNySourceIncome"),
    nyResidency: oneOf("nyResidency", ["resident", "nonresident", "part-year"]),
    localResidency: oneOf("localResidency", ["none", "nyc", "yonkers"]),
    worksInYonkers: checked("worksInYonkers"),
    w4: {
      filingStatus: raw.filingStatus,
      multipleJobs: checked("w4Step2"),
      credits: number("w4Credits"),
      otherIncome: number("w4OtherIncome"),
      deductions: number("w4Deductions"),
      extraWithholding: number("w4Extra", { max: 100000 }),
    },
    nyWithholding: {
      maritalStatus: oneOf("nyWithholdingStatus", ["single", "married"]),
      nysAllowances: number("nysAllowances", { max: 99, integer: true }),
      nycAllowances: number("nycAllowances", { max: 99, integer: true }),
      extraNys: number("nyExtra", { max: 100000 }),
    },
    priorYtdWages: number("priorYtdWages"),
    tradRetirementPercent: number("tradRetirementPercent", { max: 100 }),
    section125PerPay: number("section125PerPay", { max: 100000 }),
    afterTaxPerPay: number("afterTaxPerPay", { max: 100000 }),
    bah: {
      source: oneOf("bahSource", ["locality", "manual", "none"]),
      housingArea: raw.housingArea,
      withDependents: raw.withDependents === "yes",
      manualMonthly: raw.bahSource === "manual" ? number("bahManual") : 0,
    },
    basEligible: checked("basEligible"),
    ordersAtLeast30Days: checked("ordersAtLeast30Days"),
    profile: {
      sadOrdersAuthority: oneOf("sadOrdersAuthority", ["6.1", "other", "unknown"]),
      sadWithinNy: checked("sadWithinNy"),
      sadPayrollTax: oneOf("sadPayrollTax", ["unresolved", "subject", "exempt"]),
      sadAllowanceFederal: oneOf("sadAllowanceFederal", ["taxable", "excluded"]),
      nyOrganizedMilitia: checked("nyOrganizedMilitia"),
      title10NonTrainingInNy: checked("title10NonTrainingInNy"),
      additionalTreatment: {
        federal: oneOf("additionalFederal", ["taxable", "excluded"]),
        ny: oneOf("additionalNy", ["taxable", "s126", "excluded"]),
        local: oneOf("additionalLocal", ["taxable", "excluded"]),
        fica: oneOf("additionalFica", ["same-as-sad", "subject", "exempt"]),
      },
    },
    additional: {
      enabled: checked("additionalEnabled"),
      label: raw.additionalLabel.slice(0, 80) || "Additional payment",
      amount: number("additionalAmount", { max: 1000000 }),
      firstDate: date("additionalFirstDate", { required: checked("additionalEnabled") }),
      intervalDays: number("additionalIntervalDays", { min: 1, max: 366, integer: true }),
      endDate: date("additionalEndDate"),
    },
    supplementalMethod: oneOf("supplementalMethod", ["aggregate", "flat"]),
  };

  if (mode === "active" || mode === "sad") {
    input.periods = parsePeriods(raw.periods, mode === "sad" ? "SAD duty dates" : "Active duty dates");
    if (input.periods.length === 0) errors.push(`Enter at least one ${mode === "sad" ? "SAD" : "active duty"} period.`);
  }
  if (mode === "drill") {
    input.drills = parseDrills(raw.drills);
    input.drillPayLagDays = number("drillPayLagDays", { max: 120, integer: true });
    if (input.drills.length === 0) errors.push("Enter at least one drill date.");
  }
  if (mode === "sad") {
    input.sadFirstPayDate = date("sadFirstPayDate", { required: true });
    input.sadPayLagDays = number("sadPayLagDays", { max: 60, integer: true });
  }
  if (input.localResidency !== "none" && input.nyResidency !== "resident") {
    errors.push("NYC or Yonkers resident tax applies only to New York State residents; choose a NY resident status or 'No local resident tax'.");
  }

  if (errors.length) throw new InputError(errors);
  return input;
};

module.exports = { parseInput, InputError, DEFAULTS, MODES, FILING_STATUSES };
