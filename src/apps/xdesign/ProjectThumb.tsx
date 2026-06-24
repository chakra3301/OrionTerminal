import { useMemo } from "react";
import type { XDDoc } from "./projectsStore";
import type { Shape } from "./store";

/** A lightweight, DOM-free preview of a project's active page. Rendered into
 * the Home recent-cards. It's deliberately approximate — fills + rounded
 * boxes, no gradients/effects/vars — just enough to recognise a design at a
 * glance. */
function activePageShapes(doc: XDDoc): Shape[] {
  const page = doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
  return (page?.shapes ?? []).filter((s) => !s.hidden);
}

function bounds(shapes: Shape[]): { x: number; y: number; w: number; h: number } | null {
  if (shapes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  if (!isFinite(minX)) return null;
  const pad = Math.max(8, (maxX - minX + maxY - minY) * 0.02);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function fillOf(s: Shape): string {
  if (s.fill && s.fill !== "transparent") return s.fill;
  if (s.fillGradient?.stops?.length) return s.fillGradient.stops[0]!.color;
  if (s.fillImage) return "#5b6168";
  if (s.stroke && s.stroke !== "transparent") return s.stroke;
  return "#3a3f45";
}

export function ProjectThumb({ doc }: { doc: XDDoc | null }) {
  const shapes = useMemo(() => (doc ? activePageShapes(doc) : []), [doc]);
  const box = useMemo(() => bounds(shapes), [shapes]);

  if (!doc || !box || shapes.length === 0) {
    return <div className="xd-thumb-empty" aria-hidden="true" />;
  }

  return (
    <svg
      className="xd-thumb-svg"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {shapes.map((s) => {
        const fill = fillOf(s);
        const opacity = s.opacity ?? 1;
        if (s.kind === "ellipse") {
          return (
            <ellipse
              key={s.id}
              cx={s.x + s.w / 2}
              cy={s.y + s.h / 2}
              rx={s.w / 2}
              ry={s.h / 2}
              fill={fill}
              opacity={opacity}
            />
          );
        }
        const radius =
          (s.kind === "rect" || s.kind === "frame") ? s.radius ?? 0 : 0;
        return (
          <rect
            key={s.id}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx={radius}
            ry={radius}
            fill={s.kind === "text" ? "none" : fill}
            opacity={s.kind === "text" ? opacity * 0.9 : opacity}
            stroke={s.kind === "text" ? fillOf(s) : undefined}
            strokeWidth={s.kind === "text" ? Math.max(2, s.h / 3) : undefined}
          />
        );
      })}
    </svg>
  );
}
