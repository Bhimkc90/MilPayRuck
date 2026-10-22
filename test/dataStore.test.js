const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createStore, DataUnavailableError } = require("../lib/data/datasetStore");
const { validateSnapshot } = require("../lib/data/validate");
const { checkSource, assertAllowed, fetchBytes } = require("../lib/data/sourceMonitor");

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/data/registry.json"), "utf8"));
const real = (id, version) => JSON.parse(fs.readFileSync(path.join(__dirname, `../lib/data/snapshots/${id}/${version}.json`), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

test("every active snapshot passes validation", () => {
  for (const [id, versions] of Object.entries(registry.activeVersions)) {
    for (const version of Object.values(versions)) {
      assert.deepEqual(validateSnapshot(real(id, version), id), [], `${id} ${version}`);
    }
  }
});

test("missing year is unavailable, never substituted", () => {
  const store = createStore({ registry, today: new Date("2026-10-22") });
  assert.throws(() => store.get("irs-federal-tax", 2027), DataUnavailableError);
  assert.deepEqual(store.availableYears(), [2026]);
});

test("malformed snapshots are rejected", () => {
  const broken = clone(real("irs-federal-tax", "2026.1"));
  broken.data.brackets.single.thresholds[2] = 1000; // thresholds no longer increase
  const store = createStore({ registry, loadSnapshot: () => broken, today: new Date("2026-10-22") });
  assert.throws(() => store.get("irs-federal-tax", 2026), /failed validation/);

  const unreadable = createStore({ registry, loadSnapshot: () => { throw new SyntaxError("Unexpected token"); } });
  assert.throws(() => unreadable.get("ny-income-tax", 2026), /could not be read/);

  const garbage = createStore({ registry, loadSnapshot: () => ({ datasetId: "ny-withholding", version: "x" }) });
  assert.throws(() => garbage.get("ny-withholding", 2026), DataUnavailableError);
});

test("a snapshot whose withholding table no longer matches the brackets is rejected", () => {
  const broken = clone(real("irs-federal-tax", "2026.1"));
  broken.data.withholding.tables.standard.single[3][0] = 58000;
  assert.ok(validateSnapshot(broken, "irs-federal-tax").some((p) => /withholding single/.test(p)));
});

test("mixing years is refused", () => {
  const wrongYear = clone(real("ny-income-tax", "2026.1"));
  wrongYear.taxYear = 2025;
  const store = createStore({ registry, loadSnapshot: () => wrongYear });
  assert.throws(() => store.get("ny-income-tax", 2026), /is for 2025/);
});

test("unvalidated snapshots are refused", () => {
  const pending = clone(real("ny-sad-rules", "2026.1"));
  pending.validation.status = "pending-review";
  assert.ok(validateSnapshot(pending, "ny-sad-rules").some((p) => /pending-review/.test(p)));
});

test("outdated or changed sources produce visible warnings", () => {
  const old = createStore({ registry, today: new Date("2027-06-01") });
  assert.match(old.get("irs-federal-tax", 2026).warnings.join(" "), /last verified/);
  const changed = createStore({
    registry,
    today: new Date("2026-10-22"),
    sourceStatus: { "https://www.irs.gov/pub/irs-pdf/p15t.pdf": { state: "changed" } },
  });
  assert.match(changed.get("irs-federal-tax", 2026).warnings.join(" "), /changed/);
});

test("source monitor only contacts allowlisted HTTPS hosts", async () => {
  assert.throws(() => assertAllowed("http://www.irs.gov/x"), /https/);
  assert.throws(() => assertAllowed("https://example.com/rates.json"), /not allowlisted/);
  const redirectToEvil = async () => ({ status: 302, headers: new Map([["location", "https://evil.example/x"]]) });
  await assert.rejects(fetchBytes("https://www.irs.gov/x", redirectToEvil), /not allowlisted/);
});

test("source monitor reports unreachable, unchanged, changed, and oversize sources", async () => {
  const body = Buffer.from("hello");
  const ok = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => body });
  const blocked = async () => ({ ok: false, status: 403, headers: new Map() });
  const huge = async () => ({ ok: true, status: 200, headers: new Map([["content-length", String(100 * 1024 * 1024)]]), arrayBuffer: async () => body });
  const sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  assert.equal((await checkSource({ url: "https://www.dfas.mil/x" }, blocked)).state, "unreachable");
  assert.equal((await checkSource({ url: "https://www.irs.gov/x", sha256: sha }, ok)).state, "unchanged");
  assert.equal((await checkSource({ url: "https://www.irs.gov/x", sha256: "0".repeat(64) }, ok)).state, "changed");
  assert.equal((await checkSource({ url: "https://www.irs.gov/x" }, huge)).state, "error");
});
