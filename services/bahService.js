const XLSX = require("xlsx");
const path = require("path");

const nycZipCodes = new Set([
  "11368", "11369", "11370", "11372", "11373", "11377", "11378",
  "10001", "10002", "10003", "10004", "10005", "10006", "10007",
  "11201", "11205", "11215", "11217", "11231",
  "10451", "10452", "10453", "10454", "10455",
  "10301", "10304", "10305", "10314"
]);

const formatRankKey = (rank) => {
  const cleanRank = rank.toUpperCase().replace("-", "");

  if (cleanRank.startsWith("E")) {
    return cleanRank.replace("E", "E0");
  }

  return cleanRank;
};

const getBahRate = (zipCode, rank, dependents) => {
  const cleanZip = String(zipCode).trim();
  const rankKey = formatRankKey(rank);

  if (!nycZipCodes.has(cleanZip)) {
    return 2500;
  }

  const filePath = path.join(
    __dirname,
    "../data/2026 BAH Rates - Updated with TX270 Temporary Increase.xlsx"
  );

  const workbook = XLSX.readFile(filePath);

  const sheetName = dependents === "yes" ? "With" : "Without";
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    range: 1,
  });

  const nycRow = rows.find((row) => row.MHA === "NY219");
  
  console.log("NYC BAH row:", nycRow);
  console.log("Available columns:", Object.keys(nycRow));
  console.log("Rank entered:", rank);
  console.log("Rank key used:", rankKey);

  if (!nycRow) {
    return 2500;
  }

  return nycRow[rankKey] || 2500;
};

module.exports = {
  getBahRate,
};