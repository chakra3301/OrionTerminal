import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Wand2 } from "lucide-react";
import { ClaudeChat, type ClaudeChatMessage } from "@/components/ClaudeChat";
import { useAppChat, registerStream, forgetStream } from "@/store/appChatStore";
import { useDraggable } from "@/shell/useDraggable";
import { useXDesign } from "@/apps/xdesign/store";
import { upsertChat } from "@/lib/db";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { ipc } from "@/lib/ipc";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { log } from "@/lib/log";
import { xdesignClaude, COMPOSER_PROMPT } from "@/apps/xdesign/claude";
import {
  parseCanvasCommands,
  runCanvasCommands,
  stripCanvasCommands,
} from "@/apps/xdesign/claudeCommands";
import { parseDesignPlan, stripDesignPlan } from "@/apps/xdesign/designPlan";
import { ingestDesignPlan } from "@/apps/xdesign/ingestDesignPlan";
import { promptText } from "@/components/PromptModal";
import { computeExportBounds, renderPngBytes } from "@/apps/xdesign/exportXD";

// With the vision loop attaching a render every turn, Claude can SEE all the
// layers — but it still needs each layer's id to target it for update/delete,
// so we list a generous slice (the image carries the visual detail).
const SHAPE_SUMMARY_LIMIT = 40;
// Track which XDesign threads have been persisted at least once during this
// session; bumping the chats badge in Archives is Archives' concern, so we
// keep this local just to avoid duplicate first-writes.
const knownIds = new Set<string>();

type Box = { left: number; top: number; w: number; h: number };

const MIN_W = 300;
const MIN_H = 280;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function XDesignClaudeRail() {
  const [open, setOpen] = useState(false);
  // null = anchored bottom-right via CSS; once dragged/resized we switch to
  // explicit stage-relative coords so the panel floats wherever the user
  // parks it. Lives in component state (the rail is always mounted; `open`
  // only toggles FAB vs panel), so the placement survives close/reopen.
  const [box, setBox] = useState<Box | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<Box | null>(null);
  const stageSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Snapshot the rail's current geometry (relative to the canvas stage) and
  // the stage bounds, used by both the move and resize gestures to clamp.
  const captureGeometry = (): Box | null => {
    const el = railRef.current;
    const stage = el?.parentElement;
    if (!el || !stage) return null;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    stageSize.current = { w: s.width, h: s.height };
    return { left: r.left - s.left, top: r.top - s.top, w: r.width, h: r.height };
  };

  const drag = useDraggable({
    onStart: () => {
      const g = captureGeometry();
      dragOrigin.current = g;
      if (g) setBox(g);
    },
    onDrag: (dx, dy) => {
      const o = dragOrigin.current;
      if (!o) return;
      const { w: sw, h: sh } = stageSize.current;
      setBox({
        ...o,
        left: clamp(o.left + dx, 0, Math.max(0, sw - o.w)),
        top: clamp(o.top + dy, 0, Math.max(0, sh - o.h)),
      });
    },
  });

  const resize = useDraggable({
    onStart: () => {
      const g = captureGeometry();
      dragOrigin.current = g;
      if (g) setBox(g);
    },
    onDrag: (dx, dy) => {
      const o = dragOrigin.current;
      if (!o) return;
      const { w: sw, h: sh } = stageSize.current;
      setBox({
        ...o,
        w: clamp(o.w + dx, MIN_W, Math.max(MIN_W, sw - o.left)),
        h: clamp(o.h + dy, MIN_H, Math.max(MIN_H, sh - o.top)),
      });
    },
  });

  const thread = useAppChat((s) => s.threads.xdesign);
  const appendUser = useAppChat((s) => s.appendUser);
  const beginAssistant = useAppChat((s) => s.beginAssistant);
  const setError = useAppChat((s) => s.setError);
  const newThread = useAppChat((s) => s.newThread);

  // Track which assistant messages we've already executed commands for so
  // streaming snapshot updates don't re-run the same batch.
  const executedRef = useRef<Set<string>>(new Set());

  // Whenever the latest assistant message in this thread finishes streaming
  // (pending=false), parse any <canvas-command> blocks and run them. Single
  // pushHistory per batch is handled by runCanvasCommands.
  useEffect(() => {
    const last = thread.messages[thread.messages.length - 1];
    if (!last || last.role !== "assistant" || last.pending) return;
    if (executedRef.current.has(last.id)) return;
    executedRef.current.add(last.id);
    // A composer reply (one ```xd-design block) ingests as a whole design;
    // otherwise fall through to the low-level canvas-command path.
    const plan = parseDesignPlan(last.content);
    if (plan) {
      ingestDesignPlan(plan);
      log.info("xdesign claude: ingested design plan");
      return;
    }
    const cmds = parseCanvasCommands(last.content);
    if (cmds.length === 0) return;
    const { applied } = runCanvasCommands(cmds);
    if (applied > 0) log.info(`xdesign claude: applied ${applied} canvas command(s)`);
  }, [thread.messages]);

  // End history coalescing when the turn finishes (also covers error/cancel,
  // since those flip running off) — manual edits after the reply get normal
  // per-action undo again.
  useEffect(() => {
    if (!thread.running) useXDesign.getState().endHistoryCoalesce();
  }, [thread.running]);

  // Build a tiny system-side note describing the current XDesign document so
  // the model has context without needing the user to copy-paste anything.
  // We attach it to the first turn of each thread only (same trick the
  // archives flow uses with its system prompt prefix).
  const buildCanvasNote = (): string => {
    const { shapes, selection } = useXDesign.getState();
    if (shapes.length === 0) return "Canvas is empty.";
    const sel = Array.from(selection);
    // Include the layer id so Claude can target shapes via update/delete.
    const summary = shapes
      .slice(0, SHAPE_SUMMARY_LIMIT)
      .map(
        (s) =>
          `${sel.includes(s.id) ? "[sel] " : ""}id=${s.id} ${s.kind} "${s.name}" at ${Math.round(
            s.x,
          )},${Math.round(s.y)} · ${Math.round(s.w)}×${Math.round(s.h)}`,
      )
      .join("\n");
    const extra =
      shapes.length > SHAPE_SUMMARY_LIMIT
        ? `\n…and ${shapes.length - SHAPE_SUMMARY_LIMIT} more layer(s).`
        : "";
    return `Current canvas (${shapes.length} layers, ${selection.size} selected):\n${summary}${extra}`;
  };

  // Debounced persist — mirrors Archives' pattern. project_id stays null so
  // these chats live alongside Archives chats in the Past chats view (and
  // route back to XDesign via openChatById's null-project branch — currently
  // that branch opens Archives; we'll route to xdesign in a follow-up when
  // the per-thread origin column lands).
  useEffect(() => {
    if (thread.messages.length === 0) return;
    const id = setTimeout(() => {
      knownIds.add(thread.threadId);
      void upsertChat({
        id: thread.threadId,
        title:
          thread.title ||
          thread.messages[0]?.content.slice(0, 80) ||
          "XDesign chat",
        messages_json: JSON.stringify(thread.messages),
        searchable_text: thread.messages
          .map((m) => m.content)
          .filter(Boolean)
          .join("\n"),
        session_id: thread.sessionId,
        project_id: null,
        total_cost_usd: thread.totalCostUsd,
        origin: "xdesign",
        created_at: thread.createdAt,
        updated_at: thread.updatedAt,
      });
      scheduleReindex("chat", thread.threadId, () => {
        const cur = useAppChat.getState().threads.xdesign;
        if (!cur || cur.threadId !== thread.threadId) return null;
        const title =
          cur.title ||
          cur.messages[0]?.content.slice(0, 80) ||
          "XDesign chat";
        const body = cur.messages
          .map((m) => m.content)
          .filter(Boolean)
          .join("\n");
        return `${title}\n${body}`;
      });
    }, 600);
    return () => clearTimeout(id);
  }, [thread]);

  // Vision loop: rasterize the whole visible canvas and stash it as a PNG the
  // CLI can attach via `@<path>`, so Claude sees what it's editing instead of
  // working blind off the text layer list. Returns an absolute path, or null
  // when the canvas is empty / the render fails (non-fatal — we just send
  // text-only that turn).
  const captureCanvasSnapshot = async (): Promise<string | null> => {
    try {
      const { shapes } = useXDesign.getState();
      // Empty selection set → bounds of every visible shape (full design),
      // not just whatever happens to be selected.
      const bounds = computeExportBounds(shapes, new Set());
      if (!bounds) return null;
      const bytes = await renderPngBytes(bounds);
      if (!bytes) return null;
      return await ipc.xdesignSnapshotWrite(bytes);
    } catch (e) {
      log.warn("xdesign canvas snapshot failed", e);
      return null;
    }
  };

  // `visibleText` shows in the transcript; `sentText` is what Claude receives.
  // They differ for the composer (short brief shown, full prompt sent).
  const sendTurn = async (visibleText: string, sentText: string) => {
    appendUser("xdesign", visibleText);
    const chatId = thread.threadId;
    registerStream(chatId, "xdesign");
    beginAssistant("xdesign", chatId);
    // Coalesce every canvas edit this turn makes into one undo step, however
    // many apply calls the agent splits it into. Ended when the turn finishes
    // (see the running-watch effect below).
    useXDesign.getState().beginHistoryCoalesce();
    try {
      const isFirstTurn = !thread.sessionId;
      const note = buildCanvasNote();
      const snapshotPath = await captureCanvasSnapshot();
      const visionNote = snapshotPath
        ? "\n\nThe attached image is a render of the CURRENT canvas. Read it to judge layout, spacing, alignment, color, contrast, and overlap before deciding what to change."
        : "";
      const prompt = isFirstTurn
        ? `${xdesignClaude.systemPrompt}\n\n${note}${visionNote}\n\n---\n\n${sentText}`
        : `${note}${visionNote}\n\n---\n\n${sentText}`;
      // Pass the snapshot path through to claude_send, which attaches it as a
      // real stream-json image block (NOT an `@path` mention — those get
      // dropped on --resume turns). Null path → plain text-only send.
      await ipc.claudeSend(
        chatId,
        prompt,
        null,
        thread.sessionId,
        snapshotPath,
        useModelPrefs.getState().modelFor("xdesign"),
      );
    } catch (e) {
      log.error("xdesign chat send failed", e);
      forgetStream(chatId);
      setError("xdesign", e instanceof Error ? e.message : String(e));
    }
  };

  const handleSend = (text: string) => sendTurn(text, text);

  // ✦ Generate — compose a full design from a brief. Shows a short brief in the
  // transcript but sends the composer prompt; the reply's xd-design block is
  // ingested by the effect above.
  const handleGenerate = async () => {
    const brief = await promptText({
      title: "Generate a design",
      label: "Describe what to design — Claude builds it as editable layers.",
      placeholder: "a pricing page for a dev tool, dark & bold",
      confirmLabel: "Generate",
    });
    if (brief === null) return;
    const b = brief.trim() || "a clean, modern landing page";
    await sendTurn(
      `✦ Generate a design — ${b}`,
      `${COMPOSER_PROMPT}\n\n---\n\nBRIEF: ${b}`,
    );
  };

  const handleCancel = () => {
    void ipc.claudeCancel(thread.threadId);
  };

  const chatMessages: ClaudeChatMessage[] = thread.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content:
      m.role === "assistant"
        ? stripDesignPlan(stripCanvasCommands(m.content))
        : m.content,
    pending: m.pending,
  }));

  if (!open) {
    return (
      <button
        type="button"
        className="xd-claude-fab"
        onClick={() => setOpen(true)}
        title={`${xdesignClaude.name} (⌘L)`}
      >
        <Sparkles size={14} />
        <span>Ask {xdesignClaude.name}</span>
      </button>
    );
  }

  return (
    <div
      className="xd-claude-rail"
      ref={railRef}
      style={
        box
          ? {
              left: box.left,
              top: box.top,
              width: box.w,
              height: box.h,
              right: "auto",
              bottom: "auto",
              maxHeight: "none",
            }
          : undefined
      }
    >
      <header className="xd-claude-rail-head" onMouseDown={drag.onMouseDown}>
        <Sparkles size={12} color="var(--xd-accent)" />
        <span className="title">{xdesignClaude.name}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="xd-rail-generate"
          data-no-drag
          onClick={handleGenerate}
          disabled={thread.running}
          title="Generate a full design from a brief"
        >
          <Wand2 size={12} />
          <span>Generate</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          data-no-drag
          onClick={() => setOpen(false)}
          title="Hide"
        >
          <X size={13} />
        </button>
      </header>
      <div className="xd-claude-rail-body">
        <ClaudeChat
          appId="xdesign"
          name={xdesignClaude.name}
          subtitle={xdesignClaude.subtitle}
          accentColor={xdesignClaude.accentColor}
          systemPrompt={xdesignClaude.systemPrompt}
          openingLine={
            thread.messages.length === 0 ? xdesignClaude.openingLine : undefined
          }
          suggestionChips={xdesignClaude.suggestionChips}
          placeholder={thread.error ?? "Talk to your design partner…"}
          messages={chatMessages}
          running={thread.running}
          cost={thread.totalCostUsd}
          onSend={handleSend}
          onCancel={handleCancel}
          onNewChat={() => newThread("xdesign")}
        />
      </div>
      <div
        className="xd-claude-resize"
        onMouseDown={resize.onMouseDown}
        title="Drag to resize"
      />
    </div>
  );
}
