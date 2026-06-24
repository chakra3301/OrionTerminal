import { useState } from "react";
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
} from "lucide-react";
import { useHtmlArtifact, type ArtifactViewport } from "@/apps/xdesign/htmlArtifactStore";
import { useAppChat } from "@/store/appChatStore";
import { useDesignSystems } from "@/store/designSystemStore";
import { isDeckHtml, deckToPptxBase64 } from "@/apps/xdesign/deckToPptx";
import { base64ToBytes } from "@/apps/xdesign/imageGen";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

const VIEWPORTS: { id: ArtifactViewport; icon: typeof Monitor; w: number | null; label: string }[] = [
  { id: "desktop", icon: Monitor, w: null, label: "Desktop" },
  { id: "tablet", icon: Tablet, w: 834, label: "Tablet" },
  { id: "mobile", icon: Smartphone, w: 390, label: "Mobile" },
];

export function HtmlArtifactPreview() {
  const open = useHtmlArtifact((s) => s.open);
  const html = useHtmlArtifact((s) => s.html);
  const title = useHtmlArtifact((s) => s.title);
  const viewport = useHtmlArtifact((s) => s.viewport);
  const setViewport = useHtmlArtifact((s) => s.setViewport);
  const close = useHtmlArtifact((s) => s.close);
  const builder = useHtmlArtifact((s) => s.builder);
  const refiner = useHtmlArtifact((s) => s.refiner);
  const running = useAppChat((s) => s.threads.xdesign.running);
  const [instruction, setInstruction] = useState("");

  if (!open || !html) return null;

  const vp = VIEWPORTS.find((v) => v.id === viewport)!;

  const handleExport = async () => {
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

  const isDeck = isDeckHtml(html);

  const handleExportPptx = async () => {
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
        <button type="button" className="xd-artifact-btn" onClick={handleExport} title="Export .html">
          <Download size={12} /> {isDeck ? "HTML" : "Export"}
        </button>
        <button type="button" className="xd-artifact-btn icon" onClick={close} title="Close">
          <X size={14} />
        </button>
      </header>

      <div className="xd-artifact-stage">
        <div
          className="xd-artifact-frame"
          style={vp.w ? { width: vp.w, maxWidth: "100%" } : { width: "100%" }}
        >
          <iframe
            className="xd-artifact-iframe"
            title="Webpage preview"
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
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
