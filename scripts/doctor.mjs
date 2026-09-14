#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const add = (name, ok, detail, required = false) => results.push({ name, ok, detail, required });
function probe(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: result.status === 0 && !result.error, output: result.stdout || result.stderr || "", error: result.error?.code || `exit ${result.status}` };
}
function version(command, args = ["--version"], required = false) {
  const result = probe(command, args);
  add(command, result.ok, result.ok ? result.output.trim().split("\n")[0].slice(0, 140) : result.error, required);
  return result.ok;
}

const [major, minor] = process.versions.node.split(".").map(Number);
add("Node.js", major > 22 || major === 22 && minor >= 13, process.version, true);
version("npm", ["--version"], true);
version("rustc", ["--version"], true);
version("cargo", ["--version"], true);
add("project dependencies", existsSync(resolve(root, "node_modules/typescript/package.json")), "Run npm ci if missing", true);
if (version("claude")) {
  const status = probe("claude", ["auth", "status", "--json"]);
  let ready = false;
  try { const data = JSON.parse(status.output); ready = status.ok && data.loggedIn === true && data.authMethod === "oauth"; } catch { /* status is intentionally not printed: it can contain account details */ }
  add("Claude subscription", ready, ready ? "OAuth session reported" : "Connect in Control Panel → Providers");
}
if (version("codex")) {
  const status = probe("codex", ["login", "status"]);
  const ready = status.ok && /logged in using chatgpt/i.test(status.output);
  add("ChatGPT subscription", ready, ready ? "ChatGPT session reported" : "Connect in Control Panel → Providers");
}
version("gemini");
add("Gemini OAuth file", existsSync(resolve(homedir(), ".gemini/oauth_creds.json")), "Presence only; does not validate or refresh credentials");
add("Cursor SDK", existsSync(resolve(root, "node_modules/@cursor/sdk/package.json")), "API key and model access must be tested in Control Panel");
version("typescript-language-server");
version("pyright");
version("rust-analyzer");

const notes = [
  "No credentials are printed, installed, changed, or copied; no AI request is made.",
  "CLI login status is not proof of a successful model/tool call.",
  "API, local-model, Cursor, and Command/pi credentials need their own live checks.",
  "Release readiness also requires dependency review and packaged desktop smoke tests.",
];
if (process.argv.includes("--json")) console.log(JSON.stringify({ results, notes }, null, 2));
else {
  for (const row of results) console.log(`${row.ok ? "OK" : row.required ? "FAIL" : "CHECK"}  ${row.name}: ${row.detail}`);
  console.log(`\n${notes.join("\n")}`);
}
if (process.argv.includes("--strict") && results.some((r) => r.required && !r.ok)) process.exitCode = 1;
