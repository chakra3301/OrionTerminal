import { create } from "zustand";
import { ulid } from "ulid";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "@/lib/ipc";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { log } from "@/lib/log";
import { upsertChat, getChatById, listAllChats } from "@/lib/db";

/** Claude Code stream-json content blocks. The subprocess emits these
 * inside `assistant` events; `user` events carry matching tool_result
 * blocks. Identical to the shape `chatStore` already uses for Orion's
 * Orix47 rail. */
export type RosieContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

/** UI-friendly message shape. Assistant messages may stream — `content`
 * is replaced with a full snapshot on every `assistant` event from the
 * subprocess. User messages stay as plain text. */
export type RosieMessage = {
  id: string;
  role: "user" | "assistant";
  content: string | RosieContentBlock[];
  /** UI-only flag: assistant is mid-stream. */
  pending?: boolean;
};

/** Inline tool-use chip the UI renders alongside the assistant text. */
export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  state: "running" | "ok" | "error";
};

type RosieState = {
  open: boolean;
  /** Stable id for the whole conversation (multiple turns). Used as the
   * primary key in the `chats` table so we upsert into the same row across
   * turns instead of accumulating rows. */
  threadId: string;
  /** Auto-derived title — first user message, truncated. */
  title: string;
  messages: RosieMessage[];
  /** Tool calls indexed by tool_use id; rendered as chips in the UI. */
  toolCalls: Record<string, ToolCall>;
  running: boolean;
  error: string | null;
  /** Recent stderr lines from the claude subprocess. Surfaced in the UI as
   * a diagnostic dropdown so silent failures aren't truly silent. Capped
   * at 50 lines; oldest dropped first. */
  stderrLines: string[];
  /** Cost the subprocess reports per turn (subscription users see 0). */
  totalCostUsd: number;
  /** Timestamp the conversation was first opened — used as created_at in DB. */
  createdAt: number;
  /** Updated per turn — used for sort order. */
  updatedAt: number;
  /** Claude-code session id, set on first `system init` event so we can
   * `--resume` for multi-turn continuity. */
  sessionId: string | null;
  /** Per-turn stream id (chat id) — cancellation routes through this. */
  activeStreamId: string | null;
  /** Wall-clock ms when the current turn began — drives the elapsed timer
   * on the background task chip. Null when idle. */
  turnStartedAt: number | null;

  /** Text the input component should adopt on next render (e.g. populated
   * by the voice transcriber). Consumed by the input's effect and cleared
   * after — store is the SSOT, input local state is downstream. */
  pendingInput: string | null;
  /** TTS toggle — when true, R.O.S.I.E speaks each completed assistant turn
   * aloud via the browser's SpeechSynthesis API. Persisted across launches
   * via app_state below. */
  ttsEnabled: boolean;

  /** Whether the floating 3D companion is on screen. Default true ("always
   * visible"); flung off-screen → false until summoned again. Session-only —
   * a relaunch brings her back. */
  companionVisible: boolean;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  spawnCompanion: () => void;
  dismissCompanion: () => void;
  newConversation: () => void;
  send: (text: string) => Promise<void>;
  cancel: () => void;
  setTtsEnabled: (v: boolean) => void;
  /** Replace store state with a thread loaded from DB. Used to resume the
   * last R.O.S.I.E conversation on app boot or to switch between past chats. */
  loadThread: (threadId: string) => Promise<void>;
  /** Try to resume the most recent R.O.S.I.E thread; no-op if none exists. */
  resumeLatest: () => Promise<void>;
  /** Inject text into the panel's input field (without sending). Used by
   * the voice flow + any future "fill from elsewhere" entry points. */
  setPendingInput: (text: string | null) => void;
};

/** System prompt prepended to the FIRST user turn (claude-code's subprocess
 * doesn't take a `--system-prompt` directly via stdin the way we'd like,
 * so we inline it once and rely on `--resume` for continuity afterward). */
const SYSTEM_PROMPT = [
  "You are R.O.S.I.E (Recursive Oracle: Sentient Interface Entity), the",
  "central AI agent inside Orion Terminal — a JARVIS-",
  "style personal workstation that hosts three apps: Archives 47 (notes,",
  "journal, projects, mood boards), Orion (code editor with file tree,",
  "Monaco, and a terminal), and XDesign (design studio).",
  "",
  "You have your normal toolkit (Bash, Read, Edit, Write, Grep, Glob,",
  "etc.) PLUS Orion-aware tools from the `orion` MCP server:",
  "  - orion_list_recent_notes — what the user has been writing",
  "  - orion_search_archive — full-text search across notes/chats/assets",
  "  - orion_list_projects — recently opened projects",
  "Reach for the Orion tools when the user asks about THEIR personal",
  "archive; reach for Bash/Read/Edit/etc. for filesystem work.",
  "",
  "Style: terse, friendly, JARVIS-like. Take action — don't ask permission",
  "for non-destructive work. Report what you did, briefly.",
].join("\n");

function freshThreadState(): Pick<
  RosieState,
  | "threadId"
  | "title"
  | "messages"
  | "toolCalls"
  | "running"
  | "error"
  | "stderrLines"
  | "totalCostUsd"
  | "createdAt"
  | "updatedAt"
  | "sessionId"
  | "activeStreamId"
  | "turnStartedAt"
> {
  const now = Date.now();
  return {
    threadId: ulid(),
    title: "",
    messages: [],
    toolCalls: {},
    running: false,
    error: null,
    stderrLines: [],
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    sessionId: null,
    activeStreamId: null,
    turnStartedAt: null,
  };
}

/** Human label for what R.O.S.I.E is doing right now, derived from store
 * state. Used by the background task chip + in-panel status. */
export function currentActivity(s: RosieState): string {
  if (!s.running) return "idle";
  // A running tool wins — show which one.
  const runningTool = Object.values(s.toolCalls).find(
    (t) => t.state === "running",
  );
  if (runningTool) {
    const pretty = runningTool.name.replace(/^mcp__[^_]+__/, "");
    return `running ${pretty}`;
  }
  // Pending assistant with text yet? → responding, else thinking.
  const pending = s.messages.find((m) => m.pending);
  if (pending) {
    const hasText =
      typeof pending.content === "string"
        ? pending.content.length > 0
        : pending.content.some((b) => b.type === "text");
    return hasText ? "responding…" : "thinking…";
  }
  return "working…";
}

export const useRosie = create<RosieState>((set, get) => ({
  open: false,
  pendingInput: null,
  ttsEnabled: false,
  companionVisible: true,
  ...freshThreadState(),

  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((s) => ({ open: !s.open })),
  spawnCompanion: () => set({ companionVisible: true }),
  dismissCompanion: () => set({ companionVisible: false }),
  setPendingInput: (pendingInput) => set({ pendingInput }),
  setTtsEnabled: (ttsEnabled) => {
    set({ ttsEnabled });
    if (!ttsEnabled) {
      // Cut off any in-flight speech immediately on disable.
      void import("@/lib/voiceSpeak").then((m) => m.stopSpeaking());
    }
    // Persist the toggle so it sticks across launches.
    void import("@/lib/db").then((m) =>
      m.setAppState("rosie.ttsEnabled", ttsEnabled),
    );
  },

  newConversation: () => set({ ...freshThreadState() }),

  send: async (text: string) => {
    const value = text.trim();
    if (!value || get().running) return;
    const userMsg: RosieMessage = {
      id: ulid(),
      role: "user",
      content: value,
    };
    const pendingId = ulid();
    set((s) => ({
      messages: [
        ...s.messages,
        userMsg,
        { id: pendingId, role: "assistant", content: "", pending: true },
      ],
      // First user message becomes the conversation title (capped). Later
      // turns don't overwrite it.
      title: s.title || value.slice(0, 80),
      error: null,
    }));
    await runSubprocessTurn(pendingId, value);
  },

  cancel: () => {
    const sid = get().activeStreamId;
    if (sid) void ipc.claudeCancel(sid).catch(() => undefined);
    set({ running: false, activeStreamId: null, turnStartedAt: null });
  },

  loadThread: async (threadId: string) => {
    try {
      const row = await getChatById(threadId);
      if (!row) return;
      let messages: RosieMessage[] = [];
      try {
        const parsed = JSON.parse(row.messages_json);
        if (Array.isArray(parsed)) messages = parsed as RosieMessage[];
      } catch {
        messages = [];
      }
      // Rebuild toolCalls map from the assistant messages' tool_use blocks
      // so chips render with their last-known state. Result content is lost
      // (we don't persist it separately) — chips show as "ok" since they
      // completed in the prior session.
      const toolCalls: Record<string, ToolCall> = {};
      for (const m of messages) {
        if (m.role !== "assistant" || typeof m.content === "string") continue;
        for (const b of m.content) {
          if (b.type === "tool_use") {
            const tu = b as { id: string; name: string; input: unknown };
            toolCalls[tu.id] = {
              id: tu.id,
              name: tu.name,
              input: tu.input,
              state: "ok",
            };
          }
        }
      }
      set({
        threadId: row.id,
        title: row.title,
        messages,
        toolCalls,
        running: false,
        error: null,
        stderrLines: [],
        totalCostUsd: row.total_cost_usd,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sessionId: row.session_id,
        activeStreamId: null,
      });
    } catch (e) {
      log.warn("loadThread failed", e);
    }
  },

  resumeLatest: async () => {
    try {
      // Pull the most-recent few; filter to origin='rosie' in memory (the
      // helper is the same one Past Chats uses, no need for a new query).
      const rows = await listAllChats(20);
      const latest = rows.find((r) => r.origin === "rosie");
      if (latest) await get().loadThread(latest.id);
    } catch (e) {
      log.warn("resumeLatest failed", e);
    }
  },
}));

/** One subprocess turn: spawn claude-code with this user prompt (first turn
 * inlines the system prompt + uses claude_send fresh; subsequent turns
 * `--resume` via the sessionId). Stream-json events arrive via Tauri
 * `claude:event` and `claude:exit` — we filter by our turn's chatId. */
async function runSubprocessTurn(
  pendingMessageId: string,
  userText: string,
): Promise<void> {
  const store = useRosie;
  const chatId = ulid();
  const isFirstTurn = store.getState().sessionId === null;
  const fullPrompt = isFirstTurn
    ? `${SYSTEM_PROMPT}\n\n---\n\n${userText}`
    : userText;

  store.setState({
    running: true,
    activeStreamId: chatId,
    stderrLines: [],
    turnStartedAt: Date.now(),
  });

  const unlisten: UnlistenFn[] = [];
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    for (const u of unlisten) u();
    if (watchdog) clearTimeout(watchdog);
  };

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    // Idle watchdog: if 180 seconds pass with NO events at all (re-armed on
    // every claude:event below), assume claude is hung (PATH issue, MCP server
    // crash, silent API backoff) and surface the best diagnostic we have —
    // recent stderr lines, or a generic "no response" if stderr was empty too.
    // Measuring silence (not total turn time) lets long active tool loops run.
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (resolved) return;
        const tail = store
          .getState()
          .stderrLines.slice(-3)
          .join("\n");
        const detail = tail.length > 0 ? `\n${tail}` : "";
        const msg = `R.O.S.I.E didn't respond after 180s. The claude subprocess may be hung or missing.${detail}`;
        store.setState((s) => ({
          running: false,
          activeStreamId: null,
          turnStartedAt: null,
          error: msg,
          messages: s.messages.map((m) =>
            m.id === pendingMessageId
              ? { ...m, content: `Error: ${msg}`, pending: false }
              : m,
          ),
        }));
        // Best-effort cancel of the running subprocess so it doesn't keep
        // burning resources after we've given up on it.
        void ipc.claudeCancel(chatId).catch(() => undefined);
        done();
      }, 180_000);
    };
    armWatchdog();

    void (async () => {
      unlisten.push(
        await listen<{ chatId: string; event: RosieEvent }>(
          "claude:event",
          (e) => {
            if (e.payload.chatId !== chatId) return;
            // Any event means claude is alive — reset the idle watchdog so a
            // long-but-active turn (a multi-step tool loop) isn't killed; the
            // 180s budget applies to silence, not total turn time.
            armWatchdog();
            handleEvent(pendingMessageId, e.payload.event);
          },
        ),
      );

      unlisten.push(
        await listen<{
          chatId: string;
          code: number | null;
          error: string | null;
        }>("claude:exit", (e) => {
          if (e.payload.chatId !== chatId) return;
          // Finalize: clear pending flag, surface any error from stderr.
          const errMsg = e.payload.error;
          store.setState((s) => ({
            running: false,
            activeStreamId: null,
            turnStartedAt: null,
            error: errMsg ?? s.error,
            updatedAt: Date.now(),
            messages: s.messages.map((m) =>
              m.id === pendingMessageId ? { ...m, pending: false } : m,
            ),
          }));
          // Persist after the turn settles (only if the turn produced
          // something — empty conversations don't clutter Past Chats).
          void persistThread();
          // TTS: speak the final assistant text aloud if enabled. Pulled
          // from the just-finalized message; skip tool-only turns (no text).
          if (store.getState().ttsEnabled) {
            const msg = store
              .getState()
              .messages.find((m) => m.id === pendingMessageId);
            const spoken = extractSpeakableText(msg?.content);
            if (spoken) {
              void import("@/lib/voiceSpeak").then((m) => m.speak(spoken));
            }
          }
          done();
        }),
      );

      try {
        const sid = store.getState().sessionId;
        await ipc.claudeSend(
          chatId,
          fullPrompt,
          null,
          sid && sid.length > 0 ? sid : null,
          null,
          useModelPrefs.getState().modelFor("rosie"),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        log.warn("rosie claude_send failed", err);
        store.setState((s) => ({
          running: false,
          activeStreamId: null,
          turnStartedAt: null,
          error: message,
          messages: s.messages.map((m) =>
            m.id === pendingMessageId
              ? { ...m, content: `Error: ${message}`, pending: false }
              : m,
          ),
        }));
        done();
      }
    })();
  });
}

/** stream-json event union (only the variants we care about). */
type RosieEvent =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message?: { content?: RosieContentBlock[] } }
  | { type: "user"; message?: { content?: RosieUserBlock[] } }
  | {
      type: "result";
      total_cost_usd?: number;
      session_id?: string;
      is_error?: boolean;
    }
  | { type: "stderr"; text?: string }
  | { type: string; [k: string]: unknown };

type RosieUserBlock =
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }
  | { type: string; [k: string]: unknown };

function handleEvent(pendingId: string, ev: RosieEvent): void {
  const store = useRosie;
  const t = ev.type;

  if (t === "system") {
    const subtype = (ev as { subtype?: string }).subtype;
    if (subtype === "init") {
      const sid = (ev as { session_id?: string }).session_id;
      if (sid) store.setState({ sessionId: sid });
    }
    return;
  }

  if (t === "assistant") {
    const msg = (ev as { message?: { content?: RosieContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      // Replace pending assistant content with the full snapshot. Also
      // surface any tool_use blocks as chips.
      const blocks = msg.content;
      const newCalls: Record<string, ToolCall> = {};
      for (const b of blocks) {
        if (b.type === "tool_use") {
          const tu = b as {
            id: string;
            name: string;
            input: unknown;
          };
          newCalls[tu.id] = {
            id: tu.id,
            name: tu.name,
            input: tu.input,
            state: "running",
          };
        }
      }
      store.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === pendingId ? { ...m, content: blocks } : m,
        ),
        toolCalls: { ...s.toolCalls, ...newCalls },
      }));
    }
    return;
  }

  if (t === "user") {
    const msg = (ev as { message?: { content?: RosieUserBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type !== "tool_result") continue;
        const tr = b as Extract<RosieUserBlock, { type: "tool_result" }>;
        store.setState((s) => {
          const prev = s.toolCalls[tr.tool_use_id];
          if (!prev) return s;
          return {
            toolCalls: {
              ...s.toolCalls,
              [tr.tool_use_id]: {
                ...prev,
                result: tr.content,
                state: tr.is_error ? "error" : "ok",
              },
            },
          };
        });
      }
    }
    return;
  }

  if (t === "result") {
    const cost = (ev as { total_cost_usd?: number }).total_cost_usd;
    if (typeof cost === "number") {
      store.setState((s) => ({ totalCostUsd: s.totalCostUsd + cost }));
    }
    // The `claude:exit` event handles `running` cleanup — `result` just
    // confirms the turn ended cleanly.
    return;
  }

  if (t === "stderr") {
    const text = (ev as { text?: string }).text;
    if (text) {
      log.warn("[core stderr]", text);
      store.setState((s) => ({
        stderrLines: [...s.stderrLines, text].slice(-50),
      }));
    }
    return;
  }
}

/** Pull just the assistant's spoken text out of a message's content,
 * skipping tool_use / thinking blocks. Used by the TTS hook so the
 * synthesizer doesn't read out tool JSON or internal reasoning. */
export function extractSpeakableText(
  content: string | RosieContentBlock[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === "text") {
      const t = (b as { text?: string }).text;
      if (t) parts.push(t);
    }
  }
  return parts.join(" ").trim();
}

/** Build the FTS5-friendly searchable text by concatenating user text and
 * assistant text blocks. Tool blocks are skipped — they don't help search. */
function buildSearchableText(messages: RosieMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      parts.push(m.content);
    } else {
      for (const b of m.content) {
        if (b.type === "text") parts.push((b as { text: string }).text);
      }
    }
  }
  return parts.filter(Boolean).join("\n");
}

/** Upsert the current R.O.S.I.E thread into `chats` with origin='rosie'. No-op
 * if the conversation has no user messages yet (fresh thread on first
 * open). Idempotent — same threadId always points to the same row. */
async function persistThread(): Promise<void> {
  try {
    const s = useRosie.getState();
    const hasUser = s.messages.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.trim() !== "",
    );
    if (!hasUser) return;
    await upsertChat({
      id: s.threadId,
      title: s.title || "Untitled",
      messages_json: JSON.stringify(s.messages),
      searchable_text: buildSearchableText(s.messages),
      session_id: s.sessionId,
      project_id: null,
      total_cost_usd: s.totalCostUsd,
      origin: "rosie",
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    });
  } catch (e) {
    log.warn("core persist failed", e);
  }
}
