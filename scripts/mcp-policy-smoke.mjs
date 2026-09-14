import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const [flag, input, ...extra] = process.argv.slice(2);
assert(flag === "--binary" && input && isAbsolute(input) && !extra.length,
  "Usage: node scripts/mcp-policy-smoke.mjs --binary /absolute/path/to/orion-terminal");
const binary = realpathSync(input);
const scratch = mkdtempSync(join(tmpdir(), "orion-mcp-policy-"));
const dbPath = join(scratch, "fixture.db");
const db = new DatabaseSync(dbPath);
const results = [];
try {
  db.exec(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, blocks_json TEXT, plaintext TEXT,
      parent_id TEXT, kind TEXT, location TEXT, collection_id TEXT, created_at INTEGER, updated_at INTEGER);`);
  const file = join(scratch, "read.txt");
  writeFileSync(file, "SCOPED_READ_OK", { mode: 0o600 });
  const list = { method: "tools/list", params: {} };
  const read = { method: "tools/call", params: { name: "orion_read_file", arguments: { path: file } } };
  const create = { method: "tools/call", params: { name: "orion_create_note", arguments: { title: "SCOPED_WRITE_PROBE", body: "Synthetic fixture only." } } };
  const invoke = (grants, requests) => {
    const run = spawnSync(binary, ["--mcp-serve"], {
      cwd: scratch,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: scratch, ORION_DB_PATH: dbPath, ORION_TOOL_GRANTS: grants },
      input: requests.map((r, i) => JSON.stringify({ jsonrpc: "2.0", id: i + 1, ...r })).join("\n") + "\n",
      encoding: "utf8", timeout: 20000, maxBuffer: 8000000,
    });
    assert.equal(run.error, undefined, "MCP process failed or timed out");
    assert.equal(run.status, 0, "MCP process exited unsuccessfully");
    const replies = run.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(replies.length, requests.length);
    return replies.map((r, i) => { assert.equal(r.id, i + 1); assert(!r.error); return r.result; });
  };
  const text = r => r.content.map(c => c.text ?? "").join("\n");
  const denied = r => { assert.equal(r.isError, true); assert.match(text(r), /not authorized for this run/); };
  for (const grants of ['["Read"]', '["mcp__orion__orion_read_file"]']) {
    const [tools, allowed, forbidden] = invoke(grants, [list, read, create]);
    assert.deepEqual(tools.tools.map(t => t.name), ["orion_read_file"]);
    assert.equal(allowed.isError, false);
    assert.equal(text(allowed), "SCOPED_READ_OK");
    denied(forbidden);
    results.push({ grants, read: "allowed", createNote: "denied" });
  }
  for (const grants of ["[]", "malformed", "{}", '["--dangerously-skip-permissions"]']) {
    const [tools, forbiddenRead, forbiddenWrite] = invoke(grants, [list, read, create]);
    assert.deepEqual(tools.tools, []);
    denied(forbiddenRead); denied(forbiddenWrite);
    results.push({ grants, advertisedTools: 0, guessedTools: "denied" });
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 0);
  const [allowedWrite] = invoke('["orion_create_note"]', [create]);
  assert.equal(allowedWrite.isError, false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes").get().n, 1);
  results.push({ explicitWriteGrant: "allowed", syntheticNotes: 1 });
  const [all] = invoke('["mcp__orion"]', [list]);
  assert(all.tools.length > 1);
  results.push({ explicitWholeServerGrant: all.tools.length });
  db.prepare("INSERT INTO app_state VALUES ('plugins.state', ?)").run(JSON.stringify({ version: 1, disabled: ["@orion/editor"] }));
  const [disabledTools, disabledRead] = invoke('["Read"]', [list, read]);
  assert.deepEqual(disabledTools.tools, []);
  assert.equal(disabledRead.isError, true);
  assert.match(text(disabledRead), /plugin disabled/);
  results.push({ disabledPlugin: "denied despite grant" });
  console.log(JSON.stringify({ scope: "Packaged MCP list/call policy; no model or production profile access", results }, null, 2));
} finally {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
}
