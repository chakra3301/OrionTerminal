import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SHAPE_STYLE } from "./shapeStyle";
import { DEFAULT_VECTOR_TOOL_OPTIONS, VECTOR_TOOL_PREFERENCES_KEY, sanitizeVectorToolOptions, useVectorToolPreferences } from "./vectorToolPreferences";

let container: HTMLDivElement, root: Root, preferences: ReturnType<typeof useVectorToolPreferences>;
function Harness() { preferences = useVectorToolPreferences(); return <span>{preferences.notice}</span>; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.removeItem(VECTOR_TOOL_PREFERENCES_KEY); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<Harness/>));
const remount = async () => { await act(async () => root.unmount()); root = createRoot(container); await mount(); };

it("starts from Photoshop's defaults and keeps the shape tools' old ones", () => {
  expect(DEFAULT_VECTOR_TOOL_OPTIONS).toMatchObject({ shapeStyle: DEFAULT_SHAPE_STYLE, shapeMode: "shape", penMode: "path", pathOp: "new", radii: [0, 0, 0, 0], radiiLinked: true, polygonSides: 5, starRatio: 100, lineWeight: 4, rubberBand: false, autoAddDelete: true, curveFit: 2, magnetic: false, magneticWidth: 10, magneticContrast: 10, magneticFrequency: 57, magneticPressure: false, selectScope: "active", alignTo: "selection", sizeLinked: false, constraint: { kind: "unconstrained", width: 100, height: 100, fromCenter: false }, pixelMode: "Normal", pixelOpacity: 100, pixelAntiAlias: true });
});
it("sanitises stale and out-of-range values field by field", () => {
  expect(sanitizeVectorToolOptions({ shapeMode: "bitmap", penMode: "pixels", pixelMode: "Glow", pixelOpacity: 0, pixelAntiAlias: "yes", pathOp: "merge", radii: [4, -1, "x", 20000], polygonSides: 2.6, starRatio: 0, lineWeight: 5000, curveFit: 20, magneticWidth: 0, magneticFrequency: 101, selectScope: "everything", alignTo: "page", sizeLinked: 1, constraint: { kind: "circle", width: -5, height: 30, fromCenter: "yes" }, shapeStyle: { fill: false, strokeWidth: 3 } }))
    .toEqual({ ...DEFAULT_VECTOR_TOOL_OPTIONS, pixelOpacity: 1, radii: [4, 0, 0, 10000], polygonSides: 3, starRatio: 1, lineWeight: 1000, curveFit: 10, magneticWidth: 1, magneticFrequency: 100, constraint: { kind: "unconstrained", width: 1, height: 30, fromCenter: false }, shapeStyle: { ...DEFAULT_SHAPE_STYLE, fill: false } });
  expect(sanitizeVectorToolOptions("junk")).toEqual(DEFAULT_VECTOR_TOOL_OPTIONS);
  expect(sanitizeVectorToolOptions({ shapeMode: "pixels", pixelMode: "Behind", pixelOpacity: 40.5 })).toMatchObject({ shapeMode: "pixels", pixelMode: "Behind", pixelOpacity: 41 });
});
it("persists a change across a relaunch", async () => {
  await mount(); expect(localStorage.getItem(VECTOR_TOOL_PREFERENCES_KEY)).toBeNull();
  await act(async () => preferences.setOption("shapeStyle", style => ({ ...style, stroke: true, align: "outside" })));
  await act(async () => preferences.setOption("curveFit", 4.5));
  await remount(); expect(preferences.options.shapeStyle).toMatchObject({ stroke: true, align: "outside" }); expect(preferences.options.curveFit).toBe(4.5); expect(preferences.notice).toBeNull();
});
it.each(["invalid JSON", JSON.stringify({ schemaVersion: 2, options: {} }), JSON.stringify({ schemaVersion: 1, options: [] }), " ".repeat(51 * 1024)])("keeps unreadable saved data and lets this session edit", async raw => {
  localStorage.setItem(VECTOR_TOOL_PREFERENCES_KEY, raw); await mount(); expect(preferences.options).toEqual(DEFAULT_VECTOR_TOOL_OPTIONS); expect(container.textContent).toContain("could not be read");
  await act(async () => preferences.setOption("lineWeight", 9)); expect(preferences.options.lineWeight).toBe(9); expect(localStorage.getItem(VECTOR_TOOL_PREFERENCES_KEY)).toBe(raw);
});
it("keeps session edits when storage is full", async () => {
  await mount(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  await act(async () => preferences.setOption("polygonSides", 8)); expect(preferences.options.polygonSides).toBe(8); expect(container.textContent).toContain("could not be saved");
});
