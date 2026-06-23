// Pure reducer for a live pi run's streaming state. The Rust pi_engine emits
// flat cc events ({kind:init|assistant|tool_use|tool_result|result}); this
// folds them into a RunState the store renders. No IO.

export type CcToolCall = {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
};

export type CcRunStatus = "streaming" | "done" | "error";

export type CcMessageKind = "chat" | "directive" | "report" | "handoff";

export type CcRunState = {
  runId: string;
  profileId: string;
  channelId: string;
  text: string;
  tools: CcToolCall[];
  sessionId: string;
  cost: number;
  status: CcRunStatus;
  startedAt: number;
  // How the finished run is persisted (set at creation).
  fromId: string;
  toId: string;
  kind: CcMessageKind;
  missionRef: string;
};

export type CcEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; content: string; isError: boolean }
  | { kind: "result"; sessionId: string; cost: number };

export function newRun(
  runId: string,
  profileId: string,
  channelId: string,
  meta?: {
    fromId?: string;
    toId?: string;
    kind?: CcMessageKind;
    missionRef?: string;
  },
): CcRunState {
  return {
    runId,
    profileId,
    channelId,
    text: "",
    tools: [],
    sessionId: "",
    cost: 0,
    status: "streaming",
    startedAt: Date.now(),
    fromId: meta?.fromId ?? profileId,
    toId: meta?.toId ?? "",
    kind: meta?.kind ?? "chat",
    missionRef: meta?.missionRef ?? "",
  };
}

export function applyCcEvent(run: CcRunState, ev: CcEvent): CcRunState {
  switch (ev.kind) {
    case "init":
      return { ...run, sessionId: ev.sessionId };
    case "assistant":
      return { ...run, text: ev.text };
    case "tool_use":
      return {
        ...run,
        tools: [
          ...run.tools,
          { id: ev.id, name: ev.name, input: ev.input },
        ],
      };
    case "tool_result":
      return {
        ...run,
        tools: run.tools.map((t) =>
          t.id === ev.id
            ? { ...t, result: ev.content, isError: ev.isError }
            : t,
        ),
      };
    case "result":
      return {
        ...run,
        cost: ev.cost,
        sessionId: ev.sessionId || run.sessionId,
        status: "done",
      };
    default:
      return run;
  }
}
