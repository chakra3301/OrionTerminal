import { useWallpaperStore, type OverlayKind } from "@/store/wallpaperStore";
import { MatrixCanvas } from "./MatrixCanvas";
import { CoreOverlay } from "./CoreOverlay";

export function WallpaperOverlay({ kind, preview = false }: { kind: OverlayKind; preview?: boolean }) {
  const hue = useWallpaperStore((s) => s.matrixHue);
  const intensity = useWallpaperStore((s) => s.overlayIntensity);
  if (kind === "none" || intensity <= 0) return null;
  return <div className="ot-wp-overlay" style={{ opacity: intensity }}>
    {kind === "matrix" && <MatrixCanvas hue={hue} preview={preview} />}
    {kind === "core" && <CoreOverlay preview={preview} />}
  </div>;
}
