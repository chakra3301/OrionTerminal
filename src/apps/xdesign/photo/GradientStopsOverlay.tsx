import { useMemo, useRef, useState, type MouseEvent, type PointerEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { ColorPickerDialog } from "./ColorPickerDialog";
import { linePoint, midpointPoints, shownWidget, stopCommand, stopEdit, stopTarget, stopWidget, type StopEdit, type StopTarget, type XY } from "./gradientStops";
import { surfaceFraction } from "./viewTurn";
import type { GradientFill } from "./types";

type Drag = { pointer: number; target: StopTarget; start: XY };
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Photoshop's live gradient line on the canvas, over a gradient fill layer: click the line to add a colour stop, drag a stop to move it or off the line to remove it, drag a diamond to move a midpoint, double-click or right-click a stop to recolor it. Every edit is one command. */
export function GradientStopsOverlay({ width, height, zoom, fill, layer, disabled, commit }: { width: number; height: number; zoom: number; fill: GradientFill; layer: number; disabled: boolean; commit: (id: string, params: Record<string, unknown>) => Promise<unknown> }) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), committing = useRef(false);
  const [edit, setEdit] = useState<StopEdit | null>(null), [picking, setPicking] = useState<{ index: number; root: Element } | null>(null);
  const widget = useMemo(() => stopWidget(fill), [fill]), shown = shownWidget(widget, edit), radius = 6 / zoom, size = 5 / zoom;
  const at = (event: { clientX: number; clientY: number }): XY => { const [fx, fy] = surfaceFraction(svg.current!, event.clientX, event.clientY); return [fx * width, fy * height]; };
  const run = (next: StopEdit | null) => {
    const command = next && stopCommand(fill, next, layer);
    if (!command) { setEdit(null); return; }
    // The dropped stop stays until the edited fill arrives, so it never snaps back for a moment.
    committing.current = true;
    void commit(command.id, command.params).finally(() => { committing.current = false; setEdit(null); });
  };
  const begin = (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0 || disabled || committing.current || drag.current) return;
    const start = at(event), target = stopTarget(widget, start, radius);
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); svg.current!.setPointerCapture?.(event.pointerId);
    drag.current = { pointer: event.pointerId, target, start };
  };
  const step = (event: PointerEvent<SVGSVGElement>, done: boolean) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const next = stopEdit(widget, current.target, current.start, at(event), radius);
    if (!done) { setEdit(current.target.kind === "line" ? null : next); return; }
    drag.current = null; run(next);
  };
  const pick = (event: MouseEvent<SVGElement>) => {
    event.preventDefault();
    const target = disabled || committing.current ? null : stopTarget(widget, at(event), radius);
    if (target?.kind === "stop") setPicking({ index: target.index, root: svg.current!.closest(".xd-photo") ?? document.body });
  };
  const picked = picking && widget.stops[picking.index], [x1, y1] = linePoint(widget, widget.reverse ? 1 : 0), [x2, y2] = linePoint(widget, widget.reverse ? 0 : 1);
  return <>
    <svg ref={svg} className="xd-photo-gradient-stops" viewBox={`0 0 ${width} ${height}`} aria-label="Gradient stops" onPointerMove={event => step(event, false)} onPointerUp={event => step(event, true)} onPointerCancel={() => { drag.current = null; setEdit(null); }}>
      <line className="xd-photo-gradient-hit" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={2 * radius} role="button" aria-label="Gradient line" aria-disabled={disabled || undefined} onPointerDown={begin} onDoubleClick={pick} onContextMenu={pick}/>
      <line className="xd-photo-gradient-line" x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/>
      {midpointPoints(shown).map(({ index, at: [x, y] }) => <path key={index} className="xd-photo-gradient-midpoint" aria-label={`Color midpoint ${index + 1}`} d={`M${x} ${y - size}L${x + size} ${y}L${x} ${y + size}L${x - size} ${y}Z`} vectorEffect="non-scaling-stroke"/>)}
      {shown.stops.map((stop, index) => { const [x, y] = linePoint(shown, stop.location); return <circle key={index} className={`xd-photo-gradient-stop${shown.leaving === index ? " is-leaving" : ""}`} aria-label={`Color stop ${index + 1}`} cx={x} cy={y} r={size} fill={stop.color.slice(0, 7)} vectorEffect="non-scaling-stroke"/>; })}
    </svg>
    {/* Placed in the workspace, since the canvas surface turns and zooms; events bubble out of a portal through the React tree. */}
    {picking && picked && createPortal(<div className="xd-ge-portal" onSubmit={stop} onKeyDown={stop} onPointerDown={stop}>
      <ColorPickerDialog title="Color Picker (Stop Color)" color={picked.color.slice(0, 7)} close={() => setPicking(null)} choose={hex => { setPicking(null); if (hex.toLowerCase() !== picked.color.slice(0, 7).toLowerCase()) run({ action: "color", index: picking.index, color: hex }); }}/>
    </div>, picking.root)}
  </>;
}
