import { describe, expect, it } from "vitest";
import { SELECT_AND_MASK_TOOLS, brushSelectionParams, historyId, quickSelectionParams, selectAndMaskFold, selectAndMaskRevert, strokeMode } from "./selectAndMask";
import type { PhotoState } from "./types";

// At the History limit every new step keeps the current index (50) and drops the oldest state.
const at = (id: string | null) => ({ historySources: id === null ? undefined : [{ id: "open", index: 49, label: "Open", current: false, available: true }, { id, index: 50, label: "Edit", current: true, available: true }] }) as PhotoState;
describe("Select and Mask workspace tools", () => {
  it("lists Photoshop's Quick Selection, Refine Edge Brush and Brush", () => {
    expect(SELECT_AND_MASK_TOOLS.map(tool => [tool.id, tool.label])).toEqual([["quick", "Quick Selection Tool"], ["edge", "Refine Edge Brush Tool"], ["brush", "Brush Tool"]]);
  });
  it("paints Brush Tool strokes with the native size, hardness and mode, sampling no layers", () => {
    expect(brushSelectionParams([[1, 2], [3, 4]], 20, 50, "subtract")).toEqual({ points: [[1, 2], [3, 4]], size: 20, hardness: 50, mode: "subtract" });
  });
  it("adds or subtracts Quick Selection strokes, Alt flipping the chosen mode, with the native size and sample choice", () => {
    expect([strokeMode("add", false), strokeMode("add", true), strokeMode("subtract", false), strokeMode("subtract", true)]).toEqual(["add", "subtract", "subtract", "add"]);
    expect(quickSelectionParams([[1, 2], [3, 4]], 12, "subtract", true)).toEqual({ points: [[1, 2], [3, 4]], size: 12, mode: "subtract", sampleAllLayers: true });
  });
  it("folds in-dialog edits into one Select and Mask step, or rolls them back, by the opening state's snapshot", () => {
    expect([historyId(at("b")), historyId(at(null)), historyId(null)]).toEqual(["b", null, null]);
    expect(selectAndMaskFold("base", at("later"), true)).toEqual(["history.fold", { fromId: "base", label: "Select and Mask" }]);
    expect(selectAndMaskFold("base", at("later"), false)).toBeNull();
    expect(selectAndMaskFold("base", at("base"), true)).toBeNull();
    expect(selectAndMaskFold(null, at("later"), true)).toBeNull();
    expect(selectAndMaskRevert("base", at("later"), true)).toEqual(["history.select", { id: "base", discardRedo: true }]);
    expect(selectAndMaskRevert("base", at("base"), true)).toBeNull();
    expect(selectAndMaskRevert("base", at("later"), false)).toBeNull();
    expect(selectAndMaskRevert(null, at(null), true)).toBeNull();
  });
});
