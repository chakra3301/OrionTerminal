import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadCursorSdk(root = process.env.ORION_CURSOR_SDK_ROOT) {
  if (!root || !isAbsolute(root)) throw Error("Cursor SDK runtime is not configured. Install it in Control Panel → Providers.");
  const dir = realpathSync(join(root, "node_modules/@cursor/sdk"));
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (pkg.name !== "@cursor/sdk" || pkg.version !== "1.0.31") throw Error("Install the reviewed @cursor/sdk@1.0.31 runtime in Control Panel.");
  const entry = pkg.exports?.["."]?.import;
  if (typeof entry !== "string") throw Error("Cursor SDK has no supported ESM entrypoint");
  const file = realpathSync(resolve(dir, entry));
  if (!file.startsWith(dir + sep)) throw Error("Cursor SDK entrypoint escapes its package");
  const sdk = await import(pathToFileURL(file).href);
  if (typeof sdk.Agent?.create !== "function" || typeof sdk.Agent?.resume !== "function" || typeof sdk.Cursor?.me !== "function" || typeof sdk.CursorAgentError !== "function") {
    throw Error("Cursor SDK exports do not match the supported bridge API");
  }
  return { sdk, version: pkg.version };
}
