const Budget = require("../models/Budget");
const Profile = require("../models/Profile");

const { parseInput, InputError, DEFAULTS } = require("../lib/calculator/inputs");
const { estimate, DATASETS } = require("../lib/calculator/estimate");
const { PayRuleError } = require("../lib/pay/militaryPay");
const { getDefaultStore } = require("../lib/data/datasetStore");

const NY_HOUSING_AREAS = (() => {
  try {
    const { data } = getDefaultStore().get("dtmo-bah-ny", 2026);
    return Object.entries(data.withDependents).map(([code, area]) => ({ code, name: area.name }));
  } catch {
    return [];
  }
})();

// Profile ranks are stored like "SPC/E4"; the calculator uses DFAS grades like "E-4".
const gradeFromProfile = (profile) => {
  const match = profile && String(profile.rank || "").match(/([EWO])-?(\d{1,2})\s*$/i);
  return match ? `${match[1].toUpperCase()}-${Number(match[2])}` : null;
};

const runEstimate = (body) => {
  try {
    const input = parseInput(body);
    return { input, result: estimate(input, getDefaultStore()) };
  } catch (error) {
    if (error instanceof InputError) return { errors: error.errors };
    if (error instanceof PayRuleError) return { errors: [error.message] };
    throw error;
  }
};

const viewModel = (values, extra = {}) => ({
  values,
  housingAreas: NY_HOUSING_AREAS,
  availableYears: getDefaultStore().availableYears(),
  result: null,
  errors: [],
  budgetSaved: false,
  ...extra,
});

const showCalculator = async (req, res) => {
  const profile = await Profile.findOne({ userId: req.session.userId }).lean();
  const values = { ...DEFAULTS };
  const grade = gradeFromProfile(profile);
  if (grade) values.grade = grade;
  res.render("pay/calculator", viewModel(values, { budgetSaved: req.query.saved === "1" }));
};

const calculate = (req, res) => {
  const body = { ...req.body, __submitted: true };
  const { result, errors } = runEstimate(body);
  const values = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, body[key] === undefined ? "" : String(body[key])])) };
  res.status(errors ? 422 : 200).render("pay/calculator", viewModel(values, { result, errors: errors || [] }));
};

// Opt-in only: copies the estimated monthly average net pay into the user's budget.
// No pay inputs or estimate details are stored.
const saveToBudget = async (req, res) => {
  const amount = Number(req.body.monthlyNetAverage);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    return res.redirect("/pay-calculator");
  }
  await Budget.findOneAndUpdate(
    { userId: req.session.userId },
    { userId: req.session.userId, monthlyNetIncome: Math.round(amount * 100) / 100 },
    { upsert: true, new: true }
  );
  res.redirect("/pay-calculator?saved=1");
};

const estimateApi = (req, res) => {
  const { result, errors } = runEstimate({ ...req.body, __submitted: true });
  if (errors) return res.status(422).json({ status: "invalid", errors });
  res.json(result);
};

const dataStatusApi = (req, res) => {
  const store = getDefaultStore();
  const years = store.availableYears();
  const datasets = years.flatMap((year) =>
    Object.values(DATASETS).map((id) => {
      try {
        const { meta, warnings } = store.get(id, year);
        return { ...meta, warnings };
      } catch (error) {
        return { datasetId: id, taxYear: year, validationStatus: "unavailable", error: error.message };
      }
    })
  );
  res.json({ availableYears: years, datasets });
};

module.exports = { showCalculator, calculate, saveToBudget, estimateApi, dataStatusApi, gradeFromProfile };
