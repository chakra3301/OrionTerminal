import { create } from "zustand";
import type { AgentCli, AgentView } from "@/components/workspace/types";

export type AgentStep = {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  done: boolean;
};

export type AgentPart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; step: AgentStep }
  | { type: "notice"; id: string; text: string; error?: boolean };

export type AgentTurn = {
  id: string;
  role: "user" | "agent";
  text?: string;
  parts: AgentPart[];
};

export type AgentEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; output: string; isError: boolean }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string }
  | { kind: "result"; sessionId: string };

export type AgentSession = {
  agent: AgentCli;
  view: AgentView;
  turns: AgentTurn[];
  sessionId: string | null;
  running: boolean;
};

type State = {
  sessions: Record<string, AgentSession>;
  ensure: (chatId: string, agent: AgentCli) => AgentSession;
  setView: (chatId: string, view: AgentView) => void;
  begin: (chatId: string, text: string) => void;
  apply: (chatId: string, ev: AgentEvent) => void;
  finish: (chatId: string, error?: string | null) => void;
  reset: (chatId: string) => void;
};

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

function fresh(agent: AgentCli): AgentSession {
  return { agent, view: "chat", turns: [], sessionId: null, running: false };
}

/** Pure reducer: fold one normalised CLI event into the current agent turn. */
export function applyAgentEvent(s: AgentSession, ev: AgentEvent): AgentSession {
  if (ev.kind === "init" || ev.kind === "result") {
    return ev.sessionId ? { ...s, sessionId: ev.sessionId } : s;
  }
  const turns = s.turns.slice();
  let last = turns[turns.length - 1];
  if (!last || last.role !== "agent") {
    last = { id: nid("a"), role: "agent", parts: [] };
    turns.push(last);
  }
  const parts = last.parts.slice();
  switch (ev.kind) {
    case "text": {
      const at = parts.findIndex((p) => p.type === "text" && p.id === ev.id);
      const part: AgentPart = { type: "text", id: ev.id, text: ev.text };
      if (at >= 0) parts[at] = part;
      else parts.push(part);
      break;
    }
    case "tool":
      if (!parts.some((p) => p.type === "tool" && p.step.id === ev.id)) {
        parts.push({ type: "tool", step: { id: ev.id, name: ev.name, input: ev.input, done: false } });
      }
      break;
    case "tool_result": {
      const at = parts.findIndex((p) => p.type === "tool" && p.step.id === ev.id);
      if (at >= 0) {
        const p = parts[at] as Extract<AgentPart, { type: "tool" }>;
        parts[at] = { type: "tool", step: { ...p.step, output: ev.output, isError: ev.isError, done: true } };
      }
      break;
    }
    case "notice":
    case "error":
      parts.push({ type: "notice", id: nid("n"), text: ev.text, error: ev.kind === "error" });
      break;
  }
  turns[turns.length - 1] = { ...last, parts };
  return { ...s, turns };
}

export const useAgentChats = create<State>((set, get) => ({
  sessions: {},
  ensure: (chatId, agent) => {
    const have = get().sessions[chatId];
    if (have) return have;
    const s = fresh(agent);
    set((st) => ({ sessions: { ...st.sessions, [chatId]: s } }));
    return s;
  },
  setView: (chatId, view) =>
    set((st) => {
      const s = st.sessions[chatId];
      return s ? { sessions: { ...st.sessions, [chatId]: { ...s, view } } } : {};
    }),
  begin: (chatId, text) =>
    set((st) => {
      const s = st.sessions[chatId];
      if (!s) return {};
      const turns = [...s.turns, { id: nid("u"), role: "user" as const, text, parts: [] }];
      return { sessions: { ...st.sessions, [chatId]: { ...s, turns, running: true } } };
    }),
  apply: (chatId, ev) =>
    set((st) => {
      const s = st.sessions[chatId];
      return s ? { sessions: { ...st.sessions, [chatId]: applyAgentEvent(s, ev) } } : {};
    }),
  finish: (chatId, error) =>
    set((st) => {
      let s = st.sessions[chatId];
      if (!s) return {};
      if (error) s = applyAgentEvent(s, { kind: "error", text: error });
      // Steps the CLI never closed (cancel, crash) stop spinning.
      const turns = s.turns.map((t) =>
        t.role !== "agent" ? t : { ...t, parts: t.parts.map((p) => (p.type === "tool" && !p.step.done ? { type: "tool" as const, step: { ...p.step, done: true } } : p)) },
      );
      return { sessions: { ...st.sessions, [chatId]: { ...s, turns, running: false } } };
    }),
  reset: (chatId) =>
    set((st) => {
      const s = st.sessions[chatId];
      return s ? { sessions: { ...st.sessions, [chatId]: { ...fresh(s.agent), view: s.view } } } : {};
    }),
}));
