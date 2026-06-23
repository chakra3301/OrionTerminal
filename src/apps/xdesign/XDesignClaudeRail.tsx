import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, Wand2, Palette, Eye, Paintbrush, Shuffle, Globe, ImagePlus } from "lucide-react";
import { ulid } from "ulid";
import { ClaudeChat, type ClaudeChatMessage } from "@/components/ClaudeChat";
import { useAppChat, registerStream, forgetStream } from "@/store/appChatStore";
import { useDraggable } from "@/shell/useDraggable";
import { useXDesign } from "@/apps/xdesign/store";
import { upsertChat } from "@/lib/db";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { ipc } from "@/lib/ipc";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
import { log } from "@/lib/log";
import { xdesignClaude, COMPOSER_PROMPT, composerVariationsPrompt } from "@/apps/xdesign/claude";
import { composeCraftBrief, lensesForBrief } from "@/apps/xdesign/designKnowledge";
import {
  extractHtmlArtifact,
  stripHtmlArtifact,
  buildWebpagePrompt,
  buildRefinePrompt,
} from "@/apps/xdesign/htmlArtifact";
import { useHtmlArtifact } from "@/apps/xdesign/htmlArtifactStore";
import {
  extractSvg,
  stripSvg,
  svgToDataUrl,
  illustrationBox,
  buildIllustrationPrompt,
} from "@/apps/xdesign/svgIllustration";
import { useDesignSystems } from "@/store/designSystemStore";
import {
  designSystemToPrompt,
  parseDesignSystemReply,
  stripDesignSystemReply,
  buildCritiquePrompt,
  buildApplyBrandPrompt,
  EXTRACT_SYSTEM_PROMPT,
} from "@/apps/xdesign/designSystem";
import { toast } from "@/store/toastStore";
import {
  parseCanvasCommands,
  runCanvasCommands,
  stripCanvasCommands,
} from "@/apps/xdesign/claudeCommands";
import { parseDesignPlans, stripDesignPlan } from "@/apps/xdesign/designPlan";
import { ingestDesignPlan, ingestDesignPlans } from "@/apps/xdesign/ingestDesignPlan";
import { promptText } from "@/components/PromptModal";
import { computeExportBounds, renderPngBytes } from "@/apps/xdesign/exportXD";
import { clamp } from "@/lib/time";

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

  const activeBrand = useDesignSystems((s) => s.active());

  // The active brand contract, compiled to a prompt block — injected into both
  // the canvas-edit system prompt and the ✦ Generate composer so the AI stays
  // on-brand. Empty when no system is active.
  const brandBlock = (): string =>
    activeBrand ? `\n\n${designSystemToPrompt(activeBrand)}\n` : "";

  const thread = useAppChat((s) => s.threads.xdesign);
  const appendUser = useAppChat((s) => s.appendUser);
  const beginAssistant = useAppChat((s) => s.beginAssistant);
  const setError = useAppChat((s) => s.setError);
  const newThread = useAppChat((s) => s.newThread);

  // Track which assistant messages we've already executed commands for so
  // streaming snapshot updates don't re-run the same batch.
  const executedRef = useRef<Set<string>>(new Set());
  // When true, the next finished assistant reply is treated as an HTML
  // artifact (set by Build webpage / Refine) rather than canvas commands.
  const pendingArtifactRef = useRef(false);
  // When true, the next finished reply is an SVG illustration to place on the
  // canvas as an image layer (data: URL).
  const pendingSvgRef = useRef(false);

  // Whenever the latest assistant message in this thread finishes streaming
  // (pending=false), parse any <canvas-command> blocks and run them. Single
  // pushHistory per batch is handled by runCanvasCommands.
  useEffect(() => {
    const last = thread.messages[thread.messages.length - 1];
    if (!last || last.role !== "assistant" || last.pending) return;
    if (executedRef.current.has(last.id)) return;
    executedRef.current.add(last.id);
    // SVG-illustration turn: place the produced <svg> as a data-URL image.
    if (pendingSvgRef.current) {
      pendingSvgRef.current = false;
      const svg = extractSvg(last.content);
      if (svg) {
        const { w, h } = illustrationBox(svg, 420);
        useXDesign.getState().addShape({
          kind: "image",
          x: 500 - w / 2,
          y: 350 - h / 2,
          w,
          h,
          filePath: svgToDataUrl(svg),
          assetId: null,
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          name: "Illustration",
        });
        log.info("xdesign claude: placed SVG illustration");
      }
      return;
    }
    // HTML-artifact turn: consume the produced document into the live preview.
    if (pendingArtifactRef.current) {
      pendingArtifactRef.current = false;
      const doc = extractHtmlArtifact(last.content);
      if (doc) {
        const title = (doc.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
        useHtmlArtifact.getState().setArtifact(doc, title || undefined);
        log.info("xdesign claude: rendered HTML artifact");
      }
      return;
    }
    // An extract-brand reply (one ```xd-designsystem block) becomes a new,
    // active design system; it must take priority over canvas commands.
    const ds = parseDesignSystemReply(last.content, `ds-${ulid()}`);
    if (ds) {
      void useDesignSystems.getState().save(ds);
      void useDesignSystems.getState().setActive(ds.id);
      toast.success("Brand extracted", { body: `"${ds.name}" is now active` });
      log.info("xdesign claude: extracted design system");
      return;
    }
    // A composer reply ingests as whole design(s): one block → single design,
    // several blocks → variations laid side-by-side. Otherwise fall through to
    // the low-level canvas-command path.
    const plans = parseDesignPlans(last.content);
    if (plans.length === 1) {
      ingestDesignPlan(plans[0]!);
      log.info("xdesign claude: ingested design plan");
      return;
    }
    if (plans.length > 1) {
      ingestDesignPlans(plans);
      log.info(`xdesign claude: ingested ${plans.length} variations`);
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
        ? `${xdesignClaude.systemPrompt}${brandBlock()}\n\n${note}${visionNote}\n\n---\n\n${sentText}`
        : `${note}${visionNote}\n\n---\n\n${sentText}`;
      // Pass the snapshot path through to claude_send, which attaches it as a
      // real stream-json image block (NOT an `@path` mention — those get
      // dropped on --resume turns). Null path → plain text-only send.
      await dispatchSend({
        chatId,
        value: useModelPrefs.getState().modelFor("xdesign"),
        prompt,
        history: toRuntimeHistory(useAppChat.getState().threads.xdesign.messages),
        projectRoot: null,
        sessionId: thread.sessionId,
        imagePath: snapshotPath,
      });
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
    const brand = brandBlock();
    const brandNote = brand
      ? `${brand}\nUse the brand contract above as your design system: take its color tokens AS the plan's tokens.colors (same names + hex), honor its fonts, type scale, spacing, radii, voice, and principles. Do not invent an off-brand palette.\n`
      : "";
    const craft = `\n\n${composeCraftBrief(lensesForBrief(b))}\n`;
    await sendTurn(
      `✦ Generate a design — ${b}`,
      `${COMPOSER_PROMPT}${brandNote}${craft}\n\n---\n\nBRIEF: ${b}`,
    );
  };

  // ◈ Extract brand — distill the current canvas into a reusable design
  // system. The vision snapshot sendTurn attaches lets the model read pixels.
  const handleExtractBrand = async () => {
    if (useXDesign.getState().shapes.length === 0) {
      toast.info("Nothing to extract", { body: "The canvas is empty." });
      return;
    }
    await sendTurn(
      "◈ Extract a design system from this canvas",
      EXTRACT_SYSTEM_PROMPT,
    );
  };

  // ◉ Critique & refine — vision-based self-critique against the active brand,
  // then targeted fixes. Open Design's "critique" stage as one click.
  const handleCritique = async () => {
    if (useXDesign.getState().shapes.length === 0) {
      toast.info("Nothing to critique", { body: "The canvas is empty." });
      return;
    }
    await sendTurn(
      "◉ Critique & refine",
      buildCritiquePrompt(useDesignSystems.getState().active()),
    );
  };

  // ◈ Apply brand — restyle the existing canvas to the active brand contract
  // without changing layout/structure.
  const handleApplyBrand = async () => {
    const brand = useDesignSystems.getState().active();
    if (!brand) {
      toast.info("No active brand", { body: "Pick a design system in the Brand panel." });
      return;
    }
    if (useXDesign.getState().shapes.length === 0) {
      toast.info("Nothing to restyle", { body: "The canvas is empty." });
      return;
    }
    await sendTurn(`◈ Apply brand — ${brand.name}`, buildApplyBrandPrompt(brand));
  };

  // ⧉ Variations — generate N distinct directions side-by-side to choose from.
  const handleVariations = async () => {
    const brief = await promptText({
      title: "Generate variations",
      label: "Describe what to design — Claude pitches 3 distinct directions side-by-side.",
      placeholder: "a pricing page for a dev tool, dark & bold",
      confirmLabel: "Generate 3",
    });
    if (brief === null) return;
    const b = brief.trim() || "a clean, modern landing page";
    const brand = brandBlock();
    const brandNote = brand
      ? `${brand}\nUse the brand contract above as the shared design system across all directions: same color tokens, fonts, type scale, spacing, radii, voice.\n`
      : "";
    const craft = `\n\n${composeCraftBrief(lensesForBrief(b))}\n`;
    await sendTurn(
      `⧉ Generate 3 directions — ${b}`,
      `${composerVariationsPrompt(3)}${brandNote}${craft}\n\n---\n\nBRIEF: ${b}`,
    );
  };

  // 🌐 Build webpage — generate a real, shippable single-file HTML page from a
  // brief (brand- + craft-aware), rendered live in the sandboxed preview.
  const handleBuildWebpage = async () => {
    const brief = await promptText({
      title: "Build a webpage",
      label: "Describe the page — Claude builds real, shippable HTML/CSS you can preview & export.",
      placeholder: "a landing page for a privacy-first email app",
      confirmLabel: "Build",
    });
    if (brief === null) return;
    const b = brief.trim() || "a clean, modern landing page";
    pendingArtifactRef.current = true;
    await sendTurn(
      `🌐 Build webpage — ${b}`,
      buildWebpagePrompt(b, useDesignSystems.getState().active(), composeCraftBrief(lensesForBrief(b))),
    );
  };

  // Open the preview if we already have a page; otherwise build a new one.
  const handleWebpageButton = () => {
    if (useHtmlArtifact.getState().html) useHtmlArtifact.getState().openPreview();
    else void handleBuildWebpage();
  };

  const refineWebpage = (instruction: string) => {
    const cur = useHtmlArtifact.getState().html;
    if (!cur) return;
    pendingArtifactRef.current = true;
    void sendTurn(
      `Refine webpage — ${instruction}`,
      buildRefinePrompt(cur, instruction, useDesignSystems.getState().active()),
    );
  };

  // Let the preview overlay drive build/refine without coupling components.
  useEffect(() => {
    useHtmlArtifact.getState().setActions({
      builder: () => void handleBuildWebpage(),
      refiner: refineWebpage,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ◈ Illustrate — generate a vector SVG illustration (brand-colored) and drop
  // it on the canvas as an editable image layer.
  const handleIllustrate = async () => {
    const desc = await promptText({
      title: "Generate an illustration",
      label: "Describe the illustration — Claude draws it as scalable vector art.",
      placeholder: "an abstract aurora wave, depth, brand colors",
      confirmLabel: "Illustrate",
    });
    if (desc === null) return;
    const d = desc.trim() || "an abstract brand-colored hero graphic";
    pendingSvgRef.current = true;
    await sendTurn(
      `◈ Illustrate — ${d}`,
      buildIllustrationPrompt(d, useDesignSystems.getState().active()),
    );
  };

  const handleCancel = () => {
    void dispatchCancel(thread.threadId, useModelPrefs.getState().modelFor("xdesign"));
  };

  const chatMessages: ClaudeChatMessage[] = useMemo(
    () =>
      thread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content:
          m.role === "assistant"
            ? stripSvg(
                stripHtmlArtifact(
                  stripDesignSystemReply(stripDesignPlan(stripCanvasCommands(m.content))),
                ),
              )
            : m.content,
        pending: m.pending,
      })),
    [thread.messages],
  );

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
          className="xd-rail-icon"
          data-no-drag
          onClick={handleVariations}
          disabled={thread.running}
          title="Variations — 3 distinct directions side-by-side"
        >
          <Shuffle size={13} />
        </button>
        <button
          type="button"
          className="xd-rail-icon"
          data-no-drag
          onClick={handleWebpageButton}
          disabled={thread.running}
          title="Build webpage — real, shippable HTML you can preview & export"
        >
          <Globe size={13} />
        </button>
        <button
          type="button"
          className="xd-rail-icon"
          data-no-drag
          onClick={handleIllustrate}
          disabled={thread.running}
          title="Illustrate — generate a vector SVG illustration"
        >
          <ImagePlus size={13} />
        </button>
        <button
          type="button"
          className="xd-rail-icon"
          data-no-drag
          onClick={handleCritique}
          disabled={thread.running}
          title="Critique & refine — self-critique the canvas, then fix it"
        >
          <Eye size={13} />
        </button>
        <button
          type="button"
          className="xd-rail-icon"
          data-no-drag
          onClick={handleApplyBrand}
          disabled={thread.running}
          title="Apply brand — restyle the canvas to the active design system"
        >
          <Paintbrush size={13} />
        </button>
        <button
          type="button"
          className="xd-rail-icon"
          data-no-drag
          onClick={handleExtractBrand}
          disabled={thread.running}
          title="Extract brand — distill the canvas into a reusable design system"
        >
          <Palette size={13} />
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
