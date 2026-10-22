// Social Security and Medicare (FICA) withholding by employer, plus the annual
// Additional Medicare Tax liability check. Social Security stops at the wage base per
// employer; Additional Medicare withholding starts above $200,000 per employer.

const cents = (value) => Math.round(value * 100) / 100;

const createFicaTracker = (irs, priorWagesByPayer = {}) => {
  const fica = irs.fica;
  const ytd = { ...priorWagesByPayer };

  const withhold = (payer, wages) => {
    const before = ytd[payer] || 0;
    const after = before + wages;
    ytd[payer] = after;
    const ssWages = Math.max(0, Math.min(after, fica.socialSecurityWageBase) - Math.min(before, fica.socialSecurityWageBase));
    const threshold = fica.additionalMedicareWithholdingThreshold;
    const additionalWages = Math.max(0, after - Math.max(before, threshold));
    return {
      socialSecurity: cents(ssWages * fica.socialSecurityRate),
      medicare: cents(wages * fica.medicareRate),
      additionalMedicare: cents(additionalWages * fica.additionalMedicareRate),
    };
  };

  return { withhold, ytd: () => ({ ...ytd }) };
};

const additionalMedicareLiability = (irs, filingStatus, medicareWages) => {
  const thresholds = irs.fica.additionalMedicareLiabilityThreshold;
  const threshold = filingStatus === "mfj" ? thresholds.mfj : filingStatus === "mfs" ? thresholds.mfs : thresholds.others;
  return cents(Math.max(0, medicareWages - threshold) * irs.fica.additionalMedicareRate);
};

module.exports = { createFicaTracker, additionalMedicareLiability };
