import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const root = new URL("../src/vendor/pptxgenjs/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("upstream.json", root), "utf8"));
const sha = file => createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex");

test("PPTX browser artifact, declarations and licenses match the reviewed upstream pins", () => {
  assert.equal(sha("pptxgen.js"), manifest.adaptedSha256);
  assert.equal(sha("pptxgen.d.ts"), manifest.typesSha256);
  assert.equal(sha("LICENSE"), manifest.licenseSha256);
  assert.equal(sha("../../../THIRD_PARTY_LICENSES/PptxGenJS-MIT.txt"), manifest.licenseSha256);
  const source = readFileSync(new URL("pptxgen.js", root), "utf8");
  assert.match(source, /^import JSZip from "jszip";/);
  assert.match(source, /export default PptxGenJS;\s*$/);
  assert.doesNotMatch(source, /image-size|\brequire\(/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies.pptxgenjs, undefined);
  const require = createRequire(import.meta.url);
  const zipVersion = require("jszip/package.json").version;
  assert.equal(`jszip@${zipVersion}`, manifest.runtimeDependency);
  assert.equal(pkg.dependencies.jszip, zipVersion);
});
