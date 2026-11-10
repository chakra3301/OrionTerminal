import { create } from "zustand";
import { ipc, type AgentCliInfo, type AgentRunOptions } from "@/lib/ipc";
import { getAppState, setAppState } from "@/lib/db";
import { log } from "@/lib/log";
import type { AgentCli } from "@/components/workspace/types";

/** Chat-view choices per agent; null = the CLI's own configured default. */
export type AgentChoice = { model: string | null; effort: string | null; mode: string | null };

export const AGENT_MODES: Record<AgentCli, { id: string | null; label: string; hint: string }[]> = {
  claude: [
    { id: null, label: "Edit", hint: "Makes edits without asking (acceptEdits)" },
    { id: "plan", label: "Plan", hint: "Reads and plans, changes nothing" },
  ],
  codex: [
    { id: null, label: "Write", hint: "Can edit files in the project (workspace-write)" },
    { id: "read-only", label: "Read only", hint: "Reads and answers, changes nothing" },
  ],
  pi: [],
  hermes: [],
};

const EMPTY: AgentChoice = { model: null, effort: null, mode: null };

type State = {
  choices: Partial<Record<AgentCli, AgentChoice>>;
  info: Partial<Record<AgentCli, AgentCliInfo | "loading" | "error">>;
  hydrated: boolean;
  set: (agent: AgentCli, patch: Partial<AgentChoice>) => void;
  loadInfo: (agent: AgentCli, force?: boolean) => void;
  hydrate: () => void;
};

export function choiceFor(s: Pick<State, "choices">, agent: AgentCli): AgentChoice {
  return s.choices[agent] ?? EMPTY;
}

export function runOptions(c: AgentChoice): AgentRunOptions {
  return { model: c.model, effort: c.effort, mode: c.mode };
}

export const useAgentOptions = create<State>((set, get) => ({
  choices: {},
  info: {},
  hydrated: false,
  set: (agent, patch) => {
    const choices = { ...get().choices, [agent]: { ...choiceFor(get(), agent), ...patch } };
    set({ choices });
    void setAppState("agents.options", choices).catch((e) => log.warn("save agent options failed", e));
  },
  loadInfo: (agent, force) => {
    const have = get().info[agent];
    if (!force && have && have !== "error") return;
    set((s) => ({ info: { ...s.info, [agent]: "loading" } }));
    ipc
      .agentCliInfo(agent)
      .then((info) => set((s) => ({ info: { ...s.info, [agent]: info } })))
      .catch((e) => {
        log.warn(`agent info ${agent} failed`, e);
        set((s) => ({ info: { ...s.info, [agent]: "error" } }));
      });
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    void getAppState<Partial<Record<AgentCli, AgentChoice>>>("agents.options")
      .then((saved) => {
        if (saved && typeof saved === "object") set((s) => ({ choices: { ...saved, ...s.choices } }));
      })
      .catch(() => {});
  },
}));

/** Short label for a model id: the CLI's label when known, else the id's tail. */
export function modelLabel(info: AgentCliInfo | undefined, id: string | null): string {
  if (!id) return "";
  const hit = info?.models.find((m) => m.id === id);
  if (hit) return hit.label;
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail;
}
