import type { ToolGrant } from "./agentTypes";
import type { McpServer } from "@/store/mcpServersStore";

export type BuiltinTool = { kind: "builtin"; name: string; label: string };

export const BUILTIN_TOOLS: BuiltinTool[] = [
  { kind: "builtin", name: "WebSearch", label: "Web Search" },
  { kind: "builtin", name: "Read", label: "Read files" },
  { kind: "builtin", name: "Glob", label: "Find files" },
  { kind: "builtin", name: "Grep", label: "Search file contents" },
  { kind: "builtin", name: "Bash", label: "Run shell commands" },
  { kind: "builtin", name: "Edit", label: "Edit files" },
  { kind: "builtin", name: "Write", label: "Write files" },
];

export function mcpToolGrants(servers: McpServer[]): ToolGrant[] {
  return servers.filter((s) => s.enabled).map((s) => ({ kind: "mcp", server: s.name }));
}

export function allToolGrants(servers: McpServer[]): ToolGrant[] {
  const builtins: ToolGrant[] = BUILTIN_TOOLS.map((t) => ({ kind: "builtin", name: t.name }));
  return [...builtins, ...mcpToolGrants(servers)];
}
