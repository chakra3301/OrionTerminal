import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { XDesignToolRail } from "@/apps/xdesign/ToolRail";
import { XDesignLayersPanel } from "@/apps/xdesign/LayersPanel";
import { XDesignCanvas } from "@/apps/xdesign/Canvas";
import { XDesignInspector } from "@/apps/xdesign/Inspector";
import { XDesignClaudeRail } from "@/apps/xdesign/XDesignClaudeRail";
import { XDesignAlignBar } from "@/apps/xdesign/AlignBar";
import { PresentMode } from "@/apps/xdesign/PresentMode";
import { HtmlArtifactPreview } from "@/apps/xdesign/HtmlArtifactPreview";
import { usePresentMode } from "@/apps/xdesign/presentStore";
import { initialScreen, topLevelFrames } from "@/apps/xdesign/prototype";
import { useFileDropZone } from "@/lib/fileDrop";
import { useAssetsStore } from "@/store/assetsStore";
import { useXDesign } from "@/apps/xdesign/store";
import { useXDProjects } from "@/apps/xdesign/projectsStore";
import { XDesignHome } from "@/apps/xdesign/XDesignHome";
import { XDesignTabs } from "@/apps/xdesign/XDesignTabs";
import { log } from "@/lib/log";

/** Enter present mode on the selected top-level frame, else the first screen. */
export function startPresent(): void {
  const { shapes, selection } = useXDesign.getState();
  const selFrame = [...selection]
    .map((id) => shapes.find((s) => s.id === id))
    .find((s) => s && s.kind === "frame" && !s.parentId);
  usePresentMode.getState().enter(selFrame?.id ?? initialScreen(shapes));
}

const IMG_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "heif", "bmp", "avif",
]);

function isImagePath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return IMG_EXT.has(ext);
}

async function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = url;
  });
  return { w: img.naturalWidth, h: img.naturalHeight };
}

/** Ingest dropped image files into the Archives asset library (so they live
 * under the asset:// protocol scope and survive the original being moved/
 * deleted), then add them to the active XDesign page as image shapes near
 * the documented default-zoom viewport center (≈500, 350). Non-image paths
 * are ignored — XDesign is image-focused, and dropping a `.tsx` here would
 * be confusing. */
async function handleImageDrop(paths: string[]): Promise<void> {
  const imgs = paths.filter(isImagePath);
  if (imgs.length === 0) return;
  let assets;
  try {
    assets = await useAssetsStore.getState().ingestPaths(imgs);
  } catch (e) {
    log.warn("xdesign drop: ingest failed", e);
    return;
  }
  let stagger = 0;
  for (const a of assets) {
    if (a.kind !== "image") continue;
    let w = 480;
    let h = 360;
    try {
      const dims = await loadImageDims(convertFileSrc(a.filePath));
      const MAX = 600;
      const ratio = dims.h > 0 ? dims.w / dims.h : 1;
      if (dims.w > MAX || dims.h > MAX) {
        if (ratio >= 1) {
          w = MAX;
          h = Math.round(MAX / ratio);
        } else {
          h = MAX;
          w = Math.round(MAX * ratio);
        }
      } else {
        w = dims.w;
        h = dims.h;
      }
    } catch {
      /* keep defaults — broken image still places, user can resize */
    }
    useXDesign.getState().addShape({
      kind: "image",
      x: 500 - w / 2 + stagger,
      y: 350 - h / 2 + stagger,
      w,
      h,
      filePath: a.filePath,
      assetId: a.id,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
    });
    stagger += 30;
  }
}

export function XDesignApp() {
  const stageRef = useRef<HTMLDivElement>(null);
  // Captured via callback ref → state so the docked Design Partner can portal
  // up to the shell and live as a real flex column (see XDesignClaudeRail).
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const hasFrames = useXDesign((s) => topLevelFrames(s.shapes).length > 0);
  const activeId = useXDProjects((s) => s.activeId);

  useFileDropZone(stageRef, "xdesign-canvas", (e) => {
    if (e.type === "enter") setDropOver(true);
    else if (e.type === "leave") setDropOver(false);
    else {
      setDropOver(false);
      void handleImageDrop(e.paths);
    }
  });

  if (activeId === null) {
    return (
      <div className="xd-root xd-root-home">
        <XDesignHome />
      </div>
    );
  }

  return (
    <div className="xd-root">
      <XDesignTabs />
      <div className="xd-shell" ref={setShellEl}>
      <XDesignToolRail />
      <XDesignLayersPanel />
      <div
        ref={stageRef}
        className={`xd-canvas-stage${dropOver ? " drop-over" : ""}`}
      >
        <XDesignAlignBar />
        <XDesignCanvas />
        <XDesignClaudeRail dockTarget={shellEl} />
        {hasFrames && (
          <button
            type="button"
            className="xd-present-launch"
            onClick={startPresent}
            title="Present prototype"
          >
            <Play size={13} />
          </button>
        )}
        <PresentMode />
        <HtmlArtifactPreview />
      </div>
      <XDesignInspector />
      </div>
    </div>
  );
}
