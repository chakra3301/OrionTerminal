import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVisualActivity } from "@/components/effects/useVisualActivity";
import { WallpaperOverlay } from "@/shell/WallpaperOverlay";
import { STOCK_WALLPAPER_URL, useWallpaperStore, type OverlayKind } from "@/store/wallpaperStore";

export function OverlayPreview({ kind }: { kind: OverlayKind }) {
  const { ref, visible } = useVisualActivity<HTMLSpanElement>();
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (visible) setVisited(true); }, [visible]);
  const mode = useWallpaperStore((s) => s.mode);
  const path = useWallpaperStore((s) => s.customPath);
  const background = mode === "custom" && path ? convertFileSrc(path) : STOCK_WALLPAPER_URL;
  return <span ref={ref} className="ot-wp-overlay-thumb" data-overlay-preview={kind} aria-hidden="true"
    style={{ backgroundImage: `url("${background}")` }}>
    {(visible || visited) && <WallpaperOverlay kind={kind} preview />}
  </span>;
}
