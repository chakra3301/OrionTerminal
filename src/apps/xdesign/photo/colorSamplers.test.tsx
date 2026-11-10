import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisOverlay } from "./AnalysisTools";
import { InfoPanel, useInfoCursor } from "./InfoPanel";
import { MAX_COLOR_SAMPLERS, useColorSamplers } from "./colorSamplers";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useColorSamplers.setState({ documents: {} }); useInfoCursor.getState().set(null);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const samplers = (doc = "doc") => useColorSamplers.getState().documents[doc] ?? [];

describe("Color sampler store", () => {
  it("keeps up to ten samplers per image and renumbers after a delete", () => {
    const store = useColorSamplers.getState();
    for (let i = 0; i < MAX_COLOR_SAMPLERS; i++) expect(store.add("doc", { x: i, y: i })).toBe(true);
    expect(store.add("doc", { x: 50, y: 50 })).toBe(false);
    store.add("other", { x: 1, y: 2 });
    store.remove("doc", 0); store.move("doc", 0, { x: 7, y: 8 });
    expect(samplers().slice(0, 2)).toEqual([{ x: 7, y: 8 }, { x: 2, y: 2 }]);
    expect(samplers()).toHaveLength(9);
    store.clear("doc");
    expect([samplers(), samplers("other")]).toEqual([[], [{ x: 1, y: 2 }]]);
  });
});

describe("Color Sampler Tool", () => {
  const mount = (props: { tool?: string; samplers?: boolean } = {}) => act(async () => root.render(<AnalysisOverlay tool="colorSampler" documentId="doc" width={200} height={100} zoom={1} analysis={undefined} active extras samplers openNotes={() => {}} {...props}/>));
  const svg = () => container.querySelector<SVGSVGElement>('[aria-label="Analysis overlay"]')!;
  const marker = (n: number) => container.querySelector(`[aria-label="Color sampler ${n}"]`);
  const pointer = (target: Element, type: string, x: number, y: number, init: MouseEventInit = {}) => act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...init })); });
  beforeEach(async () => {
    await mount();
    vi.spyOn(svg(), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
    Object.assign(svg(), { setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn() });
  });

  it("places a sampler on the clicked pixel, and Alt-click elsewhere places none", async () => {
    await pointer(svg(), "pointerdown", 20.7, 30.2);
    await pointer(svg(), "pointerup", 20.7, 30.2);
    expect(samplers()).toEqual([{ x: 20, y: 30 }]);
    expect(marker(1)!.textContent).toBe("1");
    await pointer(svg(), "pointerdown", 80, 60, { altKey: true });
    await pointer(svg(), "pointerdown", 250, 60);
    expect(samplers()).toHaveLength(1);
  });

  it("moves a sampler live while dragging, and deletes it when dragged off the image or Alt-clicked", async () => {
    useColorSamplers.getState().add("doc", { x: 20, y: 30 }); useColorSamplers.getState().add("doc", { x: 5, y: 5 });
    await mount();
    await pointer(marker(1)!, "pointerdown", 20.5, 30.5);
    await pointer(svg(), "pointermove", 60.5, 40.5);
    expect(samplers()[0]).toEqual({ x: 60, y: 40 });
    await pointer(svg(), "pointerup", 61.5, 40.5);
    expect(samplers()).toEqual([{ x: 61, y: 40 }, { x: 5, y: 5 }]);
    await pointer(marker(1)!, "pointerdown", 61.5, 40.5);
    await pointer(svg(), "pointerup", 250, 40);
    expect(samplers()).toEqual([{ x: 5, y: 5 }]);
    await pointer(marker(1)!, "pointerdown", 5.5, 5.5, { altKey: true });
    expect(samplers()).toEqual([]);
  });

  it("shows samplers only when asked and places them only with the Color Sampler Tool", async () => {
    useColorSamplers.getState().add("doc", { x: 20, y: 30 });
    await mount({ samplers: false });
    expect(marker(1)).toBeNull();
    await mount({ tool: "ruler" });
    expect(marker(1)).not.toBeNull();
    await pointer(svg(), "pointerdown", 80, 60);
    expect(samplers()).toHaveLength(1);
  });
});

describe("Info panel samplers", () => {
  it("reads each sampler out, and samples again when the image changes", async () => {
    useColorSamplers.getState().add("doc", { x: 3, y: 4 }); useColorSamplers.getState().add("doc", { x: 5, y: 6 });
    const sample = vi.fn(async (x: number) => x === 3 ? "#ff8000" : "#000010");
    const render = (refresh: string) => act(async () => root.render(<InfoPanel width={10} height={10} selectionBounds={null} sample={sample} documentId="doc" refresh={refresh}/>));
    const values = (n: number) => ["R", "G", "B"].map(channel => container.querySelector(`[aria-label="Info sampler ${n}"] [aria-label="Info ${channel}"] output`)?.textContent);
    await render("v1");
    expect([values(1), values(2)]).toEqual([["255", "128", "0"], ["0", "0", "16"]]);
    expect(container.querySelector('[aria-label="Info sampler 1"]')!.textContent).toMatch(/^#1/);
    expect(sample.mock.calls).toEqual([[3, 4], [5, 6]]);
    await render("v2");
    expect(sample).toHaveBeenCalledTimes(4);
    await act(async () => useColorSamplers.getState().remove("doc", 0));
    expect(container.querySelector('[aria-label="Info sampler 2"]')).toBeNull();
    expect(values(1)).toEqual(["0", "0", "16"]);
  });
});
