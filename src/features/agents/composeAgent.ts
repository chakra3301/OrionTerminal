import type { Agent, Skill } from "./agentTypes";

export type ComposedAgent = {
  model: string;
  appendSystemPrompt: string;
  allowedTools: string[];
};

export function composeAgent(agent: Agent, allSkills: Skill[]): ComposedAgent {
  const byId = new Map(allSkills.map((s) => [s.id, s]));
  const equipped = agent.skillIds.map((id) => byId.get(id)).filter((s): s is Skill => !!s);

  const header = agent.role
    ? `You are ${agent.name}, a ${agent.role}.`
    : `You are ${agent.name}.`;
  const body = equipped.map((s) => `## ${s.name}\n${s.instructions}`.trim()).filter(Boolean);
  const appendSystemPrompt = [header, ...body].join("\n\n");

  const tools = new Set<string>();
  for (const s of equipped) {
    for (const g of s.tools) {
      tools.add(g.kind === "builtin" ? g.name : `mcp__${g.server}`);
    }
  }

  return { model: agent.brainModel, appendSystemPrompt, allowedTools: [...tools] };
}
