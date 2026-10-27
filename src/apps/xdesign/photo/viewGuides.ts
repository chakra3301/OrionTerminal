import { create } from "zustand";
import { usePreferences, unitsPerPixel, type Preferences } from "./preferences";

/*
 * View aids (rulers, grid, guides, Extras, Snap) are frontend state for the session only: the engine catalogue marks
 * view.newGuide / moveGuide / deleteGuide / clearGuides / newGuideLayout / newGuidesFromShape as pending, so guides are
 * NOT saved into the file. The guide actions below are named after those commands so engine-backed guides can replace
 * the store's `documents` map later without touching the overlay or the dialogs.
 */

/** "h" is a horizontal line at y = pos, "v" a vertical line at x = pos; positions are document pixels. */
export type GuideAxis = "h" | "v";
export type Guide = { id: number; axis: GuideAxis; pos: number };
export type SnapTargets = { guides: boolean; grid: boolean; layers: boolean; bounds: boolean };
export type ViewFlags = { rulers: boolean; grid: boolean; extras: boolean; guides: boolean; layerEdges: boolean; selectionEdges: boolean; targetPath: boolean; smartGuides: boolean; pixelGrid: boolean; lockGuides: boolean; snap: boolean; snapTo: SnapTargets };
export type GuideDialog = "new" | "layout" | null;

export const RULER_SIZE = 18;
/** Screen pixels within which Snap pulls a value onto a target. */
export const SNAP_PX = 6;

export const DEFAULT_FLAGS: ViewFlags = { rulers: false, grid: false, extras: true, guides: true, layerEdges: false, selectionEdges: true, targetPath: true, smartGuides: true, pixelGrid: true, lockGuides: false, snap: true, snapTo: { guides: true, grid: true, layers: true, bounds: true } };

type Store = {
  flags: ViewFlags;
  documents: Record<string, Guide[]>;
  dialog: GuideDialog;
  next: number;
  setFlags: (patch: Partial<ViewFlags>) => void;
  setSnapTo: (patch: Partial<SnapTargets>) => void;
  setDialog: (dialog: GuideDialog) => void;
  newGuide: (document: string, axis: GuideAxis, pos: number) => number;
  moveGuide: (document: string, id: number, pos: number) => void;
  deleteGuide: (document: string, id: number) => void;
  clearGuides: (document: string) => void;
  clearArtboardGuides: (document: string, artboard: Rect) => void;
  /** Canvas guides are those inside none of the artboards; with no artboards every guide is one. */
  clearCanvasGuides: (document: string, artboards: Rect[]) => void;
  /** Adds many guides at once, dropping duplicates; `clear` first empties the document (New Guide Layout's Clear Existing Guides). */
  addGuides: (document: string, guides: Omit<Guide, "id">[], clear?: boolean) => void;
};

const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
type Rect = readonly [number, number, number, number];
/** The engine's rule: a guide belongs to an artboard when it lies strictly between the artboard's edges on its own axis. */
const inside = (guide: Guide, [x, y, w, h]: Rect) => guide.axis === "v" ? guide.pos > x && guide.pos < x + w : guide.pos > y && guide.pos < y + h;

export const useViewAids = create<Store>((set, get) => ({
  flags: DEFAULT_FLAGS,
  documents: {},
  dialog: null,
  next: 1,
  setFlags: patch => set(state => ({ flags: { ...state.flags, ...patch } })),
  setSnapTo: patch => set(state => ({ flags: { ...state.flags, snapTo: { ...state.flags.snapTo, ...patch } } })),
  setDialog: dialog => set({ dialog }),
  newGuide: (document, axis, pos) => {
    const id = get().next;
    set(state => ({ next: id + 1, documents: { ...state.documents, [document]: [...(state.documents[document] ?? []), { id, axis, pos }] } }));
    return id;
  },
  moveGuide: (document, id, pos) => set(state => ({ documents: { ...state.documents, [document]: (state.documents[document] ?? []).map(guide => guide.id === id ? { ...guide, pos } : guide) } })),
  deleteGuide: (document, id) => set(state => ({ documents: { ...state.documents, [document]: (state.documents[document] ?? []).filter(guide => guide.id !== id) } })),
  clearGuides: document => set(state => ({ documents: { ...state.documents, [document]: [] } })),
  clearArtboardGuides: (document, artboard) => set(state => ({ documents: { ...state.documents, [document]: (state.documents[document] ?? []).filter(guide => !inside(guide, artboard)) } })),
  clearCanvasGuides: (document, artboards) => set(state => ({ documents: { ...state.documents, [document]: (state.documents[document] ?? []).filter(guide => artboards.some(rect => inside(guide, rect))) } })),
  addGuides: (document, guides, clear = false) => {
    let next = get().next;
    const list = clear ? [] : [...(get().documents[document] ?? [])];
    for (const guide of guides) if (!list.some(existing => existing.axis === guide.axis && same(existing.pos, guide.pos))) list.push({ id: next++, ...guide });
    set(state => ({ next, documents: { ...state.documents, [document]: list } }));
  },
}));

const NO_GUIDES: Guide[] = [];
export const documentGuides = (document: string) => useViewAids.getState().documents[document] ?? NO_GUIDES;

/** Extras is the master switch: hidden Extras hide the grid, guides and selection edges whatever their own checkmarks say. */
export const gridVisible = (flags: ViewFlags) => flags.extras && flags.grid;
export const guidesVisible = (flags: ViewFlags) => flags.extras && flags.guides;
export const selectionEdgesVisible = (flags: ViewFlags) => flags.extras && flags.selectionEdges;
export const targetPathVisible = (flags: ViewFlags) => flags.extras && flags.targetPath;
export const layerEdgesVisible = (flags: ViewFlags) => flags.extras && flags.layerEdges;
/** Photoshop draws the pixel grid only past 500%. */
export const pixelGridVisible = (flags: ViewFlags, zoom: number) => flags.extras && flags.pixelGrid && zoom > 5;

// ---- Rulers ----

const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
/** Minimum screen pixels between two numbered ruler ticks. */
const LABEL_PX = 56;

export type Tick = { pos: number; level: 0 | 1 | 2; label?: string };

/** Interval between numbered ticks: the smallest "nice" number of at least `min` that leaves LABEL_PX on screen, so labels thin out as you zoom out. */
export function rulerStep(zoom: number, min = 1): number {
  return NICE.find(step => step >= min && step * zoom >= LABEL_PX) ?? NICE[NICE.length - 1]!;
}

/** Ticks between document positions `from` and `to`, labelled in the ruler unit, `scale` of which span one document
 *  pixel: level 0 is numbered, 1 a half step, 2 a tenth of a step (only when at least 5 screen pixels apart). Pixel
 *  rulers never tick between pixels. */
export function rulerTicks(from: number, to: number, zoom: number, scale = 1): Tick[] {
  const min = scale === 1 ? 1 : 0, unitZoom = zoom / scale, step = rulerStep(unitZoom, min);
  const tenth = step / 10 >= min && (step / 10) * unitZoom >= 5, half = step / 2 >= min && (step / 2) * unitZoom >= 5;
  const unit = tenth ? step / 10 : half ? step / 2 : step;
  const ticks: Tick[] = [];
  for (let i = Math.floor(from * scale / unit); i * unit <= to * scale && ticks.length < 5000; i++) {
    const at = i * unit, pos = at / scale, onStep = same(at / step, Math.round(at / step));
    ticks.push(onStep ? { pos, level: 0, label: String(Math.round(at * 100) / 100) } : tenth && !same(at / (step / 2), Math.round(at / (step / 2))) ? { pos, level: 2 } : { pos, level: 1 });
  }
  return ticks;
}

// ---- Grid ----

export type GridSteps = { major: number; minor: number | null };

/** Gridline spacing in document pixels at this zoom, from Preferences › Guides, Grid & Slices (one inch in 4 by
 *  default); lines thin out so they never sit closer than 8 (major) or 4 (minor) screen pixels. */
export function gridSteps(zoom: number, resolution = 72, preferences: Pick<Preferences, "grid" | "pointSize"> = usePreferences.getState()): GridSteps {
  const { every, unit, subdivisions } = preferences.grid;
  let major = every / unitsPerPixel(unit, resolution, preferences.pointSize);
  if (!(major > 0) || !Number.isFinite(major)) major = resolution > 0 ? resolution : 72;
  while (major * zoom < 8) major *= 2;
  const minor = subdivisions > 1 ? major / subdivisions : null;
  return { major, minor: minor !== null && minor * zoom >= 4 ? minor : null };
}

// ---- Snapping ----

export type SnapContext = { width: number; height: number; guides: readonly Guide[]; grid: GridSteps | null; bounds: boolean; zoom: number };

/** Pulls `value` onto the nearest target on this axis within SNAP_PX screen pixels; returns it unchanged when none is close. */
export function snapValue(axis: GuideAxis, value: number, ctx: SnapContext, exclude?: number): number {
  const reach = SNAP_PX / ctx.zoom, targets: number[] = [];
  for (const guide of ctx.guides) if (guide.axis === axis && guide.id !== exclude) targets.push(guide.pos);
  if (ctx.bounds) targets.push(0, axis === "v" ? ctx.width : ctx.height);
  if (ctx.grid) { const step = ctx.grid.minor ?? ctx.grid.major; targets.push(Math.round(value / step) * step); }
  let best = value, distance = reach;
  for (const target of targets) { const gap = Math.abs(target - value); if (gap <= distance) { best = target; distance = gap; } }
  return best;
}

/** The snap context for a document, or null while Snap is off. Guides and grid only count as targets while they are visible. */
export function snapContext(document: string, width: number, height: number, zoom: number, resolution = 72): SnapContext | null {
  const { flags } = useViewAids.getState();
  if (!flags.snap) return null;
  const { snapTo } = flags;
  if (!snapTo.guides && !snapTo.grid && !snapTo.bounds) return null;
  return { width, height, zoom, guides: snapTo.guides && guidesVisible(flags) ? documentGuides(document) : NO_GUIDES, grid: snapTo.grid && gridVisible(flags) ? gridSteps(zoom, resolution) : null, bounds: snapTo.bounds };
}

/** Snaps an x/y pair in place of the pointer's document position. */
export function snapXY(ctx: SnapContext | null, x: number, y: number): [number, number] {
  return ctx ? [snapValue("v", x, ctx), snapValue("h", y, ctx)] : [x, y];
}

type Box = { x: number; y: number; width: number; height: number };

/** Snaps the edges of a crop box that moved since `from`. A pure move keeps its size and snaps whichever edge is closer to a target. */
export function snapBox(ctx: SnapContext | null, box: Box, from: Box): Box {
  if (!ctx) return box;
  const axis = (axisName: GuideAxis, start: number, size: number, fromStart: number, fromSize: number): [number, number] => {
    const end = start + size;
    if (size === fromSize) {
      if (start === fromStart) return [start, size];
      const a = snapValue(axisName, start, ctx), b = snapValue(axisName, end, ctx);
      const shift = a !== start && (b === end || Math.abs(a - start) <= Math.abs(b - end)) ? a - start : b !== end ? b - end : 0;
      return [start + shift, size];
    }
    const s = start === fromStart ? start : snapValue(axisName, start, ctx), e = end === fromStart + fromSize ? end : snapValue(axisName, end, ctx);
    return [s, Math.max(1, e - s)];
  };
  const [x, width] = axis("v", box.x, box.width, from.x, from.width), [y, height] = axis("h", box.y, box.height, from.y, from.height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// ---- Move snapping and Smart Guides ----

export type MoveTargets = { v: number[]; h: number[] };
export type MoveSnap = { dx: number; dy: number; lines: { axis: GuideAxis; pos: number }[] };

/** Edges and centres of boxes, as the lines a moving box's own edges and centre can meet. */
export function boxTargets(boxes: readonly Rect[], lines: readonly Guide[] = []): MoveTargets {
  const targets: MoveTargets = { v: [], h: [] };
  for (const [x, y, w, h] of boxes) { targets.v.push(x, x + w / 2, x + w); targets.h.push(y, y + h / 2, y + h); }
  for (const guide of lines) targets[guide.axis].push(guide.pos);
  return targets;
}

/** Pulls a box moved by dx, dy so its nearest edge or centre lands on a target within `reach` document pixels, per axis; lines are the targets it then meets. */
export function snapMove([x, y, w, h]: Rect, dx: number, dy: number, targets: MoveTargets, reach: number): MoveSnap {
  const axis = (start: number, size: number, delta: number, list: readonly number[]) => {
    let moved = Math.round(delta), best = reach;
    for (const feature of [start + delta, start + delta + size / 2, start + delta + size])
      for (const target of list) { const gap = Math.abs(target - feature); if (gap <= best) { best = gap; moved = Math.round(delta + target - feature); } }
    const met = [start + moved, start + moved + size / 2, start + moved + size];
    return { moved, lines: [...new Set(list.filter(target => met.some(feature => Math.abs(target - feature) < .5)))] };
  };
  const across = axis(x, w, dx, targets.v), down = axis(y, h, dy, targets.h);
  return { dx: across.moved, dy: down.moved, lines: [...across.lines.map(pos => ({ axis: "v" as const, pos })), ...down.lines.map(pos => ({ axis: "h" as const, pos }))] };
}

// ---- New Guide Layout ----

export type LayoutAxis = { number: number; size: number; gutter: number };
export type GuideLayout = { columns: LayoutAxis; rows: LayoutAxis; margin: { top: number; left: number; bottom: number; right: number }; center: boolean; clear: boolean };

export const EMPTY_LAYOUT: GuideLayout = { columns: { number: 0, size: 0, gutter: 0 }, rows: { number: 0, size: 0, gutter: 0 }, margin: { top: 0, left: 0, bottom: 0, right: 0 }, center: false, clear: false };

/** Positions along one axis: a guide at each edge of every column (or row), plus the margins. A size of 0 means "fit the space"; Center keeps a fixed size block centred in the margins. */
function layoutLines(extent: number, lead: number, trail: number, axis: LayoutAxis, center: boolean): number[] {
  const lines: number[] = [];
  if (lead > 0) lines.push(lead);
  if (trail > 0) lines.push(extent - trail);
  const room = extent - lead - trail, count = Math.floor(axis.number);
  if (count > 0 && room > 0) {
    const size = axis.size > 0 ? axis.size : (room - (count - 1) * axis.gutter) / count;
    const total = count * size + (count - 1) * axis.gutter, start = lead + (center && axis.size > 0 ? (room - total) / 2 : 0);
    for (let i = 0; i < count; i++) lines.push(start + i * (size + axis.gutter), start + i * (size + axis.gutter) + size);
  }
  return lines.map(line => Math.round(line * 100) / 100);
}

export function layoutGuides(layout: GuideLayout, width: number, height: number): Omit<Guide, "id">[] {
  const { margin } = layout;
  return [
    ...layoutLines(width, margin.left, margin.right, layout.columns, layout.center).map(pos => ({ axis: "v" as const, pos })),
    ...layoutLines(height, margin.top, margin.bottom, layout.rows, layout.center).map(pos => ({ axis: "h" as const, pos })),
  ];
}

/** New Guides From Shape: guides on the four edges of a layer's [x, y, width, height] bounds. */
export function shapeGuides(bounds: readonly number[]): Omit<Guide, "id">[] {
  const [x, y, width, height] = bounds as [number, number, number, number];
  return [{ axis: "v", pos: x }, { axis: "v", pos: x + width }, { axis: "h", pos: y }, { axis: "h", pos: y + height }];
}
