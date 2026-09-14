import test from "node:test";
import assert from "node:assert/strict";
import { classifyNativeAudit, parsePackageTree } from "./audit-native.mjs";

const finding = (name, version, id) => ({ package: { name, version }, advisory: { id } });
function report() {
  return {
    settings: { ignore: [], severity: null, target_arch: [], target_os: [], informational_warnings: ["unmaintained", "unsound", "notice"] },
    vulnerabilities: { count: 1, list: [finding("rsa", "0.9.10", "RUSTSEC-2023-0071")] },
    warnings: { unsound: [finding("glib", "0.18.5", "RUSTSEC-2024-0429")], unmaintained: [finding("unic-common", "0.9.0", "RUSTSEC-2025-0080")] },
  };
}
test("target classification keeps excluded lockfile findings visible and maintenance separate", () => {
  const packages = parsePackageTree("orion-terminal v0.1.0 (/fixture)\nunic-common v0.9.0\nunic-common v0.9.0 (*)\n");
  const result = classifyNativeAudit(report(), packages);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.maintenance.length, 1);
  assert.deepEqual(result.notSelected.map(x => x.name), ["rsa", "glib"]);
});
test("active vulnerable or unsound packages fail the target gate", () => {
  const result = classifyNativeAudit(report(), new Set(["rsa@0.9.10", "glib@0.18.5"]));
  assert.deepEqual(result.blocking.map(x => x.name), ["rsa", "glib"]);
});
test("filtered, ignored, or incomplete evidence fails closed", () => {
  const ignored = report(); ignored.settings.ignore.push("RUSTSEC-2023-0071");
  assert.throws(() => classifyNativeAudit(ignored, new Set()), /unfiltered/);
  const filtered = report(); filtered.settings.informational_warnings = ["unmaintained"];
  assert.throws(() => classifyNativeAudit(filtered, new Set()), /unfiltered/);
  const incomplete = report(); incomplete.vulnerabilities.list = [];
  assert.throws(() => classifyNativeAudit(incomplete, new Set()), /Incomplete/);
  assert.throws(() => parsePackageTree("cargo failed"), /dependency tree/);
});
