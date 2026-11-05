import { parseSelection } from "./agentValue";
import { composeAgent } from "./composeAgent";
import type { Agent, Skill } from "./agentTypes";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import type { ImportedActivation } from "@/features/intake/skillActivation";

export type ResolvedSend = {
  model: string;
  actionModel: string | null;
  systemAppend: string | null;
  allowedTools: string[] | null;
  importedSkillIds?: string[];
  importedActivation?: ImportedActivation;
};

export function resolveSend(value: string, agents: Agent[], skills: Skill[]): ResolvedSend {
  const sel = parseSelection(value);
  if (sel.kind === "model") {
    return { model: sel.id, actionModel: null, systemAppend: null, allowedTools: null };
  }
  const agent = agents.find((a) => a.id === sel.id);
  if (!agent) throw new Error("This agent no longer exists. Choose another agent or model.");
  const c = composeAgent(agent, skills);
  return {
    model: c.model,
    actionModel: c.actionModel || null,
    systemAppend: c.appendSystemPrompt || null,
    allowedTools: c.allowedTools,
    ...(c.importedSkillIds ? { importedSkillIds: c.importedSkillIds } : {}),
  };
}

export function resolveSendFromStores(value: string, allowImported = false): ResolvedSend {
  const resolved = resolveSend(value, Array.from(useAgentsStore.getState().agents.values()), useSkillsStore.getState().list());
  if (resolved.importedSkillIds?.length && !allowImported) throw new Error("Imported skills currently work only in Orion's foreground text chat. Choose a plain model or an agent without imported skills here.");
  return resolved;
}
