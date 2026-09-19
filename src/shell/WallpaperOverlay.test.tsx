import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WallpaperOverlay } from "./WallpaperOverlay";
import { useWallpaperStore } from "@/store/wallpaperStore";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
vi.mock("./MatrixCanvas", () => ({ MatrixCanvas: ({ hue, preview }: { hue: number; preview: boolean }) => <canvas data-matrix data-hue={hue} data-preview={preview} /> }));
vi.mock("./CoreOverlay", () => ({ CoreOverlay: ({ preview }: { preview: boolean }) => <canvas data-core data-preview={preview} /> }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWallpaperStore.setState({ matrixHue: 140, overlayIntensity: .6 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("shares real Matrix hue and intensity between desktop and preview", async () => {
  await act(async () => root.render(<><WallpaperOverlay kind="matrix" /><WallpaperOverlay kind="matrix" preview /></>));
  const layers = host.querySelectorAll<HTMLElement>(".ot-wp-overlay");
  expect(Array.from(layers, (layer) => layer.style.opacity)).toEqual(["0.6", "0.6"]);
  expect(Array.from(host.querySelectorAll("canvas"), (el) => el.dataset.preview)).toEqual(["false", "true"]);
  await act(async () => useWallpaperStore.setState({ matrixHue: 250, overlayIntensity: .3 }));
  expect(Array.from(host.querySelectorAll("canvas"), (el) => el.dataset.hue)).toEqual(["250", "250"]);
  expect(Array.from(layers, (layer) => layer.style.opacity)).toEqual(["0.3", "0.3"]);
});
it("does not allocate an invisible renderer at zero intensity", async () => {
  useWallpaperStore.setState({ overlayIntensity: 0 });
  await act(async () => root.render(<WallpaperOverlay kind="core" preview />));
  expect(host.children).toHaveLength(0);
});
it("renders the actual Core branch, and creates no renderer for Off", async () => {
  await act(async () => root.render(<WallpaperOverlay kind="core" preview />));
  expect(host.querySelector("[data-core]")?.getAttribute("data-preview")).toBe("true");
  await act(async () => root.render(<WallpaperOverlay kind="none" preview />));
  expect(host.children).toHaveLength(0);
});
