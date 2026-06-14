import { create } from "zustand";
import { ulid } from "ulid";
import { booleanShapes, type BoolOp } from "./booleanOps";
import type { ConstraintH, ConstraintV } from "./constraints";
import {
  applyOverrides,
  captureOverride,
  type OverrideMap,
} from "./overrides";
import { resolveVariant } from "./variants";
import type { ProtoLink } from "./prototype";

export type ToolId =
  | "select"
  | "rect"
  | "ellipse"
  | "text"
  | "image"
  | "frame"
  | "pen";

export type GradientStop = { offset: number; color: string };
export type LinearGradient = {
  kind: "linear";
  /** Direction in degrees. 0 = horizontal (left→right), 90 = vertical (top→bottom). */
  angle: number;
  stops: GradientStop[];
};
export type RadialGradient = {
  kind: "radial";
  /** Optional center (unit space 0..1, default 0.5 / 0.5). */
  cx?: number;
  cy?: number;
  /** Optional radius (unit space 0..1, default 0.5). */
  r?: number;
  stops: GradientStop[];
};
export type AngularGradient = {
  kind: "angular";
  /** Starting angle in degrees (default 0 = right). */
  startAngle?: number;
  stops: GradientStop[];
};
export type Gradient = LinearGradient | RadialGradient | AngularGradient;

export type ShadowEffect = {
  kind: "shadow";
  type: "drop" | "inner";
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
};

export type LayerBlurEffect = {
  kind: "blur";
  radius: number;
};

export type Effect = ShadowEffect | LayerBlurEffect;

export type ShapeBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Optional stroke dash pattern (alternating dash + gap lengths). Empty
   * array or undefined means solid. */
  strokeDash?: number[];
  /** Line-cap style applied at open path endpoints. */
  strokeCap?: "butt" | "round" | "square";
  /** Line-join style at corners. */
  strokeJoin?: "miter" | "round" | "bevel";
  /** Where the stroke sits relative to the shape edge. Default center. */
  strokeAlign?: "center" | "inside" | "outside";
  /** Optional gradient fill. When set, overrides `fill` for rendering;
   * `fill` is kept as the fallback solid color the user goes back to when
   * they toggle gradient off. */
  fillGradient?: Gradient;
  /** Optional image fill. Wins over `fillGradient` and `fill`. The asset's
   * absolute path is stored so the next session can rebuild the URL. */
  fillImage?: {
    filePath: string;
    assetId: string | null;
    fit: "cover" | "contain";
  };
  /** Rotation in degrees, applied around the shape's center. Optional so
   * pre-rotation shapes hydrate cleanly. */
  rotation?: number;
  /** Horizontal / vertical flip — applied around the shape's center after
   * rotation. */
  flipX?: boolean;
  flipY?: boolean;
  /** 0..1. Default 1 (fully opaque). */
  opacity?: number;
  /** Hide from the canvas (still listed in the layers panel, dimmed). */
  hidden?: boolean;
  /** Lock against selection, drag, and resize. */
  locked?: boolean;
  /** Auto-layout sizing for this shape, used when its parent has a layout
   * mode set. "hug" = size to content (only meaningful for frames),
   * "fill" = expand to fill remaining space, "fixed" = use stored w/h. */
  layoutSizingH?: "fixed" | "hug" | "fill";
  layoutSizingV?: "fixed" | "hug" | "fill";
  /** Opt out of auto-layout flow — child is positioned absolutely inside
   * the frame using its stored x/y. */
  layoutPositioning?: "auto" | "absolute";
  /** Resize constraints — how this child reflows when its parent frame
   * (with no auto-layout) resizes. Unset = left/top (Figma default). Only
   * meaningful when the shape has a parent frame. */
  constraintH?: ConstraintH;
  constraintV?: ConstraintV;
  /** Marks this shape as a main component (the source-of-truth template).
   * Other shapes can link to it via `linkedMainId`. Currently only frames
   * are typically made main, but the field lives on the base so any kind
   * can in principle be promoted. */
  isMain?: boolean;
  /** If set, this shape is an instance linked to a main component with
   * this id. "Sync from main" recreates the instance subtree from main;
   * "detach" clears this on the shape and all its descendants. */
  linkedMainId?: string;
  /** The specific MAIN-descendant id this instance node was cloned from.
   * Stable across re-clones, so it's the durable key for per-node overrides. */
  linkedNodeId?: string;
  /** Per-instance override patches, stored on the instance ROOT only, keyed by
   * the main-descendant id (`linkedNodeId`). Visual/size/text props are
   * absolute; x/y are offsets from the instance root. Re-applied by
   * `syncFromMain` so local edits survive a sync. */
  overrides?: OverrideMap;
  /** Marks a frame as a variant SET — its child main components are the
   * variants, each tagged with `variantProps`. */
  isVariantSet?: boolean;
  /** On a main component inside a variant set: this variant's property values
   * (e.g. { State: "hover", Size: "lg" }). */
  variantProps?: Record<string, string>;
  /** On an instance of a variant set: the currently-selected property combo.
   * Resolving it picks which member main the instance mirrors. */
  variantSelection?: Record<string, string>;
  /** Prototype hotspot — in present mode, clicking this shape navigates to a
   * target screen (or back). Top-level frames are the screens. */
  prototype?: ProtoLink;
  /** Frame this shape belongs to. null = top-level. Children share the
   * frame's coordinate space at the world level (we don't apply nested
   * transforms yet) — moving the frame just moves descendants together. */
  parentId?: string | null;
  /** Stacked effects (drop shadow, blur, etc.). Rendered as an SVG
   * <filter> chain. Optional so pre-effect shapes hydrate cleanly. */
  effects?: Effect[];
};

export type RectShape = ShapeBase & {
  kind: "rect";
  radius: number;
  /** Optional per-corner override [tl, tr, br, bl]. When present, `radius`
   * is the fallback used by the Inspector "all corners" field but rendering
   * uses each of the four entries. */
  radii?: [number, number, number, number];
};
export type EllipseShape = ShapeBase & { kind: "ellipse" };
export type TextShape = ShapeBase & {
  kind: "text";
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  textCase?: "as-typed" | "upper" | "lower" | "title";
  textDecoration?: "none" | "underline" | "strikethrough";
};
export type ImageShape = ShapeBase & {
  kind: "image";
  /** Absolute path on disk (so the next session can rebuild the asset URL). */
  filePath: string;
  /** Asset id from useAssetsStore — used to find a fresh path if the asset
   * was moved/replaced. Optional so hand-built images still work. */
  assetId: string | null;
};
export type FrameShape = ShapeBase & {
  kind: "frame";
  radius: number;
  radii?: [number, number, number, number];
  /** Clip descendants to the frame's bounds. */
  clipContent?: boolean;
  /** Auto-layout: how children flow inside the frame. "none" = freeform. */
  layoutMode?: "none" | "horizontal" | "vertical";
  /** Gap between flowed children (px). */
  itemSpacing?: number;
  /** Frame padding — each side. */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Primary-axis alignment of the child pack. */
  primaryAxisAlign?: "min" | "center" | "max" | "space-between";
  /** Counter-axis alignment of each child within the row/column. */
  counterAxisAlign?: "min" | "center" | "max";
};

/** A vector point in unit space (0..1) relative to the shape's bbox.
 * Optional bezier handles use the same unit space. */
export type PathPoint = {
  x: number;
  y: number;
  /** Outgoing tangent handle (for the curve leaving this point). */
  cpOutX?: number;
  cpOutY?: number;
  /** Incoming tangent handle (for the curve arriving at this point). */
  cpInX?: number;
  cpInY?: number;
};

export type PathShape = ShapeBase & {
  kind: "path";
  points: PathPoint[];
  closed: boolean;
  /** Additional closed subpaths (holes / disjoint regions), produced by
   * boolean ops. Each is a list of unit-space points like `points`. When
   * present the shape renders with even-odd fill so holes punch through. */
  subpaths?: PathPoint[][];
  /** SVG fill rule. Defaults to "nonzero"; boolean results use "evenodd". */
  fillRule?: "nonzero" | "evenodd";
};

export type Shape =
  | RectShape
  | EllipseShape
  | TextShape
  | ImageShape
  | FrameShape
  | PathShape;

export type ShapePatch = Partial<Omit<Shape, "id" | "kind" | "name">> & {
  name?: string;
};

export type Viewport = { x: number; y: number; zoom: number };

export type Page = {
  id: string;
  name: string;
  shapes: Shape[];
  /** Per-page undo/redo stacks. Each page owns its own history so switching
   * pages doesn't apply one page's undo to another. Not persisted (stripped
   * on save, re-initialized empty on hydrate). */
  past: Shape[][];
  future: Shape[][];
};

/** Design-token variable. v1 ships color tokens; numbers/strings/booleans
 * can follow when the use cases land. */
export type Variable = {
  id: string;
  name: string;
  type: "color" | "number";
  /** modeId → value (string for color, number for number). */
  values: Record<string, string | number>;
};

export type Mode = {
  id: string;
  name: string;
};

type XDesignState = {
  /** Layer order: index 0 = bottom layer. Render order matches array order;
   * the layers panel displays them top-first (reversed) for the usual UX.
   * Mirrors `pages[active].shapes` — kept top-level for hot-path access. */
  shapes: Shape[];
  /** Set of selected shape ids. Iteration order matches insertion order. */
  selection: Set<string>;
  tool: ToolId;
  /** Pages of this document. Always at least one (the default "Page 1"). */
  pages: Page[];
  activePageId: string;
  switchPage: (id: string) => void;
  newPage: (name?: string) => string;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  /** Pan/zoom in screen-space. Document coords go through this transform on
   * render; mouse coords undo it. Not persisted — every session starts at
   * (0, 0, 1). */
  viewport: Viewport;

  setTool: (tool: ToolId) => void;

  addShape: (
    shape:
      | (Omit<RectShape, "id" | "name"> & { name?: string })
      | (Omit<EllipseShape, "id" | "name"> & { name?: string })
      | (Omit<TextShape, "id" | "name"> & { name?: string })
      | (Omit<ImageShape, "id" | "name"> & { name?: string })
      | (Omit<FrameShape, "id" | "name"> & { name?: string })
      | (Omit<PathShape, "id" | "name"> & { name?: string }),
  ) => string;
  updateShape: (id: string, patch: ShapePatch) => void;
  /** Apply the same patch to every shape (used for batch moves while
   * multi-selected). The caller is responsible for computing per-shape
   * deltas if needed; this just maps the function over the targets. */
  patchMany: (ids: string[], fn: (s: Shape) => ShapePatch) => void;
  deleteShapes: (ids: string[]) => void;

  select: (id: string | null) => void;
  selectMany: (ids: string[]) => void;
  toggleInSelection: (id: string) => void;
  clearSelection: () => void;

  /** Move a shape one slot up/down in the layer stack. */
  moveLayer: (id: string, dir: 1 | -1) => void;
  /** Z-order extremes — to front / to back. */
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  /** Wrap the given shapes in a fresh frame whose bbox encloses them.
   * Returns the new frame's id. */
  groupAsFrame: (ids: string[]) => string | null;
  /** For each frame in `ids`, move its descendants to the frame's parent
   * (preserving order) and delete the frame. */
  ungroup: (ids: string[]) => void;

  /** Combine the given shapes (z-order: index 0 = bottom) into a single
   * closed vector path via a boolean op. The result inherits the bottom-most
   * shape's style and z-position; operands (and their descendants) are
   * removed. Returns the new path's id, or null if the result is empty. */
  booleanOp: (op: BoolOp, ids: string[]) => string | null;

  /** Promote a shape (typically a frame) to a main component, OR clear
   * the main flag if already set. */
  toggleMainComponent: (id: string) => void;
  /** Deep-clone the main component (and its descendants) as an instance.
   * Placed at `at` if given, else offset to the right of the main. Returns
   * the new instance root id. */
  createInstance: (mainId: string, at?: { x: number; y: number }) => string | null;
  /** Re-clone an instance from its current main, preserving the instance's
   * stored position AND its recorded per-node overrides (main wins for
   * non-overridden props; the override wins for props the user touched). */
  syncFromMain: (instanceId: string) => void;
  /** Drop all of an instance's overrides and re-sync it to match main. */
  resetInstanceOverrides: (instanceId: string) => void;

  /** Set or clear a shape's prototype hotspot link. */
  setPrototype: (id: string, link: ProtoLink | undefined) => void;

  /** Mark / unmark a frame as a variant set (its main children = variants). */
  toggleVariantSet: (id: string) => void;
  /** Set a main component's variant property values (within a variant set). */
  setVariantProps: (id: string, props: Record<string, string>) => void;
  /** Pick a variant combination for an instance: resolves the matching member
   * main, re-points the instance to it, and re-clones (position + overrides
   * preserved). No-op if the instance doesn't belong to a variant set. */
  setVariantSelection: (
    instanceId: string,
    selection: Record<string, string>,
  ) => void;
  /** Clear linkedMainId on the instance and all its descendants. The
   * resulting shapes are independent of the main. */
  detachInstance: (instanceId: string) => void;
  /** Drag-reparent helper. Move `childId` to be a child of `newParentId`
   * (null = top-level). Cycle-safe (rejects if newParent is a descendant
   * of childId). */
  reparent: (childId: string, newParentId: string | null) => void;

  /** Design-token variables — document-wide. */
  variables: Variable[];
  modes: Mode[];
  activeModeId: string;
  addVariable: (name: string, value: string | number, type?: "color" | "number") => string;
  removeVariable: (id: string) => void;
  renameVariable: (id: string, name: string) => void;
  setVariableValue: (id: string, modeId: string, value: string | number) => void;
  addMode: (name: string) => string;
  removeMode: (id: string) => void;
  renameMode: (id: string, name: string) => void;
  setActiveMode: (id: string) => void;

  /** Bulk-replace shapes from a persisted snapshot. Accepts a raw shape
   * array (legacy format) OR a full document with pages + variables. */
  hydrate: (
    snapshot:
      | Shape[]
      | {
          pages: Page[];
          activePageId: string;
          variables?: Variable[];
          modes?: Mode[];
          activeModeId?: string;
        }
      | null,
  ) => void;

  pan: (dx: number, dy: number) => void;
  /** Zoom around a screen-space anchor so the document point under the
   * cursor stays put. `factor` is multiplicative (>1 zooms in). */
  zoomAt: (factor: number, anchor: { x: number; y: number }) => void;
  resetViewport: () => void;

  /** Snap moved/drawn shapes to a fixed grid. Off by default. */
  gridSnap: boolean;
  gridSize: number;
  toggleGridSnap: () => void;
  setGridSize: (size: number) => void;

  /** History stacks for undo/redo. Only document-shape state goes in — not
   * selection, tool, or viewport (those are ephemeral UI state and shouldn't
   * be part of the user's mental "what I did" model). */
  past: Shape[][];
  future: Shape[][];
  /** When set, an agent "turn" is in progress: every batch applied through
   * runCanvasCommands collapses back to THIS baseline, so a whole multi-call
   * turn is a single undo step. Null = normal per-batch undo. `pageId` pins
   * the baseline to its page so a mid-turn page switch can't collapse one
   * page's shapes onto another. */
  coalesce: { shapes: Shape[]; past: Shape[][]; pageId: string } | null;
  /** Begin coalescing canvas history into one undo step (snapshots the
   * current shapes + past as the turn baseline). */
  beginHistoryCoalesce: () => void;
  /** Stop coalescing. Safe to call when not coalescing. */
  endHistoryCoalesce: () => void;
  /** Snapshot the current shapes onto the past stack. Call BEFORE any
   * mutation that should be undoable. Clears the future stack. */
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  /** Clipboard for copy/cut/paste. In-memory only — pastes outlive a
   * selection change but not a window reload. */
  clipboard: Shape[];
  copy: (ids: string[]) => void;
  cut: (ids: string[]) => void;
  /** Paste the clipboard into the document, offsetting by (dx, dy). Returns
   * the freshly-minted ids so callers can select them. */
  paste: (dx?: number, dy?: number) => string[];
  /** Clone the given shapes in-place with a small offset (default 12,12).
   * Returns the new ids. */
  duplicate: (ids: string[]) => string[];
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const MAX_HISTORY = 80;

function defaultNameFor(kind: Shape["kind"], idx: number): string {
  const base =
    kind === "rect"
      ? "Rectangle"
      : kind === "ellipse"
        ? "Ellipse"
        : kind === "image"
          ? "Image"
          : kind === "frame"
            ? "Frame"
            : kind === "path"
              ? "Path"
              : "Text";
  return `${base} ${idx}`;
}

const DEFAULT_PAGE_ID = "page-default";
const DEFAULT_MODE_ID = "mode-default";

export const useXDesign = create<XDesignState>((set, get) => ({
  shapes: [],
  selection: new Set(),
  tool: "select",
  pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: [], past: [], future: [] }],
  activePageId: DEFAULT_PAGE_ID,
  variables: [],
  modes: [{ id: DEFAULT_MODE_ID, name: "Default" }],
  activeModeId: DEFAULT_MODE_ID,
  addVariable: (name, value, type = "color") => {
    const id = ulid();
    set((s) => ({
      variables: [
        ...s.variables,
        {
          id,
          name,
          type,
          // Seed the current mode + any other existing modes with this value.
          values: Object.fromEntries(s.modes.map((m) => [m.id, value])),
        },
      ],
    }));
    return id;
  },
  removeVariable: (id) =>
    set((s) => ({ variables: s.variables.filter((v) => v.id !== id) })),
  renameVariable: (id, name) =>
    set((s) => ({
      variables: s.variables.map((v) => (v.id === id ? { ...v, name } : v)),
    })),
  setVariableValue: (id, modeId, value) =>
    set((s) => ({
      variables: s.variables.map((v) =>
        v.id === id ? { ...v, values: { ...v.values, [modeId]: value } } : v,
      ),
    })),
  addMode: (name) => {
    const id = ulid();
    set((s) => ({
      modes: [...s.modes, { id, name }],
      // New mode inherits values from the first existing mode so designs
      // don't suddenly become null-valued when switching.
      variables: s.variables.map((v) => {
        const firstMode = s.modes[0]?.id;
        const seed =
          firstMode !== undefined
            ? v.values[firstMode] ?? Object.values(v.values)[0]
            : Object.values(v.values)[0];
        return seed !== undefined
          ? { ...v, values: { ...v.values, [id]: seed } }
          : v;
      }),
    }));
    return id;
  },
  removeMode: (id) =>
    set((s) => {
      if (s.modes.length <= 1) return s;
      const modes = s.modes.filter((m) => m.id !== id);
      const variables = s.variables.map((v) => {
        const { [id]: _drop, ...rest } = v.values;
        return { ...v, values: rest };
      });
      const activeModeId =
        s.activeModeId === id ? modes[0]!.id : s.activeModeId;
      return { modes, variables, activeModeId };
    }),
  renameMode: (id, name) =>
    set((s) => ({
      modes: s.modes.map((m) => (m.id === id ? { ...m, name } : m)),
    })),
  setActiveMode: (id) =>
    set((s) => (s.modes.some((m) => m.id === id) ? { activeModeId: id } : s)),
  switchPage: (id) =>
    set((s) => {
      if (id === s.activePageId) return s;
      const target = s.pages.find((p) => p.id === id);
      if (!target) return s;
      // Snapshot the active page's live shapes + undo stacks back into pages,
      // then load the target page's stacks. History is per-page.
      const pages = s.pages.map((p) =>
        p.id === s.activePageId
          ? { ...p, shapes: s.shapes, past: s.past, future: s.future }
          : p,
      );
      return {
        pages,
        activePageId: id,
        shapes: target.shapes,
        past: target.past ?? [],
        future: target.future ?? [],
        selection: new Set(),
      };
    }),
  newPage: (name) => {
    const id = ulid();
    set((s) => {
      const pages = s.pages.map((p) =>
        p.id === s.activePageId
          ? { ...p, shapes: s.shapes, past: s.past, future: s.future }
          : p,
      );
      const fresh: Page = {
        id,
        name: name?.trim() || `Page ${pages.length + 1}`,
        shapes: [],
        past: [],
        future: [],
      };
      return {
        pages: [...pages, fresh],
        activePageId: id,
        shapes: [],
        past: [],
        future: [],
        selection: new Set(),
      };
    });
    return id;
  },
  renamePage: (id, name) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)),
    })),
  deletePage: (id) =>
    set((s) => {
      if (s.pages.length <= 1) return s; // never delete the last page
      const remaining = s.pages.filter((p) => p.id !== id);
      // If active page is being deleted, swap into the previous page.
      let nextActive = s.activePageId;
      let nextShapes = s.shapes;
      let nextSelection = s.selection;
      let nextPast = s.past;
      let nextFuture = s.future;
      if (id === s.activePageId) {
        const fallback = remaining[0]!;
        nextActive = fallback.id;
        nextShapes = fallback.shapes;
        nextSelection = new Set();
        nextPast = fallback.past ?? [];
        nextFuture = fallback.future ?? [];
      }
      return {
        pages: remaining,
        activePageId: nextActive,
        shapes: nextShapes,
        past: nextPast,
        future: nextFuture,
        selection: nextSelection,
      };
    }),
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],
  coalesce: null,
  clipboard: [],
  gridSnap: false,
  gridSize: 8,

  beginHistoryCoalesce: () =>
    set((s) => ({
      coalesce: { shapes: s.shapes, past: s.past, pageId: s.activePageId },
    })),
  endHistoryCoalesce: () => set({ coalesce: null }),

  setTool: (tool) => set({ tool }),

  addShape: (shape) => {
    get().pushHistory();
    const id = ulid();
    const idx = get().shapes.length + 1;
    const name = shape.name ?? defaultNameFor(shape.kind, idx);
    const full = { ...shape, id, name } as Shape;
    set((s) => ({
      shapes: [...s.shapes, full],
      selection: new Set([id]),
    }));
    return id;
  },

  updateShape: (id, patch) =>
    set((s) => {
      const target = s.shapes.find((sh) => sh.id === id);
      // If the target is an instance node, record the edit as an override on
      // the instance root so a later syncFromMain doesn't wipe it.
      const cap = target?.linkedMainId
        ? captureOverride(s.shapes, id, patch as Record<string, unknown>)
        : null;
      // Moving a shape's x/y carries its descendants by the same delta —
      // frames take their contents with them. Positions are absolute, so a
      // flat patch would otherwise leave children behind (this matches the
      // canvas drag, and fixes the inspector + agent `update` paths). Non-
      // position patches don't cascade.
      const dx = target && patch.x !== undefined ? patch.x - target.x : 0;
      const dy = target && patch.y !== undefined ? patch.y - target.y : 0;
      let next: Shape[];
      if (target && (dx !== 0 || dy !== 0)) {
        const descendants = new Set(collectDescendantIds(s.shapes, id));
        descendants.delete(id);
        next = s.shapes.map((sh) => {
          if (sh.id === id) return { ...sh, ...patch } as Shape;
          if (descendants.has(sh.id))
            return { ...sh, x: sh.x + dx, y: sh.y + dy } as Shape;
          return sh;
        });
      } else {
        next = s.shapes.map((sh) =>
          sh.id === id ? ({ ...sh, ...patch } as Shape) : sh,
        );
      }
      if (cap) {
        next = next.map((sh) =>
          sh.id === cap.rootId ? ({ ...sh, overrides: cap.overrides } as Shape) : sh,
        );
      }
      return { shapes: next };
    }),

  patchMany: (ids, fn) =>
    set((s) => {
      const targetIds = new Set(ids);
      return {
        shapes: s.shapes.map((sh) =>
          targetIds.has(sh.id) ? ({ ...sh, ...fn(sh) } as Shape) : sh,
        ),
      };
    }),

  deleteShapes: (ids) => {
    get().pushHistory();
    set((s) => {
      const drop = new Set(ids);
      const nextSel = new Set<string>();
      for (const id of s.selection) if (!drop.has(id)) nextSel.add(id);
      return {
        shapes: s.shapes.filter((sh) => !drop.has(sh.id)),
        selection: nextSel,
      };
    });
  },

  select: (id) =>
    set({
      selection: id ? new Set([id]) : new Set(),
    }),

  selectMany: (ids) => set({ selection: new Set(ids) }),

  toggleInSelection: (id) =>
    set((s) => {
      const next = new Set(s.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selection: next };
    }),

  clearSelection: () => set({ selection: new Set() }),

  moveLayer: (id, dir) => {
    get().pushHistory();
    set((s) => {
      const idx = s.shapes.findIndex((sh) => sh.id === id);
      if (idx < 0) return s;
      const target = idx + dir;
      if (target < 0 || target >= s.shapes.length) return s;
      const next = s.shapes.slice();
      const [moved] = next.splice(idx, 1);
      if (!moved) return s;
      next.splice(target, 0, moved);
      return { shapes: next };
    });
  },

  bringToFront: (ids) => {
    if (ids.length === 0) return;
    get().pushHistory();
    set((s) => {
      const targetSet = new Set(ids);
      const kept = s.shapes.filter((sh) => !targetSet.has(sh.id));
      const moved = s.shapes.filter((sh) => targetSet.has(sh.id));
      return { shapes: [...kept, ...moved] };
    });
  },

  sendToBack: (ids) => {
    if (ids.length === 0) return;
    get().pushHistory();
    set((s) => {
      const targetSet = new Set(ids);
      const kept = s.shapes.filter((sh) => !targetSet.has(sh.id));
      const moved = s.shapes.filter((sh) => targetSet.has(sh.id));
      return { shapes: [...moved, ...kept] };
    });
  },

  groupAsFrame: (ids) => {
    if (ids.length === 0) return null;
    const cur = get();
    const targets = cur.shapes.filter((s) => ids.includes(s.id));
    if (targets.length === 0) return null;
    cur.pushHistory();
    const minX = Math.min(...targets.map((s) => s.x));
    const minY = Math.min(...targets.map((s) => s.y));
    const maxX = Math.max(...targets.map((s) => s.x + s.w));
    const maxY = Math.max(...targets.map((s) => s.y + s.h));
    const PAD = 8;
    const frameId = ulid();
    const newFrame = {
      id: frameId,
      name: `Group ${cur.shapes.length + 1}`,
      kind: "frame" as const,
      x: minX - PAD,
      y: minY - PAD,
      w: maxX - minX + PAD * 2,
      h: maxY - minY + PAD * 2,
      radius: 8,
      fill: "transparent",
      stroke: "rgba(255,255,255,0.12)",
      strokeWidth: 1,
    };
    set((s) => {
      // Put the new frame just before the topmost selected shape in the stack
      // (so it renders behind them — children paint over the frame's fill).
      const topIdx = Math.max(
        ...targets.map((t) => s.shapes.findIndex((x) => x.id === t.id)),
      );
      const insertAt = topIdx;
      const without = s.shapes.filter((x) => !ids.includes(x.id));
      const reparented = s.shapes
        .filter((x) => ids.includes(x.id))
        .map((x) => ({ ...x, parentId: frameId }));
      const merged: Shape[] = [...without];
      merged.splice(insertAt, 0, newFrame, ...reparented);
      return { shapes: merged, selection: new Set([frameId]) };
    });
    return frameId;
  },

  ungroup: (ids) => {
    const cur = get();
    const frames = cur.shapes.filter(
      (s) => ids.includes(s.id) && s.kind === "frame",
    );
    if (frames.length === 0) return;
    cur.pushHistory();
    set((s) => {
      let shapes = s.shapes.slice();
      const liftedIds: string[] = [];
      for (const f of frames) {
        // Re-parent every direct child to f's parent.
        shapes = shapes.map((c) =>
          c.parentId === f.id ? { ...c, parentId: f.parentId ?? null } : c,
        );
        for (const c of shapes) if (c.parentId === (f.parentId ?? null) && c.id !== f.id) liftedIds.push(c.id);
      }
      // Now drop the frames themselves.
      const frameIds = new Set(frames.map((f) => f.id));
      shapes = shapes.filter((c) => !frameIds.has(c.id));
      return { shapes, selection: new Set(liftedIds) };
    });
  },

  booleanOp: (op, ids) => {
    const cur = get();
    // Operands in z-order (bottom-most first) — matters for subtract + style.
    const targets = cur.shapes.filter((s) => ids.includes(s.id));
    if (targets.length < 2) return null;
    const result = booleanShapes(op, targets);
    if (!result) return null;

    const bottom = targets[0]!;
    cur.pushHistory();
    const pathId = ulid();
    const newPath = {
      id: pathId,
      name: `Boolean ${cur.shapes.length + 1}`,
      kind: "path" as const,
      x: result.x,
      y: result.y,
      w: result.w,
      h: result.h,
      points: result.points,
      subpaths: result.subpaths.length ? result.subpaths : undefined,
      fillRule: "evenodd" as const,
      closed: true,
      fill: bottom.fill,
      stroke: bottom.stroke,
      strokeWidth: bottom.strokeWidth,
      fillGradient: bottom.fillGradient,
      opacity: bottom.opacity,
      parentId: bottom.parentId ?? null,
    };
    set((s) => {
      // Remove operands and any descendants (a selected frame takes its
      // subtree) so nothing is orphaned with a dangling parentId.
      const drop = new Set<string>();
      for (const id of ids)
        for (const d of collectDescendantIds(s.shapes, id)) drop.add(d);
      const insertAt = Math.max(
        ...targets.map((t) => s.shapes.findIndex((x) => x.id === t.id)),
      );
      const merged: Shape[] = [];
      let inserted = false;
      s.shapes.forEach((sh, i) => {
        if (i === insertAt) {
          merged.push(newPath as Shape);
          inserted = true;
        }
        if (!drop.has(sh.id)) merged.push(sh);
      });
      if (!inserted) merged.push(newPath as Shape);
      return { shapes: merged, selection: new Set([pathId]) };
    });
    return pathId;
  },

  toggleMainComponent: (id) => {
    get().pushHistory();
    set((s) => ({
      shapes: s.shapes.map((sh) =>
        sh.id === id ? ({ ...sh, isMain: !sh.isMain } as Shape) : sh,
      ),
    }));
  },

  createInstance: (mainId, at) => {
    const cur = get();
    const main = cur.shapes.find((s) => s.id === mainId);
    if (!main) return null;
    cur.pushHistory();
    // Collect main + its descendants in document order.
    const subtreeIds = collectDescendantIds(cur.shapes, mainId);
    const subtree = cur.shapes.filter((s) => subtreeIds.includes(s.id));
    // Build an id map: oldId → newId.
    const idMap = new Map<string, string>();
    for (const s of subtree) idMap.set(s.id, ulid());
    // Place the instance: at an explicit position if given, else offset to the
    // right of the main so it doesn't overlap. The whole subtree shifts by the
    // same delta (positions are absolute), so children stay with their root.
    const dx = at ? at.x - main.x : main.w + 40;
    const dy = at ? at.y - main.y : 0;
    const newShapes: Shape[] = subtree.map((s) => {
      const newId = idMap.get(s.id)!;
      // Re-parent: if parent is in the cloned set, use mapped id;
      //            else parent is the document root.
      const newParent = s.parentId ? idMap.get(s.parentId) ?? null : null;
      const node = {
        ...s,
        id: newId,
        x: s.x + dx,
        y: s.y + dy,
        parentId: newParent,
        // Drop the isMain marker — instances are not main.
        isMain: false,
        // Link the entire subtree to the main so sync/detach work.
        linkedMainId: mainId,
        // Remember the exact main node this clone mirrors (stable override key).
        linkedNodeId: s.id,
      } as Shape;
      // Instancing a variant member: the root tracks the chosen combo via
      // variantSelection and never carries the member's variantProps marker.
      if (s.id === mainId) {
        return {
          ...node,
          variantProps: undefined,
          isVariantSet: undefined,
          variantSelection: main.variantProps,
        } as Shape;
      }
      return node;
    });
    const newRootId = idMap.get(mainId)!;
    set((s) => ({
      shapes: [...s.shapes, ...newShapes],
      selection: new Set([newRootId]),
    }));
    return newRootId;
  },

  syncFromMain: (instanceId) => {
    const cur = get();
    const inst = cur.shapes.find((s) => s.id === instanceId);
    if (!inst || !inst.linkedMainId) return;
    if (!cur.shapes.some((s) => s.id === inst.linkedMainId)) return;
    cur.pushHistory();
    set((s) => ({ shapes: recloneInstance(s.shapes, instanceId) }));
  },

  resetInstanceOverrides: (instanceId) => {
    const cur = get();
    const inst = cur.shapes.find((s) => s.id === instanceId);
    if (!inst || !inst.linkedMainId) return;
    if (!cur.shapes.some((s) => s.id === inst.linkedMainId)) return;
    cur.pushHistory();
    set((s) => {
      // Clear the root's overrides, then re-clone so it matches main exactly.
      const cleared = s.shapes.map((sh) =>
        sh.id === instanceId ? ({ ...sh, overrides: undefined } as Shape) : sh,
      );
      return { shapes: recloneInstance(cleared, instanceId) };
    });
  },

  setPrototype: (id, link) => {
    get().pushHistory();
    set((s) => ({
      shapes: s.shapes.map((sh) =>
        sh.id === id ? ({ ...sh, prototype: link } as Shape) : sh,
      ),
    }));
  },

  toggleVariantSet: (id) => {
    get().pushHistory();
    set((s) => ({
      shapes: s.shapes.map((sh) =>
        sh.id === id ? ({ ...sh, isVariantSet: !sh.isVariantSet } as Shape) : sh,
      ),
    }));
  },

  setVariantProps: (id, props) => {
    get().pushHistory();
    set((s) => ({
      shapes: s.shapes.map((sh) =>
        sh.id === id ? ({ ...sh, variantProps: props } as Shape) : sh,
      ),
    }));
  },

  setVariantSelection: (instanceId, selection) => {
    const cur = get();
    const inst = cur.shapes.find((s) => s.id === instanceId);
    if (!inst || !inst.linkedMainId) return;
    const curMain = cur.shapes.find((s) => s.id === inst.linkedMainId);
    if (!curMain) return;
    const setFrame = curMain.parentId
      ? cur.shapes.find((s) => s.id === curMain.parentId)
      : undefined;
    if (!setFrame || !setFrame.isVariantSet) return;
    const members = cur.shapes.filter(
      (s) => s.parentId === setFrame.id && s.isMain,
    );
    const memberId = resolveVariant(
      members.map((m) => ({ id: m.id, variantProps: m.variantProps })),
      selection,
    );
    if (!memberId) return;
    cur.pushHistory();
    set((s) => {
      // Re-point the instance to the resolved member + record the selection,
      // then re-clone from that member (recloneInstance keeps the selection
      // and preserves position + overrides).
      const repointed = s.shapes.map((sh) =>
        sh.id === instanceId
          ? ({ ...sh, linkedMainId: memberId, variantSelection: selection } as Shape)
          : sh,
      );
      return { shapes: recloneInstance(repointed, instanceId) };
    });
  },

  detachInstance: (instanceId) => {
    get().pushHistory();
    set((s) => {
      const subtreeIds = new Set(collectDescendantIds(s.shapes, instanceId));
      return {
        shapes: s.shapes.map((sh) =>
          subtreeIds.has(sh.id)
            ? ({
                ...sh,
                linkedMainId: undefined,
                linkedNodeId: undefined,
                overrides: undefined,
              } as Shape)
            : sh,
        ),
      };
    });
  },

  reparent: (childId, newParentId) => {
    const cur = get();
    if (childId === newParentId) return;
    if (newParentId) {
      // Cycle-protect — newParentId can't be a descendant of childId.
      const desc = collectDescendantIds(cur.shapes, childId);
      if (desc.includes(newParentId)) return;
    }
    const child = cur.shapes.find((s) => s.id === childId);
    if (!child) return;
    if ((child.parentId ?? null) === (newParentId ?? null)) return;
    cur.pushHistory();
    set((s) => ({
      shapes: s.shapes.map((sh) =>
        sh.id === childId ? ({ ...sh, parentId: newParentId ?? null } as Shape) : sh,
      ),
    }));
  },

  hydrate: (snapshot) => {
    if (snapshot && !Array.isArray(snapshot) && Array.isArray(snapshot.pages)) {
      // Undo stacks aren't persisted — re-initialize each page's history empty.
      const pages: Page[] = (snapshot.pages.length > 0
        ? snapshot.pages
        : [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: [] }]
      ).map((p) => ({
        id: p.id,
        name: p.name,
        shapes: p.shapes ?? [],
        past: [],
        future: [],
      }));
      const active =
        pages.find((p) => p.id === snapshot.activePageId)?.id ?? pages[0]!.id;
      const liveShapes = pages.find((p) => p.id === active)?.shapes ?? [];
      const modes =
        snapshot.modes && snapshot.modes.length > 0
          ? snapshot.modes
          : [{ id: DEFAULT_MODE_ID, name: "Default" }];
      const activeModeId =
        snapshot.activeModeId && modes.some((m) => m.id === snapshot.activeModeId)
          ? snapshot.activeModeId
          : modes[0]!.id;
      set({
        pages,
        activePageId: active,
        shapes: liveShapes,
        selection: new Set(),
        past: [],
        future: [],
        coalesce: null,
        variables: snapshot.variables ?? [],
        modes,
        activeModeId,
      });
      return;
    }
    const shapes = Array.isArray(snapshot) ? snapshot : [];
    set({
      shapes,
      pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes, past: [], future: [] }],
      activePageId: DEFAULT_PAGE_ID,
      selection: new Set(),
      past: [],
      future: [],
      coalesce: null,
      variables: [],
      modes: [{ id: DEFAULT_MODE_ID, name: "Default" }],
      activeModeId: DEFAULT_MODE_ID,
    });
  },

  pan: (dx, dy) =>
    set((s) => ({ viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy } })),

  zoomAt: (factor, anchor) =>
    set((s) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.viewport.zoom * factor));
      if (next === s.viewport.zoom) return s;
      // Keep the document point under the cursor pinned during zoom:
      //   docX = (anchorX - vp.x) / vp.zoom = (anchorX - vp'.x) / next
      const docX = (anchor.x - s.viewport.x) / s.viewport.zoom;
      const docY = (anchor.y - s.viewport.y) / s.viewport.zoom;
      return {
        viewport: {
          x: anchor.x - docX * next,
          y: anchor.y - docY * next,
          zoom: next,
        },
      };
    }),

  resetViewport: () => set({ viewport: { x: 0, y: 0, zoom: 1 } }),

  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
  setGridSize: (size) => set({ gridSize: Math.max(1, Math.round(size)) }),

  pushHistory: () =>
    set((s) => ({
      past: [...s.past.slice(-(MAX_HISTORY - 1)), s.shapes],
      future: [],
    })),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1]!;
      return {
        past: s.past.slice(0, -1),
        future: [...s.future, s.shapes],
        shapes: prev,
        selection: new Set(),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const nx = s.future[s.future.length - 1]!;
      return {
        past: [...s.past, s.shapes],
        future: s.future.slice(0, -1),
        shapes: nx,
        selection: new Set(),
      };
    }),

  copy: (ids) =>
    set((s) => {
      // Snapshot full selection + descendants so pasting a frame brings its
      // children. Order matches the document so layer stacking carries over.
      const idSet = new Set<string>();
      for (const id of ids) {
        for (const d of collectDescendantIds(s.shapes, id)) idSet.add(d);
      }
      const snapshot = s.shapes.filter((sh) => idSet.has(sh.id));
      return { clipboard: snapshot };
    }),

  cut: (ids) => {
    get().copy(ids);
    get().deleteShapes(ids);
  },

  paste: (dx = 12, dy = 12) => {
    const cb = get().clipboard;
    if (cb.length === 0) return [];
    get().pushHistory();
    const idMap = new Map<string, string>();
    for (const s of cb) idMap.set(s.id, ulid());
    const next: Shape[] = cb.map((s) => {
      const newId = idMap.get(s.id)!;
      // Remap parentId. If the parent was outside the clipboard set, drop
      // the reference (paste into the canvas root, not back into the
      // original frame).
      const remappedParent = s.parentId ? idMap.get(s.parentId) ?? null : null;
      return {
        ...s,
        id: newId,
        x: s.x + dx,
        y: s.y + dy,
        parentId: remappedParent,
      } as Shape;
    });
    const newIds = next.map((s) => s.id);
    set((cur) => ({
      shapes: [...cur.shapes, ...next],
      selection: new Set(newIds),
    }));
    return newIds;
  },

  duplicate: (ids) => {
    if (ids.length === 0) return [];
    const cur = get();
    cur.pushHistory();
    const idSet = new Set<string>();
    for (const id of ids) {
      for (const d of collectDescendantIds(cur.shapes, id)) idSet.add(d);
    }
    const source = cur.shapes.filter((sh) => idSet.has(sh.id));
    const idMap = new Map<string, string>();
    for (const s of source) idMap.set(s.id, ulid());
    const next: Shape[] = source.map((s) => {
      const newId = idMap.get(s.id)!;
      const remappedParent = s.parentId ? idMap.get(s.parentId) ?? null : null;
      return {
        ...s,
        id: newId,
        x: s.x + 12,
        y: s.y + 12,
        parentId: remappedParent,
      } as Shape;
    });
    const newIds = next.map((s) => s.id);
    set((s) => ({
      shapes: [...s.shapes, ...next],
      selection: new Set(newIds),
    }));
    return newIds;
  },
}));

export function shapeIdsSorted(shapes: Shape[]): string[] {
  return shapes.map((s) => s.id);
}

/** Re-clone an instance's subtree from its current main, preserving the
 * instance root's position + overrides. Pure: returns the next shapes array.
 * Each fresh node is stamped with its source main id (`linkedNodeId`) and has
 * the matching override patch merged on; the root keeps the override map. */
export function recloneInstance(shapes: Shape[], instanceId: string): Shape[] {
  const inst = shapes.find((s) => s.id === instanceId);
  if (!inst || !inst.linkedMainId) return shapes;
  const main = shapes.find((s) => s.id === inst.linkedMainId);
  if (!main) return shapes;

  const oldSubtreeIds = new Set(collectDescendantIds(shapes, instanceId));
  const mainSubtreeIds = collectDescendantIds(shapes, main.id);
  const mainSubtree = shapes.filter((s) => mainSubtreeIds.includes(s.id));

  const idMap = new Map<string, string>();
  for (const s of mainSubtree) idMap.set(s.id, ulid());
  // Pin the instance root id stable so external selection still points to it.
  idMap.set(main.id, instanceId);

  const dx = inst.x - main.x;
  const dy = inst.y - main.y;
  const rootPos = { x: inst.x, y: inst.y };
  const overrides = inst.overrides;

  const fresh: Shape[] = mainSubtree.map((s) => {
    const newId = idMap.get(s.id)!;
    const newParent = s.parentId ? idMap.get(s.parentId) ?? null : null;
    const base = {
      ...s,
      id: newId,
      x: s.x + dx,
      y: s.y + dy,
      parentId: newParent,
      isMain: false,
      linkedMainId: main.id,
      linkedNodeId: s.id,
    } as Shape;
    const withOv = applyOverrides(base, s.id, rootPos, overrides) as Shape;
    // The root carries the override map + variant selection forward, and never
    // inherits the member main's variantProps / isVariantSet markers.
    return newId === instanceId
      ? ({
          ...withOv,
          overrides,
          variantProps: undefined,
          isVariantSet: undefined,
          variantSelection: inst.variantSelection,
        } as Shape)
      : withOv;
  });

  const kept = shapes.filter((sh) => !oldSubtreeIds.has(sh.id));
  return [...kept, ...fresh];
}

/** Resolve a stored value that may be a `var:<id>` reference into the live
 * value for the active mode. Returns the input unchanged for non-vars. */
export function resolveVar(
  value: string | number,
  variables: Variable[],
  activeModeId: string,
): string | number {
  if (typeof value !== "string" || !value.startsWith("var:")) return value;
  const id = value.slice(4);
  const v = variables.find((x) => x.id === id);
  if (!v) return value;
  return v.values[activeModeId] ?? Object.values(v.values)[0] ?? value;
}

/** Walk a shape and replace any var: references in color-ish fields with
 * their resolved current-mode values. Returns a copy when anything was
 * changed; same reference otherwise. */
export function resolveShapeVars(
  shape: Shape,
  variables: Variable[],
  activeModeId: string,
): Shape {
  if (variables.length === 0) return shape;
  let dirty = false;
  const next: Shape = { ...shape };
  const resolveStr = (v: string | undefined): string | undefined => {
    if (typeof v !== "string" || !v.startsWith("var:")) return v;
    const out = resolveVar(v, variables, activeModeId);
    if (out === v) return v;
    dirty = true;
    return typeof out === "string" ? out : String(out);
  };
  const rf = resolveStr(shape.fill);
  if (rf !== shape.fill) next.fill = rf!;
  const rs = resolveStr(shape.stroke);
  if (rs !== shape.stroke) next.stroke = rs!;
  // Gradient stops can be variable refs too.
  if (shape.fillGradient) {
    const stops = shape.fillGradient.stops.map((stop) => {
      const c = resolveStr(stop.color);
      return c === stop.color ? stop : { ...stop, color: c! };
    });
    if (stops.some((s, i) => s !== shape.fillGradient!.stops[i])) {
      next.fillGradient = { ...shape.fillGradient, stops } as typeof shape.fillGradient;
      dirty = true;
    }
  }
  // Effect colors.
  if (shape.effects) {
    const effects = shape.effects.map((e) => {
      if (e.kind === "shadow") {
        const c = resolveStr(e.color);
        return c === e.color ? e : { ...e, color: c! };
      }
      return e;
    });
    if (effects.some((e, i) => e !== shape.effects![i])) {
      next.effects = effects;
      dirty = true;
    }
  }
  return dirty ? next : shape;
}

/** Collect a shape's id + every descendant id, BFS order. Used by drag + delete
 * so moving/removing a frame brings its children with it. */
export function collectDescendantIds(
  shapes: Shape[],
  rootId: string,
): string[] {
  const out: string[] = [rootId];
  const childrenByParent = new Map<string, string[]>();
  for (const s of shapes) {
    const p = s.parentId ?? null;
    if (!p) continue;
    const arr = childrenByParent.get(p) ?? [];
    arr.push(s.id);
    childrenByParent.set(p, arr);
  }
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of childrenByParent.get(id) ?? []) {
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}
