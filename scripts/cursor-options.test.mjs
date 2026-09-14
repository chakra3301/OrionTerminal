import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorOptions, cursorTools } from "./cursor-options.mjs";

test("Cursor preserves the Orion MCP bridge and disables unreviewed native edits", () => {
  const mcpServers = { orion: { command: "/orion", args: ["--mcp-serve"], env: { ORION_BRIDGE_TOKEN: "test-only" } } };
  const options = cursorOptions({ apiKey: "test", model: "auto", cwd: "/project", mcpServers });
  assert.deepEqual(options.mcpServers, mcpServers);
  assert.deepEqual(options.local, { cwd: "/project", settingSources: [] });
  assert.ok(options.disallowedTools.includes("edit"));
  assert.equal(options.tools, undefined);
});
test("restricted MCP tool families require the exact native grant snapshot", () => {
  const allowedTools = ["mcp__orion__orion_fx_get_scene"];
  const config = { apiKey: "test", allowedTools, mcpServers: { orion: { env: { ORION_TOOL_GRANTS: JSON.stringify(allowedTools) } } } };
  assert.deepEqual(cursorOptions(config).tools, ["mcp"]);
  assert.throws(() => cursorOptions({ ...config, mcpServers: {} }), /matching native/);
  assert.throws(() => cursorOptions({ ...config, allowedTools: ["Read"] }), /matching native/);
  assert.throws(() => cursorOptions({ ...config, mcpServers: { ...config.mcpServers, extra: {} } }), /matching native/);
});

test("empty restrictions stay tool-less; explicit MCP and built-ins translate", () => {
  assert.deepEqual(cursorTools([]), []);
  assert.deepEqual(cursorTools(["mcp__orion__orion_fx_get_scene", "Read", "Write"]), ["mcp", "read"]);
  assert.throws(() => cursorTools(["not-a-supported-tool"]), /Unsupported/);
});
