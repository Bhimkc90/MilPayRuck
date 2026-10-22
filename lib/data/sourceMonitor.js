// Server-side check of the official sources behind each active snapshot.
// Downloads are treated as opaque bytes: they are hashed and compared, never parsed
// into code or executed. Only allowlisted HTTPS hosts are contacted.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ALLOWED_HOSTS = new Set([
  "www.irs.gov",
  "www.tax.ny.gov",
  "tax.ny.gov",
  "www.ssa.gov",
  "www.dfas.mil",
  "dmna.ny.gov",
  "www.nysenate.gov",
  "www.travel.dod.mil",
  "www.law.cornell.edu",
]);
const TIMEOUT_MS = 20000;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const assertAllowed = (url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("only https sources are allowed");
  if (!ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`host ${parsed.hostname} is not allowlisted`);
  return parsed;
};

const fetchBytes = async (url, fetchImpl = fetch, redirects = 0) => {
  assertAllowed(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "MilPayRuck official-rate monitor" },
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) throw new Error("too many redirects");
      const next = new URL(response.headers.get("location"), url).toString();
      return fetchBytes(next, fetchImpl, redirects + 1);
    }
    if (!response.ok) return { httpStatus: response.status };

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("response too large");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error("response too large");
    return { httpStatus: response.status, buffer, contentType: response.headers.get("content-type") };
  } finally {
    clearTimeout(timer);
  }
};

const checkSource = async (source, fetchImpl) => {
  const checkedAt = new Date().toISOString();
  try {
    const result = await fetchBytes(source.url, fetchImpl);
    if (!result.buffer) {
      return { state: "unreachable", httpStatus: result.httpStatus, checkedAt, note: "Using last verified snapshot." };
    }
    const sha256 = crypto.createHash("sha256").update(result.buffer).digest("hex");
    if (!source.sha256) return { state: "reachable-unhashed", sha256, checkedAt };
    return { state: sha256 === source.sha256 ? "unchanged" : "changed", sha256, expected: source.sha256, checkedAt };
  } catch (error) {
    return { state: "error", error: error.message, checkedAt, note: "Using last verified snapshot." };
  }
};

const collectSources = (registry, readSnapshot) => {
  const sources = new Map();
  for (const [datasetId, versions] of Object.entries(registry.activeVersions)) {
    for (const version of Object.values(versions)) {
      for (const source of readSnapshot(datasetId, version).sources) {
        if (!sources.has(source.url)) sources.set(source.url, { ...source, datasetId, version });
      }
    }
  }
  return [...sources.values()];
};

const runMonitor = async ({ registry, readSnapshot, fetchImpl, outputPath } = {}) => {
  const results = {};
  for (const source of collectSources(registry, readSnapshot)) {
    results[source.url] = { datasetId: source.datasetId, version: source.version, ...(await checkSource(source, fetchImpl)) };
  }
  const report = { generatedAt: new Date().toISOString(), sources: results };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
};

module.exports = { runMonitor, checkSource, fetchBytes, assertAllowed, ALLOWED_HOSTS };
