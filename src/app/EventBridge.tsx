import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useChatStore, type ContentBlock } from "@/store/chatStore";
import {
  useAppChat,
  appForStream,
  forgetStream,
} from "@/store/appChatStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useTabsStore } from "@/store/tabsStore";
import { useNotesStore } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell, type AppId } from "@/shell/store/useShell";
import { useProjectStore } from "@/store/projectStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { countNotes } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import {
  isOrionNoteWriteTool,
  isOrionMoodWriteTool,
  isOrionAssetWriteTool,
  isOrionHermesWriteTool,
} from "@/lib/orionToolMatch";
import { useHermes, type HermesStatus, type HermesColumn } from "@/store/hermesStore";
import { useCommand } from "@/store/commandStore";
import { type CcEvent } from "@/apps/command/ccRun";
import { useSpotify } from "@/store/spotifyStore";
import { useRepoLensWebsites } from "@/apps/archives/repolens/useRepoLensWebsites";
import { onPassExit } from "@/features/agents/twoPassCoordinator";
import { log } from "@/lib/log";

/** UI actions the MCP server can request via the local TCP bridge. Each
 * kind maps to a store mutation in the frontend. */
type UiAction =
  | { kind: "open_app"; payload: { app: AppId } }
  | { kind: "switch_project"; payload: { name_or_id: string } }
  | {
      kind: "open_note";
      payload: { id: string; kind?: "note" | "journal" | "project" };
    }
  | { kind: "open_file"; payload: { path: string } }
  | { kind: "run_in_terminal"; payload: { command: string } }
  | {
      kind: "xdesign_add_rect";
      payload: { x: number; y: number; w: number; h: number; fill?: string; radius?: number };
    }
  | {
      kind: "xdesign_add_text";
      payload: { x: number; y: number; text: string; fontSize?: number; fill?: string };
    }
  | {
      kind: "xdesign_add_ellipse";
      payload: { x: number; y: number; w: number; h: number; fill?: string };
    }
  | {
      kind: "xdesign_add_frame";
      payload: { x: number; y: number; w: number; h: number; fill?: string };
    }
  | { kind: "xdesign_get_canvas"; payload: Record<string, never> }
  | { kind: "xdesign_get_selection"; payload: Record<string, never> }
  | { kind: "xdesign_apply"; payload: { ops: unknown[] } }
  | { kind: string; payload: unknown };

/** The bridge wraps every action with a request id so the frontend can reply
 * via `ui_bridge_respond`. */
type UiActionEnvelope = UiAction & { requestId: string };

/** Returns data for read-back (query) kinds; void for fire-and-forget
 * actions. Throwing here surfaces an error back to the calling MCP tool. */
async function handleUiAction(action: UiAction): Promise<unknown> {
  if (action.kind === "open_app") {
    const app = (action.payload as { app?: AppId } | undefined)?.app;
    if (
      app &&
      (app === "archives" ||
        app === "orion" ||
        app === "xdesign" ||
        app === "hermes")
    ) {
      useShell.getState().openApp(app);
    }
    return;
  }
  if (action.kind === "switch_project") {
    const q = (action.payload as { name_or_id?: string } | undefined)
      ?.name_or_id;
    if (!q || !q.trim()) return;
    const project = useProjectStore.getState();
    await project.loadRecents();
    const recents = useProjectStore.getState().recents;
    const lower = q.toLowerCase();
    const match =
      recents.find((p) => p.id === q) ??
      recents.find((p) => p.name === q) ??
      recents.find((p) => p.name.toLowerCase() === lower) ??
      recents.find((p) => p.name.toLowerCase().includes(lower));
    if (match) {
      await project.switchToProject(match);
      useShell.getState().openApp("orion");
    } else {
      log.warn("ui:action switch_project — no match for:", q);
    }
    return;
  }
  if (action.kind === "run_in_terminal") {
    const cmd = (action.payload as { command?: string } | undefined)?.command;
    if (!cmd?.trim()) return;
    // Open Orion + the Terminal tab if not already.
    useShell.getState().openApp("orion");
    useWorkspace
      .getState()
      .openTab({ kind: "terminal" }, { preferRole: "terminal" });
    // The terminal panel sets ptyId after `terminalOpen` resolves — wait
    // for it (up to ~3s) then write. Newline appended so the shell runs it.
    const { useTerminalStore } = await import("@/store/terminalStore");
    const { ipc } = await import("@/lib/ipc");
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const id = useTerminalStore.getState().ptyId;
      if (id) {
        await ipc.terminalWrite(id, `${cmd}\n`);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    log.warn("run_in_terminal: pty never came up within 3s");
    return;
  }
  if (action.kind === "xdesign_add_rect") {
    const p = action.payload as {
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      radius?: number;
    };
    useShell.getState().openApp("xdesign");
    const { useXDesign } = await import("@/apps/xdesign/store");
    useXDesign.getState().addShape({
      kind: "rect",
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      radius: p.radius ?? 0,
      fill: p.fill ?? "#00e0ff",
      stroke: "transparent",
      strokeWidth: 0,
    });
    return;
  }
  if (action.kind === "xdesign_add_ellipse") {
    const p = action.payload as {
      x: number; y: number; w: number; h: number; fill?: string;
    };
    useShell.getState().openApp("xdesign");
    const { useXDesign } = await import("@/apps/xdesign/store");
    useXDesign.getState().addShape({
      kind: "ellipse",
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      fill: p.fill ?? "#00e0ff",
      stroke: "transparent",
      strokeWidth: 0,
    });
    return;
  }
  if (action.kind === "xdesign_add_frame") {
    const p = action.payload as {
      x: number; y: number; w: number; h: number; fill?: string;
    };
    useShell.getState().openApp("xdesign");
    const { useXDesign } = await import("@/apps/xdesign/store");
    useXDesign.getState().addShape({
      kind: "frame",
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      radius: 0,
      fill: p.fill ?? "rgba(255,255,255,0.03)",
      stroke: "rgba(255,255,255,0.12)",
      strokeWidth: 1,
    });
    return;
  }
  if (action.kind === "xdesign_add_text") {
    const p = action.payload as {
      x: number;
      y: number;
      text: string;
      fontSize?: number;
      fill?: string;
    };
    useShell.getState().openApp("xdesign");
    const { useXDesign } = await import("@/apps/xdesign/store");
    useXDesign.getState().addShape({
      kind: "text",
      x: p.x,
      y: p.y,
      w: Math.max(60, p.text.length * (p.fontSize ?? 24) * 0.55),
      h: (p.fontSize ?? 24) * 1.3,
      text: p.text,
      fontSize: p.fontSize ?? 24,
      fill: p.fill ?? "#e6f4ec",
      stroke: "transparent",
      strokeWidth: 0,
    });
    return;
  }
  if (action.kind === "open_file") {
    const raw = (action.payload as { path?: string } | undefined)?.path?.trim();
    if (!raw) return;
    const project = useProjectStore.getState().active;
    const isAbs = /^([a-zA-Z]:)?[\\/]/.test(raw);
    const path =
      isAbs || !project
        ? raw
        : `${project.root_path}/${raw}`.replace(/\/+/g, "/");
    useShell.getState().openApp("orion");
    const label = path.split(/[\\/]/).pop() ?? path;
    useWorkspace.getState().openTab(
      { kind: "file", path },
      { label, preferRole: "editor" },
    );
    return;
  }
  if (action.kind === "staged_edit") {
    // The chat agent edited a file via orion_apply_edit / orion_write_file.
    // The new content is already on disk; stage it for the user to review and
    // surface the diff. We reply immediately (no blocking on the human).
    const p = action.payload as {
      path?: string;
      original?: string;
      updated?: string;
      is_new?: boolean;
    };
    if (!p.path || typeof p.updated !== "string") return;
    const { usePendingEdits } = await import("@/store/pendingEditsStore");
    usePendingEdits.getState().stage({
      path: p.path,
      original: p.original ?? "",
      updated: p.updated,
      isNew: !!p.is_new,
    });
    // Checkpoint the pre-image (first edit per file per burst) so the whole
    // agent turn is one-click restorable even after the review is accepted.
    void import("@/features/aiEdits/checkpoints").then((m) =>
      m.captureForStagedEdit({
        path: p.path!,
        original: p.original ?? "",
        isNew: !!p.is_new,
      }),
    );
    // Refresh any open buffer to the new content (clean — disk matches).
    useTabsStore.getState().markLoaded(p.path, p.updated);
    useFileTreeRefresh.getState().bump();
    useShell.getState().openApp("orion");
    useWorkspace.getState().openTab({ kind: "diff-review", path: p.path });
    return;
  }
  if (action.kind === "open_note") {
    const p = action.payload as {
      id?: string;
      kind?: "note" | "journal" | "project";
    };
    if (!p?.id) return;
    // 1. Re-hydrate notes so the freshly-written row is in the store before
    //    the view tries to render it.
    await useNotesStore.getState().load();
    // 2. Open Archives behind whatever overlay is showing (Core panel etc).
    useShell.getState().openApp("archives");
    // 3. Switch to the right Archives view and select the note.
    const archives = useArchives.getState();
    const kind =
      p.kind ?? useNotesStore.getState().notes.get(p.id)?.kind ?? "note";
    if (kind === "project") {
      archives.setView("projects");
      archives.setOpenProjectId(p.id);
    } else if (kind === "journal") {
      archives.setView("journal");
      archives.setSelectedNoteId(p.id);
    } else {
      archives.setView("notes");
      archives.setOpenNoteId(p.id);
    }
    return;
  }
  if (action.kind === "xdesign_apply") {
    const ops = (action.payload as { ops?: unknown }).ops;
    if (!Array.isArray(ops)) throw new Error("xdesign_apply: ops must be an array");
    useShell.getState().openApp("xdesign");
    const { runCanvasCommands } = await import("@/apps/xdesign/claudeCommands");
    // Whole array applies as ONE undo step; returns new ids + per-op status.
    const outcome = runCanvasCommands(
      ops as Parameters<typeof runCanvasCommands>[0],
    );
    return { applied: outcome.applied, results: outcome.results };
  }
  if (action.kind === "xdesign_get_canvas") {
    const { useXDesign } = await import("@/apps/xdesign/store");
    const st = useXDesign.getState();
    return {
      activePageId: st.activePageId,
      pages: st.pages.map((p) => ({
        id: p.id,
        name: p.name,
        shapeCount: p.shapes.length,
      })),
      selection: Array.from(st.selection),
      shapes: st.shapes,
    };
  }
  if (action.kind === "xdesign_get_selection") {
    const { useXDesign } = await import("@/apps/xdesign/store");
    const st = useXDesign.getState();
    return {
      selection: Array.from(st.selection),
      shapes: st.shapes.filter((s) => st.selection.has(s.id)),
    };
  }
  log.warn("ui:action unknown kind:", action.kind);
}


/** Global map: tool_use_id → tool_name. Populated whenever we observe an
 * assistant tool_use block. Read when the matching user tool_result lands
 * so we know what to invalidate. Module-scope so it survives across
 * EventBridge re-mounts and chatId boundaries. */
const toolUseIdToName = new Map<string, string>();

let notesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNotesRefresh() {
  if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
  // Tiny coalescing window — multiple writes in quick succession (e.g. a
  // claude turn that creates 3 notes) collapse to one load() + count.
  notesRefreshTimer = setTimeout(() => {
    notesRefreshTimer = null;
    void useNotesStore.getState().load();
    void countNotes()
      .then((n) => useArchives.getState().setCounts({ notes: n }))
      .catch(() => undefined);
  }, 250);
}
let moodRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMoodRefresh() {
  if (moodRefreshTimer) clearTimeout(moodRefreshTimer);
  moodRefreshTimer = setTimeout(() => {
    moodRefreshTimer = null;
    void import("@/store/moodBoardsStore").then((m) =>
      m.useMoodBoardsStore.getState().load(),
    );
  }, 250);
}
let assetsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAssetsRefresh() {
  if (assetsRefreshTimer) clearTimeout(assetsRefreshTimer);
  assetsRefreshTimer = setTimeout(() => {
    assetsRefreshTimer = null;
    void import("@/store/assetsStore").then((m) =>
      m.useAssetsStore.getState().load(),
    );
  }, 250);
}
let hermesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleHermesRefresh() {
  if (hermesRefreshTimer) clearTimeout(hermesRefreshTimer);
  // refresh() (not load()) so a live swarm's in-memory state survives ROSIE's
  // board writes landing via her MCP tools.
  hermesRefreshTimer = setTimeout(() => {
    hermesRefreshTimer = null;
    void useHermes.getState().refresh();
  }, 250);
}

// Tools whose completion changes the project's file layout. When a
// tool_result for one of these lands, we bump the file-tree refresh counter
// so the explorer shows the new file/rename without waiting for the chat
// turn to end.
const FILE_MODIFYING_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

function findToolUseName(
  chat: ReturnType<typeof useChatStore.getState>["active"],
  toolUseId: string,
): string | null {
  if (!chat) return null;
  for (const m of chat.messages) {
    for (const b of m.blocks) {
      if (b.type === "tool_use" && b.id === toolUseId) return b.name;
    }
  }
  return null;
}

type ClaudeEnvelope = {
  chatId: string;
  event: ClaudeEvent;
};

type ClaudeEvent =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message?: { content?: ContentBlock[] } }
  | { type: "user"; message?: { content?: Array<UserContentBlock> } }
  | {
      type: "result";
      total_cost_usd?: number;
      session_id?: string;
      is_error?: boolean;
    }
  | { type: "stderr"; text?: string }
  | { type: string; [k: string]: unknown };

type UserContentBlock =
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }
  | { type: string; [k: string]: unknown };

function extractAssistantText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function handleAppChatClaudeEvent(env: ClaudeEnvelope): boolean {
  const app = appForStream(env.chatId);
  if (!app) return false;
  const ev = env.event;
  const t = ev.type;
  const store = useAppChat.getState();

  if (t === "system") {
    const subtype = (ev as { subtype?: string }).subtype;
    if (subtype === "init") {
      const sid = (ev as { session_id?: string }).session_id;
      if (sid) store.setSessionId(app, sid);
    }
    return true;
  }
  if (t === "assistant") {
    const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      const text = extractAssistantText(msg.content);
      if (text) store.setAssistantContent(app, text);
    }
    return true;
  }
  if (t === "result") {
    const cost = (ev as { total_cost_usd?: number }).total_cost_usd;
    store.finishAssistant(app, typeof cost === "number" ? cost : null);
    forgetStream(env.chatId);
    return true;
  }
  if (t === "stderr") {
    const text = (ev as { text?: string }).text;
    if (text) log.warn("[claude stderr]", text);
    return true;
  }
  return true; // we handled (or ignored) the event for this app
}

function trackOrionToolSideEffects(env: ClaudeEnvelope) {
  const ev = env.event;
  if (ev.type === "assistant") {
    const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          toolUseIdToName.set(block.id, block.name);
        }
      }
    }
  } else if (ev.type === "user") {
    const msg = (ev as { message?: { content?: UserContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        const tr = block as Extract<UserContentBlock, { type: "tool_result" }>;
        const name = toolUseIdToName.get(tr.tool_use_id);
        if (name && !tr.is_error) {
          if (isOrionNoteWriteTool(name)) scheduleNotesRefresh();
          if (isOrionMoodWriteTool(name)) scheduleMoodRefresh();
          if (isOrionAssetWriteTool(name)) scheduleAssetsRefresh();
          if (isOrionHermesWriteTool(name)) scheduleHermesRefresh();
        }
        // GC: each tool_use id is one-shot — drop after first result.
        toolUseIdToName.delete(tr.tool_use_id);
      }
    }
  }
}

function handleClaude(env: ClaudeEnvelope) {
  // Global side-effect pass: track tool_use names + invalidate caches when
  // we see write-tool results. Runs regardless of which chat surface owns
  // the chatId so Core / Orix47 / Archives / XDesign all stay in sync.
  trackOrionToolSideEffects(env);

  // App-chat (Archives/XDesign over the CLI) owns this chatId? Route there
  // and stop — useChatStore is Orion-only.
  if (handleAppChatClaudeEvent(env)) return;

  const ev = env.event;
  const t = ev.type;
  const store = useChatStore.getState();
  if (!store.active || store.active.id !== env.chatId) return;

  if (t === "system") {
    const subtype = (ev as { subtype?: string }).subtype;
    if (subtype === "init") {
      const sid = (ev as { session_id?: string }).session_id;
      if (sid) store.setSessionId(sid);
    }
    return;
  }

  if (t === "assistant") {
    const msg = (ev as { message?: { content?: ContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      const blocks = msg.content.filter(
        (b): b is ContentBlock => b.type === "text" || b.type === "tool_use",
      );
      store.onAssistantBlocks(blocks);
    }
    return;
  }

  if (t === "user") {
    const msg = (ev as { message?: { content?: UserContentBlock[] } }).message;
    if (msg && Array.isArray(msg.content)) {
      let shouldRefreshTree = false;
      for (const b of msg.content) {
        if (b.type === "tool_result") {
          const tr = b as Extract<UserContentBlock, { type: "tool_result" }>;
          // Look up the tool name in the live chat blocks to decide whether
          // a filesystem mutation is implied. Skip errored results.
          if (!tr.is_error) {
            const name = findToolUseName(store.active, tr.tool_use_id);
            if (name && FILE_MODIFYING_TOOLS.has(name)) {
              shouldRefreshTree = true;
            }
          }
          store.onToolResult(tr.tool_use_id, {
            content: tr.content,
            isError: tr.is_error,
          });
        }
      }
      if (shouldRefreshTree) useFileTreeRefresh.getState().bump();
    }
    return;
  }

  if (t === "result") {
    const cost = (ev as { total_cost_usd?: number }).total_cost_usd;
    if (typeof cost === "number") store.addCost(cost);
    store.finishTurn();
    return;
  }

  if (t === "stderr") {
    const text = (ev as { text?: string }).text;
    if (text) log.warn("[claude stderr]", text);
    return;
  }
}

export function EventBridge() {
  const inline = useInlineEditStore;

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    listen<{ streamId: string; text: string }>("inline:delta", (e) => {
      const cur = inline.getState();
      if (cur.streamId !== e.payload.streamId) return;
      cur.appendDelta(e.payload.text);
    }).then((u) => unlisteners.push(u));

    listen<{ streamId: string; text: string }>("inline:final", (e) => {
      const cur = inline.getState();
      if (cur.streamId !== e.payload.streamId) return;
      cur.setFinal(e.payload.text);
    }).then((u) => unlisteners.push(u));

    listen<{ streamId: string }>("inline:done", (e) => {
      const cur = inline.getState();
      if (cur.streamId !== e.payload.streamId) return;
      cur.finishStream();
    }).then((u) => unlisteners.push(u));

    listen<{ streamId: string; message: string }>("inline:error", (e) => {
      const cur = inline.getState();
      if (cur.streamId !== e.payload.streamId) return;
      cur.setError(e.payload.message);
    }).then((u) => unlisteners.push(u));

    listen<ClaudeEnvelope>("claude:event", (e) => handleClaude(e.payload)).then(
      (u) => unlisteners.push(u),
    );

    // Command Center — a profile's headless pi run streams flat cc events here;
    // mirror them into the live run, persist on exit.
    listen<{ runId: string; event: CcEvent }>("cc:event", (e) => {
      useCommand.getState().applyRunEvent(e.payload.runId, e.payload.event);
    }).then((u) => unlisteners.push(u));

    listen<{ runId: string; code: number | null; error: string | null }>(
      "cc:exit",
      (e) => {
        void useCommand
          .getState()
          .finishRun(e.payload.runId, e.payload.error ?? undefined);
      },
    ).then((u) => unlisteners.push(u));

    // OS-level Spotify media hotkeys (registered in Rust). Single code path:
    // the global shortcut fires here even when Orion is unfocused.
    listen<string>("spotify:hotkey", (e) => {
      const action = e.payload;
      if (action === "playpause" || action === "next" || action === "previous") {
        void useSpotify.getState().control(action);
      }
    }).then((u) => unlisteners.push(u));

    // Hermes swarm — the engine streams each agent's assistant text + status
    // and rolls the task up; mirror it into the store for the live board.
    listen<{ taskId: string; agentId: string; text: string }>(
      "hermes:agent",
      (e) => {
        useHermes
          .getState()
          .applyAgentText(e.payload.taskId, e.payload.agentId, e.payload.text);
      },
    ).then((u) => unlisteners.push(u));

    listen<{
      taskId: string;
      agentId: string;
      status: HermesStatus;
      output: string;
      error: string;
      sessionId: string | null;
    }>("hermes:agentStatus", (e) => {
      useHermes.getState().applyAgentStatus(e.payload);
    }).then((u) => unlisteners.push(u));

    listen<{ taskId: string; status: HermesStatus; columnId: HermesColumn }>(
      "hermes:task",
      (e) => {
        useHermes.getState().applyTask(e.payload);
      },
    ).then((u) => unlisteners.push(u));

    // RepoLens website rip — the engine streams the rip's status/phase + log
    // deltas + thumbnail path; mirror it into the store for the live progress UI.
    listen<{
      id: string;
      status: import("../apps/archives/repolens/repolensWebsitesDb").WebsiteStatus;
      phase: string;
      logDelta?: string;
      thumbnailPath?: string;
      sessionId?: string | null;
    }>("repolens:website", (e) => {
      useRepoLensWebsites.getState().applyEvent(e.payload);
    }).then((u) => unlisteners.push(u));

    // UI-action bridge: out-of-process MCP server → main app via TCP →
    // Tauri event → here. Lets agents drive UI-state changes (open_app,
    // switch_project) that can't be done by a direct DB write.
    listen<UiActionEnvelope>("ui:action", (e) => {
      const { requestId } = e.payload;
      // Always reply so the bridge connection never waits out its timeout —
      // {ok:true, data} for queries, {ok:true} for actions, {ok:false} on throw.
      handleUiAction(e.payload)
        .then((data) => {
          void ipc.uiBridgeRespond(requestId, true, data ?? null, null);
        })
        .catch((err) => {
          log.warn("ui:action handler failed", err);
          void ipc.uiBridgeRespond(
            requestId,
            false,
            null,
            err instanceof Error ? err.message : String(err),
          );
        });
    }).then((u) => unlisteners.push(u));

    // Auto-refresh the file tree whenever ANY terminal pty produces output —
    // covers the Claude Code tab (which runs interactively in a pty, so its
    // file edits never flow through `claude:event` and the existing tool-use
    // refresh path can't see them) as well as raw shell commands like `npm i`
    // / `mv`. Throttled (leading bump per window) so continuous TUI output
    // refreshes ~once a second instead of slamming the tree refetch.
    let treeBumpTimer: number | null = null;
    const scheduleTreeBump = () => {
      if (treeBumpTimer != null) return;
      treeBumpTimer = window.setTimeout(() => {
        useFileTreeRefresh.getState().bump();
        treeBumpTimer = null;
      }, 750);
    };
    listen<{ ptyId: string; data: string }>("terminal:data", () => {
      scheduleTreeBump();
    }).then((u) => unlisteners.push(u));

    // External-source changes (Finder, VS Code, git, downloads) come through
    // the Rust fs_watch debouncer as `fs:changed`. Share the same throttle so
    // bursts overlapping with terminal/Claude-Code activity coalesce to one
    // refresh.
    listen<null>("fs:changed", () => {
      scheduleTreeBump();
    }).then((u) => unlisteners.push(u));

    listen<{ chatId: string; code: number | null; error: string | null }>(
      "claude:exit",
      (e) => {
        // App-chat (Archives/XDesign over CLI)?
        const app = appForStream(e.payload.chatId);
        if (app) {
          const store = useAppChat.getState();
          if (e.payload.error) {
            store.setError(app, e.payload.error);
          } else {
            // Normal exit without a `result` event → still flip running off.
            const t = store.threads[app];
            if (t.running) store.finishAssistant(app, null);
          }
          forgetStream(e.payload.chatId);
          return;
        }
        const store = useChatStore.getState();
        if (!store.active || store.active.id !== e.payload.chatId) return;
        // Two-pass agent? On the Brain pass's exit this seals the plan and
        // fires the Action pass — do NOT finalize. The Action pass's exit (or
        // a single-pass turn) falls through to the normal finalize below.
        if (onPassExit(e.payload.chatId, e.payload.error)) return;
        store.finishTurn();
        store.setRunning(false);
        if (e.payload.error) log.warn("[claude exit]", e.payload.error);
      },
    ).then((u) => unlisteners.push(u));

    // Messages-API chat stream (Archives + XDesign rails).
    listen<{ chatId: string; text: string }>("chat:delta", (e) => {
      const app = appForStream(e.payload.chatId);
      if (!app) return;
      useAppChat.getState().appendDelta(app, e.payload.text);
    }).then((u) => unlisteners.push(u));

    listen<{ chatId: string; totalCostUsd: number | null }>(
      "chat:done",
      (e) => {
        const app = appForStream(e.payload.chatId);
        if (!app) return;
        useAppChat.getState().finishAssistant(app, e.payload.totalCostUsd);
        forgetStream(e.payload.chatId);
      },
    ).then((u) => unlisteners.push(u));

    listen<{ chatId: string; message: string }>("chat:error", (e) => {
      const app = appForStream(e.payload.chatId);
      if (!app) {
        log.warn("[chat error]", e.payload.message);
        return;
      }
      useAppChat.getState().setError(app, e.payload.message);
      forgetStream(e.payload.chatId);
    }).then((u) => unlisteners.push(u));

    return () => {
      for (const u of unlisteners) u();
      if (treeBumpTimer != null) {
        clearTimeout(treeBumpTimer);
        treeBumpTimer = null;
      }
    };
  }, [inline]);

  return null;
}
