// Layout constraints — how a freeform child reflows when its parent frame
// resizes. The complement to auto-layout: a frame with `layoutMode`
// none/undefined uses constraints; horizontal/vertical uses computeAutoLayout.
// Default (unset) = left/top, matching Figma.
//
// Pure + framework-free so it's cheap to unit-test and reuse from the canvas
// resize loop.

export type ConstraintH = "left" | "right" | "left-right" | "center" | "scale";
export type ConstraintV = "top" | "bottom" | "top-bottom" | "center" | "scale";

export type Box = { x: number; y: number; w: number; h: number };

export type ConstrainedChild = Box & {
  constraintH?: ConstraintH;
  constraintV?: ConstraintV;
};

/** The two end-anchored and one center/scale modes collapse to a single
 * per-axis solver; H and V differ only in which fields they touch. */
type AxisMode = "start" | "end" | "both" | "center" | "scale";

function modeH(c: ConstraintH | undefined): AxisMode {
  switch (c) {
    case "right":
      return "end";
    case "left-right":
      return "both";
    case "center":
      return "center";
    case "scale":
      return "scale";
    default:
      return "start"; // left / unset
  }
}

function modeV(c: ConstraintV | undefined): AxisMode {
  switch (c) {
    case "bottom":
      return "end";
    case "top-bottom":
      return "both";
    case "center":
      return "center";
    case "scale":
      return "scale";
    default:
      return "start"; // top / unset
  }
}

/** Solve one axis. (cStart, cSize) is the child's offset+size along the axis;
 * (oStart, oSize) the old frame, (nStart, nSize) the new frame. Returns the
 * child's new offset + size. */
function solveAxis(
  cStart: number,
  cSize: number,
  oStart: number,
  oSize: number,
  nStart: number,
  nSize: number,
  mode: AxisMode,
): { start: number; size: number } {
  const oEnd = oStart + oSize;
  const nEnd = nStart + nSize;
  switch (mode) {
    case "start": {
      // Pin the leading gap; size unchanged. Reduces to "unchanged" when the
      // frame's leading edge doesn't move.
      const startGap = cStart - oStart;
      return { start: nStart + startGap, size: cSize };
    }
    case "end": {
      // Pin the trailing gap; size unchanged.
      const endGap = oEnd - (cStart + cSize);
      return { start: nEnd - endGap - cSize, size: cSize };
    }
    case "both": {
      // Pin both gaps; size stretches.
      const startGap = cStart - oStart;
      const endGap = oEnd - (cStart + cSize);
      return { start: nStart + startGap, size: nSize - startGap - endGap };
    }
    case "center": {
      // Keep the child's center at the same ratio of the frame; size unchanged.
      const center = cStart + cSize / 2;
      const ratio = oSize !== 0 ? (center - oStart) / oSize : 0.5;
      const nCenter = nStart + ratio * nSize;
      return { start: nCenter - cSize / 2, size: cSize };
    }
    case "scale": {
      // Scale the leading offset and the size by the frame's growth ratio.
      const ratio = oSize !== 0 ? nSize / oSize : 1;
      const startOff = cStart - oStart;
      return { start: nStart + startOff * ratio, size: cSize * ratio };
    }
  }
}

/** Minimal node shape `reflowConstraints` needs. `Shape` satisfies this
 * structurally, so the store's shapes pass through without a conversion. */
export type ConstraintNode = Box & {
  id: string;
  parentId?: string | null;
  kind: string;
  layoutMode?: "none" | "horizontal" | "vertical";
  constraintH?: ConstraintH;
  constraintV?: ConstraintV;
};

const isAutoLayoutFrame = (n: ConstraintNode): boolean =>
  n.kind === "frame" &&
  (n.layoutMode === "horizontal" || n.layoutMode === "vertical");

/** Replay layout constraints for every descendant of a resized non-auto-layout
 * frame. `childStarts` holds each descendant's box captured at drag start; we
 * recompute from those (never the live, already-moved values) so a drag never
 * compounds. Recurses into nested non-auto-layout child frames; auto-layout
 * frames stop the recursion (their interiors are positioned by the auto-layout
 * engine at render). Returns a flat list of {id, box} patches. */
export function reflowConstraints(
  frameId: string,
  oldBox: Box,
  newBox: Box,
  childStarts: Map<string, Box>,
  nodes: ConstraintNode[],
  minDim = 1,
): Array<{ id: string; box: Box }> {
  const out: Array<{ id: string; box: Box }> = [];
  for (const c of nodes) {
    if ((c.parentId ?? null) !== frameId) continue;
    const cStart = childStarts.get(c.id);
    if (!cStart) continue;
    const nb = applyConstraints(
      { ...cStart, constraintH: c.constraintH, constraintV: c.constraintV },
      oldBox,
      newBox,
    );
    const box: Box = {
      x: nb.x,
      y: nb.y,
      w: Math.max(minDim, nb.w),
      h: Math.max(minDim, nb.h),
    };
    out.push({ id: c.id, box });
    if (c.kind === "frame" && !isAutoLayoutFrame(c)) {
      // Recurse with the UNCLAMPED constraint result so nested gaps stay
      // accurate even when the clamp nudged the rendered size.
      out.push(...reflowConstraints(c.id, cStart, nb, childStarts, nodes, minDim));
    }
  }
  return out;
}

/** Reflow a freeform child of a frame when that frame resizes from
 * `oldFrame` to `newFrame`. H and V are solved independently. */
export function applyConstraints(
  child: ConstrainedChild,
  oldFrame: Box,
  newFrame: Box,
): Box {
  const h = solveAxis(
    child.x,
    child.w,
    oldFrame.x,
    oldFrame.w,
    newFrame.x,
    newFrame.w,
    modeH(child.constraintH),
  );
  const v = solveAxis(
    child.y,
    child.h,
    oldFrame.y,
    oldFrame.h,
    newFrame.y,
    newFrame.h,
    modeV(child.constraintV),
  );
  return { x: h.start, y: v.start, w: h.size, h: v.size };
}
