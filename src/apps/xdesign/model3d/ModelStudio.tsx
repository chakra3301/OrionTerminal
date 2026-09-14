/**
 * img2model studio shell — replaces the SVG design canvas when the active
 * XDesign project is kind "model", same pattern as `fx/FxEditor.tsx` for
 * kind "fx". Toolbar (attach reference, toggle overlay, export factory,
 * place snapshot in a design canvas) + live viewport + assist chat.
 */

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { ImagePlus, Eye, EyeOff, Download, SendToBack, Sparkles, RotateCw } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";
import { useAssetsStore } from "@/store/assetsStore";
import { useXDesign } from "@/apps/xdesign/store";
import { useXDProjects } from "@/apps/xdesign/projectsStore";
import { useModelStore, type ReferenceImage } from "./modelStore";
import { useModelAssist, passProgressLabel } from "./modelAssist";
import { ModelViewport } from "./ModelViewport";
import { ModelAssistPanel } from "./ModelAssistPanel";
import { emitFactorySource } from "./factoryBuilder";
import { getModelRenderBridge } from "./modelRenderBridge";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

// The CLI's image-attach path (`claude_cli.rs::build_user_image_message`)
// hardcodes `media_type: "image/png"` for whatever file it's handed — if
// the user's actual reference is a JPEG/WEBP/etc (very common for a real
// object photo), that media-type mismatch can make the very first turn
// (re-sent on every retry, since a fresh session always reattaches it)
// choke or hang indefinitely with zero visible progress. So `filePath`
// here is ALWAYS a freshly-written, guaranteed-PNG snapshot, never the
// original asset path. Also capped to a sane dimension so the CLI's
// stdin base64 transfer of a 20+MP photo isn't itself the slow part.
const REFERENCE_MAX_DIM = 2048;

async function loadReferenceFromPath(filePath: string, assetId: string | null): Promise<ReferenceImage> {
  const url = convertFileSrc(filePath);
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const scale = Math.min(1, REFERENCE_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/png");

  const pngBytes: Uint8Array = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("canvas.toBlob returned null")); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
    }, "image/png");
  });
  const pngPath = await ipc.xdesignSnapshotWrite(Array.from(pngBytes));

  return { assetId, filePath: pngPath, dataUrl, w, h };
}

async function saveBytes(bytes: Uint8Array, defaultName: string, filterName: string, ext: string): Promise<void> {
  const path = await saveDialog({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return;
  await ipc.xdesignSaveBytes(path, Array.from(bytes));
  toast.success("Exported", { body: path });
}

async function placeInDesign(): Promise<void> {
  const bridge = getModelRenderBridge();
  if (!bridge) { toast.error("Viewport not ready"); return; }
  const canvas = await bridge.captureReviewShot();
  if (!canvas) { toast.error("Capture failed"); return; }
  const path = await join(await appConfigDir(), `model-snapshot-${Date.now()}.png`);
  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  await ipc.xdesignSaveBytes(path, Array.from(new Uint8Array(await blob.arrayBuffer())));
  const assets = await useAssetsStore.getState().ingestPaths([path]);
  const asset = assets.find((a) => a.kind === "image");
  if (!asset) { toast.error("Couldn't ingest the snapshot as an asset"); return; }
  await useXDProjects.getState().ensureActive();
  useXDesign.getState().addShape({
    kind: "image", x: 500 - 256, y: 350 - 256, w: 512, h: 512,
    filePath: asset.filePath, assetId: asset.id, fill: "transparent", stroke: "transparent", strokeWidth: 0,
  });
  toast.success("Placed in design canvas");
}

export function ModelStudio() {
  const reference = useModelStore((s) => s.reference);
  const showOverlay = useModelStore((s) => s.showReferenceOverlay);
  const orbitAutoSpin = useModelStore((s) => s.orbitAutoSpin);
  const spec = useModelStore((s) => s.spec);
  const [busyAttach, setBusyAttach] = useState(false);

  const attachReference = async () => {
    setBusyAttach(true);
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
      });
      const filePath = Array.isArray(picked) ? picked[0] : picked;
      if (!filePath) return;
      const assets = await useAssetsStore.getState().ingestPaths([filePath]);
      const asset = assets.find((a) => a.kind === "image");
      const ref = await loadReferenceFromPath(asset?.filePath ?? filePath, asset?.id ?? null);
      useModelStore.getState().setReference(ref);
      useModelAssist.getState().setOpen(true);
      toast.success("Reference attached", { body: `${ref.w}×${ref.h}` });
    } catch (e) {
      log.error("img2model attach reference failed", e);
      toast.error("Couldn't load that image");
    } finally {
      setBusyAttach(false);
    }
  };

  const exportFactory = async () => {
    const src = emitFactorySource(spec);
    await saveBytes(new TextEncoder().encode(src), `create${spec.name.replace(/\W+/g, "")}Model.ts`, "TypeScript", "ts");
  };

  return (
    <div className="xd-model-studio">
      <div className="xd-model-toolbar">
        <button type="button" onClick={() => void attachReference()} disabled={busyAttach} title="Attach reference image">
          <ImagePlus size={14} /> {reference ? "Replace reference" : "Attach reference"}
        </button>
        <button
          type="button"
          onClick={() => useModelStore.getState().setShowReferenceOverlay(!showOverlay)}
          disabled={!reference}
          title="Toggle reference overlay"
          className={showOverlay ? "active" : ""}
        >
          {showOverlay ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          type="button"
          onClick={() => useModelStore.getState().setOrbitAutoSpin(!orbitAutoSpin)}
          title="Toggle turntable auto-spin"
          className={orbitAutoSpin ? "active" : ""}
        >
          <RotateCw size={14} />
        </button>
        <span className="xd-model-toolbar-pass">{passProgressLabel()}</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => void exportFactory()} title="Export TypeScript factory + spec JSON">
          <Download size={14} /> Export
        </button>
        <button type="button" onClick={() => void placeInDesign()} title="Snapshot the current pass into a design canvas">
          <SendToBack size={14} /> Place in design
        </button>
        <button
          type="button"
          className={useModelAssist.getState().open ? "active" : ""}
          onClick={() => useModelAssist.getState().setOpen(!useModelAssist.getState().open)}
          title="img2model assist"
        >
          <Sparkles size={14} />
        </button>
      </div>
      <div className="xd-model-body">
        <ModelViewport />
        <ModelAssistPanel />
      </div>
    </div>
  );
}
