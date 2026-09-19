import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OverlayPreview } from "./OverlayPreview";
const state = vi.hoisted(() => ({ visible: false, mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("@/components/effects/useVisualActivity", () => ({ useVisualActivity: () => ({ ref: useRef(null), visible: state.visible, active: state.visible }) }));
vi.mock("@/store/wallpaperStore", () => ({ STOCK_WALLPAPER_URL: "/stock.png", useWallpaperStore: (select: (s: unknown) => unknown) => select({ mode: "default", customPath: null }) }));
vi.mock("@/shell/WallpaperOverlay", () => ({ WallpaperOverlay: () => {
  useEffect(() => { state.mount(); return state.unmount; }, []);
  return <canvas />;
} }));
it("defers the renderer until first visibility, then retains it without context churn until settings close", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<OverlayPreview kind="core" />));
    expect(state.mount).not.toHaveBeenCalled();
    state.visible = true;
    await act(async () => root.render(<OverlayPreview kind="core" />));
    expect(state.mount).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[aria-hidden='true']")).not.toBeNull();
    state.visible = false;
    await act(async () => root.render(<OverlayPreview kind="core" />));
    expect(state.unmount).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(state.unmount).toHaveBeenCalledTimes(1);
});
