import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("resources/preview-bootstrap-integrity.json", root);
const configUrl = new URL("src-tauri/tauri.conf.json", root);
const source = (await readFile(new URL("src/apps/xdesign/preview-bootstrap.js", root), "utf8")).replace(/\r\n?/g, "\n");
const scriptSource = `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
let previous;
try { previous = JSON.parse(await readFile(manifestUrl, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const config = JSON.parse(await readFile(configUrl, "utf8"));
for (const name of ["csp", "devCsp"]) {
  const csp = config.app.security[name];
  const tokens = csp["script-src"].split(/\s+/).filter(token => token !== previous?.scriptSource && token !== scriptSource);
  csp["script-src"] = [...tokens, scriptSource].join(" ");
}
await writeFile(manifestUrl, JSON.stringify({ scriptSource }, null, 2) + "\n");
await writeFile(configUrl, JSON.stringify(config, null, 2) + "\n");
console.log("Updated the exact preview-bootstrap CSP hash; no blanket inline permission added.");
