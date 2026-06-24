import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Wand2, Palette, Eye, Paintbrush, Shuffle, Globe, ImagePlus, Image as ImageIcon, Presentation, Film, Minimize2, Maximize2, PanelRight, PanelRightClose, type LucideIcon } from "lucide-react";
import { ulid } from "ulid";
import { ClaudeChat, type ClaudeChatMessage } from "@/components/ClaudeChat";
import { useAppChat, registerStream, forgetStream } from "@/store/appChatStore";
import { useDraggable } from "@/shell/useDraggable";
import { useXDesign } from "@/apps/xdesign/store";
import { upsertChat } from "@/lib/db";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { ipc } from "@/lib/ipc";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useProvidersStore } from "@/store/providersStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useToasts } from "@/store/toastStore";
import {
  pickImageProvider,
  resolveImageModel,
  getImageModelOverride,
  defaultSize,
  base64ToBytes,
  sizeAspect,
  styleImagePrompt,
} from "@/apps/xdesign/imageGen";
import {
  hasImageSlots,
  extractImageRequests,
  inlineGeneratedImages,
} from "@/apps/xdesign/imageSlots";
import { designTurnModel } from "@/apps/xdesign/designModel";
import { blueprintForLenses, buildBlueprintPrompt, BLUEPRINTS } from "@/apps/xdesign/htmlBlueprints";
import {
  inspectArtifact,
  summarizeIssues,
  buildRepairPrompt,
} from "@/apps/xdesign/artifactGuard";
import { dispatchSend, dispatchCancel, toRuntimeHistory } from "@/features/agents/dispatchSend";
import { log } from "@/lib/log";
import { xdesignClaude, COMPOSER_PROMPT, composerVariationsPrompt } from "@/apps/xdesign/claude";
import { composeCraftBrief, lensesForBrief } from "@/apps/xdesign/designKnowledge";
import {
  extractHtmlArtifact,
  stripHtmlArtifact,
  buildWebpagePrompt,
  buildDeckPrompt,
  buildMotionPrompt,
  buildRefinePrompt,
  buildElementRefinePrompt,
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
type Placement = "float" | "dock";
type RailUi = { placement: Placement; box: Box | null; collapsed: boolean };

const MIN_W = 300;
const MIN_H = 280;
// How much of the panel must stay reachable when parked past a viewport edge.
const GRAB_MARGIN = 120;
// Below this floating width the Generate label collapses to its icon and the
// action icons wrap.
const COMPACT_W = 360;
const RAIL_UI_KEY = "xd-rail-ui";

function loadRailUi(): RailUi {
  try {
    const raw = localStorage.getItem(RAIL_UI_KEY);
    if (raw) {
      const o = JSON.parse(raw) as RailUi;
      if (o && (o.placement === "float" || o.placement === "dock"))
        return { placement: o.placement, box: o.box ?? null, collapsed: !!o.collapsed };
    }
  } catch {
    /* ignore corrupt persisted ui */
  }
  return { placement: "float", box: null, collapsed: false };
}

export function XDesignClaudeRail() {
  const [open, setOpen] = useState(false);
  // Floating placement, size, and collapsed state — persisted so the partner
  // stays where you parked it across close/reopen and app restarts. box is in
  // VIEWPORT coords (the floating rail is portaled to <body> with position:
  // fixed) so it can move anywhere in the terminal, not just over the canvas.
  const [ui, setUiState] = useState<RailUi>(loadRailUi);
  const { placement, box, collapsed } = ui;
  const setUi = (patch: Partial<RailUi>) =>
    setUiState((u) => {
      const next = { ...u, ...patch };
      try {
        localStorage.setItem(RAIL_UI_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  const setBox = (b: Box) => setUi({ box: b });
  const railRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<Box | null>(null);

  // Keep the panel sane + on-screen-ish: cap its size to the viewport but let
  // it hang PAST any edge (over the inspector, tool rail, or off the window /
  // onto the desktop) as long as a grab margin stays reachable. This is what
  // lets it leave the canvas entirely.
  const clampBox = (b: Box): Box => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = clamp(b.w, MIN_W, W);
    const h = clamp(b.h, MIN_H, H);
    return {
      w,
      h,
      left: clamp(b.left, GRAB_MARGIN - w, W - GRAB_MARGIN),
      top: clamp(b.top, 0, H - GRAB_MARGIN),
    };
  };

  // Snapshot the rail's current viewport geometry for the move/resize gestures.
  const captureGeometry = (): Box | null => {
    const el = railRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
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
      setBox(clampBox({ ...o, left: o.left + dx, top: o.top + dy }));
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
      setBox(clampBox({ ...o, w: o.w + dx, h: o.h + dy }));
    },
  });

  const activeBrand = useDesignSystems((s) => s.active());

  // The active brand contract, compiled to a prompt block — injected into both
  // the canvas-edit system prompt and the ✦ Generate composer so the AI stays
  // on-brand. Empty when no system is active.
  const brandBlock = (): string =>
    activeBrand ? `\n\n${designSystemToPrompt(activeBrand, { withRamps: true })}\n` : "";

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
  // True while a 🌐 turn is a REFINE of the current page (vs a fresh build) —
  // the guard only stub-checks refines. Reset per user action.
  const refiningRef = useRef(false);
  // One silent auto-repair budget per user-initiated build/refine.
  const repairAttemptRef = useRef(0);

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
    // HTML-artifact turn: consume the produced document into the live preview
    // (resolving any {{IMG: …}} slots into real generated images first).
    if (pendingArtifactRef.current) {
      pendingArtifactRef.current = false;
      const doc = extractHtmlArtifact(last.content);
      if (doc) void renderArtifact(doc);
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
  // `modelOverride` lets the labelled creative buttons force the strongest
  // model (Tier 0); plain chat omits it and keeps the user's dropdown choice.
  const sendTurn = async (visibleText: string, sentText: string, modelOverride?: string) => {
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
        value: modelOverride ?? useModelPrefs.getState().modelFor("xdesign"),
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

  // The strongest model for a labelled creative turn (Tier 0). Plain chat
  // (handleSend) deliberately stays on the user's dropdown choice.
  const bestModel = () => designTurnModel(useModelPrefs.getState().modelFor("xdesign"));

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
      bestModel(),
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
      bestModel(),
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
      bestModel(),
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
    await sendTurn(`◈ Apply brand — ${brand.name}`, buildApplyBrandPrompt(brand), bestModel());
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
      bestModel(),
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
    refiningRef.current = false;
    repairAttemptRef.current = 0;
    const imagesAvailable = !!pickImageProvider(useProvidersStore.getState().providers);
    // Lever 2: pick the expert blueprint for the brief; the model fills its
    // named slots instead of free-architecting the page. Core craft only — the
    // blueprint already carries the artifact structure the lens used to hint.
    const blueprint = buildBlueprintPrompt(blueprintForLenses(lensesForBrief(b)));
    await sendTurn(
      `🌐 Build webpage — ${b}`,
      buildWebpagePrompt(
        b,
        useDesignSystems.getState().active(),
        composeCraftBrief(),
        imagesAvailable,
        blueprint,
      ),
      bestModel(),
    );
  };

  // 🖥️ Build deck — a presentable HTML slide deck (self-contained nav + print-
  // to-PDF CSS) from a brief, via the same artifact pipeline + preview.
  const handleBuildDeck = async () => {
    const brief = await promptText({
      title: "Build a slide deck",
      label: "Describe the deck — Claude builds presentable HTML slides you can preview & export.",
      placeholder: "a seed pitch deck for an AI design tool",
      confirmLabel: "Build deck",
    });
    if (brief === null) return;
    const b = brief.trim() || "a concise pitch deck";
    pendingArtifactRef.current = true;
    refiningRef.current = false;
    repairAttemptRef.current = 0;
    const imagesAvailable = !!pickImageProvider(useProvidersStore.getState().providers);
    await sendTurn(
      `🖥️ Build deck — ${b}`,
      buildDeckPrompt(
        b,
        useDesignSystems.getState().active(),
        buildBlueprintPrompt(BLUEPRINTS.deck),
        imagesAvailable,
      ),
      bestModel(),
    );
  };

  // 🎥 Motion — a self-contained, canvas-based looping motion graphic; plays in
  // the preview and can be recorded to video there.
  const handleBuildMotion = async () => {
    const brief = await promptText({
      title: "Generate motion",
      label: "Describe the motion graphic — Claude builds a looping canvas animation you can preview & record.",
      placeholder: "a flowing aurora gradient with drifting particles",
      confirmLabel: "Animate",
    });
    if (brief === null) return;
    const b = brief.trim() || "an on-brand looping motion graphic";
    pendingArtifactRef.current = true;
    refiningRef.current = false;
    repairAttemptRef.current = 0;
    await sendTurn(
      `🎥 Motion — ${b}`,
      buildMotionPrompt(b, useDesignSystems.getState().active()),
      bestModel(),
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
    refiningRef.current = true;
    repairAttemptRef.current = 0;
    const imagesAvailable = !!pickImageProvider(useProvidersStore.getState().providers);
    void sendTurn(
      `Refine webpage — ${instruction}`,
      buildRefinePrompt(cur, instruction, useDesignSystems.getState().active(), imagesAvailable),
      bestModel(),
    );
  };

  // Element-scoped refine: the preview hands us the selected element's clean
  // outerHTML + an instruction; we ask the model to change only that element
  // and return the full document (so it flows back through the render/guard
  // pipeline → the iframe reloads with the surgical fix applied).
  const refineElement = (elementHtml: string, instruction: string) => {
    const cur = useHtmlArtifact.getState().html;
    if (!cur) return;
    pendingArtifactRef.current = true;
    refiningRef.current = true;
    repairAttemptRef.current = 0;
    const imagesAvailable = !!pickImageProvider(useProvidersStore.getState().providers);
    void sendTurn(
      `Refine element — ${instruction}`,
      buildElementRefinePrompt(
        cur,
        elementHtml,
        instruction,
        useDesignSystems.getState().active(),
        imagesAvailable,
      ),
      bestModel(),
    );
  };

  // Let the preview overlay drive build/refine without coupling components.
  useEffect(() => {
    useHtmlArtifact.getState().setActions({
      builder: () => void handleBuildWebpage(),
      refiner: refineWebpage,
      elementRefiner: refineElement,
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
      bestModel(),
    );
  };

  // 🖼️ Generate image — real raster image from a text prompt via a
  // user-configured image provider (OpenAI/Google). Ingested into the Archives
  // asset library, then placed as an editable image layer (real filePath, not
  // an embedded data URL — keeps the document light). Direct API call, not a
  // chat turn.
  const handleGenerateImage = async () => {
    const provider = pickImageProvider(useProvidersStore.getState().providers);
    if (!provider) {
      toast.info("No image provider", {
        body: "Add an image-capable key (OpenAI or Google) in Control Panel → Providers.",
      });
      return;
    }
    const desc = await promptText({
      title: "Generate an image",
      label: `Describe the image — ${provider.name} renders it as a real raster image.`,
      placeholder: "a dark moody mountain range at dusk, cinematic",
      confirmLabel: "Generate",
    });
    if (desc === null) return;
    const d = desc.trim();
    if (!d) return;
    const model = resolveImageModel(provider.kind, getImageModelOverride(provider.id));
    const size = defaultSize();
    const styled = styleImagePrompt(d, useDesignSystems.getState().active());
    const loadingId = toast.info("Generating image…", {
      durationMs: 0,
      body: `${provider.name} · ${model}`,
    });
    try {
      const { b64, mime } = await ipc.xdesignImageGen(
        provider.kind,
        provider.baseUrl,
        provider.keyRef,
        model,
        styled,
        size,
      );
      const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      const blob = new Blob([base64ToBytes(b64)], { type: mime });
      const [asset] = await useAssetsStore
        .getState()
        .ingestBlobs([{ blob, suggestedName: `generated.${ext}` }]);
      if (!asset) throw new Error("could not save the generated image");
      const ratio = sizeAspect(size);
      const w = 420;
      const h = Math.round(w / ratio);
      useXDesign.getState().addShape({
        kind: "image",
        x: 500 - w / 2,
        y: 350 - h / 2,
        w,
        h,
        filePath: asset.filePath,
        assetId: asset.id,
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
        name: "Generated image",
      });
      useToasts.getState().dismiss(loadingId);
      toast.success("Image generated", { body: "Placed on canvas + saved to Archives." });
      log.info("xdesign: placed generated raster image");
    } catch (e) {
      useToasts.getState().dismiss(loadingId);
      toast.error("Image generation failed", {
        body: e instanceof Error ? e.message : String(e),
      });
      log.error("xdesign image gen failed", e);
    }
  };

  // Render a produced HTML document into the live preview. When an image
  // provider exists and the page used {{IMG: …}} slots, generate a real raster
  // per slot and inline it as a data: URL (sandboxed srcdoc can't load
  // asset://; data URLs also make the exported file self-contained). Failed /
  // uncovered slots fall back to a gradient so the layout never breaks.
  const renderArtifact = async (doc: string) => {
    const title = (doc.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const provider = pickImageProvider(useProvidersStore.getState().providers);
    const requests = provider ? extractImageRequests(doc) : [];
    if (provider && requests.length > 0) {
      const loadingId = toast.info(
        `Generating ${requests.length} image${requests.length > 1 ? "s" : ""}…`,
        { durationMs: 0, body: provider.name },
      );
      const model = resolveImageModel(provider.kind, getImageModelOverride(provider.id));
      const brand = useDesignSystems.getState().active();
      const map = new Map<string, string>();
      await Promise.all(
        requests.map(async (desc) => {
          try {
            const { b64, mime } = await ipc.xdesignImageGen(
              provider.kind,
              provider.baseUrl,
              provider.keyRef,
              model,
              styleImagePrompt(desc, brand),
              defaultSize(),
            );
            map.set(desc, `data:${mime};base64,${b64}`);
          } catch (e) {
            log.warn("html artifact image slot failed", desc, e);
          }
        }),
      );
      useToasts.getState().dismiss(loadingId);
      log.info(`xdesign claude: ${map.size}/${requests.length} slot image(s) generated`);
      finishArtifact(inlineGeneratedImages(doc, map), title);
      return;
    }
    // No provider / no slots — swap any stray tokens for the gradient fallback.
    const safe = hasImageSlots(doc) ? inlineGeneratedImages(doc, new Map()) : doc;
    finishArtifact(safe, title);
  };

  // Lever 3 — quality guard. Inspect the final document; on issues run ONE
  // silent auto-repair turn, else publish (warning if still imperfect).
  const finishArtifact = (finalHtml: string, title: string) => {
    const prior = useHtmlArtifact.getState().html;
    const issues = inspectArtifact(finalHtml, { prior, isRefine: refiningRef.current });
    if (issues.length > 0 && repairAttemptRef.current < 1) {
      repairAttemptRef.current += 1;
      pendingArtifactRef.current = true;
      toast.info("Polishing the page…", { body: summarizeIssues(issues) });
      log.info(`xdesign artifact guard: repairing — ${summarizeIssues(issues)}`);
      void sendTurn("Polish & fix the page", buildRepairPrompt(issues, finalHtml), bestModel());
      return;
    }
    if (issues.length > 0) {
      toast.warning("Page may need a tweak", { body: summarizeIssues(issues) });
      log.warn(`xdesign artifact guard: shipped with issues — ${summarizeIssues(issues)}`);
    }
    useHtmlArtifact.getState().setArtifact(finalHtml, title || undefined);
    log.info("xdesign claude: rendered HTML artifact");
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

  const actions: { icon: LucideIcon; tip: string; onClick: () => void; disabled?: boolean }[] = [
    { icon: Shuffle, tip: "Variations — 3 distinct directions side-by-side", onClick: handleVariations, disabled: thread.running },
    { icon: Globe, tip: "Build webpage — real, shippable HTML you can preview & export", onClick: handleWebpageButton, disabled: thread.running },
    { icon: Presentation, tip: "Build deck — a presentable HTML slide deck (export to PDF/HTML)", onClick: handleBuildDeck, disabled: thread.running },
    { icon: Film, tip: "Motion — a looping canvas motion graphic you can record to video", onClick: handleBuildMotion, disabled: thread.running },
    { icon: ImagePlus, tip: "Illustrate — generate a vector SVG illustration", onClick: handleIllustrate, disabled: thread.running },
    { icon: ImageIcon, tip: "Generate image — real raster from a prompt (needs an image key)", onClick: handleGenerateImage },
    { icon: Eye, tip: "Critique & refine — self-critique the canvas, then fix it", onClick: handleCritique, disabled: thread.running },
    { icon: Paintbrush, tip: "Apply brand — restyle the canvas to the active design system", onClick: handleApplyBrand, disabled: thread.running },
    { icon: Palette, tip: "Extract brand — distill the canvas into a reusable design system", onClick: handleExtractBrand, disabled: thread.running },
  ];

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

  const floating = placement === "float";
  const isCompact = floating && !collapsed && box != null && box.w < COMPACT_W;
  const iconsOnly = collapsed || isCompact;

  const cb = floating && box ? clampBox(box) : null;
  const railStyle =
    floating && cb
      ? collapsed
        ? {
            left: clamp(cb.left, 0, window.innerWidth - 120),
            top: clamp(cb.top, 0, window.innerHeight - 40),
            right: "auto" as const,
            bottom: "auto" as const,
          }
        : {
            left: cb.left,
            top: cb.top,
            width: cb.w,
            height: cb.h,
            right: "auto" as const,
            bottom: "auto" as const,
            maxHeight: "none" as const,
          }
      : undefined;

  const rail = (
    <div
      className={`xd-claude-rail ${floating ? "floating" : "dock"}${collapsed && floating ? " collapsed" : ""}${isCompact ? " compact" : ""}`}
      ref={railRef}
      style={railStyle}
    >
      <header
        className="xd-claude-rail-head"
        onMouseDown={floating ? drag.onMouseDown : undefined}
        style={floating ? undefined : { cursor: "default" }}
      >
        <Sparkles size={12} color="var(--xd-accent)" />
        {!collapsed && <span className="title">{xdesignClaude.name}</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="xd-rail-generate xd-rail-tip"
          data-no-drag
          onClick={handleGenerate}
          disabled={thread.running}
          aria-label="Generate a full design from a brief"
          data-tip="Generate a full design from a brief"
        >
          <Wand2 size={12} />
          {!iconsOnly && <span>Generate</span>}
        </button>
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            className="xd-rail-icon xd-rail-tip"
            data-no-drag
            onClick={a.onClick}
            disabled={a.disabled}
            aria-label={a.tip}
            data-tip={a.tip}
          >
            <a.icon size={13} />
          </button>
        ))}
        {floating && (
          <button
            type="button"
            className="icon-btn xd-rail-tip"
            data-no-drag
            onClick={() => setUi({ collapsed: !collapsed })}
            aria-label={collapsed ? "Expand" : "Collapse to icons"}
            data-tip={collapsed ? "Expand" : "Collapse to icons"}
          >
            {collapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
        )}
        <button
          type="button"
          className="icon-btn xd-rail-tip"
          data-no-drag
          onClick={() => setUi({ placement: floating ? "dock" : "float", collapsed: false })}
          aria-label={floating ? "Dock as a panel" : "Float over the canvas"}
          data-tip={floating ? "Dock as a panel" : "Float over the canvas"}
        >
          {floating ? <PanelRight size={13} /> : <PanelRightClose size={13} />}
        </button>
        <button
          type="button"
          className="icon-btn xd-rail-tip"
          data-no-drag
          onClick={() => setOpen(false)}
          aria-label="Hide"
          data-tip="Hide"
        >
          <X size={13} />
        </button>
      </header>
      {!collapsed && (
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
      )}
      {floating && !collapsed && (
        <div
          className="xd-claude-resize"
          onMouseDown={resize.onMouseDown}
          title="Drag to resize"
        />
      )}
    </div>
  );

  // Floating → portal to <body> so it escapes the canvas-stage clip and can
  // move anywhere in the terminal. Docked → render in place as a right column.
  return floating ? createPortal(rail, document.body) : rail;
}
