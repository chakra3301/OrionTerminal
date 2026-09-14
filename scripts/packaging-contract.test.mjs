import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

test("packaged asset loaders can fetch bundled, blob, and scoped native assets", () => {
  const connect = config.app.security.csp["connect-src"].split(/\s+/);
  for (const source of ["'self'", "blob:", "asset:", "http://asset.localhost"]) {
    assert.ok(connect.includes(source), `Missing ${source}: Three.js GLB and texture loading use fetch, not img-src`);
  }
  for (const broad of ["*", "http:", "https:"]) assert.ok(!connect.includes(broad));
  assert.equal(config.app.security.csp["object-src"], "'none'");
  assert.equal(config.app.security.csp["base-uri"], "'none'");
});

test("SQL is not preloaded before the app setup backup can run", () => {
  assert.deepEqual(config.plugins?.sql?.preload ?? [], [], "SQL plugin preloads run before app setup and would bypass the pre-migration snapshot");
});

test("startup does not purge notes using an empty plaintext heuristic", () => {
  const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  const db = readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8");
  assert.doesNotMatch(app, /purgeEmptyNotes/);
  const noteDeletes = [...db.matchAll(/DELETE\s+FROM\s+notes\b[^"`]+/gi)].map(([sql]) => sql.trim());
  assert.deepEqual(noteDeletes, ["DELETE FROM notes WHERE id = $1"], "Note deletion must remain explicitly ID-scoped; empty plaintext does not imply an empty note");
});

test("clean verification builds emitted resources before compiling native tests", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const steps = pkg.scripts.verify.split(/\s*&&\s*/);
  for (const gate of ["npm run typecheck", "npm test", "npm run test:bridges", "npm run build", "npm run test:native"]) {
    assert.ok(steps.includes(gate), `Missing verification gate: ${gate}`);
  }
  assert.ok(steps.indexOf("npm run build") < steps.indexOf("npm run test:native"), "Tauri requires the emitted dist/licenses resources even when compiling tests");
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /run: npm run verify\s*\n/, "Release preflight must use the same clean-build ordering");
});

test("bundle retains checked third-party notices and license texts", () => {
  for (const resource of ["../LICENSE", "../NOTICE", "../THIRD_PARTY_NOTICES.md", "../THIRD_PARTY_LICENSES"]) {
    assert.ok(config.bundle.resources.includes(resource));
  }
});
