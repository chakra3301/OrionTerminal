import { describe, expect, it } from "vitest";
import { gestureRectangle, polygonPoint, selectionGestureCommand, selectionGestureMode } from "./selectionGesture";
import { paintToolDefaults } from "./PaintToolOptions";

const none = { shiftKey: false, altKey: false };
describe("Image selection geometry and native requests", () => {
  it("uses only the reference endpoints for image/layer straightening and rejects short or invalid lines", () => {
    const points = [[10.25, 14.5, .8], [22, 9, .6], [40.5, 18.75, 1]];
    expect(selectionGestureCommand("straighten", points, {}, "subtract", none, none)).toEqual({ id: "image.analysis.straightenLayer", params: { start: [10.25, 14.5], end: [40.5, 18.75], crop: true } });
    expect(selectionGestureCommand("straighten", points, { scope: "layers" }, "intersect", none, none)?.params.crop).toBe(false);
    for (const points of [[[1, 1]], [[1, 1], [1.1, 1.1]], [[1, 1], [Infinity, 4]], [[0, 0], [2147483648, 1]]]) expect(selectionGestureCommand("straighten", points, {}, "replace", none, none)).toBeNull();
  });
  it("rounds endpoints once, including reverse and fractional drags", () => {
    expect(gestureRectangle([.49, 1.49], [10.51, 20.51], {}, none, none)).toEqual({ x: 0, y: 1, width: 11, height: 20 });
    expect(gestureRectangle([10.51, 20.51], [.49, 1.49], {}, none, none)).toEqual({ x: 0, y: 1, width: 11, height: 20 });
  });
  it.each([[1, 1], [1, -1], [-1, 1], [-1, -1]])("keeps ratio and centered bounds in quadrant %s %s", (x, y) => {
    const rect = gestureRectangle([100, 100], [100 + x * 40, 100 + y * 10], { style: "fixedRatio", ratioWidth: 2, ratioHeight: 1 }, none, none)!;
    expect(rect.width).toBe(40); expect(rect.height).toBe(20); expect(rect.x).toBe(x < 0 ? 60 : 100); expect(rect.y).toBe(y < 0 ? 80 : 100);
    expect(gestureRectangle([100, 100], [100 + x * 40, 100 + y * 10], { style: "fixedRatio", ratioWidth: 2, ratioHeight: 1, fromCenter: true }, none, none)).toEqual({ x: 60, y: 80, width: 80, height: 40 });
  });
  it("uses initial modifiers for combination and later modifiers for geometry", () => {
    expect(selectionGestureMode("replace", { shiftKey: true, altKey: true }, "select.rect")).toBe("intersect");
    expect(selectionGestureMode("replace", { shiftKey: true, altKey: false }, "select.lasso")).toBe("add");
    expect(selectionGestureMode("add", { shiftKey: false, altKey: true }, "select.magicWand")).toBe("subtract");
    expect(gestureRectangle([20, 30], [40, 35], {}, none, { shiftKey: true, altKey: true })).toEqual({ x: 0, y: 10, width: 40, height: 40 });
    expect(gestureRectangle([20, 30], [40, 35], {}, { shiftKey: true, altKey: true }, { shiftKey: true, altKey: true })).toEqual({ x: 20, y: 30, width: 20, height: 5 });
    expect(selectionGestureMode("intersect", none, "select.quick")).toBe("replace");
    expect(selectionGestureMode("replace", { shiftKey: true, altKey: true }, "select.quick")).toBe("subtract");
  });
  it("supports click placement of a fixed area and centered fixed size", () => {
    const options = { style: "fixedSize", fixedWidth: 21, fixedHeight: 11 };
    expect(gestureRectangle([50, 50], [50, 50], options, none, none)).toEqual({ x: 50, y: 50, width: 21, height: 11 });
    expect(gestureRectangle([50, 50], [10, 10], { ...options, fromCenter: true }, none, none)).toEqual({ x: 40, y: 45, width: 21, height: 11 });
  });
  it("refuses invalid, empty, overflowing or over-limit crop requests", () => {
    for (const last of [[20, 10], [NaN, 5], [Infinity, 2], [2147483648, 20]]) expect(gestureRectangle([20, 10], last, {}, none, none)).toBeNull();
    expect(gestureRectangle([2147483600, 10], [2147483640, 20], {}, none, none)).toBeNull();
    expect(gestureRectangle([20, 10], [30, 20], { style: "fixedRatio", ratioWidth: 0, ratioHeight: 0 }, none, none)).toBeNull();
    expect(selectionGestureCommand("crop", [[0, 0]], { style: "fixedSize", fixedWidth: 100000, fixedHeight: 100000 }, "replace", none, none)).toBeNull();
  });
  it("sends only supported native geometry/edge/combination fields", () => {
    expect(selectionGestureCommand("ellipseSelection", [[20, 25, .7], [40, 45, .5]], { ...paintToolDefaults("ellipseSelection", null), feather: 2.5, antiAlias: false }, "intersect", none, none)).toEqual({ id: "select.rect", params: { x: 20, y: 25, width: 20, height: 20, ellipse: true, feather: 2.5, antiAlias: false, mode: "intersect" } });
    expect(selectionGestureCommand("select.object", [[40, 45], [20, 25]], { sampleAllLayers: true }, "add", none, none)).toEqual({ id: "select.object", params: { rect: [20, 25, 20, 20], mode: "add", sampleAllLayers: true } });
    expect(selectionGestureCommand("crop", [[20, 25], [40, 45]], { deleteCroppedPixels: true }, "replace", none, none)).toEqual({ id: "image.crop", params: { x: 20, y: 25, width: 20, height: 20, deleteCroppedPixels: true } });
    expect(selectionGestureCommand("select.quick", [[20, 25, .7, 0], [40, 45, .5, 0]], { size: 18, enhanceEdge: true, sampleAllLayers: true }, "subtract", none, none)).toEqual({ id: "select.quick", params: { points: [[20, 25], [40, 45]], size: 18, mode: "subtract", enhanceEdge: true, sampleAllLayers: true } });
    expect(selectionGestureCommand("polygonLasso", [[10, 10], [40, 10], [40, 40]], { feather: 3 }, "add", none, none)).toEqual({ id: "select.lasso", params: { points: [[10, 10], [40, 10], [40, 40]], feather: 3, antiAlias: true, mode: "add" } });
    expect(selectionGestureCommand("polygonLasso", [[10, 10], [40, 10]], {}, "replace", none, none)).toBeNull();
  });
  it("snaps polygon segments to 45 degrees without altering unsnapped input", () => {
    expect(polygonPoint([10, 10], [30, 14], false)).toEqual([30, 14]);
    const snapped = polygonPoint([10, 10], [30, 14], true); expect(snapped[1]).toBe(10); expect(Math.hypot(snapped[0] - 10, snapped[1] - 10)).toBeCloseTo(Math.hypot(20, 4));
  });
});
