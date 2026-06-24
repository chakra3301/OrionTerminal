import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
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
import { recordCanvasToFile } from "@/apps/xdesign/recordCanvas";
import { base64ToBytes } from "@/apps/xdesign/imageGen";
import {
  EDITOR_STYLE_ID,
  pathOf,
  elementAt,
  mergeInlineStyle,
  parseInlineStyle,
  serializeForSave,
  cleanOuterHTML,
} from "@/apps/xdesign/htmlEditor";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

const VIEWPORTS: { id: ArtifactViewport; icon: typeof Monitor; w: number | null; label: string }[] = [
  { id: "desktop", icon: Monitor, w: null, label: "Desktop" },
  { id: "tablet", icon: Tablet, w: 834, label: "Tablet" },
  { id: "mobile", icon: Smartphone, w: 390, label: "Mobile" },
];

const SELECTED_ATTR = "data-xd-selected";
const EDITOR_CSS = `[${SELECTED_ATTR}]{outline:2px solid #ff3ea5 !important;outline-offset:1px;}
[${SELECTED_ATTR}][contenteditable]{outline:2px dashed #ff3ea5 !important;}
*{cursor:default;}`;

type ToolbarPos = { top: number; left: number };

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

  // --- In-place visual editor state ---
  const [editMode, setEditMode] = useState(false);
  const [selPath, setSelPath] = useState<number[] | null>(null);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPos | null>(null);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const selPathRef = useRef<number[] | null>(null);
  selPathRef.current = selPath;
  const stageRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef<{ doc: Document; click: EventListener; dbl: EventListener } | null>(
    null,
  );

  // liveHtml drives the iframe srcDoc. We mutate the iframe's contentDocument in
  // place during editing and persist back to the store WITHOUT reloading the
  // iframe: selfSavedRef remembers what we wrote so the sync effect can tell our
  // own echo from a genuine external change (regenerate / refine).
  const [liveHtml, setLiveHtml] = useState<string | null>(html);
  const selfSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (html !== null && html !== selfSavedRef.current) {
      setLiveHtml(html);
      setSelPath(null);
      setToolbarPos(null);
    }
  }, [html]);

  // NOTE: no early return before the hooks below — all hooks (incl. the editor
  // wiring useEffect) must run unconditionally every render. The render guard
  // lives just before the JSX return.
  const vp = VIEWPORTS.find((v) => v.id === viewport)!;
  const isDeck = !!html && isDeckHtml(html);
  const hasCanvas = !isDeck && !!html && /<canvas/i.test(html);
  const canEdit = !hasCanvas; // editing a pure motion canvas is meaningless

  // --- Editor wiring (thin DOM-bridge side-effect layer) ---

  const getDoc = (): Document | null => iframeRef.current?.contentDocument ?? null;

  const persistEdits = () => {
    const doc = getDoc();
    if (!doc) return;
    try {
      const serialized = serializeForSave(doc);
      selfSavedRef.current = serialized;
      useHtmlArtifact.getState().setArtifact(serialized, title);
    } catch (e) {
      log.warn("html editor persist failed", e);
    }
  };

  const positionToolbar = (el: Element) => {
    const frame = iframeRef.current;
    const stage = stageRef.current;
    if (!frame || !stage) return;
    const r = el.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const top = fr.top - sr.top + r.top - 42;
    const left = fr.left - sr.left + r.left;
    setToolbarPos({ top: Math.max(2, top), left: Math.max(2, left) });
  };

  const selectElement = (el: Element) => {
    const doc = getDoc();
    if (!doc) return;
    for (const prev of Array.from(doc.querySelectorAll(`[${SELECTED_ATTR}]`)))
      prev.removeAttribute(SELECTED_ATTR);
    el.setAttribute(SELECTED_ATTR, "1");
    setSelPath(pathOf(el));
    positionToolbar(el);
  };

  const selectedEl = (): Element | null => {
    const doc = getDoc();
    if (!doc || !selPathRef.current) return null;
    return elementAt(doc.documentElement, selPathRef.current);
  };

  const teardownEditor = () => {
    const l = listenersRef.current;
    if (l) {
      l.doc.removeEventListener("click", l.click, true);
      l.doc.removeEventListener("dblclick", l.dbl, true);
      listenersRef.current = null;
    }
    const doc = getDoc();
    if (doc) {
      doc.getElementById(EDITOR_STYLE_ID)?.remove();
      for (const el of Array.from(doc.querySelectorAll(`[${SELECTED_ATTR}]`)))
        el.removeAttribute(SELECTED_ATTR);
      for (const el of Array.from(doc.querySelectorAll("[contenteditable]")))
        el.removeAttribute("contenteditable");
    }
    setSelPath(null);
    setToolbarPos(null);
  };

  const setupEditor = () => {
    const doc = getDoc();
    if (!doc || !doc.body) return;
    if (listenersRef.current) return; // already wired
    let style = doc.getElementById(EDITOR_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = EDITOR_STYLE_ID;
      style.textContent = EDITOR_CSS;
      doc.head?.appendChild(style);
    }
    const click: EventListener = (e) => {
      const el = e.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      if (el === doc.documentElement || el === doc.body) return;
      e.preventDefault();
      e.stopPropagation();
      selectElement(el);
    };
    const dbl: EventListener = (e) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.nodeType !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      selectElement(el);
      el.setAttribute("contenteditable", "true");
      el.focus();
      const finish = () => {
        el.removeAttribute("contenteditable");
        persistEdits();
      };
      el.addEventListener("blur", finish, { once: true });
    };
    doc.addEventListener("click", click, true);
    doc.addEventListener("dblclick", dbl, true);
    listenersRef.current = { doc, click, dbl };
  };

  // Re-wire whenever edit mode flips or the iframe reloads (liveHtml change).
  useEffect(() => {
    if (!editMode) {
      teardownEditor();
      return;
    }
    const frame = iframeRef.current;
    if (!frame) return;
    const wire = () => setupEditor();
    // contentDocument may already be ready; also re-wire on reload.
    wire();
    frame.addEventListener("load", wire);
    return () => {
      frame.removeEventListener("load", wire);
      teardownEditor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, liveHtml]);

  // --- Toolbar actions (operate on the resolved selected element) ---

  const patchStyle = (patch: Record<string, string | null>) => {
    const el = selectedEl() as HTMLElement | null;
    if (!el) return;
    el.setAttribute("style", mergeInlineStyle(el.getAttribute("style"), patch));
    positionToolbar(el);
    persistEdits();
  };

  const bumpFontSize = (delta: number) => {
    const el = selectedEl() as HTMLElement | null;
    if (!el) return;
    const doc = getDoc();
    const cur = parseInlineStyle(el.getAttribute("style"))["font-size"];
    const base = cur ? parseFloat(cur) : parseFloat(doc?.defaultView?.getComputedStyle(el).fontSize ?? "16");
    const next = Math.max(8, Math.round((isNaN(base) ? 16 : base) + delta));
    patchStyle({ "font-size": `${next}px` });
  };

  const toggleBold = () => {
    const el = selectedEl() as HTMLElement | null;
    if (!el) return;
    const cur = parseInlineStyle(el.getAttribute("style"))["font-weight"];
    const isBold = cur === "700" || cur === "bold";
    patchStyle({ "font-weight": isBold ? null : "700" });
  };

  const deleteSelected = () => {
    const el = selectedEl();
    if (!el) return;
    el.remove();
    setSelPath(null);
    setToolbarPos(null);
    persistEdits();
  };

  const duplicateSelected = () => {
    const el = selectedEl();
    if (!el) return;
    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute(SELECTED_ATTR);
    el.after(clone);
    selectElement(clone);
    persistEdits();
  };

  const moveSelected = (dir: -1 | 1) => {
    const el = selectedEl();
    if (!el) return;
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    if (dir < 0) sib.before(el);
    else sib.after(el);
    setSelPath(pathOf(el));
    positionToolbar(el);
    persistEdits();
  };

  const submitElementRefine = () => {
    const t = aiText.trim();
    const el = selectedEl();
    if (!t || !el || running || !elementRefiner) return;
    elementRefiner(cleanOuterHTML(el), t);
    setAiText("");
    setAiOpen(false);
  };

  const toggleEdit = () => {
    if (editMode) persistEdits();
    setEditMode((v) => !v);
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

  // Record the artifact's <canvas> animation to a video file (MediaRecorder on
  // the in-iframe canvas stream — same trick voice capture uses).
  const handleExportVideo = async () => {
    const doc = iframeRef.current?.contentDocument;
    const canvas = (doc?.querySelector("canvas#scene") ??
      doc?.querySelector("canvas")) as HTMLCanvasElement | null;
    if (!canvas) {
      toast.error("No canvas to record", { body: "This artifact has no <canvas> animation." });
      return;
    }
    setRecording(true);
    const recId = toast.info("Recording 6s…", { durationMs: 0, body: "Capturing the animation…" });
    try {
      const { bytes, ext } = await recordCanvasToFile(canvas, 6000);
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
            srcDoc={liveHtml ?? html}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
        {editMode && selPath && toolbarPos && (
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
        {editMode && selPath && toolbarPos && aiOpen && (
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
      {editMode && selPath && (() => {
        const el = selectedEl() as HTMLElement | null;
        return el ? (
          <ElementInspector
            key={selPath.join("-")}
            el={el}
            onPatch={patchStyle}
            onMove={moveSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
          />
        ) : null;
      })()}
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
  el: HTMLElement;
  onPatch: (patch: Record<string, string | null>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

// Right-rail inspector for the selected element. Keyed by selection path so it
// remounts (fresh initial values) whenever the selection changes; edits write
// inline styles via onPatch.
function ElementInspector({ el, onPatch, onMove, onDuplicate, onDelete }: InspectorProps) {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const inline = parseInlineStyle(el.getAttribute("style"));
  const init = (prop: string): string => inline[prop] ?? cs?.getPropertyValue(prop) ?? "";
  const px = (prop: string): string => {
    const v = init(prop);
    const n = parseFloat(v);
    return isNaN(n) ? "" : String(Math.round(n));
  };
  const tag = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}`;

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
        <input defaultValue={inline["padding"] ?? ""} placeholder={cs?.padding ?? "0"} onChange={(e) => onPatch({ padding: e.target.value || null })} />
      </label>
      <label className="xd-insp-row">
        <span>Margin</span>
        <input defaultValue={inline["margin"] ?? ""} placeholder={cs?.margin ?? "0"} onChange={(e) => onPatch({ margin: e.target.value || null })} />
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
