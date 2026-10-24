import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, gridSteps, gridVisible, guidesVisible, layoutGuides, EMPTY_LAYOUT, rulerStep, rulerTicks, shapeGuides, snapBox, snapContext, snapValue, snapXY, useViewAids, type SnapContext } from "./viewGuides";

const ctx = (patch: Partial<SnapContext> = {}): SnapContext => ({ width: 800, height: 600, zoom: 1, guides: [], grid: null, bounds: false, ...patch });

beforeEach(() => useViewAids.setState({ flags: DEFAULT_FLAGS, documents: {}, dialog: null, next: 1 }));

describe("ruler ticks", () => {
  it("widens the numbered interval as the view zooms out", () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(4)).toBe(20);
    expect(rulerStep(16)).toBe(5);
    expect(rulerStep(0.1)).toBe(1000);
  });
  it("numbers whole steps and adds half and tenth ticks only when they are spaced out", () => {
    const ticks = rulerTicks(0, 200, 1);
    expect(ticks.filter(tick => tick.level === 0).map(tick => tick.label)).toEqual(["0", "100", "200"]);
    expect(ticks.find(tick => tick.pos === 50)?.level).toBe(1);
    expect(ticks.find(tick => tick.pos === 10)?.level).toBe(2);
    expect(rulerTicks(0, 20, 16).some(tick => tick.level === 2)).toBe(false);
  });
  it("starts from the first tick at or after the visible start, including negative positions", () => {
    expect(rulerTicks(-130, -90, 1).filter(tick => tick.level === 0).map(tick => tick.label)).toEqual(["-100"]);
  });
});

describe("grid", () => {
  it("defaults to one inch with four subdivisions, in document pixels", () => {
    expect(gridSteps(1, 72)).toEqual({ major: 72, minor: 18 });
    expect(gridSteps(1, 300)).toEqual({ major: 300, minor: 75 });
  });
  it("drops subdivisions and doubles the spacing when lines would crowd", () => {
    expect(gridSteps(0.1, 72).minor).toBeNull();
    expect(gridSteps(0.05, 72).major).toBe(288);
  });
});

describe("snapping", () => {
  it("snaps to a guide only within the screen-pixel reach, scaled by zoom", () => {
    const c = ctx({ guides: [{ id: 1, axis: "v", pos: 100 }] });
    expect(snapValue("v", 104, c)).toBe(100);
    expect(snapValue("v", 110, c)).toBe(110);
    expect(snapValue("h", 101, c)).toBe(101);
    expect(snapValue("v", 101.5, { ...c, zoom: 4 })).toBe(100);
    expect(snapValue("v", 103, { ...c, zoom: 4 })).toBe(103);
  });
  it("ignores the excluded guide so a dragged guide does not snap to itself", () => {
    expect(snapValue("v", 101, ctx({ guides: [{ id: 7, axis: "v", pos: 100 }] }), 7)).toBe(101);
  });
  it("snaps to document bounds and grid lines, preferring the nearest", () => {
    expect(snapValue("v", 797, ctx({ bounds: true }))).toBe(800);
    expect(snapValue("h", 3, ctx({ bounds: true }))).toBe(0);
    expect(snapValue("v", 20, ctx({ grid: { major: 72, minor: 18 } }))).toBe(18);
    expect(snapValue("v", 17, ctx({ grid: { major: 72, minor: 18 }, guides: [{ id: 1, axis: "v", pos: 15 }] }))).toBe(18);
  });
  it("builds the context from the toggles and only counts visible guides and grid", () => {
    const aids = useViewAids.getState();
    aids.newGuide("d", "v", 50);
    expect(snapContext("d", 800, 600, 1)?.guides).toHaveLength(1);
    expect(snapContext("d", 800, 600, 1)?.grid).toBeNull();
    aids.setFlags({ grid: true });
    expect(snapContext("d", 800, 600, 1)?.grid).not.toBeNull();
    aids.setFlags({ extras: false });
    expect(snapContext("d", 800, 600, 1)?.guides).toHaveLength(0);
    expect(snapContext("d", 800, 600, 1)?.grid).toBeNull();
    aids.setSnapTo({ guides: false, grid: false, bounds: false });
    expect(snapContext("d", 800, 600, 1)).toBeNull();
    aids.setSnapTo({ bounds: true }); aids.setFlags({ snap: false });
    expect(snapContext("d", 800, 600, 1)).toBeNull();
    expect(snapXY(null, 3, 4)).toEqual([3, 4]);
  });
  it("snaps crop box edges: resize snaps the moved edge, move snaps the nearer edge and keeps the size", () => {
    const c = ctx({ bounds: true });
    const from = { x: 10, y: 10, width: 100, height: 100 };
    expect(snapBox(c, { x: 3, y: 10, width: 107, height: 100 }, from)).toEqual({ x: 0, y: 10, width: 110, height: 100 });
    expect(snapBox(c, { x: 695, y: 10, width: 100, height: 100 }, from)).toEqual({ x: 700, y: 10, width: 100, height: 100 });
    expect(snapBox(c, { x: 50, y: 50, width: 100, height: 100 }, from)).toEqual({ x: 50, y: 50, width: 100, height: 100 });
    expect(snapBox(null, { x: 3, y: 3, width: 1, height: 1 }, from)).toEqual({ x: 3, y: 3, width: 1, height: 1 });
  });
});

describe("guide state", () => {
  it("adds, moves, deletes and clears per document", () => {
    const aids = useViewAids.getState();
    const a = aids.newGuide("one", "h", 10); aids.newGuide("two", "v", 5);
    aids.moveGuide("one", a, 40);
    expect(useViewAids.getState().documents.one).toEqual([{ id: a, axis: "h", pos: 40 }]);
    aids.deleteGuide("one", a);
    expect(useViewAids.getState().documents.one).toEqual([]);
    expect(useViewAids.getState().documents.two).toHaveLength(1);
    aids.clearGuides("two");
    expect(useViewAids.getState().documents.two).toEqual([]);
  });
  it("Extras is the master switch for grid and guides", () => {
    expect(gridVisible({ ...DEFAULT_FLAGS, grid: true })).toBe(true);
    expect(gridVisible({ ...DEFAULT_FLAGS, grid: true, extras: false })).toBe(false);
    expect(guidesVisible({ ...DEFAULT_FLAGS, extras: false })).toBe(false);
  });
});

describe("guide layouts", () => {
  it("fits columns into the margins when no width is given", () => {
    const guides = layoutGuides({ ...EMPTY_LAYOUT, columns: { number: 2, size: 0, gutter: 20 }, margin: { top: 0, left: 10, bottom: 0, right: 10 } }, 800, 600);
    expect(guides.map(g => g.pos).sort((a, b) => a - b)).toEqual([10, 10, 390, 410, 790, 790]);
    expect(guides.every(g => g.axis === "v")).toBe(true);
  });
  it("centres fixed-width columns and builds rows", () => {
    const columns = layoutGuides({ ...EMPTY_LAYOUT, columns: { number: 2, size: 100, gutter: 0 }, center: true }, 800, 600);
    expect(columns.map(g => g.pos)).toEqual([300, 400, 400, 500]);
    const rows = layoutGuides({ ...EMPTY_LAYOUT, rows: { number: 3, size: 0, gutter: 0 } }, 800, 600);
    expect(rows.filter(g => g.axis === "h").map(g => g.pos)).toEqual([0, 200, 200, 400, 400, 600]);
  });
  it("de-duplicates when added and honours Clear Existing Guides", () => {
    const aids = useViewAids.getState();
    aids.newGuide("d", "v", 400);
    aids.addGuides("d", layoutGuides({ ...EMPTY_LAYOUT, columns: { number: 2, size: 0, gutter: 0 } }, 800, 600));
    expect(useViewAids.getState().documents.d!.filter(g => g.pos === 400)).toHaveLength(1);
    aids.addGuides("d", [{ axis: "h", pos: 1 }], true);
    expect(useViewAids.getState().documents.d).toHaveLength(1);
  });
  it("puts shape guides on the four edges of [x, y, width, height]", () => {
    expect(shapeGuides([10, 20, 30, 40])).toEqual([{ axis: "v", pos: 10 }, { axis: "v", pos: 40 }, { axis: "h", pos: 20 }, { axis: "h", pos: 60 }]);
  });
});
