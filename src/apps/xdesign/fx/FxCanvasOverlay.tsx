/**
 * On-canvas transform gizmo for source layers (shape / text / image /
 * video): drag the body to move, corner handles to resize/scale, top handle
 * to rotate. Sits over the WebGL canvas; only the box + handles capture
 * pointer events so mouse-reactive shaders still get the cursor everywhere
 * else. All edits go through the store params (x/y/width/height/scale/size/
 * rotation) so they persist and stay in sync with the inspector.
 */

import { useRef } from "react";
import { useFxStore } from "./fxStore";
import { fxEffect } from "./fxRegistry";
import { getSourceAspect } from "./fxSourceInfo";
import { unitBox, type GizmoBox } from "./fxGizmo";

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

type Drag = {
  mode: "move" | "resize" | "rotate";
  corner: number;
  startPx: { x: number; y: number };
  start: Record<string, number>;
  box: GizmoBox;
};

export function FxCanvasOverlay({
  fitW,
  fitH,
}: {
  fitW: number;
  fitH: number;
}) {
  const layer = useFxStore((s) =>
    s.scene.layers.find((l) => l.id === s.selectedLayerId) ?? null,
  );
  const sceneW = useFxStore((s) => s.scene.width);
  const sceneH = useFxStore((s) => s.scene.height);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const spec = layer ? fxEffect(layer.effectId) : undefined;
  if (!layer || spec?.category !== "source" || fitW === 0) return null;
  const box = unitBox(layer, sceneW, sceneH);
  if (!box) return null;

  const clampParam = (key: string, v: number): number => {
    const p = spec?.params.find((q) => q.key === key);
    if (p && p.type === "number") return Math.min(p.max, Math.max(p.min, v));
    return v;
  };

  const cxPx = box.x * fitW;
  const cyPx = box.y * fitH;
  const wPx = box.w * fitW;
  const hPx = box.h * fitH;

  const pointerUnit = (e: React.PointerEvent): { x: number; y: number } => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / fitW, y: (e.clientY - r.top) / fitH };
  };

  const begin = (
    e: React.PointerEvent,
    mode: Drag["mode"],
    corner = 0,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      corner,
      startPx: pointerUnit(e),
      start: { ...(layer.params as Record<string, number>) },
      box,
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cur = pointerUnit(e);
    const dx = cur.x - d.startPx.x;
    const dy = cur.y - d.startPx.y;

    if (d.mode === "move") {
      useFxStore.getState().setParam(layer.id, "x", clampParam("x", num(d.start.x, 0.5) + dx));
      useFxStore.getState().setParam(layer.id, "y", clampParam("y", num(d.start.y, 0.5) + dy));
      return;
    }

    if (d.mode === "rotate") {
      const ax = (cur.x - d.box.x) * fitW;
      const ay = (cur.y - d.box.y) * fitH;
      let deg = (Math.atan2(ay, ax) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      useFxStore.getState().setParam(layer.id, "rotation", clampParam("rotation", Math.round(deg)));
      return;
    }

    // resize — pointer in the box's local (unrotated) frame.
    const theta = (-d.box.rot * Math.PI) / 180;
    const relX = cur.x - d.box.x;
    const relY = cur.y - d.box.y;
    // rotate the delta back into local axes (aspect-correct via px).
    const rx = relX * fitW;
    const ry = relY * fitH;
    const lx = rx * Math.cos(theta) - ry * Math.sin(theta);
    const ly = rx * Math.sin(theta) + ry * Math.cos(theta);
    const halfWUnit = Math.abs(lx) / fitW;
    const halfHUnit = Math.abs(ly) / fitH;
    const S = useFxStore.getState();

    if (layer.effectId === "srcShape") {
      S.setParam(layer.id, "width", clampParam("width", halfWUnit * 2));
      S.setParam(layer.id, "height", clampParam("height", halfHUnit * 2));
    } else if (layer.effectId === "srcImage" || layer.effectId === "srcVideo") {
      const a = getSourceAspect(layer.id);
      const R = a ? a / (sceneW / sceneH) : 1;
      const fromW = (halfWUnit * 2) / Math.min(1, R);
      const fromH = (halfHUnit * 2) / Math.min(1, 1 / R);
      S.setParam(layer.id, "scale", clampParam("scale", (fromW + fromH) / 2));
    } else if (layer.effectId === "srcText") {
      const lines = String(layer.params.content ?? "").split(/\n|\\n/).length;
      S.setParam(layer.id, "size", clampParam("size", (halfHUnit * 2) / (1.2 * lines)));
    }
  };

  const end = (e: React.PointerEvent) => {
    if (drag.current) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag.current = null;
    }
  };

  return (
    <div ref={rootRef} className="xd-fx-gizmo-root">
      <div
        className="xd-fx-gizmo"
        style={{
          left: cxPx - wPx / 2,
          top: cyPx - hPx / 2,
          width: wPx,
          height: hPx,
          transform: `rotate(${box.rot}deg)`,
        }}
        onPointerDown={(e) => begin(e, "move")}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          className="xd-fx-gizmo-rot"
          onPointerDown={(e) => begin(e, "rotate")}
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
        />
        {CORNERS.map(([sx, sy], i) => (
          <div
            key={i}
            className="xd-fx-gizmo-handle"
            style={{
              left: `calc(50% + ${(sx * wPx) / 2}px)`,
              top: `calc(50% + ${(sy * hPx) / 2}px)`,
            }}
            onPointerDown={(e) => begin(e, "resize", i)}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
    </div>
  );
}
