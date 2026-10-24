import type { Agent, Skill } from "./agentTypes";

export type ComposedAgent = {
  model: string;
  actionModel: string;
  appendSystemPrompt: string;
  allowedTools: string[];
  importedSkillIds?: string[];
};

export function composeAgent(agent: Agent, allSkills: Skill[]): ComposedAgent {
  const byId = new Map(allSkills.map((s) => [s.id, s]));
  const importedSkillIds = [...new Set(agent.skillIds.filter((id) => id.startsWith("imported:") || byId.get(id)?.imported))];
  for (const id of importedSkillIds) {
    const skill = byId.get(id);
    if (!skill?.imported) throw new Error(`Imported skill ${id} is missing. Repair this agent in Agent Forge.`);
    if (!skill.imported.enabled) throw new Error(`Imported skill “${skill.name}” is disabled. Enable it or detach it in Agent Forge.`);
  }
  const equipped = agent.skillIds.filter((id) => !importedSkillIds.includes(id)).map((id) => byId.get(id)).filter((s): s is Skill => !!s);

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

  return { model: agent.brainModel, actionModel: agent.actionModel, appendSystemPrompt, allowedTools: [...tools], ...(importedSkillIds.length ? { importedSkillIds } : {}) };
}
