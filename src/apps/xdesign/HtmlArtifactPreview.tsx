import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  X,
  Monitor,
  Tablet,
  Smartphone,
  Download,
  RefreshCw,
  Send,
  Loader2,
  Presentation,
  Film,
  Pencil,
  Bold,
  Trash2,
  Copy,
  Plus,
  Minus,
  Type,
  PaintBucket,
  Sparkles,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useHtmlArtifact, type ArtifactViewport } from "@/apps/xdesign/htmlArtifactStore";
import { useAppChat } from "@/store/appChatStore";
import { useToasts } from "@/store/toastStore";
import { useDesignSystems } from "@/store/designSystemStore";
import { isDeckHtml, deckToPptxBase64 } from "@/apps/xdesign/deckToPptx";
import { base64ToBytes } from "@/apps/xdesign/imageGen";
import { parseInlineStyle } from "@/apps/xdesign/htmlEditor";
import {
  HTML_PREVIEW_SANDBOX,
  prepareHtmlPreview,
  parsePreviewEvent,
  previewCommand,
  type PreviewCommand,
  type PreviewSelection,
} from "@/apps/xdesign/htmlPreviewBridge";
import { confirmAction } from "@/components/ConfirmModal";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import { trackXDesignActivity } from "@/apps/xdesign/runtimeActivity";

const VIEWPORTS: { id: ArtifactViewport; icon: typeof Monitor; w: number | null; label: string }[] = [
  { id: "desktop", icon: Monitor, w: null, label: "Desktop" },
  { id: "tablet", icon: Tablet, w: 834, label: "Tablet" },
  { id: "mobile", icon: Smartphone, w: 390, label: "Mobile" },
];

type ToolbarPos = { top: number; left: number };
type RecordedPreview = { bytes: Uint8Array; ext: "mp4" | "webm" };
type PendingRecording = {
  resolve: (result: RecordedPreview) => void;
  reject: (error: Error) => void;
  timer: number;
};

export function HtmlArtifactPreview() {
  const open = useHtmlArtifact((s) => s.open);
  const html = useHtmlArtifact((s) => s.html);
  const title = useHtmlArtifact((s) => s.title);
  const viewport = useHtmlArtifact((s) => s.viewport);
  const setViewport = useHtmlArtifact((s) => s.setViewport);
  const close = useHtmlArtifact((s) => s.close);
  const builder = useHtmlArtifact((s) => s.builder);
  const refiner = useHtmlArtifact((s) => s.refiner);
  const elementRefiner = useHtmlArtifact((s) => s.elementRefiner);
  const running = useAppChat((s) => s.threads.xdesign.running);
  const [instruction, setInstruction] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [recording, setRecording] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingRecordings = useRef(new Map<string, PendingRecording>());
  const recordSequence = useRef(0);
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const persistAllowedUntil = useRef(0);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [selection, setSelection] = useState<PreviewSelection | null>(null);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPos | null>(null);
  const [liveHtml, setLiveHtml] = useState<string | null>(html);
  const [previewSrcDoc, setPreviewSrcDoc] = useState<string | undefined>();
  const selfSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (html !== null && html !== selfSavedRef.current) {
      setLiveHtml(html);
      setSelection(null);
      setToolbarPos(null);
    }
  }, [html]);

  useEffect(() => {
    if (!liveHtml) {
      setPreviewSrcDoc(undefined);
      return;
    }
    const prepared = prepareHtmlPreview(liveHtml);
    setBridgeReady(false);
    setSelection(null);
    setToolbarPos(null);
    setPreviewSrcDoc(prepared.srcDoc);
    return prepared.release;
  }, [liveHtml]);

  useEffect(
    () => () => {
      for (const pending of pendingRecordings.current.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("preview closed before recording completed"));
      }
      pendingRecordings.current.clear();
    },
    [],
  );

  const vp = VIEWPORTS.find((v) => v.id === viewport)!;
  const isDeck = !!html && isDeckHtml(html);
  const hasCanvas = !isDeck && !!html && /<canvas/i.test(html);
  const canEdit = !hasCanvas;

  const sendToPreview = useCallback((command: PreviewCommand) => {
    iframeRef.current?.contentWindow?.postMessage(previewCommand(command), "*");
  }, []);

  const updateSelection = useCallback((next: PreviewSelection | null) => {
    setSelection(next);
    if (!next) {
      setToolbarPos(null);
      return;
    }
    const frame = iframeRef.current;
    const stage = stageRef.current;
    if (!frame || !stage) return;
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    setToolbarPos({
      top: Math.max(2, frameRect.top - stageRect.top + next.rect.top - 42),
      left: Math.max(2, frameRect.left - stageRect.left + next.rect.left),
    });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parsePreviewEvent(event.data);
      if (!message) return;

      if (message.type === "ready") {
        setBridgeReady(true);
        sendToPreview({ type: "set-edit", enabled: editModeRef.current });
      } else if (message.type === "selection") {
        if (editModeRef.current) updateSelection(message.selection);
      } else if (message.type === "persist") {
        if (!editModeRef.current && Date.now() > persistAllowedUntil.current) return;
        selfSavedRef.current = message.html;
        useHtmlArtifact.getState().setArtifact(message.html, title);
      } else if (message.type === "external-link") {
        void confirmAction({
          title: "Open external link?",
          body: message.url,
          confirmLabel: "Open",
        }).then((approved) => {
          if (approved) void openUrl(message.url).catch((error) => log.warn("openUrl failed", error));
        });
      } else if (message.type === "record-result") {
        const pending = pendingRecordings.current.get(message.requestId);
        if (!pending) return;
        pendingRecordings.current.delete(message.requestId);
        window.clearTimeout(pending.timer);
        pending.resolve({ bytes: new Uint8Array(message.bytes), ext: message.ext });
      } else if (message.type === "record-error") {
        const pending = pendingRecordings.current.get(message.requestId);
        if (!pending) return;
        pendingRecordings.current.delete(message.requestId);
        window.clearTimeout(pending.timer);
        pending.reject(new Error(message.error));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendToPreview, title, updateSelection]);

  const recordPreviewCanvas = useCallback(
    (durationMs: number): Promise<RecordedPreview> =>
      trackXDesignActivity(
        "preview-recording",
        "Wait for XDesign preview recording to finish before disabling the plugin.",
        () => new Promise((resolve, reject) => {
        if (!bridgeReady) {
          reject(new Error("preview is still loading"));
          return;
        }
        const requestId = `record-${Date.now()}-${++recordSequence.current}`;
        const timer = window.setTimeout(() => {
          pendingRecordings.current.delete(requestId);
          reject(new Error("preview recording timed out"));
        }, durationMs + 15_000);
        pendingRecordings.current.set(requestId, { resolve, reject, timer });
        sendToPreview({ type: "record-canvas", requestId, durationMs });
      }),
      ),
    [bridgeReady, sendToPreview],
  );

  // --- Toolbar actions (operate through the isolated-frame bridge) ---

  const patchStyle = (patch: Record<string, string | null>) => {
    if (!selection) return;
    sendToPreview({ type: "patch-style", patch });
  };

  const bumpFontSize = (delta: number) => {
    if (!selection) return;
    const inline = parseInlineStyle(selection.inlineStyle);
    const current = inline["font-size"] ?? selection.computed["font-size"] ?? "16";
    const base = parseFloat(current);
    const next = Math.max(8, Math.round((Number.isFinite(base) ? base : 16) + delta));
    patchStyle({ "font-size": `${next}px` });
  };

  const toggleBold = () => {
    if (!selection) return;
    const inline = parseInlineStyle(selection.inlineStyle);
    const weight = inline["font-weight"] ?? selection.computed["font-weight"] ?? "400";
    patchStyle({ "font-weight": weight === "700" || weight === "bold" ? null : "700" });
  };

  const deleteSelected = () => sendToPreview({ type: "delete-selection" });
  const duplicateSelected = () => sendToPreview({ type: "duplicate-selection" });
  const moveSelected = (direction: -1 | 1) =>
    sendToPreview({ type: "move-selection", direction });

  const submitElementRefine = () => {
    const text = aiText.trim();
    if (!text || !selection || running || !elementRefiner) return;
    elementRefiner(selection.outerHTML, text);
    setAiText("");
    setAiOpen(false);
  };

  const toggleEdit = () => {
    const next = !editModeRef.current;
    editModeRef.current = next;
    persistAllowedUntil.current = next ? Number.POSITIVE_INFINITY : Date.now() + 1000;
    setEditMode(next);
    if (!next) updateSelection(null);
    sendToPreview({ type: "set-edit", enabled: next });
  };

  const handleExport = async () => {
    if (!html) return;
    try {
      const path = await save({
        defaultPath: `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "page"}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) return;
      await ipc.saveFileAtomic(path, html);
      toast.success("Exported HTML", { body: path });
    } catch (e) {
      log.error("html export failed", e);
      toast.error("Export failed", { body: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleExportVideo = async () => {
    setRecording(true);
    const recId = toast.info("Recording 6s…", { durationMs: 0, body: "Capturing the animation…" });
    try {
      const { bytes, ext } = await recordPreviewCanvas(6000);
      useToasts.getState().dismiss(recId);
      const path = await save({
        defaultPath: `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "motion"}.${ext}`,
        filters: [{ name: "Video", extensions: [ext] }],
      });
      if (!path) return;
      await ipc.xdesignSaveBytes(path, Array.from(bytes));
      toast.success("Exported video", { body: path });
    } catch (e) {
      useToasts.getState().dismiss(recId);
      log.error("video export failed", e);
      toast.error("Video export unavailable", {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRecording(false);
    }
  };

  const handleExportPptx = async () => {
    if (!html) return;
    try {
      const path = await save({
        defaultPath: `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "deck"}.pptx`,
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
      });
      if (!path) return;
      const b64 = await deckToPptxBase64(html, useDesignSystems.getState().active(), title);
      await ipc.xdesignSaveBytes(path, Array.from(base64ToBytes(b64)));
      toast.success("Exported PPTX", { body: path });
    } catch (e) {
      log.error("pptx export failed", e);
      toast.error("PPTX export failed", { body: e instanceof Error ? e.message : String(e) });
    }
  };

  const submitRefine = () => {
    const t = instruction.trim();
    if (!t || running || !refiner) return;
    refiner(t);
    setInstruction("");
  };

  if (!open || !html) return null;

  return (
    <div className="xd-artifact-overlay">
      <header className="xd-artifact-bar">
        <span className="xd-artifact-title">{title}</span>
        <div className="xd-artifact-viewports">
          {VIEWPORTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`xd-artifact-vp${v.id === viewport ? " active" : ""}`}
              onClick={() => setViewport(v.id)}
              title={v.label}
            >
              <v.icon size={13} />
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <button
            type="button"
            className={`xd-artifact-btn${editMode ? " active" : ""}`}
            onClick={toggleEdit}
            disabled={!bridgeReady}
            title="Edit elements directly — click to select, double-click text to edit"
          >
            <Pencil size={12} /> {editMode ? "Editing" : "Edit"}
          </button>
        )}
        {builder && (
          <button
            type="button"
            className="xd-artifact-btn"
            onClick={() => builder()}
            disabled={running}
            title="Generate a fresh page"
          >
            <RefreshCw size={12} /> Regenerate
          </button>
        )}
        {isDeck && (
          <button type="button" className="xd-artifact-btn" onClick={() => void handleExportPptx()} title="Export editable .pptx">
            <Presentation size={12} /> PPTX
          </button>
        )}
        {hasCanvas && (
          <button type="button" className="xd-artifact-btn" onClick={() => void handleExportVideo()} disabled={recording} title="Record the animation to a video file">
            <Film size={12} /> {recording ? "Recording…" : "Video"}
          </button>
        )}
        <button type="button" className="xd-artifact-btn" onClick={handleExport} title="Export .html">
          <Download size={12} /> {isDeck ? "HTML" : "Export"}
        </button>
        <button type="button" className="xd-artifact-btn icon" onClick={close} title="Close">
          <X size={14} />
        </button>
      </header>

      <div className="xd-artifact-main">
      <div className="xd-artifact-stage" ref={stageRef}>
        <div
          className="xd-artifact-frame"
          style={vp.w ? { width: vp.w, maxWidth: "100%" } : { width: "100%" }}
        >
          <iframe
            ref={iframeRef}
            className="xd-artifact-iframe"
            title="Webpage preview"
            srcDoc={previewSrcDoc}
            sandbox={HTML_PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
          />
        </div>
        {editMode && selection && toolbarPos && (
          <div
            className="xd-edit-toolbar"
            style={{ top: toolbarPos.top, left: toolbarPos.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={() => bumpFontSize(-2)} title="Smaller">
              <Minus size={12} />
            </button>
            <Type size={12} className="xd-edit-icon" />
            <button type="button" onClick={() => bumpFontSize(2)} title="Bigger">
              <Plus size={12} />
            </button>
            <button type="button" onClick={toggleBold} title="Bold">
              <Bold size={12} />
            </button>
            <label className="xd-edit-color" title="Text color">
              <Type size={11} />
              <input
                type="color"
                onChange={(e) => patchStyle({ color: e.target.value })}
              />
            </label>
            <label className="xd-edit-color" title="Background color">
              <PaintBucket size={11} />
              <input
                type="color"
                onChange={(e) => patchStyle({ background: e.target.value })}
              />
            </label>
            <button type="button" onClick={duplicateSelected} title="Duplicate">
              <Copy size={12} />
            </button>
            <button type="button" onClick={deleteSelected} title="Delete">
              <Trash2 size={12} />
            </button>
            {elementRefiner && (
              <button
                type="button"
                className={aiOpen ? "active" : ""}
                onClick={() => setAiOpen((v) => !v)}
                title="AI: rewrite this element"
              >
                <Sparkles size={12} />
              </button>
            )}
          </div>
        )}
        {editMode && selection && toolbarPos && aiOpen && (
          <div
            className="xd-edit-ai"
            style={{ top: toolbarPos.top + 30, left: toolbarPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Sparkles size={12} className="xd-edit-icon" />
            <input
              autoFocus
              value={aiText}
              placeholder={running ? "Working…" : "Fix this element — e.g. 'smooth radial gradient, no seam'"}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitElementRefine();
                if (e.key === "Escape") setAiOpen(false);
              }}
              disabled={running}
            />
            <button type="button" onClick={submitElementRefine} disabled={!aiText.trim() || running} title="Apply">
              <Send size={12} />
            </button>
          </div>
        )}
      </div>
      {editMode && selection && (
        <ElementInspector
          key={selection.path.join("-")}
          selection={selection}
          onPatch={patchStyle}
          onMove={moveSelected}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
        />
      )}
      </div>

      <footer className="xd-artifact-refine">
        {running ? (
          <div className="xd-artifact-running">
            <Loader2 size={13} className="spin" /> Working…
          </div>
        ) : (
          <>
            <input
              className="xd-artifact-input"
              value={instruction}
              placeholder="Refine — e.g. 'make the hero full-bleed with a bigger headline'…"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRefine();
              }}
              disabled={!refiner}
            />
            <button
              type="button"
              className="xd-artifact-btn"
              onClick={submitRefine}
              disabled={!instruction.trim() || !refiner}
            >
              <Send size={12} /> Refine
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function rgbToHex(v: string): string {
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : "#000000";
  const h = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`;
}

type InspectorProps = {
  selection: PreviewSelection;
  onPatch: (patch: Record<string, string | null>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function ElementInspector({ selection, onPatch, onMove, onDuplicate, onDelete }: InspectorProps) {
  const inline = parseInlineStyle(selection.inlineStyle);
  const init = (prop: string): string => inline[prop] ?? selection.computed[prop] ?? "";
  const px = (prop: string): string => {
    const value = parseFloat(init(prop));
    return Number.isFinite(value) ? String(Math.round(value)) : "";
  };
  const firstClass = selection.className.trim().split(/\s+/)[0];
  const tag = `${selection.tag}${firstClass ? `.${firstClass}` : ""}`;

  return (
    <aside className="xd-inspector">
      <div className="xd-insp-tag">{tag}</div>

      <div className="xd-insp-section">Typography</div>
      <label className="xd-insp-row">
        <span>Size</span>
        <input type="number" defaultValue={px("font-size")} onChange={(e) => onPatch({ "font-size": e.target.value ? `${e.target.value}px` : null })} />
      </label>
      <label className="xd-insp-row">
        <span>Weight</span>
        <select defaultValue={init("font-weight") || "400"} onChange={(e) => onPatch({ "font-weight": e.target.value })}>
          {["300", "400", "500", "600", "700", "800"].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </label>
      <label className="xd-insp-row">
        <span>Line</span>
        <input defaultValue={inline["line-height"] ?? ""} placeholder="1.5" onChange={(e) => onPatch({ "line-height": e.target.value || null })} />
      </label>
      <label className="xd-insp-row">
        <span>Tracking</span>
        <input defaultValue={inline["letter-spacing"] ?? ""} placeholder="0" onChange={(e) => onPatch({ "letter-spacing": e.target.value || null })} />
      </label>

      <div className="xd-insp-section">Color</div>
      <label className="xd-insp-row">
        <span>Text</span>
        <input type="color" defaultValue={rgbToHex(init("color"))} onChange={(e) => onPatch({ color: e.target.value })} />
      </label>
      <label className="xd-insp-row">
        <span>Background</span>
        <input type="color" defaultValue={rgbToHex(init("background-color"))} onChange={(e) => onPatch({ "background-color": e.target.value })} />
      </label>

      <div className="xd-insp-section">Spacing</div>
      <label className="xd-insp-row">
        <span>Padding</span>
        <input defaultValue={inline["padding"] ?? ""} placeholder={selection.computed.padding ?? "0"} onChange={(e) => onPatch({ padding: e.target.value || null })} />
      </label>
      <label className="xd-insp-row">
        <span>Margin</span>
        <input defaultValue={inline["margin"] ?? ""} placeholder={selection.computed.margin ?? "0"} onChange={(e) => onPatch({ margin: e.target.value || null })} />
      </label>

      <div className="xd-insp-section">Border</div>
      <label className="xd-insp-row">
        <span>Border</span>
        <input defaultValue={inline["border"] ?? ""} placeholder="1px solid #000" onChange={(e) => onPatch({ border: e.target.value || null })} />
      </label>
      <label className="xd-insp-row">
        <span>Radius</span>
        <input type="number" defaultValue={px("border-radius")} onChange={(e) => onPatch({ "border-radius": e.target.value ? `${e.target.value}px` : null })} />
      </label>

      <div className="xd-insp-section">Arrange</div>
      <div className="xd-insp-actions">
        <button type="button" onClick={() => onMove(-1)} title="Move up"><ChevronUp size={13} /></button>
        <button type="button" onClick={() => onMove(1)} title="Move down"><ChevronDown size={13} /></button>
        <button type="button" onClick={onDuplicate} title="Duplicate"><Copy size={13} /></button>
        <button type="button" onClick={onDelete} title="Delete"><Trash2 size={13} /></button>
      </div>
    </aside>
  );
}
