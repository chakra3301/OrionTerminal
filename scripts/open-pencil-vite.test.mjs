import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openPencilWorkers } from "./open-pencil-vite.mjs";

const figExport = fileURLToPath(new URL("../node_modules/@open-pencil/core/dist/io/formats/fig/export.js", import.meta.url));

test("FIG export packs in the export worker inside Tauri instead of invoking a missing native command", () => {
  const { code } = openPencilWorkers().transform(readFileSync(figExport, "utf8"), figExport);
  assert.doesNotMatch(code, /if \(IS_TAURI\) \{\s*const \{ invoke \}/);
  assert.match(code, /new URL\("\.\/export-worker\.js", import\.meta\.url\)/);
});
