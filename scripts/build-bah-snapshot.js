// Builds the New York BAH snapshot from the official DTMO "All BAH rates" workbook.
// Usage: node scripts/build-bah-snapshot.js [path/to/workbook.xlsx]
// The workbook is parsed as data only. The snapshot is written but must still pass
// `npm run data:validate` and `npm test` before it is committed and activated.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DEFAULT_WORKBOOK = path.join(
  __dirname,
  "../data/2026 BAH Rates - Updated with TX270 Temporary Increase.xlsx"
);
const OUTPUT = path.join(__dirname, "../lib/data/snapshots/dtmo-bah-ny/2026.1.json");

const EXPECTED_COLUMNS = [
  "MHA", "MHA_NAME",
  "E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08", "E09",
  "W01", "W02", "W03", "W04", "W05",
  "O01E", "O02E", "O03E",
  "O01", "O02", "O03", "O04", "O05", "O06", "O07",
];

const gradeKey = (column) =>
  column.replace(/^([EWO])0?(\d+)(E?)$/, (_, letter, number, suffix) => `${letter}-${number}${suffix}`);

const readSheet = (workbook, sheetName) => {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
  const header = rows[1];

  if (JSON.stringify(header) !== JSON.stringify(EXPECTED_COLUMNS)) {
    throw new Error(`Unexpected columns in sheet ${sheetName}: ${JSON.stringify(header)}`);
  }

  const areas = {};

  for (const row of rows.slice(2)) {
    if (!String(row[0]).startsWith("NY")) continue;

    const rates = {};
    EXPECTED_COLUMNS.slice(2).forEach((column, index) => {
      const value = row[index + 2];
      if (!Number.isInteger(value) || value <= 0 || value > 20000) {
        throw new Error(`Invalid BAH value ${value} for ${row[0]} ${column}`);
      }
      rates[gradeKey(column)] = value;
    });

    areas[row[0]] = { name: row[1], rates };
  }

  return { title: rows[0][0], areas };
};

const build = (workbookPath) => {
  const buffer = fs.readFileSync(workbookPath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const withDependents = readSheet(workbook, "With");
  const withoutDependents = readSheet(workbook, "Without");

  if (Object.keys(withDependents.areas).join() !== Object.keys(withoutDependents.areas).join()) {
    throw new Error("With/without dependent sheets list different New York housing areas");
  }

  return {
    datasetId: "dtmo-bah-ny",
    version: "2026.1",
    taxYear: 2026,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sources: [
      {
        title: `${withDependents.title} / ${withoutDependents.title}`,
        publisher: "Defense Travel Management Office (DTMO)",
        url: "https://www.travel.dod.mil/Allowances/Basic-Allowance-for-Housing/BAH-Rate-Lookup/",
        publicationDate: "2026 rates; release '2026 Abilene Temporary Increase (Effective 05/16/2026)' (TX270 only)",
        retrievedAt: "2026-06-22 (workbook committed to this repository); DTMO release list re-checked 2026-10-22",
        retrievalMethod: "Official PDF/Excel download stored in data/. DoD sites block automated server requests, so refreshes are manual.",
        // Hash of the stored workbook (not of the lookup page URL above).
        file: path.relative(path.join(__dirname, ".."), workbookPath),
        fileSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      },
    ],
    validation: {
      status: "validated",
      validatedAt: new Date().toISOString().slice(0, 10),
      checks: [
        "Workbook column layout matches the DTMO 2026 format exactly.",
        "Every New York rate is a positive whole-dollar amount.",
        "Both dependency sheets list the same New York housing areas.",
      ],
    },
    data: {
      note: "DTMO publishes one O-7 column that also applies to O-8 through O-10 ('O-7/O-7+').",
      withDependents: withDependents.areas,
      withoutDependents: withoutDependents.areas,
    },
  };
};

if (require.main === module) {
  const snapshot = build(process.argv[2] || DEFAULT_WORKBOOK);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Wrote ${OUTPUT} (${Object.keys(snapshot.data.withDependents).length} housing areas)`);
}

module.exports = { build };
