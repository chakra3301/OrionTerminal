import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SELECTION_PREFERENCES_KEY, readSelectionPreferences, rememberedSelectionValues, saveSelectionPreferences, sanitizeSelectionPreferences } from "./selectionPreferences";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("remembered selection workflow options", () => {
  it("restores native option precision and independent workflow choices while using current image samples", () => {
    expect(saveSelectionPreferences("refine", true, { radius: 2.5, smooth: 12.25, output: "layerMask", edgeBrushes: [{ points: [[1, 2]] }] }, "overlay", 44)).toBeNull();
    expect(saveSelectionPreferences("color", true, { select: "sampledColors", sampleFuzziness: 87.5, colors: ["#ff0000"], points: [[70, 80]], subtractPoints: [[4, 5]] }, "white", 30)).toBeNull();
    const saved = readSelectionPreferences();
    expect(saved.workflows.refine).toEqual({ options: { radius: 2.5, smooth: 12.25, output: "layerMask" }, view: "overlay", brushSize: 44 });
    expect(rememberedSelectionValues("color", [.2, 1.1, -.1, .5], saved.workflows.color)).toMatchObject({ colors: [[.2, 1.1, -.1, .5]], points: [], subtractPoints: [], sampleFuzziness: 87.5 });
    expect(saveSelectionPreferences("refine", false, {}, "mask", 30)).toBeNull();
    expect(readSelectionPreferences().workflows.refine).toBeUndefined(); expect(readSelectionPreferences().workflows.color).toBeDefined();
  });
  it("validates ranges/types/enums and restores defaults for invalid tonal pairs", () => {
    expect(sanitizeSelectionPreferences("refine", { radius: NaN, smooth: 101, feather: -1, smartRadius: "true", output: "bad", amount: 42.25, unknown: "x" })).toEqual({ amount: 42.25 });
    expect(sanitizeSelectionPreferences("focus", { range: .375, noise: .125, mode: "intersect", sampleAllLayers: false })).toEqual({ range: .375, noise: .125, mode: "intersect", sampleAllLayers: false });
    expect(sanitizeSelectionPreferences("color", { midLow: 170, midHigh: 90, range: 1e30, toneFuzziness: 20 })).toEqual({ toneFuzziness: 20 });
  });
  it.each(['{broken', JSON.stringify({ schemaVersion: 2, workflows: { refine: { options: { radius: 10 } } } }), JSON.stringify({ schemaVersion: 1, workflows: [] }), "x".repeat(17000)])("preserves unreadable/newer preferences without overwrite", raw => {
    localStorage.setItem(SELECTION_PREFERENCES_KEY, raw); const value = readSelectionPreferences();
    expect(value.writable).toBe(false); expect(value.notice).toContain("could not be read");
    expect(saveSelectionPreferences("refine", true, { radius: 5 }, "mask", 30)).toContain("could not be read"); expect(localStorage.getItem(SELECTION_PREFERENCES_KEY)).toBe(raw);
  });
  it("reports denied storage and recovers without changing remembered native options", () => {
    saveSelectionPreferences("refine", true, { radius: 3 }, "mask", 30);
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    expect(saveSelectionPreferences("refine", true, { radius: 5 }, "mask", 30)).toContain("was applied");
    expect(readSelectionPreferences().workflows.refine?.options.radius).toBe(3);
    expect(saveSelectionPreferences("refine", true, { radius: 5 }, "mask", 30)).toBeNull(); expect(readSelectionPreferences().workflows.refine?.options.radius).toBe(5);
  });
});
