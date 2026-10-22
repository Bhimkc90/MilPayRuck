// Decides, for each pay component, whether it is taxable for federal income tax, New York,
// local tax, and Social Security/Medicare, and how well that rule is supported:
//   confirmed    - stated in an official source retrieved for this version
//   general-rule - follows a general rule; no component-specific source was found
//   assumed      - a user-reported or user-selected assumption
//   unresolved   - the rule could not be verified; the affected amount is gated

const rule = (status, basis, note) => ({ status, basis, note });

const nyMilitaryRule = (profile, s126Applies) => {
  if (profile.nyResidency === "nonresident") {
    return rule("excluded", "confirmed", "Military pay of a nonresident is not NY income (IT-225-I S-119; 50 U.S.C. 4001(b)).");
  }
  if (s126Applies) {
    return rule("excluded", "confirmed", "NY organized militia pay for active service in NY under Title 10 orders other than training (IT-225-I S-126).");
  }
  return rule("taxable", "confirmed", "NY residents are taxed on military pay that is federally taxable (IT-201-I, Members of the armed forces).");
};

const sadNyRule = (profile) => {
  if (!profile.sadWithinNy) {
    return rule("taxable", "general-rule", "S-126 requires service within New York State; treated as taxable.");
  }
  if (profile.sadOrdersAuthority === "6.1") {
    return rule("excluded", "confirmed", "SAD under Military Law sec. 6.1 orders, within NY: NY subtraction S-126 (IT-225-I 2025 instructions; 2026 edition not yet published).");
  }
  if (profile.sadOrdersAuthority === "other") {
    return rule("taxable", "confirmed", "S-126 covers only SAD orders under Military Law sec. 6.1; orders cite another authority.");
  }
  return rule("taxable", "unresolved", "Orders authority unknown. If the orders cite Military Law sec. 6.1, S-126 would remove this pay from NY (and NYC/Yonkers resident) tax; this estimate may overstate NY tax.");
};

const sadFicaRule = (profile) => {
  if (profile.sadPayrollTax === "subject") return rule("subject", "assumed", "You indicated Social Security/Medicare are withheld from your SAD pay.");
  if (profile.sadPayrollTax === "exempt") return rule("exempt", "assumed", "You indicated Social Security/Medicare are not withheld from your SAD pay.");
  return rule("unresolved", "unresolved", "SAD Social Security/Medicare treatment was not verified (depends on NY's Section 218 agreement / 26 U.S.C. 3121(b)(7)). Check your SAD pay statement.");
};

const treatmentFor = (kind, profile) => {
  const local = (nyRule) => {
    if (nyRule.status === "excluded") return rule("excluded", nyRule.basis, "Follows the NY treatment: NYC and Yonkers resident taxes are computed from NY taxable income.");
    return rule("taxable", nyRule.basis, "Follows the NY treatment.");
  };

  switch (kind) {
    case "basic": {
      const ny = nyMilitaryRule(profile, profile.title10NonTrainingInNy && profile.nyOrganizedMilitia);
      return {
        federal: rule("taxable", "confirmed", "Basic pay is gross income (IRS Pub 3, Table 1)."),
        ny,
        local: local(ny),
        yonkersNonresident: rule("excluded", "confirmed", "Military compensation is not income from sources in a jurisdiction where the member is not domiciled (50 U.S.C. 4001(b), (g)(3))."),
        fica: rule("subject", "confirmed", "Basic pay is subject to Social Security and Medicare (DFAS FICA table, DoD FMR Vol. 7A Ch. 45)."),
        retirementBase: true,
      };
    }
    case "bah":
    case "bas":
      return {
        federal: rule("excluded", "confirmed", `${kind.toUpperCase()} is excluded from gross income (IRS Pub 3, Table 2).`),
        ny: rule("excluded", "confirmed", "Not in federal AGI, so not in NY AGI."),
        local: rule("excluded", "confirmed", "Not in NY taxable income."),
        yonkersNonresident: rule("excluded", "confirmed", "Military allowance; not earnings subject to Yonkers nonresident tax."),
        fica: rule("exempt", "confirmed", "Allowances are not basic pay; FICA applies to basic pay only (DFAS FICA table, DoD FMR Vol. 7A Ch. 45)."),
        retirementBase: false,
      };
    case "drill": {
      const ny = nyMilitaryRule(profile, false);
      return {
        federal: rule("taxable", "confirmed", "Drill pay is gross income (IRS Pub 3, Table 1)."),
        ny: ny.status === "taxable"
          ? rule("taxable", "confirmed", "Drills and training are excluded from S-126; NY residents are taxed on federally taxable military pay.")
          : ny,
        local: local(ny),
        yonkersNonresident: rule("excluded", "confirmed", "Military compensation of a non-domiciliary (50 U.S.C. 4001(b))."),
        fica: rule("subject", "confirmed", "Drill pay is basic pay subject to Social Security and Medicare."),
        retirementBase: true,
      };
    }
    case "sad-basic":
    case "sad-minimum": {
      const ny = sadNyRule(profile);
      return {
        federal: rule("taxable", "general-rule", "Compensation for services is gross income; no federal exclusion for SAD pay was found (Pub 3 exclusions apply to federal military allowances, not state pay)."),
        ny,
        local: local(ny),
        yonkersNonresident: rule("taxable", "general-rule", "SAD is state service, not federal 'military service' under the SCRA, so the SCRA source rule is not applied."),
        fica: sadFicaRule(profile),
        retirementBase: true,
      };
    }
    case "sad-allowance": {
      const federal = profile.sadAllowanceFederal === "excluded"
        ? rule("excluded", "assumed", "You chose to treat SAD allowances as excluded like federal BAH/BAS; not confirmed for state-paid allowances.")
        : rule("taxable", "assumed", "Default: state-paid SAD allowances treated as taxable wages. 26 U.S.C. 134 exclusion was not confirmed for state-paid allowances.");
      const sadRule = sadNyRule(profile);
      const ny = federal.status === "excluded"
        ? rule("excluded", "assumed", "Not in federal AGI under the selected treatment.")
        : sadRule;
      return {
        federal,
        ny,
        local: local(ny),
        yonkersNonresident: rule(federal.status, "assumed", "Follows the federal treatment selected for SAD allowances."),
        fica: sadFicaRule(profile),
        retirementBase: false,
      };
    }
    case "additional": {
      const selected = profile.additionalTreatment;
      const sadFica = sadFicaRule(profile);
      const fica =
        selected.fica === "subject" ? rule("subject", "assumed", "User-selected: Social Security/Medicare apply.")
          : selected.fica === "exempt" ? rule("exempt", "assumed", "User-selected: no Social Security/Medicare.")
            : profile.mode === "sad" ? { ...sadFica, note: `Follows SAD pay. ${sadFica.note}` }
              : rule("unresolved", "unresolved", "Payroll-tax treatment of the additional payment is not verified; select a treatment.");
      const ny =
        selected.ny === "excluded" ? rule("excluded", "assumed", "User-selected: excluded from NY income (not verified).")
          : selected.ny === "s126" ? rule("excluded", "assumed", "User-selected: treated like SAD pay under S-126 (not verified for this bonus).")
            : rule("taxable", "assumed", "Default: taxable in NY. No NY exclusion for this payment was verified.");
      return {
        federal: selected.federal === "excluded"
          ? rule("excluded", "assumed", "User-selected: excluded from federal income. No federal exclusion was verified; the general rule and IRS Pub 15 treat bonuses as taxable supplemental wages.")
          : rule("taxable", "assumed", "Default: taxable supplemental wages (IRS Pub 15). Tax-free treatment was not verified."),
        ny,
        local: selected.local === "excluded"
          ? rule("excluded", "assumed", "User-selected: excluded from local tax (not verified).")
          : rule("taxable", "assumed", "Default: taxable for local tax where it applies."),
        yonkersNonresident: selected.local === "excluded"
          ? rule("excluded", "assumed", "User-selected.")
          : rule("taxable", "assumed", "Default: earnings for Yonkers nonresident tax if earned in Yonkers."),
        fica,
        retirementBase: false,
      };
    }
    default:
      throw new Error(`Unknown pay component ${kind}`);
  }
};

module.exports = { treatmentFor };
