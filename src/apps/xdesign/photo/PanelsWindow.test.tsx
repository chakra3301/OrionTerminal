import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistogramPanel, histogramChannels, histogramPercentile, histogramStats } from "./HistogramPanel";
import { CharacterPanel, faceName } from "./CharacterPanel";
import { ParagraphPanel } from "./ParagraphPanel";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";

const native = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke, convertFileSrc: (p: string) => p }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: "photo", version: "v1", name: "Image", width: 100, height: 100, previewWidth: 100, previewHeight: 100, bundlePath: "", previewPath: "x.png", originalPath: null };
const layer: PhotoLayer = { id: 4, name: "T", kind: "Text", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false,
  text: { text: "Hello", font: "Inter", sizePt: 12, antialias: "smooth", runs: [{ start: 0, end: 5, style: { font: "Inter", size: 12, weight: 400, italic: false, fauxBold: false, caps: "normal", leading: "auto", color: "#112233ff", features: { swsh: 1 }, ligatures: true } }],
    paragraphs: [{ start: 0, end: 5, style: { align: "left", direction: "auto", startIndent: 0, hyphenate: false } }] } };
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.run.mockReset().mockResolvedValue({ faces: [{ weight: 400, italic: false }, { weight: 700, italic: false }] }); native.invoke.mockReset().mockResolvedValue([]);
  usePhotoWorkspace.setState({ projectId: "project", busy: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const by = <T extends Element = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
const pick = (label: string, value: string) => act(async () => { const s = by<HTMLSelectElement>(label); s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });

describe("Histogram panel", () => {
  it("computes statistics and mode-aware channels", () => {
    const bins = Array(256).fill(0); bins[10] = 2; bins[30] = 2;
    expect(histogramStats(bins)).toMatchObject({ mean: 20, stdDev: 10, median: 10, pixels: 4 });
    expect(histogramStats(bins, 2)!.pixels).toBe(2); expect(histogramStats(Array(256).fill(0))).toBeNull();
    expect(histogramPercentile(bins, 10)).toBe(50);
    expect(histogramChannels("RGB").map(c => c.label)).toEqual(["Colors", "RGB", "Red", "Green", "Blue", "Luminosity"]);
    expect(histogramChannels("Grayscale").map(c => c.label)).toEqual(["Gray"]); expect(histogramChannels("Lab").map(c => c.label)).toEqual(["Lightness", "a", "b"]);
  });
  it("reads the histogram once edits settle and shows statistics under the pointer", async () => {
    const level = (i: number) => Array.from({ length: 256 }, (_, n) => n === i ? 8 : 0);
    native.invoke.mockResolvedValue([level(50), level(10), level(20), level(30)]);
    await act(async () => root.render(<HistogramPanel document={photo} mode="RGB" activeLayer={4}/>));
    expect(native.invoke).not.toHaveBeenCalled(); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_histogram", { projectId: "project", photoId: "photo", version: "v1", layer: null, below: false, space: "rgb" });
    expect(container.querySelectorAll(".xd-hist-colors").length).toBe(3);
    await act(async () => by<HTMLInputElement>("Histogram expanded view").click());
    await pick("Histogram channel", "red"); expect(by("Histogram Mean").textContent).toContain("10.00");
    await pick("Histogram source", "layer"); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_histogram", expect.objectContaining({ layer: 4, below: false }));
    const graph = by("Histogram graph"); graph.getBoundingClientRect = () => ({ left: 0, width: 256 } as DOMRect);
    await act(async () => graph.dispatchEvent(Object.assign(new MouseEvent("pointermove", { bubbles: true, clientX: 10 }))));
    expect(by("Histogram Level").textContent).toContain("10"); expect(by("Histogram Count").textContent).toContain("8");
  });
});

describe("Character and Paragraph panels", () => {
  it("writes character styles to the whole layer and disables without a type layer", async () => {
    await act(async () => root.render(<CharacterPanel layer={layer}/>)); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(native.run).toHaveBeenCalledWith("type.fonts", { family: "Inter" }); expect(faceName({ weight: 700, italic: true })).toBe("Bold Italic");
    await pick("Font style", "700/false"); expect(native.run).toHaveBeenLastCalledWith("type.setStyle", { layer: 4, weight: 700, italic: false });
    await act(async () => by("All Caps").click()); expect(native.run).toHaveBeenLastCalledWith("type.setStyle", { layer: 4, caps: "all" });
    expect(by("Swash").getAttribute("aria-pressed")).toBe("true"); await act(async () => by("Swash").click());
    expect(native.run).toHaveBeenLastCalledWith("type.openType.swash", { layer: 4, on: false });
    await pick("Anti-aliasing", "windowsLcd"); expect(native.run).toHaveBeenLastCalledWith("type.antiAlias.windowsLcd", { layer: 4 });
    await act(async () => root.render(<CharacterPanel layer={undefined}/>)); expect(container.textContent).toContain("Select a type layer");
  });
  it("sets paragraph alignment and hyphenation", async () => {
    await act(async () => root.render(<ParagraphPanel layer={layer}/>));
    await act(async () => by("Justify all").click()); expect(native.run).toHaveBeenLastCalledWith("type.setStyle", { layer: 4, align: "justifyAll" });
    await act(async () => by<HTMLInputElement>("Hyphenate").click()); expect(native.run).toHaveBeenLastCalledWith("type.setStyle", { layer: 4, hyphenate: true });
  });
});
