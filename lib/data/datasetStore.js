// Loads validated, versioned official-rate snapshots.
// Calculations ask for a dataset by tax year; if no validated snapshot covers that year
// the request fails with DataUnavailableError instead of silently using another year.

const fs = require("fs");
const path = require("path");
const { validateSnapshot } = require("./validate");

const SNAPSHOT_DIR = path.join(__dirname, "snapshots");
const REGISTRY_PATH = path.join(__dirname, "registry.json");
const SOURCE_STATUS_PATH = path.join(__dirname, "../../data/cache/source-status.json");

class DataUnavailableError extends Error {
  constructor(datasetId, taxYear, reason) {
    super(`No validated ${datasetId} data for tax year ${taxYear}: ${reason}`);
    this.name = "DataUnavailableError";
    this.datasetId = datasetId;
    this.taxYear = taxYear;
    this.reason = reason;
  }
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const createStore = ({ registry, loadSnapshot, sourceStatus = {}, today = new Date() } = {}) => {
  const cache = new Map();
  const activeRegistry = registry || readJson(REGISTRY_PATH);
  const load =
    loadSnapshot ||
    ((datasetId, version) => readJson(path.join(SNAPSHOT_DIR, datasetId, `${version}.json`)));

  const get = (datasetId, taxYear) => {
    const key = `${datasetId}:${taxYear}`;
    if (cache.has(key)) return cache.get(key);

    const version = (activeRegistry.activeVersions[datasetId] || {})[String(taxYear)];
    if (!version) throw new DataUnavailableError(datasetId, taxYear, "no active version is registered");

    let snapshot;
    try {
      snapshot = load(datasetId, version);
    } catch (error) {
      throw new DataUnavailableError(datasetId, taxYear, `snapshot ${version} could not be read (${error.message})`);
    }

    const problems = validateSnapshot(snapshot, datasetId);
    if (problems.length) {
      throw new DataUnavailableError(datasetId, taxYear, `snapshot ${version} failed validation: ${problems.slice(0, 3).join("; ")}`);
    }
    if (snapshot.taxYear !== Number(taxYear)) {
      throw new DataUnavailableError(datasetId, taxYear, `snapshot ${version} is for ${snapshot.taxYear}`);
    }

    const warnings = [];
    const validatedAt = new Date(`${snapshot.validation.validatedAt}T00:00:00Z`);
    const ageDays = Math.floor((today - validatedAt) / 86400000);
    if (ageDays > (activeRegistry.reviewAfterDays || 120)) {
      warnings.push(`${datasetId} ${version} was last verified ${snapshot.validation.validatedAt} (${ageDays} days ago); re-check the official source.`);
    }
    for (const source of snapshot.sources) {
      const status = sourceStatus[source.url];
      if (status && status.state === "changed") {
        warnings.push(`Official source changed since ${datasetId} ${version} was verified (${source.url}); results use the last verified version until a new snapshot is validated.`);
      }
    }

    const entry = {
      data: snapshot.data,
      meta: {
        datasetId,
        version: snapshot.version,
        taxYear: snapshot.taxYear,
        effectiveFrom: snapshot.effectiveFrom,
        effectiveTo: snapshot.effectiveTo,
        validatedAt: snapshot.validation.validatedAt,
        validationStatus: snapshot.validation.status,
        sources: snapshot.sources.map(({ title, url, publicationDate, retrievedAt, sha256, fileSha256 }) => ({
          title, url, publicationDate, retrievedAt, sha256: sha256 || fileSha256,
        })),
      },
      warnings,
    };
    cache.set(key, entry);
    return entry;
  };

  const availableYears = () => {
    const ids = Object.keys(activeRegistry.activeVersions);
    const years = new Set(ids.flatMap((id) => Object.keys(activeRegistry.activeVersions[id])));
    return [...years].filter((year) => ids.every((id) => activeRegistry.activeVersions[id][year])).map(Number).sort();
  };

  return { get, availableYears };
};

const readSourceStatus = () => {
  try {
    return readJson(SOURCE_STATUS_PATH).sources || {};
  } catch {
    return {};
  }
};

let defaultStore;
const getDefaultStore = () => {
  if (!defaultStore) defaultStore = createStore({ sourceStatus: readSourceStatus() });
  return defaultStore;
};

module.exports = { createStore, getDefaultStore, DataUnavailableError, SOURCE_STATUS_PATH };
