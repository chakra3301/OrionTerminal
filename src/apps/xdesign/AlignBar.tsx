import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from "lucide-react";
import { useXDesign, type Shape } from "@/apps/xdesign/store";

type Axis = "x" | "y";
type Anchor = "min" | "mid" | "max";

function alignShapes(
  shapes: Shape[],
  selectedIds: Set<string>,
  axis: Axis,
  anchor: Anchor,
): Map<string, { x?: number; y?: number }> {
  const targets = shapes.filter((s) => selectedIds.has(s.id));
  if (targets.length < 2) return new Map();

  let bound = 0;
  if (axis === "x") {
    if (anchor === "min") bound = Math.min(...targets.map((s) => s.x));
    else if (anchor === "max") bound = Math.max(...targets.map((s) => s.x + s.w));
    else
      bound =
        (Math.min(...targets.map((s) => s.x)) +
          Math.max(...targets.map((s) => s.x + s.w))) /
        2;
  } else {
    if (anchor === "min") bound = Math.min(...targets.map((s) => s.y));
    else if (anchor === "max") bound = Math.max(...targets.map((s) => s.y + s.h));
    else
      bound =
        (Math.min(...targets.map((s) => s.y)) +
          Math.max(...targets.map((s) => s.y + s.h))) /
        2;
  }

  const out = new Map<string, { x?: number; y?: number }>();
  for (const s of targets) {
    if (axis === "x") {
      let x = s.x;
      if (anchor === "min") x = bound;
      else if (anchor === "max") x = bound - s.w;
      else x = bound - s.w / 2;
      out.set(s.id, { x });
    } else {
      let y = s.y;
      if (anchor === "min") y = bound;
      else if (anchor === "max") y = bound - s.h;
      else y = bound - s.h / 2;
      out.set(s.id, { y });
    }
  }
  return out;
}

function distribute(
  shapes: Shape[],
  selectedIds: Set<string>,
  axis: Axis,
): Map<string, { x?: number; y?: number }> {
  const targets = shapes.filter((s) => selectedIds.has(s.id));
  if (targets.length < 3) return new Map();
  // Sort by the axis's midpoint so distribution honors visual order.
  const sorted = targets
    .slice()
    .sort((a, b) =>
      axis === "x" ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2),
    );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const out = new Map<string, { x?: number; y?: number }>();
  // Keep the first and last shapes pinned; redistribute interior shapes by
  // equal *gap* between bounding boxes (Figma's "distribute" behavior).
  if (sorted.length === 2) return out;
  const totalSize = sorted.reduce(
    (acc, s) => acc + (axis === "x" ? s.w : s.h),
    0,
  );
  const span =
    axis === "x"
      ? last.x + last.w - first.x
      : last.y + last.h - first.y;
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor =
    axis === "x" ? first.x + first.w + gap : first.y + first.h + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const s = sorted[i]!;
    if (axis === "x") {
      out.set(s.id, { x: cursor });
      cursor += s.w + gap;
    } else {
      out.set(s.id, { y: cursor });
      cursor += s.h + gap;
    }
  }
  return out;
}

const ALIGN_BTNS: Array<{
  key: string;
  Icon: typeof AlignStartVertical;
  title: string;
  axis: Axis;
  anchor: Anchor;
}> = [
  { key: "left",   Icon: AlignStartVertical,   title: "Align left",   axis: "x", anchor: "min" },
  { key: "centerH",Icon: AlignCenterVertical,  title: "Align center", axis: "x", anchor: "mid" },
  { key: "right",  Icon: AlignEndVertical,     title: "Align right",  axis: "x", anchor: "max" },
  { key: "top",    Icon: AlignStartHorizontal, title: "Align top",    axis: "y", anchor: "min" },
  { key: "middleV",Icon: AlignCenterHorizontal,title: "Align middle", axis: "y", anchor: "mid" },
  { key: "bottom", Icon: AlignEndHorizontal,   title: "Align bottom", axis: "y", anchor: "max" },
];

export function XDesignAlignBar() {
  const selection = useXDesign((s) => s.selection);
  const shapes = useXDesign((s) => s.shapes);
  const patchMany = useXDesign((s) => s.patchMany);
  const pushHistory = useXDesign((s) => s.pushHistory);

  if (selection.size < 2) return null;

  const runAlign = (axis: Axis, anchor: Anchor) => {
    const updates = alignShapes(shapes, selection, axis, anchor);
    if (updates.size === 0) return;
    pushHistory();
    patchMany(Array.from(updates.keys()), (s) => updates.get(s.id) ?? {});
  };

  const runDistribute = (axis: Axis) => {
    const updates = distribute(shapes, selection, axis);
    if (updates.size === 0) return;
    pushHistory();
    patchMany(Array.from(updates.keys()), (s) => updates.get(s.id) ?? {});
  };

  const canDistribute = selection.size >= 3;

  return (
    <div className="xd-alignbar" role="toolbar" aria-label="Alignment">
      {ALIGN_BTNS.map((b) => (
        <button
          type="button"
          key={b.key}
          className="xd-alignbar-btn"
          title={b.title}
          onClick={() => runAlign(b.axis, b.anchor)}
        >
          <b.Icon size={13} />
        </button>
      ))}
      <span className="xd-alignbar-sep" />
      <button
        type="button"
        className="xd-alignbar-btn"
        title={
          canDistribute
            ? "Distribute horizontally (equal gap)"
            : "Distribute horizontally — needs 3+ selected"
        }
        onClick={() => runDistribute("x")}
        disabled={!canDistribute}
      >
        <AlignHorizontalDistributeCenter size={13} />
      </button>
      <button
        type="button"
        className="xd-alignbar-btn"
        title={
          canDistribute
            ? "Distribute vertically (equal gap)"
            : "Distribute vertically — needs 3+ selected"
        }
        onClick={() => runDistribute("y")}
        disabled={!canDistribute}
      >
        <AlignVerticalDistributeCenter size={13} />
      </button>
    </div>
  );
}
