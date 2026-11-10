import { useRef, useState, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import "./filterThumbnail.css";

const ZOOMS = [12.5, 25, 50, 100, 200, 300, 400, 800, 1600];
const FRAME = 128;

/** Pans and zooms the full-image preview. It is not a true-resolution tile: the engine only renders regions for the Blur Gallery commands. */
export function FilterThumbnail({ src, width, height, label }: { src: string; width: number; height: number; label: string }) {
  const [zoom, setZoom] = useState(100), [center, setCenter] = useState<[number, number]>([.5, .5]), drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const scale = zoom / 100, shown = { width: width * scale, height: height * scale };
  const step = (direction: 1 | -1) => setZoom(current => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(current) + direction))]!);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y; drag.current = { ...current, x: event.clientX, y: event.clientY };
    setCenter(([x, y]) => [clamp(x - dx / shown.width), clamp(y - dy / shown.height)]);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null; };
  return <div className="xd-photo-filter-thumbnail">
    <div className="xd-photo-filter-thumbnail-frame" role="img" aria-label={`${label} thumbnail`} onPointerDown={event => { if (event.button !== 0) return; drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <img src={src} alt="" draggable={false} style={{ width: shown.width, height: shown.height, transform: `translate(${FRAME / 2 - center[0] * shown.width}px, ${FRAME / 2 - center[1] * shown.height}px)` }}/>
    </div>
    <div className="xd-photo-filter-thumbnail-zoom">
      <button type="button" aria-label="Zoom out" disabled={zoom === ZOOMS[0]} onClick={() => step(-1)}><Minus size={12}/></button>
      <span aria-live="polite">{zoom}%</span>
      <button type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.at(-1)} onClick={() => step(1)}><Plus size={12}/></button>
    </div>
  </div>;
}
