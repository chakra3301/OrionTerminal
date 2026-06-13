import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useXDesign,
  collectDescendantIds,
  resolveShapeVars,
  type Shape,
  type ShapePatch,
  type Effect,
  type ShadowEffect,
  type LayerBlurEffect,
  type Gradient,
  type PathPoint,
} from "@/apps/xdesign/store";
import { XDesignImagePicker } from "@/apps/xdesign/ImagePicker";
import { localToWorld, worldToUnit } from "@/apps/xdesign/booleanOps";
import { computeAutoLayout, type LayoutOverrides } from "@/apps/xdesign/autoLayout";
import { setExportSvgRef } from "@/apps/xdesign/exportXD";
import type { Asset } from "@/store/assetsStore";

const MIN_DIM = 4;
const DEFAULT_FILL = "rgba(255, 62, 165, 0.18)";
const DEFAULT_STROKE = "rgba(255, 62, 165, 0.75)";
const TEXT_DEFAULT_W = 220;
const TEXT_DEFAULT_H = 36;
const HANDLE_SIZE = 8;

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type DraftRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "rect" | "ellipse" | "frame";
};

type DragOp =
  | {
      kind: "move";
      start: { x: number; y: number };
      startShapes: Map<string, { x: number; y: number }>;
    }
  | {
      kind: "rotate";
      /** Pivot for the rotation (single shape's center or multi-selection
       * bbox center, captured once at drag start). */
      pivot: { x: number; y: number };
      startAngleDeg: number;
      /** Per-shape starting state: original center and own rotation. The
       * group is rotated by replaying delta against these snapshots. */
      startShapes: Map<
        string,
        { cx: number; cy: number; rotation: number }
      >;
    }
  | {
      kind: "resize";
      handle: ResizeHandle;
      start: { x: number; y: number };
      startBbox: { x: number; y: number; w: number; h: number };
      /** Per-shape proportional position inside `startBbox`. We replay this
       * relative geometry against the live bbox each frame to compute each
       * shape's new position+size — works equally well for single and
       * multi-selection. */
      startShapes: Map<
        string,
        { relX: number; relY: number; relW: number; relH: number }
      >;
    }
  | {
      kind: "marquee";
      start: { x: number; y: number };
      current: { x: number; y: number };
      additive: boolean;
      baseSelection: Set<string>;
    }
  | {
      kind: "anchor";
      pathId: string;
      index: number;
      part: "point" | "cpIn" | "cpOut";
    };

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

const HANDLE_POSITIONS: Array<{ handle: ResizeHandle; xRatio: number; yRatio: number }> = [
  { handle: "nw", xRatio: 0, yRatio: 0 },
  { handle: "n",  xRatio: 0.5, yRatio: 0 },
  { handle: "ne", xRatio: 1, yRatio: 0 },
  { handle: "e",  xRatio: 1, yRatio: 0.5 },
  { handle: "se", xRatio: 1, yRatio: 1 },
  { handle: "s",  xRatio: 0.5, yRatio: 1 },
  { handle: "sw", xRatio: 0, yRatio: 1 },
  { handle: "w",  xRatio: 0, yRatio: 0.5 },
];

function applyResize(
  handle: ResizeHandle,
  start: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = start;
  // Horizontal
  if (handle === "nw" || handle === "w" || handle === "sw") {
    x = start.x + dx;
    w = start.w - dx;
  } else if (handle === "ne" || handle === "e" || handle === "se") {
    w = start.w + dx;
  }
  // Vertical
  if (handle === "nw" || handle === "n" || handle === "ne") {
    y = start.y + dy;
    h = start.h - dy;
  } else if (handle === "sw" || handle === "s" || handle === "se") {
    h = start.h + dy;
  }
  // Flip when sizes go negative — keep the bbox positive so downstream math
  // (and Inspector) doesn't break.
  if (w < 0) {
    x = x + w;
    w = -w;
  }
  if (h < 0) {
    y = y + h;
    h = -h;
  }
  return { x, y, w: Math.max(MIN_DIM, w), h: Math.max(MIN_DIM, h) };
}

function shapeIntersects(
  s: Shape,
  box: { x: number; y: number; w: number; h: number },
): boolean {
  const ax2 = s.x + s.w;
  const ay2 = s.y + s.h;
  const bx2 = box.x + box.w;
  const by2 = box.y + box.h;
  return s.x < bx2 && ax2 > box.x && s.y < by2 && ay2 > box.y;
}

/** Try to snap a moving bounding box to the edges/center of any non-moving
 * shape. Returns the dx/dy adjustment (in doc coords) and the guide-line
 * positions to draw. Threshold is in doc coords (callers translate from
 * screen pixels by dividing by zoom). */
function computeSnap(
  moving: { x: number; y: number; w: number; h: number },
  others: Shape[],
  threshold: number,
): {
  dx: number;
  dy: number;
  guideV: number | null;
  guideH: number | null;
} {
  const myX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const myY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestX: { dist: number; dx: number; at: number } | null = null;
  let bestY: { dist: number; dy: number; at: number } | null = null;

  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oys = [o.y, o.y + o.h / 2, o.y + o.h];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dx = oxs[j]! - myX[i]!;
        const adx = Math.abs(dx);
        if (adx <= threshold && (!bestX || adx < bestX.dist)) {
          bestX = { dist: adx, dx, at: oxs[j]! };
        }
        const dy = oys[j]! - myY[i]!;
        const ady = Math.abs(dy);
        if (ady <= threshold && (!bestY || ady < bestY.dist)) {
          bestY = { dist: ady, dy, at: oys[j]! };
        }
      }
    }
  }

  return {
    dx: bestX?.dx ?? 0,
    dy: bestY?.dy ?? 0,
    guideV: bestX?.at ?? null,
    guideH: bestY?.at ?? null,
  };
}

export function XDesignCanvas() {
  const shapes = useXDesign((s) => s.shapes);
  const selection = useXDesign((s) => s.selection);
  const tool = useXDesign((s) => s.tool);
  const viewport = useXDesign((s) => s.viewport);
  const addShape = useXDesign((s) => s.addShape);
  const updateShape = useXDesign((s) => s.updateShape);
  const select = useXDesign((s) => s.select);
  const selectMany = useXDesign((s) => s.selectMany);
  const toggleInSelection = useXDesign((s) => s.toggleInSelection);
  const clearSelection = useXDesign((s) => s.clearSelection);
  const deleteShapes = useXDesign((s) => s.deleteShapes);
  const setTool = useXDesign((s) => s.setTool);
  const patchMany = useXDesign((s) => s.patchMany);
  const pan = useXDesign((s) => s.pan);
  const zoomAt = useXDesign((s) => s.zoomAt);
  const resetViewport = useXDesign((s) => s.resetViewport);
  const pushHistory = useXDesign((s) => s.pushHistory);
  const undo = useXDesign((s) => s.undo);
  const redo = useXDesign((s) => s.redo);
  const copyShapes = useXDesign((s) => s.copy);
  const cutShapes = useXDesign((s) => s.cut);
  const pasteShapes = useXDesign((s) => s.paste);
  const duplicateShapes = useXDesign((s) => s.duplicate);
  const gridSnap = useXDesign((s) => s.gridSnap);
  const gridSize = useXDesign((s) => s.gridSize);
  const toggleGridSnap = useXDesign((s) => s.toggleGridSnap);
  const bringToFront = useXDesign((s) => s.bringToFront);
  const sendToBack = useXDesign((s) => s.sendToBack);
  const groupAsFrame = useXDesign((s) => s.groupAsFrame);
  const ungroup = useXDesign((s) => s.ungroup);
  const variables = useXDesign((s) => s.variables);
  const activeModeId = useXDesign((s) => s.activeModeId);

  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    setExportSvgRef(svgRef.current);
    return () => setExportSvgRef(null);
  }, []);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const [drag, setDrag] = useState<DragOp | null>(null);
  /** Path currently in anchor-edit mode (double-click a path to enter). */
  const [editPathId, setEditPathId] = useState<string | null>(null);

  // Auto-layout overrides — Map<shapeId, {x,y,w,h}> for every shape whose
  // position/size is being driven by a parent frame's flow.
  const layoutOverrides = useMemo<LayoutOverrides>(
    () => computeAutoLayout(shapes),
    [shapes],
  );
  const displayShapes = useMemo(() => {
    const hasLayout = layoutOverrides.size > 0;
    const hasVars = variables.length > 0;
    if (!hasLayout && !hasVars) return shapes;
    return shapes.map((s) => {
      const o = hasLayout ? layoutOverrides.get(s.id) : undefined;
      const laid = o ? ({ ...s, ...o } as Shape) : s;
      return hasVars ? resolveShapeVars(laid, variables, activeModeId) : laid;
    });
  }, [shapes, layoutOverrides, variables, activeModeId]);
  const displayShape = useCallback(
    (id: string): Shape | undefined => displayShapes.find((s) => s.id === id),
    [displayShapes],
  );

  // Viewport culling: above a threshold, only render top-level subtrees that
  // intersect the visible doc rect (+ a generous margin so nothing pops in
  // jarringly). Below it, render everything (the cull cost isn't worth it).
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const CULL_THRESHOLD = 120;
  const visibleShapes = useMemo(() => {
    if (displayShapes.length <= CULL_THRESHOLD || canvasSize.w === 0) return displayShapes;
    const z = viewport.zoom;
    const margin = Math.max(canvasSize.w, canvasSize.h) / z; // ~one screen of slack
    const vis = {
      x: -viewport.x / z - margin,
      y: -viewport.y / z - margin,
      w: canvasSize.w / z + margin * 2,
      h: canvasSize.h / z + margin * 2,
    };
    const intersects = (s: Shape) =>
      s.x < vis.x + vis.w && s.x + s.w > vis.x && s.y < vis.y + vis.h && s.y + s.h > vis.y;
    const keep = new Set<string>();
    for (const s of displayShapes) {
      if (s.parentId) continue; // handled with its top-level ancestor
      const subtree = collectDescendantIds(displayShapes, s.id);
      if (subtree.some((id) => { const d = displayShapes.find((x) => x.id === id); return d && intersects(d); })) {
        for (const id of subtree) keep.add(id);
      }
    }
    // Always keep selected shapes (their handles must render).
    for (const id of selection) keep.add(id);
    return displayShapes.filter((s) => keep.has(s.id));
  }, [displayShapes, canvasSize, viewport, selection]);

  const [spaceDown, setSpaceDown] = useState(false);
  const [panDrag, setPanDrag] = useState<{ x: number; y: number } | null>(null);
  const [imagePicker, setImagePicker] = useState(false);
  const [guides, setGuides] = useState<{
    v: number | null;
    h: number | null;
  }>({ v: null, h: null });
  // Pen tool state: anchor points in doc coords (with optional bezier
  // handles), plus the live cursor for the preview segment. Committed via
  // Enter / closing on the first anchor.
  const [penAnchors, setPenAnchors] = useState<PathPoint[]>([]);
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);
  /** Anchor index being drag-shaped right now (mouse held after drop). */
  const [penDragIdx, setPenDragIdx] = useState<number | null>(null);

  // Image tool opens the picker on activation, then drops the picked asset at
  // the viewport center.
  useEffect(() => {
    if (tool === "image") setImagePicker(true);
  }, [tool]);

  const commitPenPath = (anchorsArg: PathPoint[], closed: boolean) => {
    if (anchorsArg.length < 2) return;
    // Compute bbox including bezier handles — handles can extend beyond the
    // anchor points and we want them inside the normalized 0..1 space.
    const allX = anchorsArg.flatMap((p) =>
      [p.x, p.cpInX, p.cpOutX].filter((v): v is number => typeof v === "number"),
    );
    const allY = anchorsArg.flatMap((p) =>
      [p.y, p.cpInY, p.cpOutY].filter((v): v is number => typeof v === "number"),
    );
    const minX = Math.min(...allX);
    const minY = Math.min(...allY);
    const maxX = Math.max(...allX);
    const maxY = Math.max(...allY);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const normalize = (v: number | undefined, base: number, span: number) =>
      typeof v === "number" ? (v - base) / span : undefined;
    const points: PathPoint[] = anchorsArg.map((p) => ({
      x: (p.x - minX) / w,
      y: (p.y - minY) / h,
      ...(typeof p.cpInX === "number"
        ? { cpInX: normalize(p.cpInX, minX, w) }
        : {}),
      ...(typeof p.cpInY === "number"
        ? { cpInY: normalize(p.cpInY, minY, h) }
        : {}),
      ...(typeof p.cpOutX === "number"
        ? { cpOutX: normalize(p.cpOutX, minX, w) }
        : {}),
      ...(typeof p.cpOutY === "number"
        ? { cpOutY: normalize(p.cpOutY, minY, h) }
        : {}),
    }));
    addShape({
      kind: "path",
      x: minX,
      y: minY,
      w,
      h,
      points,
      closed,
      fill: closed ? DEFAULT_FILL : "transparent",
      stroke: DEFAULT_STROKE,
      strokeWidth: 1.5,
    });
    setPenAnchors([]);
    setPenCursor(null);
    setTool("select");
  };

  // Exit pen mode when the tool changes — drop drafting state cleanly.
  useEffect(() => {
    if (tool !== "pen") {
      setPenAnchors([]);
      setPenCursor(null);
    }
  }, [tool]);

  const placeImage = (asset: Asset) => {
    if (!asset.filePath) return;
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    // Drop near the viewport center, in document coords.
    const screenCenter = rect
      ? { x: rect.width / 2, y: rect.height / 2 }
      : { x: 200, y: 200 };
    const cx = (screenCenter.x - viewport.x) / viewport.zoom;
    const cy = (screenCenter.y - viewport.y) / viewport.zoom;
    // Default 320×220; user resizes from there.
    const w = 320;
    const h = 220;
    const id = addShape({
      kind: "image",
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
      filePath: asset.filePath,
      assetId: asset.id,
      name: asset.title || "Image",
    });
    select(id);
    setImagePicker(false);
    setTool("select");
  };

  const cancelImagePicker = () => {
    setImagePicker(false);
    setTool("select");
  };

  // ── Keyboard: delete + escape + arrow-nudge + zoom + space-pan ─
  useEffect(() => {
    const isEditing = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || node.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditing(e.target)) return;
      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      // Copy / Cut / Paste / Duplicate
      if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
        if (selection.size === 0) return;
        e.preventDefault();
        copyShapes(Array.from(selection));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "x" || e.key === "X")) {
        if (selection.size === 0) return;
        e.preventDefault();
        cutShapes(Array.from(selection));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "v" || e.key === "V")) {
        // Skip if Inspector / contenteditable owns focus — let native paste run.
        if (isEditing(e.target)) return;
        e.preventDefault();
        pasteShapes();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "d" || e.key === "D")) {
        if (selection.size === 0) return;
        e.preventDefault();
        duplicateShapes(Array.from(selection));
        return;
      }
      // Zoom shortcuts — work even when nothing is selected. Anchor at the
      // center of the canvas since we have no cursor here.
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        const anchor = rect
          ? { x: rect.width / 2, y: rect.height / 2 }
          : { x: 0, y: 0 };
        zoomAt(1.2, anchor);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        const anchor = rect
          ? { x: rect.width / 2, y: rect.height / 2 }
          : { x: 0, y: 0 };
        zoomAt(1 / 1.2, anchor);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        resetViewport();
        return;
      }
      // Select all (⌘A) — top-level shapes (children come along via frames).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        const top = useXDesign
          .getState()
          .shapes.filter((s) => !s.parentId && !s.hidden && !s.locked)
          .map((s) => s.id);
        if (top.length) selectMany(top);
        return;
      }
      // Grid snap toggle: ⇧⌘ G
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        toggleGridSnap();
        return;
      }
      // Group / Ungroup: ⌘G / ⌘⇧G  (⇧⌘G is grid; ⌘⌥G = ungroup as alternate)
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === "g" || e.key === "G")
      ) {
        if (selection.size === 0) return;
        e.preventDefault();
        groupAsFrame(Array.from(selection));
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.altKey || (e.shiftKey && (e.key === "G"))) &&
        (e.key === "g" || e.key === "G")
      ) {
        if (selection.size === 0) return;
        e.preventDefault();
        ungroup(Array.from(selection));
        return;
      }
      // Bring to front / send to back: ⌘⇧] / ⌘⇧[
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "]" || e.key === "}")
      ) {
        if (selection.size === 0) return;
        e.preventDefault();
        bringToFront(Array.from(selection));
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "[" || e.key === "{")
      ) {
        if (selection.size === 0) return;
        e.preventDefault();
        sendToBack(Array.from(selection));
        return;
      }
      // Zoom helpers: ⇧0 = 100%, ⇧1 = fit, ⇧2 = fit-selection
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && e.key === ")") {
        e.preventDefault();
        resetViewport();
        return;
      }
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && e.key === "!") {
        e.preventDefault();
        // Fit all shapes
        const svg = svgRef.current;
        if (!svg) return;
        const allShapes = useXDesign.getState().shapes;
        if (allShapes.length === 0) {
          resetViewport();
          return;
        }
        const minX = Math.min(...allShapes.map((s) => s.x));
        const minY = Math.min(...allShapes.map((s) => s.y));
        const maxX = Math.max(...allShapes.map((s) => s.x + s.w));
        const maxY = Math.max(...allShapes.map((s) => s.y + s.h));
        const rect = svg.getBoundingClientRect();
        const pad = 40;
        const zx = (rect.width - pad * 2) / (maxX - minX || 1);
        const zy = (rect.height - pad * 2) / (maxY - minY || 1);
        const zoom = Math.max(0.1, Math.min(8, Math.min(zx, zy)));
        useXDesign.setState({
          viewport: {
            zoom,
            x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
            y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
          },
        });
        return;
      }
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && e.key === "@") {
        if (selection.size === 0) return;
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const allShapes = useXDesign.getState().shapes;
        const sel = allShapes.filter((s) => selection.has(s.id));
        if (sel.length === 0) return;
        const minX = Math.min(...sel.map((s) => s.x));
        const minY = Math.min(...sel.map((s) => s.y));
        const maxX = Math.max(...sel.map((s) => s.x + s.w));
        const maxY = Math.max(...sel.map((s) => s.y + s.h));
        const rect = svg.getBoundingClientRect();
        const pad = 80;
        const zx = (rect.width - pad * 2) / (maxX - minX || 1);
        const zy = (rect.height - pad * 2) / (maxY - minY || 1);
        const zoom = Math.max(0.1, Math.min(8, Math.min(zx, zy)));
        useXDesign.setState({
          viewport: {
            zoom,
            x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
            y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
          },
        });
        return;
      }
      // Hand tool toggle (Figma-style): hold Space to pan.
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key === "Enter" && tool === "pen" && penAnchors.length >= 2) {
        e.preventDefault();
        commitPenPath(penAnchors, false);
        return;
      }
      if (e.key === "Escape") {
        if (tool === "pen" && penAnchors.length > 0) {
          setPenAnchors([]);
          setPenCursor(null);
          setTool("select");
          return;
        }
        if (editPathId) {
          setEditPathId(null);
          return;
        }
        clearSelection();
        if (tool !== "select") setTool("select");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.size > 0) {
          e.preventDefault();
          // Cascade: deleting a frame removes its descendants too.
          const ids = new Set<string>();
          const allShapes = useXDesign.getState().shapes;
          for (const id of selection) {
            for (const d of collectDescendantIds(allShapes, id)) ids.add(d);
          }
          deleteShapes(Array.from(ids));
        }
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        if (selection.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        else if (e.key === "ArrowLeft") dx = -step;
        else dx = step;
        const ids = Array.from(selection);
        patchMany(ids, (sh) => ({ x: sh.x + dx, y: sh.y + dy }));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    bringToFront,
    clearSelection,
    copyShapes,
    cutShapes,
    deleteShapes,
    duplicateShapes,
    groupAsFrame,
    pasteShapes,
    patchMany,
    penAnchors,
    redo,
    resetViewport,
    selection,
    sendToBack,
    setTool,
    toggleGridSnap,
    tool,
    undo,
    ungroup,
    zoomAt,
    editPathId,
  ]);

  // Leaving the select tool drops anchor-edit mode.
  useEffect(() => {
    if (tool !== "select" && editPathId) setEditPathId(null);
  }, [tool, editPathId]);

  /** Screen-space coords inside the SVG (not viewport-adjusted). */
  const toScreenPoint = useCallback(
    (evt: RMouseEvent | MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (evt as MouseEvent).clientX - rect.left,
        y: (evt as MouseEvent).clientY - rect.top,
      };
    },
    [],
  );

  /** Document-space coords (the viewport transform undone). */
  const toSvgPoint = useCallback(
    (evt: RMouseEvent | MouseEvent) => {
      const p = toScreenPoint(evt);
      return {
        x: (p.x - viewport.x) / viewport.zoom,
        y: (p.y - viewport.y) / viewport.zoom,
      };
    },
    [toScreenPoint, viewport.x, viewport.y, viewport.zoom],
  );

  // While the pen tool is active and we have at least one anchor, track the
  // cursor so we can render the live preview segment from the last anchor.
  // While the mouse is also held after dropping a fresh anchor, drag the
  // anchor's bezier handles symmetrically from its position.
  useEffect(() => {
    if (tool !== "pen" || penAnchors.length === 0) {
      if (penCursor !== null) setPenCursor(null);
      return;
    }
    const onMove = (e: MouseEvent) => {
      const p = toSvgPoint(e);
      setPenCursor(p);
      if (penDragIdx !== null) {
        setPenAnchors((prev) => {
          const next = prev.slice();
          const anchor = next[penDragIdx];
          if (!anchor) return prev;
          // Symmetric handles: cpOut at cursor, cpIn mirrored across anchor.
          next[penDragIdx] = {
            ...anchor,
            cpOutX: p.x,
            cpOutY: p.y,
            cpInX: anchor.x - (p.x - anchor.x),
            cpInY: anchor.y - (p.y - anchor.y),
          };
          return next;
        });
      }
    };
    const onUp = () => {
      if (penDragIdx !== null) setPenDragIdx(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  // penCursor intentionally excluded to avoid a re-add loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, penAnchors.length, toSvgPoint, penDragIdx]);

  // ── Canvas-level pointer handlers (drawing + deselect + marquee + pan) ─
  const onCanvasMouseDown = (e: RMouseEvent<SVGSVGElement>) => {
    // Space-pan: any mousedown on the canvas starts a pan, ignoring tool.
    if (spaceDown || e.button === 1) {
      e.preventDefault();
      setPanDrag(toScreenPoint(e));
      return;
    }
    if (e.target !== svgRef.current && tool === "select") {
      // Click landed on something other than the canvas background — let the
      // shape's own handler take it.
      return;
    }
    // Clicking empty canvas exits path-edit mode.
    if (editPathId) setEditPathId(null);
    const p = toSvgPoint(e);
    if (tool === "select") {
      // Start a marquee. If shift isn't held, the existing selection is
      // dropped at mouseup (but kept visually until then so the user sees
      // what they're replacing).
      setDrag({
        kind: "marquee",
        start: p,
        current: p,
        additive: e.shiftKey,
        baseSelection: new Set(selection),
      });
      return;
    }
    if (tool === "pen") {
      // Click adds an anchor. Clicking near the first anchor closes the path.
      const CLOSE_RADIUS = 8 / viewport.zoom;
      if (penAnchors.length >= 2) {
        const first = penAnchors[0]!;
        const dx = p.x - first.x;
        const dy = p.y - first.y;
        if (Math.hypot(dx, dy) <= CLOSE_RADIUS) {
          commitPenPath(penAnchors, true);
          return;
        }
      }
      const newAnchor: PathPoint = { x: p.x, y: p.y };
      setPenAnchors((prev) => {
        const next = [...prev, newAnchor];
        setPenDragIdx(next.length - 1);
        return next;
      });
      return;
    }
    if (tool === "rect" || tool === "ellipse" || tool === "frame") {
      setDraft({ x: p.x, y: p.y, w: 0, h: 0, kind: tool });
    } else if (tool === "text") {
      const id = addShape({
        kind: "text",
        x: p.x,
        y: p.y,
        w: TEXT_DEFAULT_W,
        h: TEXT_DEFAULT_H,
        text: "Type here",
        fontSize: 22,
        fill: "var(--t-primary)",
        stroke: "transparent",
        strokeWidth: 0,
      });
      select(id);
      setTool("select");
    }
  };

  useEffect(() => {
    if (!draft && !drag && !panDrag) return;
    const onMove = (e: MouseEvent) => {
      if (panDrag) {
        const sp = toScreenPoint(e);
        pan(sp.x - panDrag.x, sp.y - panDrag.y);
        setPanDrag(sp);
        return;
      }
      const p = toSvgPoint(e);
      if (draft) {
        setDraft({
          ...draft,
          w: p.x - draft.x,
          h: p.y - draft.y,
        });
      }
      if (drag?.kind === "move") {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        // Build the moving group's bbox at the desired (un-snapped) position.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [id, start] of drag.startShapes) {
          const live = shapes.find((s) => s.id === id);
          if (!live) continue;
          const nx = start.x + dx;
          const ny = start.y + dy;
          minX = Math.min(minX, nx);
          minY = Math.min(minY, ny);
          maxX = Math.max(maxX, nx + live.w);
          maxY = Math.max(maxY, ny + live.h);
        }
        let adjDx = dx;
        let adjDy = dy;
        let guideV: number | null = null;
        let guideH: number | null = null;
        if (isFinite(minX)) {
          const movingBox = {
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
          };
          const movingIds = new Set(drag.startShapes.keys());
          const others = shapes.filter((s) => !movingIds.has(s.id));
          const threshold = 6 / viewport.zoom;
          const snap = computeSnap(movingBox, others, threshold);
          adjDx = dx + snap.dx;
          adjDy = dy + snap.dy;
          guideV = snap.guideV;
          guideH = snap.guideH;
          // Grid snap: round the bbox top-left to the nearest grid line.
          // Smart-guide snap wins on tied frames because we apply it first;
          // grid takes over when no shape edge is in range.
          if (gridSnap && snap.guideV === null && snap.guideH === null) {
            const newX = minX + adjDx;
            const newY = minY + adjDy;
            adjDx += Math.round(newX / gridSize) * gridSize - newX;
            adjDy += Math.round(newY / gridSize) * gridSize - newY;
          } else if (gridSnap && snap.guideV === null) {
            const newX = minX + adjDx;
            adjDx += Math.round(newX / gridSize) * gridSize - newX;
          } else if (gridSnap && snap.guideH === null) {
            const newY = minY + adjDy;
            adjDy += Math.round(newY / gridSize) * gridSize - newY;
          }
        }
        setGuides({ v: guideV, h: guideH });
        const ids = Array.from(drag.startShapes.keys());
        patchMany(ids, (sh) => {
          const start = drag.startShapes.get(sh.id);
          if (!start) return {};
          return { x: start.x + adjDx, y: start.y + adjDy };
        });
      } else if (drag?.kind === "rotate") {
        const ang =
          (Math.atan2(p.y - drag.pivot.y, p.x - drag.pivot.x) * 180) / Math.PI;
        let delta = ang - drag.startAngleDeg;
        if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        const rad = (delta * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const ids = Array.from(drag.startShapes.keys());
        patchMany(ids, (sh) => {
          const start = drag.startShapes.get(sh.id);
          if (!start) return {};
          // Rotate the original center around the pivot by `delta`.
          const dxc = start.cx - drag.pivot.x;
          const dyc = start.cy - drag.pivot.y;
          const newCx = drag.pivot.x + dxc * cosR - dyc * sinR;
          const newCy = drag.pivot.y + dxc * sinR + dyc * cosR;
          const w = sh.w;
          const h = sh.h;
          let next = start.rotation + delta;
          next = ((next + 180) % 360 + 360) % 360 - 180;
          return {
            x: newCx - w / 2,
            y: newCy - h / 2,
            rotation: next,
          };
        });
      } else if (drag?.kind === "resize") {
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        // Constrain proportions while ⇧ is held — lock to the start aspect.
        // We only lock when both axes are actively driven by the handle
        // (corners); pure edge handles are 1D so there's nothing to lock.
        const handle = drag.handle;
        const isCorner =
          handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";
        if (e.shiftKey && isCorner && drag.startBbox.w > 0 && drag.startBbox.h > 0) {
          const aspect = drag.startBbox.w / drag.startBbox.h;
          // Drive whichever axis the cursor moved more in — converts dy to
          // dx (or vice-versa) so the bbox stays at the original aspect.
          if (Math.abs(dx) >= Math.abs(dy)) {
            const sign = handle === "nw" || handle === "sw" ? -1 : 1;
            const signY = handle === "nw" || handle === "ne" ? -1 : 1;
            const newDy = (Math.abs(dx) / aspect) * sign * signY;
            dy = newDy;
          } else {
            const signY = handle === "nw" || handle === "ne" ? -1 : 1;
            const signX = handle === "nw" || handle === "sw" ? -1 : 1;
            const newDx = Math.abs(dy) * aspect * signY * signX;
            dx = newDx;
          }
        }
        const newBbox = applyResize(drag.handle, drag.startBbox, dx, dy);
        const ids = Array.from(drag.startShapes.keys());
        patchMany(ids, (sh) => {
          const rel = drag.startShapes.get(sh.id);
          if (!rel) return {};
          return {
            x: newBbox.x + rel.relX * newBbox.w,
            y: newBbox.y + rel.relY * newBbox.h,
            w: Math.max(MIN_DIM, rel.relW * newBbox.w),
            h: Math.max(MIN_DIM, rel.relH * newBbox.h),
          };
        });
      } else if (drag?.kind === "anchor") {
        const sh = shapes.find((s) => s.id === drag.pathId);
        if (sh && sh.kind === "path") {
          const u = worldToUnit(p.x, p.y, sh);
          const points = sh.points.map((pt, i) => {
            if (i !== drag.index) return pt;
            if (drag.part === "point") {
              // Carry the anchor's bezier handles by the same delta so the
              // curve shape is preserved as the vertex moves.
              const dxu = u.x - pt.x;
              const dyu = u.y - pt.y;
              const np: PathPoint = { ...pt, x: u.x, y: u.y };
              if (pt.cpInX !== undefined) np.cpInX = pt.cpInX + dxu;
              if (pt.cpInY !== undefined) np.cpInY = pt.cpInY + dyu;
              if (pt.cpOutX !== undefined) np.cpOutX = pt.cpOutX + dxu;
              if (pt.cpOutY !== undefined) np.cpOutY = pt.cpOutY + dyu;
              return np;
            }
            if (drag.part === "cpIn") return { ...pt, cpInX: u.x, cpInY: u.y };
            return { ...pt, cpOutX: u.x, cpOutY: u.y };
          });
          updateShape(drag.pathId, { points } as ShapePatch);
        }
      } else if (drag?.kind === "marquee") {
        setDrag({ ...drag, current: p });
      }
    };
    const onUp = (e: MouseEvent) => {
      if (panDrag) {
        setPanDrag(null);
        return;
      }
      // Always clear snap guides on mouseup — they're an in-flight signal.
      if (guides.v !== null || guides.h !== null) {
        setGuides({ v: null, h: null });
      }
      if (draft) {
        const p = toSvgPoint(e);
        const w = p.x - draft.x;
        const h = p.y - draft.y;
        const nx = w >= 0 ? draft.x : draft.x + w;
        const ny = h >= 0 ? draft.y : draft.y + h;
        const aw = Math.abs(w);
        const ah = Math.abs(h);
        if (aw >= MIN_DIM && ah >= MIN_DIM) {
          if (draft.kind === "rect") {
            addShape({
              kind: "rect",
              x: nx,
              y: ny,
              w: aw,
              h: ah,
              radius: 6,
              fill: DEFAULT_FILL,
              stroke: DEFAULT_STROKE,
              strokeWidth: 1.5,
            });
          } else if (draft.kind === "ellipse") {
            addShape({
              kind: "ellipse",
              x: nx,
              y: ny,
              w: aw,
              h: ah,
              fill: DEFAULT_FILL,
              stroke: DEFAULT_STROKE,
              strokeWidth: 1.5,
            });
          } else {
            // frame — slate-grey bg + faint stroke so it reads as a container
            // without competing visually with content.
            const frameId = addShape({
              kind: "frame",
              x: nx,
              y: ny,
              w: aw,
              h: ah,
              radius: 8,
              fill: "rgba(255, 255, 255, 0.02)",
              stroke: "rgba(255, 255, 255, 0.12)",
              strokeWidth: 1,
            });
            // Auto-parent: any TOP-LEVEL shape whose center sits inside the
            // freshly-drawn frame becomes a child. Frames don't catch other
            // frames (you can drag-re-parent later if you want that).
            const adopt: string[] = [];
            for (const s of shapes) {
              if (s.id === frameId) continue;
              if (s.parentId) continue;
              if (s.kind === "frame") continue;
              const cx = s.x + s.w / 2;
              const cy = s.y + s.h / 2;
              if (cx > nx && cx < nx + aw && cy > ny && cy < ny + ah) {
                adopt.push(s.id);
              }
            }
            if (adopt.length > 0) {
              patchMany(adopt, () => ({ parentId: frameId }) as ShapePatch);
            }
          }
        }
        setDraft(null);
        setTool("select");
      }
      if (drag?.kind === "marquee") {
        const box = marqueeBox(drag.start, drag.current);
        const hits = shapes
          .filter((s) => !s.locked && !s.hidden && shapeIntersects(s, box))
          .map((s) => s.id);
        // Tiny marquee = treat as an empty-area click → clear selection.
        if (box.w < 2 && box.h < 2) {
          if (!drag.additive) clearSelection();
        } else if (drag.additive) {
          // Toggle each hit into the base selection.
          const next = new Set(drag.baseSelection);
          for (const id of hits) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
          selectMany(Array.from(next));
        } else {
          selectMany(hits);
        }
      }
      if (drag) setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [
    draft,
    drag,
    panDrag,
    guides.h,
    guides.v,
    addShape,
    gridSnap,
    gridSize,
    patchMany,
    setTool,
    toSvgPoint,
    toScreenPoint,
    pan,
    updateShape,
    shapes,
    viewport.zoom,
    clearSelection,
    selectMany,
  ]);

  // ── Per-shape mousedown (select + start move) ────────────
  // Clicked shape → its ancestor chain [clicked … topFrame] (cycle-guarded).
  const ancestorChain = (shape: Shape): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: Shape | undefined = shape;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur.id);
      cur = cur.parentId ? shapes.find((s) => s.id === cur!.parentId) : undefined;
    }
    return chain;
  };

  /** Figma-style progressive selection: a plain click selects the TOP-LEVEL
   * frame (so frames feel like units); clicking again inside an already-
   * selected frame drills one level deeper toward the cursor. ⌘/double-click
   * jump straight to the exact leaf. */
  const resolveSelectTarget = (shape: Shape, deep: boolean): string => {
    if (deep) return shape.id;
    const chain = ancestorChain(shape);
    for (let i = chain.length - 1; i >= 0; i--) {
      if (selection.has(chain[i]!)) return chain[Math.max(0, i - 1)]!;
    }
    return chain[chain.length - 1]!; // nothing selected yet → top-level
  };

  const onShapeMouseDown = (e: RMouseEvent, shape: Shape) => {
    if (tool !== "select") return;
    // Locked or hidden shapes are pass-through: the click reaches the
    // canvas background (marquee/deselect) instead of selecting them.
    if (shape.locked || shape.hidden) return;
    e.stopPropagation();
    const deep = e.metaKey || e.ctrlKey || e.detail >= 2;
    const targetId = resolveSelectTarget(shape, deep);
    // Double-click a path → enter anchor-edit mode instead of deep-select.
    const targetShape = shapes.find((s) => s.id === targetId);
    if (e.detail >= 2 && targetShape?.kind === "path") {
      select(targetId);
      setEditPathId(targetId);
      return;
    }
    if (editPathId && editPathId !== targetId) setEditPathId(null);
    const isSel = selection.has(targetId);
    if (e.shiftKey) {
      toggleInSelection(targetId);
      return;
    }
    if (!isSel) select(targetId);
    const p = toSvgPoint(e);
    const liveIds = isSel ? Array.from(selection) : [targetId];
    // Expand the moving set with frame descendants so dragging a frame
    // brings everything inside with it.
    const fullSet = new Set<string>();
    for (const id of liveIds) {
      for (const d of collectDescendantIds(shapes, id)) fullSet.add(d);
    }
    const startShapes = new Map<string, { x: number; y: number }>();
    for (const id of fullSet) {
      const s = displayShape(id);
      if (s) startShapes.set(id, { x: s.x, y: s.y });
    }
    pushHistory();
    setDrag({ kind: "move", start: p, startShapes });
  };

  // ── Wheel: trackpad pan + pinch zoom + ctrl-wheel zoom ─────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      // ctrl/meta-wheel (or browser pinch) → zoom around cursor.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const anchor = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        // 1 unit of zoom intent per ~100 deltaY at default trackpad speed.
        const factor = Math.exp(-e.deltaY / 200);
        zoomAt(factor, anchor);
        return;
      }
      // Plain wheel → pan. deltaX/deltaY are already in CSS px on modern
      // browsers; just translate the viewport.
      if (e.deltaX !== 0 || e.deltaY !== 0) {
        e.preventDefault();
        pan(-e.deltaX, -e.deltaY);
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [pan, zoomAt]);

  const onHandleMouseDown = (e: RMouseEvent, handle: ResizeHandle) => {
    e.stopPropagation();
    const ids = Array.from(selection);
    if (ids.length === 0) return;
    const selectedShapes = ids
      .map((id) => displayShape(id))
      .filter((s): s is Shape => Boolean(s));
    if (selectedShapes.length === 0) return;
    // Bounding box of the current selection.
    const minX = Math.min(...selectedShapes.map((s) => s.x));
    const minY = Math.min(...selectedShapes.map((s) => s.y));
    const maxX = Math.max(...selectedShapes.map((s) => s.x + s.w));
    const maxY = Math.max(...selectedShapes.map((s) => s.y + s.h));
    const bw = Math.max(MIN_DIM, maxX - minX);
    const bh = Math.max(MIN_DIM, maxY - minY);
    const startBbox = { x: minX, y: minY, w: bw, h: bh };
    const startShapes = new Map<
      string,
      { relX: number; relY: number; relW: number; relH: number }
    >();
    for (const s of selectedShapes) {
      startShapes.set(s.id, {
        relX: (s.x - minX) / bw,
        relY: (s.y - minY) / bh,
        relW: s.w / bw,
        relH: s.h / bh,
      });
    }
    const p = toSvgPoint(e);
    pushHistory();
    setDrag({ kind: "resize", handle, start: p, startBbox, startShapes });
  };

  const startAnchorDrag = (
    e: RMouseEvent,
    index: number,
    part: "point" | "cpIn" | "cpOut",
  ) => {
    e.stopPropagation();
    if (!editPathId) return;
    pushHistory();
    setDrag({ kind: "anchor", pathId: editPathId, index, part });
  };

  const editPath = useMemo(() => {
    if (!editPathId) return null;
    const s = shapes.find((sh) => sh.id === editPathId);
    return s && s.kind === "path" ? s : null;
  }, [editPathId, shapes]);

  const selectionBounds = useMemo(() => {
    if (selection.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sh of displayShapes) {
      if (!selection.has(sh.id)) continue;
      minX = Math.min(minX, sh.x);
      minY = Math.min(minY, sh.y);
      maxX = Math.max(maxX, sh.x + sh.w);
      maxY = Math.max(maxY, sh.y + sh.h);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [displayShapes, selection]);


  const marquee =
    drag?.kind === "marquee" ? marqueeBox(drag.start, drag.current) : null;

  /** Synthetic "rotation bbox shape" — for single-selection, the actual
   * shape (so the handle rides its rotation); for multi-selection, the
   * axis-aligned selection bbox. */
  const rotHandleShape = useMemo<Shape | null>(() => {
    if (selection.size === 0) return null;
    if (selection.size === 1) {
      const id = Array.from(selection)[0]!;
      return displayShape(id) ?? null;
    }
    if (!selectionBounds) return null;
    return {
      id: "__sel__",
      name: "Selection",
      kind: "rect",
      x: selectionBounds.x,
      y: selectionBounds.y,
      w: selectionBounds.w,
      h: selectionBounds.h,
      rotation: 0,
      radius: 0,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
    };
  }, [displayShape, selection, selectionBounds]);

  const startRotate = (e: RMouseEvent) => {
    if (!rotHandleShape) return;
    e.stopPropagation();
    const pivotX = rotHandleShape.x + rotHandleShape.w / 2;
    const pivotY = rotHandleShape.y + rotHandleShape.h / 2;
    const p = toSvgPoint(e);
    const startAngle =
      (Math.atan2(p.y - pivotY, p.x - pivotX) * 180) / Math.PI;
    const startShapes = new Map<
      string,
      { cx: number; cy: number; rotation: number }
    >();
    for (const id of selection) {
      const s = displayShape(id);
      if (!s) continue;
      startShapes.set(id, {
        cx: s.x + s.w / 2,
        cy: s.y + s.h / 2,
        rotation: s.rotation ?? 0,
      });
    }
    pushHistory();
    setDrag({
      kind: "rotate",
      pivot: { x: pivotX, y: pivotY },
      startAngleDeg: startAngle,
      startShapes,
    });
  };

  const cursor = panDrag
    ? "grabbing"
    : spaceDown
      ? "grab"
      : tool === "select"
        ? drag?.kind === "move"
          ? "grabbing"
          : drag?.kind === "marquee"
            ? "crosshair"
            : "default"
        : "crosshair";

  const vpTransform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`;
  // Handles + selection bbox + marquee are 1px-thick UI affordances; scaling
  // them with the viewport would make them ugly. Keep them outside the
  // viewport <g> and re-apply the transform per-coord instead.
  const tx = (x: number) => x * viewport.zoom + viewport.x;
  const ty = (y: number) => y * viewport.zoom + viewport.y;
  const ts = (n: number) => n * viewport.zoom;

  return (
    <div className="xd-canvas-wrap">
      <svg
        ref={svgRef}
        className="xd-canvas-svg"
        style={{ cursor }}
        onMouseDown={onCanvasMouseDown}
      >
        <CheckerBackground />
        <g transform={vpTransform}>
          <defs>
            {shapes
              .filter((s) => (s.effects ?? []).length > 0)
              .map((s) => (
                <ShapeEffectFilter
                  key={s.id}
                  shapeId={s.id}
                  effects={s.effects ?? []}
                />
              ))}
            {shapes
              .filter((s) => !!s.fillGradient)
              .map((s) => (
                <GradientDef
                  key={s.id}
                  shapeId={s.id}
                  gradient={s.fillGradient!}
                />
              ))}
            {shapes
              .filter((s) => !!s.fillImage)
              .map((s) => (
                <ImageFillDef
                  key={s.id}
                  shapeId={s.id}
                  filePath={s.fillImage!.filePath}
                  fit={s.fillImage!.fit}
                />
              ))}
            {shapes
              .filter(
                (s): s is Extract<Shape, { kind: "frame" }> =>
                  s.kind === "frame" && !!(s as { clipContent?: boolean }).clipContent,
              )
              .map((s) => (
                <clipPath id={`xd-clip-${s.id}`} key={s.id}>
                  <rect
                    x={s.x}
                    y={s.y}
                    width={s.w}
                    height={s.h}
                    rx={s.radius}
                    ry={s.radius}
                  />
                </clipPath>
              ))}
            {shapes
              .filter((s) => s.strokeAlign === "inside")
              .map((s) => (
                <clipPath id={`xd-sclip-${s.id}`} key={`sc-${s.id}`}>
                  {s.kind === "ellipse" ? (
                    <ellipse
                      cx={s.x + s.w / 2}
                      cy={s.y + s.h / 2}
                      rx={s.w / 2}
                      ry={s.h / 2}
                    />
                  ) : (
                    <rect
                      x={s.x}
                      y={s.y}
                      width={s.w}
                      height={s.h}
                      rx={(s as { radius?: number }).radius ?? 0}
                      ry={(s as { radius?: number }).radius ?? 0}
                    />
                  )}
                </clipPath>
              ))}
          </defs>
          {renderShapesWithClipping({
            shapes: visibleShapes,
            selection,
            onShapeMouseDown,
            updateShape,
            pushHistory,
          })}
          {draft && draft.kind === "rect" && (
            <rect
              x={Math.min(draft.x, draft.x + draft.w)}
              y={Math.min(draft.y, draft.y + draft.h)}
              width={Math.abs(draft.w)}
              height={Math.abs(draft.h)}
              rx={6}
              fill={DEFAULT_FILL}
              stroke={DEFAULT_STROKE}
              strokeWidth={1.5 / viewport.zoom}
              strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
              pointerEvents="none"
            />
          )}
          {tool === "pen" && penAnchors.length > 0 && (
            <g>
              {/* Committed bezier-aware path */}
              {penAnchors.length >= 2 && (
                <path
                  d={pathToSvgD(penAnchors, false)}
                  fill="none"
                  stroke="var(--neon-magenta)"
                  strokeWidth={1.5 / viewport.zoom}
                />
              )}
              {/* Live segment from last anchor to cursor */}
              {penCursor && penDragIdx === null && (
                <line
                  x1={penAnchors[penAnchors.length - 1]!.x}
                  y1={penAnchors[penAnchors.length - 1]!.y}
                  x2={penCursor.x}
                  y2={penCursor.y}
                  stroke="var(--neon-magenta)"
                  strokeWidth={1 / viewport.zoom}
                  strokeDasharray={`${3 / viewport.zoom} ${2 / viewport.zoom}`}
                />
              )}
              {/* Handles for each anchor that has them */}
              {penAnchors.map((p, i) => (
                <g key={`h-${i}`}>
                  {typeof p.cpInX === "number" && typeof p.cpInY === "number" && (
                    <>
                      <line
                        x1={p.x}
                        y1={p.y}
                        x2={p.cpInX}
                        y2={p.cpInY}
                        stroke="rgba(255, 62, 165, 0.55)"
                        strokeWidth={1 / viewport.zoom}
                      />
                      <circle
                        cx={p.cpInX}
                        cy={p.cpInY}
                        r={3 / viewport.zoom}
                        fill="var(--neon-magenta)"
                      />
                    </>
                  )}
                  {typeof p.cpOutX === "number" && typeof p.cpOutY === "number" && (
                    <>
                      <line
                        x1={p.x}
                        y1={p.y}
                        x2={p.cpOutX}
                        y2={p.cpOutY}
                        stroke="rgba(255, 62, 165, 0.55)"
                        strokeWidth={1 / viewport.zoom}
                      />
                      <circle
                        cx={p.cpOutX}
                        cy={p.cpOutY}
                        r={3 / viewport.zoom}
                        fill="var(--neon-magenta)"
                      />
                    </>
                  )}
                </g>
              ))}
              {/* Anchor dots (drawn last so they sit on top of handle lines) */}
              {penAnchors.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={4 / viewport.zoom}
                  fill={i === 0 ? "var(--neon-yellow)" : "var(--bg-0)"}
                  stroke="var(--neon-magenta)"
                  strokeWidth={1.5 / viewport.zoom}
                />
              ))}
            </g>
          )}
          {draft && draft.kind === "ellipse" && (
            <ellipse
              cx={draft.x + draft.w / 2}
              cy={draft.y + draft.h / 2}
              rx={Math.abs(draft.w) / 2}
              ry={Math.abs(draft.h) / 2}
              fill={DEFAULT_FILL}
              stroke={DEFAULT_STROKE}
              strokeWidth={1.5 / viewport.zoom}
              strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
              pointerEvents="none"
            />
          )}
        </g>
        {selectionBounds && (
          <rect
            x={tx(selectionBounds.x) - 2}
            y={ty(selectionBounds.y) - 2}
            width={ts(selectionBounds.w) + 4}
            height={ts(selectionBounds.h) + 4}
            fill="none"
            stroke="var(--neon-cyan)"
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
        {tool === "select" && !editPath && selectionBounds && (
          <ResizeHandles
            bbox={selectionBounds}
            viewport={viewport}
            onHandleMouseDown={onHandleMouseDown}
          />
        )}
        {tool === "select" && !editPath && rotHandleShape && (
          <RotationHandle
            shape={rotHandleShape}
            viewport={viewport}
            onMouseDown={startRotate}
          />
        )}
        {tool === "select" && editPath && (
          <PathEditOverlay
            shape={editPath}
            viewport={viewport}
            onAnchorDown={startAnchorDrag}
          />
        )}
        {marquee && (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill="rgba(0, 224, 255, 0.08)"
            stroke="var(--neon-cyan)"
            strokeWidth={1}
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
        {guides.v !== null && (
          <line
            x1={tx(guides.v)}
            y1={0}
            x2={tx(guides.v)}
            y2={10000}
            stroke="var(--neon-magenta)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}
        {guides.h !== null && (
          <line
            x1={0}
            y1={ty(guides.h)}
            x2={10000}
            y2={ty(guides.h)}
            stroke="var(--neon-magenta)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}
      </svg>
      <div className="xd-canvas-hud">
        {shapes.length} {shapes.length === 1 ? "layer" : "layers"} ·{" "}
        {selection.size} selected · tool: {tool} ·{" "}
        {Math.round(viewport.zoom * 100)}%
        {gridSnap && <span className="xd-hud-flag"> · grid {gridSize}</span>}
      </div>
      {imagePicker && (
        <XDesignImagePicker onClose={cancelImagePicker} onPick={placeImage} />
      )}
    </div>
  );
}

/** Render shapes top-down with a small twist for frames that have
 * clipContent: their descendants are wrapped under a `<g clip-path=…>` so
 * children render inside the frame's clip mask, while the frame itself
 * stays unclipped (its stroke and bg remain visible outside the clip). */
function renderShapesWithClipping({
  shapes,
  selection,
  onShapeMouseDown,
  updateShape,
  pushHistory,
}: {
  shapes: Shape[];
  selection: Set<string>;
  onShapeMouseDown: (e: RMouseEvent, shape: Shape) => void;
  updateShape: (id: string, patch: ShapePatch) => void;
  pushHistory: () => void;
}) {
  // Pre-compute parent → ordered children. Walking the array in document
  // order preserves z-stacking semantics.
  const childrenByParent = new Map<string, Shape[]>();
  for (const s of shapes) {
    if (!s.parentId) continue;
    const arr = childrenByParent.get(s.parentId) ?? [];
    arr.push(s);
    childrenByParent.set(s.parentId, arr);
  }
  const clippedFrames = new Set(
    shapes
      .filter((s) => s.kind === "frame" && (s as { clipContent?: boolean }).clipContent)
      .map((s) => s.id),
  );

  // Render the top-level shapes; for clipped frames, emit a frame then a
  // clipped <g> of its descendants. Non-clipped frames just emit normally
  // and their descendants render inline alongside.
  const handled = new Set<string>();
  const out: ReactNode[] = [];
  const renderOne = (sh: Shape) => (
    <ShapeNode
      key={sh.id}
      shape={sh}
      selected={selection.has(sh.id)}
      onMouseDown={(e) => onShapeMouseDown(e, sh)}
      onTextChange={(text) => {
        pushHistory();
        updateShape(sh.id, { text } as ShapePatch);
      }}
    />
  );
  for (const sh of shapes) {
    if (handled.has(sh.id)) continue;
    if (clippedFrames.has(sh.id)) {
      // Frame itself, then a clipped <g> containing only its descendants.
      out.push(renderOne(sh));
      const descendants: Shape[] = [];
      const walk = (id: string) => {
        for (const c of childrenByParent.get(id) ?? []) {
          descendants.push(c);
          handled.add(c.id);
          walk(c.id);
        }
      };
      walk(sh.id);
      handled.add(sh.id);
      out.push(
        <g key={`clip-${sh.id}`} clipPath={`url(#xd-clip-${sh.id})`}>
          {descendants.map(renderOne)}
        </g>,
      );
    } else {
      out.push(renderOne(sh));
      handled.add(sh.id);
    }
  }
  return out;
}

function RotationHandle({
  shape,
  viewport,
  onMouseDown,
}: {
  shape: Shape;
  viewport: { x: number; y: number; zoom: number };
  onMouseDown: (e: RMouseEvent) => void;
}) {
  // Place the handle 22 screen-px above the (rotated) top-center of the
  // shape. Easiest: compute the un-rotated top-center, then rotate the
  // offset (and the offset alone) by the shape's rotation around the
  // shape center. Convert to screen coords last.
  const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  // Un-rotated top-center: (cx, cy - h/2). Offset into a unit vector from
  // center to top-center, rotate by `rot`, then place at center +
  // unitVec * (h/2 + offset).
  const halfH = shape.h / 2;
  const HANDLE_OFFSET = 22 / viewport.zoom;
  const distance = halfH + HANDLE_OFFSET;
  // The "up" direction in the rotated frame: (sin(rot), -cos(rot)) — this
  // points to the rotated top of the shape.
  const ux = Math.sin(rot);
  const uy = -Math.cos(rot);
  const tipDoc = { x: cx + ux * distance, y: cy + uy * distance };
  const topDoc = { x: cx + ux * halfH, y: cy + uy * halfH };
  const tipScreen = {
    x: tipDoc.x * viewport.zoom + viewport.x,
    y: tipDoc.y * viewport.zoom + viewport.y,
  };
  const topScreen = {
    x: topDoc.x * viewport.zoom + viewport.x,
    y: topDoc.y * viewport.zoom + viewport.y,
  };
  return (
    <g>
      <line
        x1={topScreen.x}
        y1={topScreen.y}
        x2={tipScreen.x}
        y2={tipScreen.y}
        stroke="var(--neon-cyan)"
        strokeWidth={1}
        pointerEvents="none"
      />
      <circle
        cx={tipScreen.x}
        cy={tipScreen.y}
        r={6}
        fill="var(--bg-0)"
        stroke="var(--neon-cyan)"
        strokeWidth={1.5}
        style={{ cursor: "grab" }}
        onMouseDown={onMouseDown}
      />
    </g>
  );
}

function ResizeHandles({
  bbox,
  viewport,
  onHandleMouseDown,
}: {
  bbox: { x: number; y: number; w: number; h: number };
  viewport: { x: number; y: number; zoom: number };
  onHandleMouseDown: (e: RMouseEvent, handle: ResizeHandle) => void;
}) {
  return (
    <g>
      {HANDLE_POSITIONS.map(({ handle, xRatio, yRatio }) => {
        const cx = (bbox.x + bbox.w * xRatio) * viewport.zoom + viewport.x;
        const cy = (bbox.y + bbox.h * yRatio) * viewport.zoom + viewport.y;
        return (
          <rect
            key={handle}
            x={cx - HANDLE_SIZE / 2}
            y={cy - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="var(--bg-0)"
            stroke="var(--neon-cyan)"
            strokeWidth={1.5}
            style={{ cursor: HANDLE_CURSORS[handle] }}
            onMouseDown={(e) => onHandleMouseDown(e, handle)}
          />
        );
      })}
    </g>
  );
}

function PathEditOverlay({
  shape,
  viewport,
  onAnchorDown,
}: {
  shape: Shape & { kind: "path" };
  viewport: { x: number; y: number; zoom: number };
  onAnchorDown: (
    e: RMouseEvent,
    index: number,
    part: "point" | "cpIn" | "cpOut",
  ) => void;
}) {
  const tx = (x: number) => x * viewport.zoom + viewport.x;
  const ty = (y: number) => y * viewport.zoom + viewport.y;
  // Unit point → screen via the same transform the path renders under.
  const screen = (ux: number, uy: number) => {
    const [wx, wy] = localToWorld(ux * shape.w, uy * shape.h, shape);
    return { x: tx(wx), y: ty(wy) };
  };
  return (
    <g>
      {shape.points.map((p, i) => {
        const a = screen(p.x, p.y);
        const cpIn =
          p.cpInX !== undefined && p.cpInY !== undefined
            ? screen(p.cpInX, p.cpInY)
            : null;
        const cpOut =
          p.cpOutX !== undefined && p.cpOutY !== undefined
            ? screen(p.cpOutX, p.cpOutY)
            : null;
        return (
          <g key={i}>
            {cpIn && (
              <>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={cpIn.x}
                  y2={cpIn.y}
                  stroke="var(--neon-magenta)"
                  strokeWidth={1}
                  opacity={0.6}
                  pointerEvents="none"
                />
                <circle
                  cx={cpIn.x}
                  cy={cpIn.y}
                  r={4}
                  fill="var(--bg-0)"
                  stroke="var(--neon-magenta)"
                  strokeWidth={1.5}
                  style={{ cursor: "move" }}
                  onMouseDown={(e) => onAnchorDown(e, i, "cpIn")}
                />
              </>
            )}
            {cpOut && (
              <>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={cpOut.x}
                  y2={cpOut.y}
                  stroke="var(--neon-magenta)"
                  strokeWidth={1}
                  opacity={0.6}
                  pointerEvents="none"
                />
                <circle
                  cx={cpOut.x}
                  cy={cpOut.y}
                  r={4}
                  fill="var(--bg-0)"
                  stroke="var(--neon-magenta)"
                  strokeWidth={1.5}
                  style={{ cursor: "move" }}
                  onMouseDown={(e) => onAnchorDown(e, i, "cpOut")}
                />
              </>
            )}
            <rect
              x={a.x - HANDLE_SIZE / 2}
              y={a.y - HANDLE_SIZE / 2}
              width={HANDLE_SIZE}
              height={HANDLE_SIZE}
              fill="var(--neon-magenta)"
              stroke="var(--bg-0)"
              strokeWidth={1.5}
              style={{ cursor: "move" }}
              onMouseDown={(e) => onAnchorDown(e, i, "point")}
            />
          </g>
        );
      })}
    </g>
  );
}

function marqueeBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function ShapeNode({
  shape,
  selected,
  onMouseDown,
  onTextChange,
}: {
  shape: Shape;
  selected: boolean;
  onMouseDown: (e: RMouseEvent) => void;
  onTextChange: (next: string) => void;
}) {
  if (shape.hidden) return null;
  const selectedStroke = selected ? "var(--neon-cyan)" : shape.stroke;
  const selectedWidth = selected ? Math.max(shape.strokeWidth, 1.25) : shape.strokeWidth;

  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const rot = shape.rotation ?? 0;
  const sx = shape.flipX ? -1 : 1;
  const sy = shape.flipY ? -1 : 1;
  // Build a combined transform: flip in-place around the center first
  // (right-most ops apply first in SVG), then rotate around the same
  // center. Skip the transform entirely when neither is active.
  let rotateTransform: string | undefined;
  if (rot !== 0 || sx !== 1 || sy !== 1) {
    const parts: string[] = [];
    if (rot !== 0) parts.push(`rotate(${rot} ${cx} ${cy})`);
    if (sx !== 1 || sy !== 1) {
      parts.push(`translate(${cx} ${cy})`);
      parts.push(`scale(${sx} ${sy})`);
      parts.push(`translate(${-cx} ${-cy})`);
    }
    rotateTransform = parts.join(" ");
  }
  const opacityAttr = shape.opacity ?? 1;
  const filterAttr =
    (shape.effects ?? []).length > 0 ? `url(#${filterIdFor(shape.id)})` : undefined;
  const fillAttr = shape.fillImage
    ? `url(#${imageFillIdFor(shape.id)})`
    : shape.fillGradient
      ? `url(#${gradientIdFor(shape.id)})`
      : shape.fill;
  const strokeDashArray =
    shape.strokeDash && shape.strokeDash.length > 0
      ? shape.strokeDash.join(" ")
      : undefined;
  const strokeLineCap = shape.strokeCap ?? "butt";
  const strokeLineJoin = shape.strokeJoin ?? "miter";
  // Stroke alignment trick: SVG strokes are centered on the path. For
  // inside/outside, double the stroke width and either clip to the shape
  // (inside, so only the inner half shows) or overdraw with the fill on
  // top (outside via paint-order: stroke fill).
  const strokeAlign = shape.strokeAlign ?? "center";
  const effectiveStrokeWidth =
    strokeAlign === "center" ? selectedWidth : selectedWidth * 2;
  const paintOrderAttr = strokeAlign === "outside" ? "stroke fill markers" : undefined;
  const strokeClipAttr =
    strokeAlign === "inside" ? `url(#xd-sclip-${shape.id})` : undefined;

  if (shape.kind === "rect") {
    // If per-corner radii are set, render as a custom <path>; otherwise
    // a single `rx` rect is enough.
    if (shape.radii) {
      return (
        <path
          d={rectPathD(shape.x, shape.y, shape.w, shape.h, shape.radii)}
          fill={fillAttr}
          stroke={selectedStroke}
          strokeWidth={selectedWidth}
          strokeDasharray={strokeDashArray}
          strokeLinecap={strokeLineCap}
          strokeLinejoin={strokeLineJoin}
          onMouseDown={onMouseDown}
          transform={rotateTransform}
          filter={filterAttr}
          opacity={opacityAttr}
          style={{ cursor: "move" }}
        />
      );
    }
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={shape.radius}
        ry={shape.radius}
        fill={fillAttr}
        stroke={selectedStroke}
        strokeWidth={effectiveStrokeWidth}
        strokeDasharray={strokeDashArray}
        clipPath={strokeClipAttr}
        paintOrder={paintOrderAttr}
        strokeLinecap={strokeLineCap}
        strokeLinejoin={strokeLineJoin}
        onMouseDown={onMouseDown}
        transform={rotateTransform}
        filter={filterAttr}
        opacity={opacityAttr}
        style={{ cursor: "move" }}
      />
    );
  }
  if (shape.kind === "frame") {
    const useCustomPath = !!shape.radii;
    return (
      <g
        style={{ cursor: "move" }}
        onMouseDown={onMouseDown}
        transform={rotateTransform}
        filter={filterAttr}
        opacity={opacityAttr}
      >
        {useCustomPath ? (
          <path
            d={rectPathD(shape.x, shape.y, shape.w, shape.h, shape.radii!)}
            fill={fillAttr}
            stroke={selectedStroke}
            strokeWidth={selectedWidth}
            strokeDasharray={strokeDashArray}
            strokeLinecap={strokeLineCap}
            strokeLinejoin={strokeLineJoin}
          />
        ) : (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            rx={shape.radius}
            ry={shape.radius}
            fill={fillAttr}
            stroke={selectedStroke}
            strokeWidth={selectedWidth}
            strokeDasharray={strokeDashArray}
            strokeLinecap={strokeLineCap}
            strokeLinejoin={strokeLineJoin}
          />
        )}
        <text
          x={shape.x + 4}
          y={shape.y - 6}
          fill={selected ? "var(--neon-cyan)" : "var(--t-tertiary)"}
          fontFamily="var(--f-mono)"
          fontSize={10}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {shape.name}
        </text>
      </g>
    );
  }
  if (shape.kind === "ellipse") {
    return (
      <ellipse
        cx={shape.x + shape.w / 2}
        cy={shape.y + shape.h / 2}
        rx={Math.abs(shape.w) / 2}
        ry={Math.abs(shape.h) / 2}
        fill={fillAttr}
        stroke={selectedStroke}
        strokeWidth={effectiveStrokeWidth}
        strokeDasharray={strokeDashArray}
        clipPath={strokeClipAttr}
        paintOrder={paintOrderAttr}
        onMouseDown={onMouseDown}
        transform={rotateTransform}
        filter={filterAttr}
        opacity={opacityAttr}
        style={{ cursor: "move" }}
      />
    );
  }
  if (shape.kind === "path") {
    // Points are stored in unit space (0..1). Scale the path to (w, h) and
    // translate to (x, y) via a wrapping <g>. Stroke uses vector-effect so
    // it doesn't get squished when the bbox is non-square.
    const d = pathToSvgD(shape.points, shape.closed, shape.subpaths);
    return (
      <g
        onMouseDown={onMouseDown}
        style={{ cursor: "move" }}
        transform={
          rotateTransform
            ? `${rotateTransform} translate(${shape.x} ${shape.y}) scale(${shape.w} ${shape.h})`
            : `translate(${shape.x} ${shape.y}) scale(${shape.w} ${shape.h})`
        }
        filter={filterAttr}
        opacity={opacityAttr}
      >
        <path
          d={d}
          fill={shape.closed ? fillAttr : "none"}
          fillRule={shape.fillRule}
          stroke={selectedStroke}
          strokeWidth={selectedWidth}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin={shape.strokeJoin ?? "round"}
          strokeLinecap={shape.strokeCap ?? "round"}
          strokeDasharray={strokeDashArray}
        />
      </g>
    );
  }
  if (shape.kind === "image") {
    return (
      <g
        onMouseDown={onMouseDown}
        style={{ cursor: "move" }}
        transform={rotateTransform}
        filter={filterAttr}
        opacity={opacityAttr}
      >
        <image
          href={convertFileSrc(shape.filePath)}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          preserveAspectRatio="xMidYMid slice"
        />
        {selected && (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill="none"
            stroke="var(--neon-cyan)"
            strokeWidth={selectedWidth}
            pointerEvents="none"
          />
        )}
      </g>
    );
  }
  // text
  return (
    <g
      onMouseDown={onMouseDown}
      style={{ cursor: "move" }}
      transform={rotateTransform}
      filter={filterAttr}
      opacity={opacityAttr}
    >
      {selected && (
        <rect
          x={shape.x - 4}
          y={shape.y - 4}
          width={shape.w + 8}
          height={shape.h + 8}
          fill="rgba(0,224,255,0.04)"
          stroke="var(--neon-cyan)"
          strokeWidth={1}
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      )}
      <foreignObject x={shape.x} y={shape.y} width={shape.w} height={shape.h}>
        <div
          contentEditable={selected}
          suppressContentEditableWarning
          onBlur={(e) => onTextChange(e.currentTarget.textContent ?? "")}
          onMouseDown={(e) => {
            if (selected) e.stopPropagation();
          }}
          style={{
            width: "100%",
            height: "100%",
            outline: "none",
            color: shape.fill,
            fontFamily: shape.fontFamily ?? "var(--f-display)",
            fontWeight: shape.fontWeight ?? 400,
            fontSize: shape.fontSize,
            lineHeight: shape.lineHeight ?? 1.2,
            letterSpacing:
              typeof shape.letterSpacing === "number"
                ? `${shape.letterSpacing}px`
                : undefined,
            textAlign: shape.textAlign ?? "left",
            textTransform:
              shape.textCase === "upper"
                ? "uppercase"
                : shape.textCase === "lower"
                  ? "lowercase"
                  : shape.textCase === "title"
                    ? "capitalize"
                    : "none",
            textDecoration:
              shape.textDecoration && shape.textDecoration !== "none"
                ? shape.textDecoration === "underline"
                  ? "underline"
                  : "line-through"
                : "none",
            whiteSpace: "pre-wrap",
            cursor: selected ? "text" : "move",
          }}
        >
          {shape.text}
        </div>
      </foreignObject>
    </g>
  );
}

/** Build an SVG path that describes a rect with individually-rounded
 * corners. Each radius is clamped so opposite radii can't overlap. */
function rectPathD(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
): string {
  const [tl0, tr0, br0, bl0] = radii;
  const maxR = Math.min(w, h) / 2;
  const tl = Math.max(0, Math.min(tl0, maxR));
  const tr = Math.max(0, Math.min(tr0, maxR));
  const br = Math.max(0, Math.min(br0, maxR));
  const bl = Math.max(0, Math.min(bl0, maxR));
  // Move to start of top edge (after the TL corner), trace clockwise.
  return [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : ``,
    `L ${x + w} ${y + h - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : ``,
    `L ${x + bl} ${y + h}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : ``,
    `L ${x} ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : ``,
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

function subpathD(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return "";
  const cmds: string[] = [];
  cmds.push(`M ${points[0]!.x} ${points[0]!.y}`);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1]!;
    // Bezier curve when either end of the segment has a handle defined.
    if (
      prev.cpOutX !== undefined ||
      prev.cpOutY !== undefined ||
      p.cpInX !== undefined ||
      p.cpInY !== undefined
    ) {
      const c1x = prev.cpOutX ?? prev.x;
      const c1y = prev.cpOutY ?? prev.y;
      const c2x = p.cpInX ?? p.x;
      const c2y = p.cpInY ?? p.y;
      cmds.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p.x} ${p.y}`);
    } else {
      cmds.push(`L ${p.x} ${p.y}`);
    }
  }
  if (closed) cmds.push("Z");
  return cmds.join(" ");
}

function pathToSvgD(
  points: PathPoint[],
  closed: boolean,
  subpaths?: PathPoint[][],
): string {
  let d = subpathD(points, closed);
  // Extra subpaths (boolean-op holes / disjoint regions) are always closed.
  if (subpaths)
    for (const sp of subpaths) {
      const extra = subpathD(sp, true);
      if (extra) d += " " + extra;
    }
  return d;
}

function CheckerBackground() {
  return (
    <>
      <defs>
        <pattern
          id="xd-grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#xd-grid)" />
    </>
  );
}

export function filterIdFor(shapeId: string): string {
  return `xd-fx-${shapeId}`;
}

export function gradientIdFor(shapeId: string): string {
  return `xd-grad-${shapeId}`;
}

export function imageFillIdFor(shapeId: string): string {
  return `xd-imgfill-${shapeId}`;
}

function ImageFillDef({
  shapeId,
  filePath,
  fit,
}: {
  shapeId: string;
  filePath: string;
  fit: "cover" | "contain";
}) {
  return (
    <pattern
      id={imageFillIdFor(shapeId)}
      patternUnits="objectBoundingBox"
      width={1}
      height={1}
    >
      <image
        href={convertFileSrc(filePath)}
        x={0}
        y={0}
        width={1}
        height={1}
        preserveAspectRatio={
          fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"
        }
      />
    </pattern>
  );
}

function GradientDef({
  shapeId,
  gradient,
}: {
  shapeId: string;
  gradient: Gradient;
}) {
  if (gradient.kind === "linear") {
    const rad = (gradient.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return (
      <linearGradient
        id={gradientIdFor(shapeId)}
        gradientUnits="objectBoundingBox"
        x1={0.5 - cos * 0.5}
        y1={0.5 - sin * 0.5}
        x2={0.5 + cos * 0.5}
        y2={0.5 + sin * 0.5}
      >
        {gradient.stops.map((s, i) => (
          <stop key={i} offset={s.offset} stopColor={s.color} />
        ))}
      </linearGradient>
    );
  }
  if (gradient.kind === "radial") {
    return (
      <radialGradient
        id={gradientIdFor(shapeId)}
        gradientUnits="objectBoundingBox"
        cx={gradient.cx ?? 0.5}
        cy={gradient.cy ?? 0.5}
        r={gradient.r ?? 0.5}
      >
        {gradient.stops.map((s, i) => (
          <stop key={i} offset={s.offset} stopColor={s.color} />
        ))}
      </radialGradient>
    );
  }
  // Angular (conic) — SVG has no native conic; approximate via a stack of
  // many narrow radial-arc slices using <pattern>. For visual fidelity we
  // fake it with a linearGradient that mimics a sweep using stops at fine
  // granularity. Simplest: render as a series of fan slices is overkill —
  // we just emit a conic-gradient via a `mask` + many radials, but that's
  // heavy. Instead: degrade to a linear at the startAngle.
  const start = gradient.startAngle ?? 0;
  const rad = (start * Math.PI) / 180;
  return (
    <linearGradient
      id={gradientIdFor(shapeId)}
      gradientUnits="objectBoundingBox"
      x1={0.5 - Math.cos(rad) * 0.5}
      y1={0.5 - Math.sin(rad) * 0.5}
      x2={0.5 + Math.cos(rad) * 0.5}
      y2={0.5 + Math.sin(rad) * 0.5}
    >
      {gradient.stops.map((s, i) => (
        <stop key={i} offset={s.offset} stopColor={s.color} />
      ))}
    </linearGradient>
  );
}

function ShapeEffectFilter({
  shapeId,
  effects,
}: {
  shapeId: string;
  effects: Effect[];
}) {
  // Effects split into three buckets. Order of compositing (back→front):
  //   drop shadows → source (optionally layer-blurred) → inner shadows.
  const drops = effects.filter(
    (e): e is Extract<Effect, ShadowEffect> & { type: "drop" } =>
      e.kind === "shadow" && (e as ShadowEffect).type === "drop",
  );
  const inners = effects.filter(
    (e): e is Extract<Effect, ShadowEffect> & { type: "inner" } =>
      e.kind === "shadow" && (e as ShadowEffect).type === "inner",
  );
  const blur = effects.find((e) => e.kind === "blur") as
    | LayerBlurEffect
    | undefined;
  if (drops.length === 0 && inners.length === 0 && !blur) return null;

  const blurSourceId = blur ? `blurred-${shapeId}` : undefined;
  const finalSourceIn = blurSourceId ?? "SourceGraphic";

  return (
    <filter
      id={filterIdFor(shapeId)}
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
    >
      {/* Drop shadows */}
      {drops.map((s, i) => {
        const blurId = `blur-d-${shapeId}-${i}`;
        const offId = `off-d-${shapeId}-${i}`;
        const colorId = `col-d-${shapeId}-${i}`;
        const result = `shadow-d-${shapeId}-${i}`;
        return (
          <g key={`d-${i}`}>
            <feGaussianBlur in="SourceAlpha" stdDeviation={s.blur / 2} result={blurId} />
            <feOffset in={blurId} dx={s.offsetX} dy={s.offsetY} result={offId} />
            <feFlood floodColor={s.color} result={colorId} />
            <feComposite in={colorId} in2={offId} operator="in" result={result} />
          </g>
        );
      })}

      {/* Inner shadows. Subtract an offset+blurred alpha from the full
       * source alpha to get the inside-edge mask, then color & clip. */}
      {inners.map((s, i) => {
        const blurId = `blur-i-${shapeId}-${i}`;
        const offId = `off-i-${shapeId}-${i}`;
        const maskId = `mask-i-${shapeId}-${i}`;
        const colorId = `col-i-${shapeId}-${i}`;
        const result = `shadow-i-${shapeId}-${i}`;
        return (
          <g key={`i-${i}`}>
            <feGaussianBlur in="SourceAlpha" stdDeviation={s.blur / 2} result={blurId} />
            <feOffset in={blurId} dx={s.offsetX} dy={s.offsetY} result={offId} />
            <feComposite
              in="SourceAlpha"
              in2={offId}
              operator="arithmetic"
              k2={1}
              k3={-1}
              result={maskId}
            />
            <feFlood floodColor={s.color} result={colorId} />
            <feComposite in={colorId} in2={maskId} operator="in" result={result} />
          </g>
        );
      })}

      {/* Layer blur on the source. */}
      {blur && (
        <feGaussianBlur
          in="SourceGraphic"
          stdDeviation={blur.radius}
          result={blurSourceId}
        />
      )}

      <feMerge>
        {drops.map((_, i) => (
          <feMergeNode key={`m-d-${i}`} in={`shadow-d-${shapeId}-${i}`} />
        ))}
        <feMergeNode in={finalSourceIn} />
        {inners.map((_, i) => (
          <feMergeNode key={`m-i-${i}`} in={`shadow-i-${shapeId}-${i}`} />
        ))}
      </feMerge>
    </filter>
  );
}
