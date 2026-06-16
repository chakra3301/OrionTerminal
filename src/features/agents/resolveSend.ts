import { parseSelection } from "./agentValue";
import { composeAgent } from "./composeAgent";
import type { Agent, Skill } from "./agentTypes";

export type ResolvedSend = {
  model: string;
  systemAppend: string | null;
  allowedTools: string[] | null;
};

export function resolveSend(value: string, agents: Agent[], skills: Skill[]): ResolvedSend {
  const sel = parseSelection(value);
  if (sel.kind === "model") {
    return { model: sel.id, systemAppend: null, allowedTools: null };
  }
  const agent = agents.find((a) => a.id === sel.id);
  if (!agent) return { model: value, systemAppend: null, allowedTools: null };
  const c = composeAgent(agent, skills);
  return { model: c.model, systemAppend: c.appendSystemPrompt || null, allowedTools: c.allowedTools.length ? c.allowedTools : null };
}

import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";

export function resolveSendFromStores(value: string): ResolvedSend {
  return resolveSend(value, Array.from(useAgentsStore.getState().agents.values()), useSkillsStore.getState().list());
}
