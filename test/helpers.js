const { createStore } = require("../lib/data/datasetStore");
const { parseInput } = require("../lib/calculator/inputs");
const { estimate } = require("../lib/calculator/estimate");

const store = createStore({ today: new Date("2026-10-22T00:00:00Z") });
const data = (id) => store.get(id, 2026).data;

const run = (fields) => estimate(parseInput({ __submitted: true, ...fields }), store, { today: new Date("2026-10-22T00:00:00Z") });

// Independent progressive-tax helper for tests: sums each bracket slice directly.
const progressive = (thresholds, rates, income) => {
  let tax = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    const top = i + 1 < thresholds.length ? thresholds[i + 1] : Infinity;
    if (income > thresholds[i]) tax += (Math.min(income, top) - thresholds[i]) * rates[i];
  }
  return Math.round(tax * 100) / 100;
};

module.exports = { store, data, run, progressive };
