import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Evaluate only the pure schema declarations, never the editor or agent loop.
const model = fs.readFileSync(new URL("../src/apps/xdesign/fx/fxModel.ts", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/apps/xdesign/fx/fxAssist.ts", import.meta.url), "utf8");
const start = source.indexOf("const obj = (");
const end = source.indexOf("// ── System prompt", start);
if (start < 0 || end < 0) throw new Error("FX schema boundaries changed; update the generator.");
function evaluate(code, bindings = {}) {
  const context = { exports: {}, ...bindings };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context, { timeout: 1000 });
  return context.exports;
}
const constants = evaluate(model);
const { FX_TOOLS } = evaluate(source.slice(start, end), constants);
const tools = FX_TOOLS.map(({ name, description, input_schema }) => ({ name: `orion_${name}`, description, inputSchema: input_schema }));
fs.writeFileSync(new URL("../resources/fx-tools.json", import.meta.url), JSON.stringify(tools, null, 2) + "\n");
console.log(`Synced ${tools.length} FX tool schemas.`);
