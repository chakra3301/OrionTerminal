import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("../src/vendor/pptxgenjs/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("upstream.json", root), "utf8"));
if (manifest.tarball !== `https://registry.npmjs.org/pptxgenjs/-/pptxgenjs-${manifest.version}.tgz`) throw Error("Unexpected upstream registry URL");
const response = await fetch(manifest.tarball, { redirect: "error", signal: AbortSignal.timeout(30_000) });
if (!response.ok || !response.body) throw Error(`Upstream download failed: ${response.status}`);
const chunks = []; let size = 0;
for await (const chunk of response.body) {
  size += chunk.length;
  if (size > 5_000_000) throw Error("Upstream archive exceeds size limit");
  chunks.push(chunk);
}
const archive = Buffer.concat(chunks);
if (`sha512-${createHash("sha512").update(archive).digest("base64")}` !== manifest.integrity) throw Error("Upstream archive integrity mismatch");
const tmp = mkdtempSync(join(tmpdir(), "orion-pptx-source-"));
try {
  const file = join(tmp, "package.tgz"); writeFileSync(file, archive);
  const extract = (member, expected) => {
    const bytes = execFileSync("tar", ["-xOf", file, `package/${member}`], { maxBuffer: 2_000_000, timeout: 10_000 });
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw Error(`Upstream member changed: ${member}`);
    return bytes;
  };
  const source = extract("dist/pptxgen.min.js", manifest.sourceSha256).toString("utf8");
  const types = extract("types/index.d.ts", manifest.typesSha256);
  const license = extract("LICENSE", manifest.licenseSha256);
  const adapted = 'import JSZip from "jszip";\n' + source.replace(/^\/\/# sourceMappingURL=.*$/m, "") + '\nexport default PptxGenJS;\n';
  if (createHash("sha256").update(adapted).digest("hex") !== manifest.adaptedSha256) throw Error("Browser adapter changed; review its recorded checksum");
  writeFileSync(new URL("pptxgen.js", root), adapted);
  writeFileSync(new URL("pptxgen.d.ts", root), types);
  writeFileSync(new URL("LICENSE", root), license);
  writeFileSync(new URL("../THIRD_PARTY_LICENSES/PptxGenJS-MIT.txt", import.meta.url), license);
  console.log(`Verified upstream PptxGenJS ${manifest.version} browser build; added only ESM imports/exports and removed the source-map directive.`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
