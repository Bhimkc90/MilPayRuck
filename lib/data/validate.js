// Structural and consistency checks for official-rate snapshots.
// Each validator returns a list of problems; an empty list means the snapshot may be used.

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const cumulativeTax = (thresholds, rates, index) => {
  let tax = 0;
  for (let i = 0; i < index; i += 1) {
    tax += (thresholds[i + 1] - thresholds[i]) * rates[i];
  }
  return tax;
};

const checkIncreasing = (values, label, problems) => {
  for (let i = 1; i < values.length; i += 1) {
    if (!(values[i] > values[i - 1])) problems.push(`${label}: thresholds must increase`);
  }
};

const checkMetadata = (snapshot, expectedId) => {
  const problems = [];
  if (!snapshot || typeof snapshot !== "object") return ["snapshot is not an object"];
  if (snapshot.datasetId !== expectedId) problems.push(`datasetId ${snapshot.datasetId} != ${expectedId}`);
  for (const field of ["version", "taxYear", "effectiveFrom", "effectiveTo", "sources", "validation", "data"]) {
    if (snapshot[field] === undefined) problems.push(`missing ${field}`);
  }
  if (!Array.isArray(snapshot.sources) || snapshot.sources.length === 0) {
    problems.push("at least one source is required");
  } else {
    snapshot.sources.forEach((source, index) => {
      for (const field of ["title", "url", "retrievedAt"]) {
        if (!source[field]) problems.push(`source ${index} missing ${field}`);
      }
      if (source.url && !source.url.startsWith("https://")) problems.push(`source ${index} must be https`);
    });
  }
  if (snapshot.validation && snapshot.validation.status !== "validated") {
    problems.push(`validation status is ${snapshot.validation.status}`);
  }
  return problems;
};

const validators = {
  "dfas-military-pay": (data) => {
    const problems = [];
    const columns = data.yearsOfServiceColumns;
    if (!Array.isArray(columns) || columns.length !== 22) problems.push("expected 22 service columns");
    for (const [grade, row] of Object.entries(data.basicPay || {})) {
      if (!Array.isArray(row) || row.length !== columns.length) {
        problems.push(`${grade}: wrong column count`);
        continue;
      }
      let previous = 0;
      for (const value of row) {
        if (value === null) continue;
        if (typeof value !== "number" || value <= 0) problems.push(`${grade}: invalid rate ${value}`);
        if (value < previous) problems.push(`${grade}: rate decreases with service`);
        previous = value;
      }
      const cap = /^O-(7|8|9|10)$/.test(grade) ? data.caps.executiveLevelII : data.caps.executiveLevelV;
      if (previous > cap) problems.push(`${grade}: exceeds published cap`);
    }
    if (Object.keys(data.basicPay || {}).length !== 27) problems.push("expected 27 pay grades");
    if (!(data.bas && data.bas.officer > 0 && data.bas.enlisted > 0)) problems.push("BAS rates missing");
    if (!data.activeDutyPaydays || data.activeDutyPaydays.months.length !== 12) problems.push("expected 12 payday months");
    return problems;
  },

  "dtmo-bah-ny": (data) => {
    const problems = [];
    for (const key of ["withDependents", "withoutDependents"]) {
      const areas = data[key] || {};
      if (Object.keys(areas).length === 0) problems.push(`${key}: no housing areas`);
      for (const [mha, area] of Object.entries(areas)) {
        if (!/^NY\d{3}$/.test(mha)) problems.push(`${key}: bad MHA ${mha}`);
        if (Object.keys(area.rates || {}).length !== 24) problems.push(`${key} ${mha}: expected 24 grades`);
      }
    }
    return problems;
  },

  "irs-federal-tax": (data) => {
    const problems = [];
    const { rates } = data.brackets;
    for (const status of ["mfj", "hoh", "single", "mfs"]) {
      const schedule = data.brackets[status];
      checkIncreasing(schedule.thresholds, `brackets ${status}`, problems);
      schedule.publishedBase.forEach((base, index) => {
        const derived = cumulativeTax(schedule.thresholds, rates, index);
        if (!near(base, derived, 0.01)) problems.push(`brackets ${status}: base ${base} != derived ${derived}`);
      });
    }
    for (const status of ["mfj", "single", "hoh"]) {
      const table = data.withholding.tables.standard[status];
      const brackets = data.brackets[status];
      const shift = data.standardDeduction[status] - (status === "mfj" ? data.withholding.line1g.mfj : data.withholding.line1g.others);
      table.slice(1).forEach((row, index) => {
        if (row[0] !== brackets.thresholds[index] + shift) {
          problems.push(`withholding ${status}: row ${index + 1} starts at ${row[0]}, expected ${brackets.thresholds[index] + shift}`);
        }
        if (!near(row[2], brackets.publishedBase[index], 0.01)) problems.push(`withholding ${status}: base mismatch at row ${index + 1}`);
      });
    }
    const fica = data.fica;
    if (!(fica.socialSecurityWageBase > 0 && fica.socialSecurityRate === 0.062 && fica.medicareRate === 0.0145)) {
      problems.push("FICA parameters invalid");
    }
    return problems;
  },

  "ny-income-tax": (data) => {
    const problems = [];
    const checkSchedules = (schedules, label, tolerance) => {
      for (const [status, schedule] of Object.entries(schedules)) {
        checkIncreasing(schedule.thresholds, `${label} ${status}`, problems);
        schedule.publishedBase.forEach((base, index) => {
          const derived = cumulativeTax(schedule.thresholds, schedule.rates, index);
          if (!near(base, derived, tolerance)) problems.push(`${label} ${status}: base ${base} vs derived ${derived.toFixed(2)}`);
        });
      }
    };
    checkSchedules(data.nys.schedules, "NYS", 1);
    checkSchedules(data.nyc.schedules, "NYC", 1);

    for (const [status, worksheets] of Object.entries(data.nys.recapture.worksheets)) {
      const schedule = data.nys.schedules[status];
      // NY derives worksheet amounts from the published (rounded) schedule bases.
      const tableTax = (income) => {
        const index = schedule.thresholds.filter((threshold) => income > threshold).length - 1;
        return schedule.publishedBase[index] + (income - schedule.thresholds[index]) * schedule.rates[index];
      };
      let previousBase = 0;
      let previousBenefit = null;
      worksheets.later.forEach((sheet, position) => {
        const start = sheet.taxableIncomeOver;
        const rateIndex = schedule.thresholds.indexOf(start);
        const startRate = schedule.rates[rateIndex];
        const flatPrevious = schedule.rates[rateIndex - 1] * start;
        const expectedBase = position === 0
          ? flatPrevious - tableTax(start)
          : previousBase + previousBenefit;
        const expectedBenefit = startRate * start - tableTax(start) - sheet.recaptureBase;
        if (!near(sheet.recaptureBase, expectedBase, 1)) problems.push(`NYS ${status} worksheet ${sheet.worksheet}: recapture base ${sheet.recaptureBase} vs ${expectedBase.toFixed(2)}`);
        if (!near(sheet.incrementalBenefit, expectedBenefit, 1)) problems.push(`NYS ${status} worksheet ${sheet.worksheet}: incremental benefit ${sheet.incrementalBenefit} vs ${expectedBenefit.toFixed(2)}`);
        previousBase = sheet.recaptureBase;
        previousBenefit = sheet.incrementalBenefit;
      });
    }
    if (data.yonkers.residentSurchargeRate !== 0.1675) problems.push("Yonkers surcharge rate unexpected");
    return problems;
  },

  "ny-withholding": (data) => {
    const problems = [];
    for (const jurisdiction of ["nys", "nyc", "yonkersResident"]) {
      const block = data[jurisdiction];
      for (const status of ["single", "married"]) {
        for (const period of ["weekly", "biweekly", "semimonthly", "monthly", "daily"]) {
          const allowance = block.allowances[period] && block.allowances[period][status];
          if (!allowance || !(allowance.deduction > 0) || !(allowance.perExemption > 0)) {
            problems.push(`${jurisdiction} ${status} ${period}: allowance missing`);
          }
          const rows = block.exactCalculation[status] && block.exactCalculation[status][period];
          if (!rows || rows.length < 2) {
            problems.push(`${jurisdiction} ${status} ${period}: table missing`);
            continue;
          }
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            if (i > 0 && row.atLeast !== rows[i - 1].lessThan) problems.push(`${jurisdiction} ${status} ${period}: gap at row ${i + 1}`);
            if (row.unsupported) continue;
            if (row.subtract !== row.atLeast) problems.push(`${jurisdiction} ${status} ${period}: column 3 mismatch at row ${i + 1}`);
            if (i > 0 && !rows[i - 1].unsupported) {
              const previous = rows[i - 1];
              const accumulated = previous.add + (previous.lessThan - previous.subtract) * previous.rate;
              // Column 5 comes from annual amounts divided by pay periods, so allow table rounding.
              if (!near(row.add, accumulated, Math.max(0.1, row.add * 0.015))) problems.push(`${jurisdiction} ${status} ${period}: column 5 not cumulative at row ${i + 1}`);
            }
          }
        }
      }
    }
    return problems;
  },

  "ny-sad-rules": (data) => {
    const problems = [];
    if (data.sadDailyMinimum !== 125) problems.push("unexpected SAD daily minimum");
    if (!data.specialDutyBonus || data.specialDutyBonus.reportedFrequencyDays !== 14) problems.push("bonus frequency missing");
    return problems;
  },
};

const validateSnapshot = (snapshot, expectedId) => {
  const problems = checkMetadata(snapshot, expectedId);
  if (problems.length) return problems;
  const validator = validators[expectedId];
  if (!validator) return [`no validator for ${expectedId}`];
  try {
    return validator(snapshot.data);
  } catch (error) {
    return [`malformed data: ${error.message}`];
  }
};

module.exports = { validateSnapshot, datasetIds: Object.keys(validators) };
