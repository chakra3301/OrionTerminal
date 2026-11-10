import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { editorDiamonds, midpointLocation, segmentFraction } from "./gradientStops";

/** The Gradient Editor's colour midpoint diamonds, inside the colour stop strip: a press selects one and dragging moves it along its segment, without the strip adding a stop. */
export function MidpointDiamonds({ locations, midpoints, around, selected, select, set }: { locations: number[]; midpoints: number[]; around: number | null; selected: number | null; select: (segment: number) => void; set: (segment: number, value: number) => void }) {
  const drag = useRef<{ pointer: number; segment: number } | null>(null);
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current, box = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!current || current.pointer !== event.pointerId || !box?.width || !Number.isFinite(event.clientX)) return;
    set(current.segment, segmentFraction(locations, current.segment, (event.clientX - box.left) / box.width));
  };
  const end = (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null; };
  const keys = (segment: number) => (event: KeyboardEvent) => {
    const step = event.shiftKey ? .1 : .01, delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(segment); }
    if (delta) { event.preventDefault(); select(segment); set(segment, (midpoints[segment] ?? .5) + delta); }
  };
  return <>{editorDiamonds(locations, around, selected).map(segment => <span key={`m${segment}`} role="button" tabIndex={0} aria-label={`Color midpoint ${segment + 1}`} aria-pressed={selected === segment} className="xd-ge-midpoint"
    style={{ left: `${Math.round(midpointLocation(locations, midpoints, segment) * 1e5) / 1e3}%` }} onClick={() => select(segment)} onKeyDown={keys(segment)}
    onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); select(segment); drag.current = { pointer: event.pointerId, segment }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}/>)}</>;
}
