// Validates every snapshot referenced by lib/data/registry.json. Exit code 1 on any problem.
const fs = require("fs");
const path = require("path");
const { validateSnapshot } = require("../lib/data/validate");

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/data/registry.json"), "utf8"));
let failed = false;

for (const [datasetId, versions] of Object.entries(registry.activeVersions)) {
  for (const [year, version] of Object.entries(versions)) {
    const file = path.join(__dirname, "../lib/data/snapshots", datasetId, `${version}.json`);
    let problems;
    try {
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
      problems = validateSnapshot(snapshot, datasetId);
      if (String(snapshot.taxYear) !== year) problems.push(`registered for ${year} but snapshot is ${snapshot.taxYear}`);
    } catch (error) {
      problems = [error.message];
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${datasetId} ${version} (${year})`);
    problems.forEach((problem) => console.log(`     - ${problem}`));
    failed = failed || problems.length > 0;
  }
}

process.exit(failed ? 1 : 0);
