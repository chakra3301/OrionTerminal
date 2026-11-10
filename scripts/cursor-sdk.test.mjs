import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCursorSdk } from "./cursor-sdk.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "orion-sdk-test-"));
  const pkg = join(root, "node_modules/@cursor/sdk"); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "index.mjs"), "export class Agent { static create() {} static resume() {} } export class Cursor { static me() {} } export class CursorAgentError extends Error {};");
  const manifest = { name: "@cursor/sdk", version: "1.1.0", exports: { ".": { import: "./index.mjs" } } };
  const save = () => writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest)); save();
  return { root, pkg, manifest, save };
}

test("SDK loads from the explicit runtime, never ambient checkout resolution", async () => {
  const f = fixture();
  try {
    assert.equal((await loadCursorSdk(f.root)).version, "1.1.0");
    await assert.rejects(loadCursorSdk(join(f.root, "missing")));
    await assert.rejects(loadCursorSdk(""), /not configured/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("SDK rejects unsupported versions and package-escaping entrypoints", async () => {
  const f = fixture();
  try {
    f.manifest.version = "2.0.0"; f.save();
    await assert.rejects(loadCursorSdk(f.root), /reviewed/);
    f.manifest.version = "1.1.0"; f.manifest.exports["."].import = "../escape.mjs"; f.save();
    writeFileSync(join(f.pkg, "../escape.mjs"), "throw Error('must not execute');");
    await assert.rejects(loadCursorSdk(f.root), /escapes/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("optional SDK install is pinned to audited registry packages", () => {
  const root = new URL("../resources/cursor-runtime/", import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL("package.json", root)));
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root)));
  assert.equal(pkg.dependencies["@cursor/sdk"], "1.1.0");
  assert.equal(lock.packages["node_modules/@cursor/sdk"].version, "1.1.0");
  assert.equal(pkg.overrides["@connectrpc/connect-node"].undici, "6.29.1");
  for (const [name, data] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.match(data.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.match(data.integrity, /^sha512-/);
  }
});

test("reviewed SDK parses streamed messages and nonempty event maps", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const { sdk, version } = await loadCursorSdk(root);
  assert.equal(version, "1.1.0");
  const turn = { steps: [{ type: "assistantMessage", message: { text: "hello" } }] };
  assert.equal(sdk.AgentConversationTurnSchema.safeParse(turn).success, true);
  const output = { type: "shell-output-delta", event: { stdout: "hello", exitCode: 0 } };
  assert.equal(sdk.ShellOutputDeltaUpdateSchema.safeParse(output).success, true);
  assert.equal(sdk.ShellOutputDeltaUpdateSchema.safeParse({ type: "shell-output-delta", event: null }).success, false);
});
