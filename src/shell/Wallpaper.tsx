import { convertFileSrc } from "@tauri-apps/api/core";
import { STOCK_WALLPAPER_URL, useWallpaperStore } from "@/store/wallpaperStore";
import { WallpaperOverlay } from "@/shell/WallpaperOverlay";

export function Wallpaper() {
  const mode = useWallpaperStore((s) => s.mode);
  const customPath = useWallpaperStore((s) => s.customPath);
  const overlay = useWallpaperStore((s) => s.overlay);
  const hasCustom = mode === "custom" && !!customPath;
  const customUrl = hasCustom ? convertFileSrc(customPath!) : null;

  return (
    <div className="ot-wallpaper" aria-hidden data-custom={hasCustom ? "1" : "0"} data-overlay={overlay}>
      <div className="ot-wp-custom" style={{ backgroundImage: `url("${customUrl ?? STOCK_WALLPAPER_URL}")` }} />
      <WallpaperOverlay kind={overlay} />
    </div>
  );
}
