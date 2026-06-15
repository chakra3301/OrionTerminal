export type Selection =
  | { kind: "model"; id: string }
  | { kind: "agent"; id: string };

const AGENT_PREFIX = "agent:";

export function formatAgentValue(agentId: string): string {
  return AGENT_PREFIX + agentId;
}

export function parseSelection(value: string | null | undefined): Selection {
  const v = value ?? "";
  if (v.startsWith(AGENT_PREFIX)) {
    return { kind: "agent", id: v.slice(AGENT_PREFIX.length) };
  }
  return { kind: "model", id: v };
}
