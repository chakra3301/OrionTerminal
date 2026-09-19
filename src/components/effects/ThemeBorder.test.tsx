import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
vi.mock("metal-fx", async () => ({
  ...await vi.importActual<typeof import("metal-fx")>("metal-fx"),
  isMetalFxSupported: vi.fn(() => true), setSharedPreset: vi.fn(), setSharedPresetMode: vi.fn(), destroyInstance: vi.fn(), redrawInstance: vi.fn(),
  createInstance: vi.fn(options => ({ ...options, canvas: options.hostCanvas, everCopied: true })),
  updateInstance: vi.fn((instance, patch) => Object.assign(instance, patch)),
}));
vi.mock("border-beam", () => ({ BorderBeam: ({ children }: { children: React.ReactNode }) => <div data-beam>{children}</div> }));
import { createInstance, isMetalFxSupported, redrawInstance, setSharedPreset } from "metal-fx";
import { ThemeBorder } from "./ThemeBorder";
import { useThemeExtras } from "@/store/themeExtrasStore";
import { useThemeStore } from "@/store/themeStore";
let host: HTMLDivElement, root: Root, mounts: number;
function Editor() { useEffect(() => { mounts++; }, []); return <input aria-label="Editor" defaultValue="draft" />; }
beforeEach(async () => { await import("./BorderEffect"); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); useThemeStore.getState().hydrate("liquid"); useThemeExtras.getState().hydrate(null); mounts = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const change = async (patch: Parameters<ReturnType<typeof useThemeExtras.getState>["update"]>[1]) => act(async () => { useThemeExtras.getState().update("liquid", patch); await new Promise(resolve => setTimeout(resolve, 0)); });
it("keeps the entire decorative subtree inert and separate from the editor", async () => {
  await act(async () => root.render(<div><ThemeBorder /><Editor /></div>));
  await change({ border: "metal" });
  const layer = host.querySelector(".ot-themed-border")!;
  expect(layer.hasAttribute("inert")).toBe(true); expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(layer.querySelector("input")).toBeNull();
});
it("switches and refreshes paused finishes without remounting editor or canvas", async () => {
  await act(async () => root.render(<div><ThemeBorder /><Editor /></div>));
  const input = host.querySelector("input")!; input.value = "unsaved work";
  await change({ border: "metal", animate: false });
  const canvas = host.querySelector("canvas");
  await change({ metalPreset: "gold" });
  expect(host.querySelector('[data-preset="gold"]'), host.innerHTML).not.toBeNull();
  expect(host.querySelector("canvas")).toBe(canvas);
  await change({ border: "beam" }); await change({ border: "default" });
  expect(host.querySelector(".ot-themed-border")).toBeNull(); expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("unsaved work"); expect(mounts).toBe(1);
});
it("keeps the Metal canvas mounted across intensity and motion changes", async () => {
  await act(async () => root.render(<div><ThemeBorder /><Editor /></div>));
  await change({ border: "metal", animate: false });
  const canvas = host.querySelector("canvas");
  await change({ strength: .35 });
  expect(host.querySelector("canvas")).toBe(canvas);
  expect(redrawInstance).toHaveBeenCalledWith(canvas);
  await change({ animate: true });
  expect(host.querySelector("canvas")).toBe(canvas); expect(mounts).toBe(1);
});
it("sets the material before registration can paint a first frozen frame", async () => {
  await act(async () => root.render(<div><ThemeBorder /></div>));
  await change({ border: "metal", metalPreset: "gold", animate: false });
  expect(setSharedPreset).toHaveBeenCalledWith("gold", "dark");
  expect(vi.mocked(setSharedPreset).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createInstance).mock.invocationCallOrder[0]!);
});
it("never freezes an uninitialized shader while applying paused properties", async () => {
  const original = vi.mocked(createInstance).getMockImplementation()!;
  vi.mocked(createInstance).mockImplementation(options => ({ ...original(options), everCopied: false }));
  try {
    await act(async () => root.render(<div><ThemeBorder /></div>));
    await change({ border: "metal", animate: false });
    expect(redrawInstance).not.toHaveBeenCalled();
    vi.mocked(createInstance).mock.results.at(-1)!.value.everCopied = true;
    await change({ strength: .4 });
    expect(redrawInstance).toHaveBeenCalled();
  } finally { vi.mocked(createInstance).mockImplementation(original); }
});
it("does not carry Beam palette or geometry attributes into Metal", async () => {
  await act(async () => root.render(<div><ThemeBorder /></div>));
  await change({ border: "beam", beamSize: "line", beamPalette: "sunset" });
  expect(host.querySelector(".ot-themed-border")?.getAttribute("data-palette")).toBe("sunset");
  await change({ border: "metal" });
  const layer = host.querySelector(".ot-themed-border")!;
  expect(layer.hasAttribute("data-palette")).toBe(false); expect(layer.hasAttribute("data-shape")).toBe(false);
  expect(layer.querySelector("[data-beam]")).toBeNull(); expect(layer.querySelector(".ot-border-base")).toBeNull();
});
it("tracks radius-only changes without replacing canvas or editor", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(360);
  await act(async () => root.render(<div style={{ border: "1px solid", borderTopLeftRadius: 18 }}><ThemeBorder /><Editor /></div>));
  await change({ border: "metal" });
  const canvas = host.querySelector("canvas");
  expect((host.querySelector(".ot-metal-border") as HTMLElement).style.borderRadius).toBe("18px");
  await act(async () => { (host.firstElementChild as HTMLElement).style.borderTopLeftRadius = "26px"; await new Promise(resolve => setTimeout(resolve, 0)); });
  expect((host.querySelector(".ot-metal-border") as HTMLElement).style.borderRadius).toBe("26px");
  expect(host.querySelector("canvas")).toBe(canvas);
  expect((host.querySelector(".ot-themed-border") as HTMLElement).style.top).toBe("-1px"); expect(mounts).toBe(1);
});
it("falls back to a static edge without WebGL2", async () => {
  vi.mocked(isMetalFxSupported).mockReturnValueOnce(false);
  await act(async () => root.render(<div><ThemeBorder /><Editor /></div>));
  await change({ border: "metal" });
  expect(host.querySelector(".metal-fx-fallback")).not.toBeNull();
  expect(createInstance).not.toHaveBeenCalled(); expect(host.querySelector("input")).not.toBeNull();
});
it("zero intensity removes decoration without hiding application content", async () => {
  await act(async () => root.render(<div><ThemeBorder /><Editor /></div>));
  await change({ border: "metal", strength: 0 });
  expect(host.querySelector(".ot-themed-border")).toBeNull(); expect(host.querySelector("input")).not.toBeNull();
});
