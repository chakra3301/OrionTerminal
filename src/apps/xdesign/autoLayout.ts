// Auto-layout — Figma's flex-like layout engine for frames.
//
// `computeAutoLayout(shapes)` walks every frame whose `layoutMode` is
// horizontal or vertical and lays out its direct children (those whose
// `parentId === frame.id` AND `layoutPositioning !== "absolute"`). The
// returned map carries position+size overrides we apply at render time —
// the underlying stored shapes don't change, so disabling AL reverts
// cleanly to whatever the user last positioned manually.
//
// Nested frames lay out depth-first: a child frame computes its own HUG
// size before its parent reads it back.

import type { Shape, FrameShape } from "@/apps/xdesign/store";

export type LayoutBox = { x: number; y: number; w: number; h: number };
export type LayoutOverrides = Map<string, LayoutBox>;

const PAD = (sh: FrameShape) => ({
  t: sh.paddingTop ?? 0,
  r: sh.paddingRight ?? 0,
  b: sh.paddingBottom ?? 0,
  l: sh.paddingLeft ?? 0,
});

function shapeBox(
  sh: Shape,
  overrides: LayoutOverrides,
): LayoutBox {
  const o = overrides.get(sh.id);
  if (o) return o;
  return { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
}

function isAutoLayoutFrame(sh: Shape): sh is FrameShape {
  return (
    sh.kind === "frame" &&
    (sh.layoutMode === "horizontal" || sh.layoutMode === "vertical")
  );
}

/** Collect the in-flow children of a frame, preserving document order. */
function flowChildren(frameId: string, shapes: Shape[]): Shape[] {
  const out: Shape[] = [];
  for (const s of shapes) {
    if (s.parentId !== frameId) continue;
    if (s.layoutPositioning === "absolute") continue;
    out.push(s);
  }
  return out;
}

/** Sum of children's widths (or heights) given the overrides accumulated so far. */
function sumAlong(
  children: Shape[],
  axis: "x" | "y",
  overrides: LayoutOverrides,
): number {
  return children.reduce(
    (acc, c) => acc + (axis === "x" ? shapeBox(c, overrides).w : shapeBox(c, overrides).h),
    0,
  );
}

function maxAlong(
  children: Shape[],
  axis: "x" | "y",
  overrides: LayoutOverrides,
): number {
  let m = 0;
  for (const c of children) {
    const b = shapeBox(c, overrides);
    m = Math.max(m, axis === "x" ? b.w : b.h);
  }
  return m;
}

/** Layout a single frame and its children, recursing depth-first into any
 * child frames that are themselves auto-layout. Writes into `overrides`. */
function layoutFrame(
  frame: FrameShape,
  shapes: Shape[],
  overrides: LayoutOverrides,
): void {
  const children = flowChildren(frame.id, shapes);

  // Recurse: child frames with their own auto-layout settle their sizes
  // BEFORE we use them in the parent's math.
  for (const c of children) {
    if (isAutoLayoutFrame(c)) layoutFrame(c, shapes, overrides);
  }

  const mode = frame.layoutMode ?? "none";
  if (mode === "none" || children.length === 0) return;

  const horizontal = mode === "horizontal";
  const gap = frame.itemSpacing ?? 0;
  const p = PAD(frame);

  // HUG sizing: frame grows to fit content on either axis.
  const frameBox = shapeBox(frame, overrides);
  let frameW = frameBox.w;
  let frameH = frameBox.h;

  // Compute "natural" content size for hug.
  const naturalMainSize = horizontal
    ? sumAlong(children, "x", overrides) + gap * (children.length - 1)
    : sumAlong(children, "y", overrides) + gap * (children.length - 1);
  const naturalCross = horizontal
    ? maxAlong(children, "y", overrides)
    : maxAlong(children, "x", overrides);

  // HUG horizontal/vertical adjust the FRAME size, not children.
  if (horizontal) {
    if ((frame.layoutSizingH ?? "fixed") === "hug") frameW = naturalMainSize + p.l + p.r;
    if ((frame.layoutSizingV ?? "fixed") === "hug") frameH = naturalCross + p.t + p.b;
  } else {
    if ((frame.layoutSizingV ?? "fixed") === "hug") frameH = naturalMainSize + p.t + p.b;
    if ((frame.layoutSizingH ?? "fixed") === "hug") frameW = naturalCross + p.l + p.r;
  }

  // Inner box that hosts the flow.
  const innerX = frameBox.x + p.l;
  const innerY = frameBox.y + p.t;
  const innerW = Math.max(0, frameW - p.l - p.r);
  const innerH = Math.max(0, frameH - p.t - p.b);
  const innerMain = horizontal ? innerW : innerH;
  const innerCross = horizontal ? innerH : innerW;

  // First, distribute FILL children along the main axis.
  const fillKey = horizontal ? "layoutSizingH" : "layoutSizingV";

  const fillChildren = children.filter((c) => (c[fillKey] ?? "fixed") === "fill");
  const fixedMainTotal = children
    .filter((c) => (c[fillKey] ?? "fixed") !== "fill")
    .reduce((acc, c) => acc + (horizontal ? shapeBox(c, overrides).w : shapeBox(c, overrides).h), 0);
  const totalGap = gap * Math.max(0, children.length - 1);
  const fillAvail = Math.max(0, innerMain - fixedMainTotal - totalGap);
  const fillEach = fillChildren.length > 0 ? fillAvail / fillChildren.length : 0;

  // Pre-compute each child's main-axis size after fill distribution.
  const mainSizes: number[] = children.map((c) => {
    const sizing = c[fillKey] ?? "fixed";
    if (sizing === "fill") return fillEach;
    return horizontal ? shapeBox(c, overrides).w : shapeBox(c, overrides).h;
  });
  const totalChildren = mainSizes.reduce((a, b) => a + b, 0);

  // Alignment along the main axis.
  let cursor = horizontal ? innerX : innerY;
  let useGap = gap;
  const align = frame.primaryAxisAlign ?? "min";
  if (align === "center") {
    const free = innerMain - totalChildren - totalGap;
    cursor += free / 2;
  } else if (align === "max") {
    const free = innerMain - totalChildren - totalGap;
    cursor += free;
  } else if (align === "space-between" && children.length > 1) {
    const free = innerMain - totalChildren;
    useGap = free / (children.length - 1);
  }

  // Cross-axis alignment + FILL on cross axis (children stretch to inner).
  const crossSizeKey = horizontal ? "h" : "w";
  const crossFillKey = horizontal ? "layoutSizingV" : "layoutSizingH";
  const crossAlign = frame.counterAxisAlign ?? "min";

  for (let i = 0; i < children.length; i++) {
    const c = children[i]!;
    const box = shapeBox(c, overrides);
    const main = mainSizes[i]!;
    const crossSizing = c[crossFillKey] ?? "fixed";
    const cross = crossSizing === "fill" ? innerCross : (crossSizeKey === "h" ? box.h : box.w);
    let crossOffset = 0;
    if (crossAlign === "center") crossOffset = (innerCross - cross) / 2;
    else if (crossAlign === "max") crossOffset = innerCross - cross;
    const newBox: LayoutBox = horizontal
      ? {
          x: cursor,
          y: innerY + crossOffset,
          w: main,
          h: cross,
        }
      : {
          x: innerX + crossOffset,
          y: cursor,
          w: cross,
          h: main,
        };
    overrides.set(c.id, newBox);
    // If this child is a nested AL frame and its size changed, re-layout it
    // against the new bounds.
    if (isAutoLayoutFrame(c)) {
      const oldBox = shapeBox(c, new Map());
      if (newBox.w !== oldBox.w || newBox.h !== oldBox.h) {
        layoutFrame(c, shapes, overrides);
        // Restore the parent-driven box (re-layouting only edits descendants).
        overrides.set(c.id, newBox);
      }
    }
    cursor += main + useGap;
  }

  // Finally, write the frame's own size override (HUG might have grown it).
  overrides.set(frame.id, {
    x: frameBox.x,
    y: frameBox.y,
    w: frameW,
    h: frameH,
  });
}

export function computeAutoLayout(shapes: Shape[]): LayoutOverrides {
  const overrides: LayoutOverrides = new Map();
  // Top-level frames first; recursion handles nesting.
  for (const sh of shapes) {
    if (!sh.parentId && isAutoLayoutFrame(sh)) {
      layoutFrame(sh, shapes, overrides);
    }
  }
  // Also lay out AL frames that are themselves children of non-AL parents.
  // Walk again; layoutFrame is idempotent for frames already laid out.
  for (const sh of shapes) {
    if (isAutoLayoutFrame(sh) && !overrides.has(sh.id)) {
      layoutFrame(sh, shapes, overrides);
    }
  }
  return overrides;
}
