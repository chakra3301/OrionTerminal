import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoPanel, useInfoCursor } from "./InfoPanel";
import { useColorSamplers } from "./colorSamplers";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => useInfoCursor.getState().set(null)); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const val = (label: string, nth = 0) => container.querySelectorAll(`[aria-label="Info ${label}"] output`)[nth]!.textContent;
const move = (x: number, y: number) => act(() => { useInfoCursor.getState().set([x, y]); });
const flush = () => act(async () => { await Promise.resolve(); });
const render = (sample: (x: number, y: number) => Promise<string | null> = vi.fn(async () => null), selectionBounds: [number, number, number, number] | null = null) => { act(() => root.render(<InfoPanel width={200} height={100} selectionBounds={selectionBounds} sample={sample} />)); return sample; };

describe("InfoPanel", () => {
  it("shows the document size", () => { render(); expect(container.textContent).toContain("Doc: 200 × 100 px"); });
  it("floors the cursor position", () => { render(); move(12.9, 40.2); expect(val("X")).toBe("12"); expect(val("Y")).toBe("40"); });
  it("blanks the cursor for null and outside points", () => {
    render(); move(5, 5); act(() => useInfoCursor.getState().set(null)); expect(val("X")).toBe("");
    move(200, 5); expect(val("X")).toBe(""); move(5, -0.5); expect(val("Y")).toBe("");
  });
  it("does not sample outside the image", async () => { const sample = render(); move(500, 5); await flush(); expect(sample).not.toHaveBeenCalled(); });
  it("shows RGB and HSB for a sampled colour", async () => {
    const sample = render(vi.fn(async () => "#ff8000")); move(3.7, 4.2); await flush();
    expect(sample).toHaveBeenCalledWith(3, 4);
    expect([val("R"), val("G"), val("B", 0)]).toEqual(["255", "128", "0"]);
    expect([val("H"), val("S"), val("B", 1)]).toEqual(["30°", "100%", "100%"]);
  });
  it("blanks colour for a transparent pixel, an error and leaving the image", async () => {
    const sample = vi.fn<(x: number, y: number) => Promise<string | null>>().mockResolvedValueOnce("#ff8000").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("x"));
    render(sample); move(1, 1); await flush(); expect(val("R")).toBe("255");
    move(2, 1); await flush(); expect(val("R")).toBe("");
    move(3, 1); await flush(); expect(val("R")).toBe("");
    sample.mockResolvedValue("#000000"); move(4, 1); await flush(); expect(val("B", 0)).toBe("0");
    act(() => useInfoCursor.getState().set(null)); expect(val("B", 0)).toBe("");
  });
  it("coalesces moves while a request is in flight", async () => {
    const pending: ((hex: string | null) => void)[] = [], sample = render(vi.fn(() => new Promise<string | null>(resolve => { pending.push(resolve); })));
    move(1, 1); move(2, 2); move(3, 3); move(4, 4);
    expect(sample).toHaveBeenCalledTimes(1);
    await act(async () => { pending[0]!("#ff0000"); });
    expect(sample).toHaveBeenCalledTimes(2);
    expect(sample).toHaveBeenLastCalledWith(4, 4);
    expect(val("R")).toBe("");
    await act(async () => { pending[1]!("#00ff00"); });
    expect(sample).toHaveBeenCalledTimes(2);
    expect(val("G")).toBe("255");
  });
  it("does not resample while the cursor stays in the same pixel", async () => { const sample = render(); move(1.1, 1.1); move(1.8, 1.9); await flush(); expect(sample).toHaveBeenCalledTimes(1); });
  it("shows the selection size", () => {
    render(undefined, [10, 20, 64, 48]); expect([val("W"), val("H", 1)]).toEqual(["64", "48"]);
    act(() => root.render(<InfoPanel width={200} height={100} selectionBounds={undefined} sample={async () => null} />)); expect(val("W")).toBe("");
  });
  it("reads a CMYK image's inks in percent for the first readout and each color sampler, keeping HSB from the shown colour", async () => {
    act(() => useColorSamplers.setState({ documents: { doc: [{ x: 9, y: 8 }] } }));
    const sample = vi.fn(async () => "#ff8000"), ink = vi.fn(async (x: number) => x === 9 ? [10.4, 20, 30, 40.6] : [0, 49.6, 100, 0]);
    act(() => root.render(<InfoPanel width={200} height={100} selectionBounds={null} sample={sample} ink={ink} documentId="doc"/>)); move(3.7, 4.2); await flush(); await flush();
    expect(ink).toHaveBeenCalledWith(3, 4); expect(ink).toHaveBeenCalledWith(9, 8);
    expect([val("C"), val("M"), val("Y"), val("K")]).toEqual(["0%", "50%", "100%", "0%"]);
    expect(container.querySelector('[aria-label="Info R"]')).toBeNull();
    expect([val("H"), val("S"), val("B", 0)]).toEqual(["30°", "100%", "100%"]);
    expect([...container.querySelectorAll('[aria-label="Info sampler 1"] output')].map(output => output.textContent)).toEqual(["10%", "20%", "30%", "41%"]);
    act(() => useColorSamplers.setState({ documents: {} }));
  });
  it("ignores a result that settles after unmount", async () => {
    let done!: (hex: string | null) => void; const sample = render(vi.fn(() => new Promise<string | null>(resolve => { done = resolve; })));
    move(1, 1); act(() => root.unmount()); await act(async () => { done("#ff0000"); });
    expect(sample).toHaveBeenCalledTimes(1); root = createRoot(container);
  });
});
