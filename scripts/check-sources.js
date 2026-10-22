// Checks the official sources behind active snapshots and records their status in
// data/cache/source-status.json. A changed source is flagged for review; it never
// replaces a validated snapshot automatically.
const fs = require("fs");
const path = require("path");
const { runMonitor } = require("../lib/data/sourceMonitor");
const { SOURCE_STATUS_PATH } = require("../lib/data/datasetStore");

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/data/registry.json"), "utf8"));
const readSnapshot = (datasetId, version) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/data/snapshots", datasetId, `${version}.json`), "utf8"));

runMonitor({ registry, readSnapshot, outputPath: SOURCE_STATUS_PATH }).then((report) => {
  for (const [url, status] of Object.entries(report.sources)) {
    console.log(`${status.state.padEnd(18)} ${status.httpStatus || ""} ${url}`);
  }
  console.log(`Wrote ${SOURCE_STATUS_PATH}`);
});
