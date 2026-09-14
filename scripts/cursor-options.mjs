const TOOL_NAMES = {
  Read: "read", Edit: "mcp", Write: "mcp", Grep: "grep", Glob: "glob",
  Bash: "shell", WebSearch: "webSearch", WebFetch: "webFetch",
};

export function cursorTools(allowedTools) {
  if (allowedTools == null) return undefined;
  return [...new Set(allowedTools.map((name) => {
    if (name.startsWith("mcp__") || name.startsWith("orion_")) return "mcp";
    const tool = TOOL_NAMES[name];
    if (!tool) throw new Error(`Unsupported Cursor tool selection: ${name}`);
    return tool;
  }))];
}

export function cursorOptions(config) {
  if (config.allowedTools != null) {
    const servers = config.mcpServers ?? {};
    let grants;
    try { grants = JSON.parse(servers.orion?.env?.ORION_TOOL_GRANTS); } catch { /* missing or invalid policy fails below */ }
    if (Object.keys(servers).some(name => name !== "orion") ||
        !Array.isArray(grants) || JSON.stringify(grants) !== JSON.stringify(config.allowedTools)) {
      throw new Error("Restricted Cursor tools require a matching native Orion MCP grant policy");
    }
  }
  return {
    apiKey: config.apiKey.trim(),
    model: { id: config.model || "composer-2.5" },
    local: { cwd: config.cwd || process.cwd(), settingSources: [] },
    mcpServers: config.mcpServers,
    tools: cursorTools(config.allowedTools),
    // Native file edits bypass Orion's reviewable MCP diff tools.
    disallowedTools: ["edit", "delete", "applyAgentDiff"],
  };
}
