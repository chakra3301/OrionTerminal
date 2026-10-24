import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PhotoDocument } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { geometryPoint } from "./GeometryDialog";
import { beginXDesignActivity } from "../runtimeActivity";
import { useDesignDialog } from "../useDesignDialog";

type XY = [number, number];
export type CropQuad = [XY, XY, XY, XY];
const cornerNames = ["Top left", "Top right", "Bottom right", "Bottom left"];
export const PERSPECTIVE_CROP_COMMAND = "image.xdesignPerspectiveCrop";
export function cropDimensions(quad: CropQuad): [number, number] {
  const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return [Math.max(1, Math.round((distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2)), Math.max(1, Math.round((distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2))];
}
export function validCropQuad(quad: CropQuad, width: number, height: number): boolean {
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4]!, c = quad[(i + 2) % 4]!;
    return a.every(Number.isFinite) && a[0] >= 0 && a[0] <= width && a[1] >= 0 && a[1] <= height && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 1 && (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 1e-6;
  });
}

export function PerspectiveCropDialog({ document, close, canvas }: { document: PhotoDocument; close: () => void; canvas?: { element: HTMLElement; zoom: number } }) {
  const busy = usePhotoWorkspace(s => s.busy), projectId = usePhotoWorkspace(s => s.projectId), error = usePhotoWorkspace(s => s.error), viewKey = usePhotoWorkspace(s => s.state?.viewKey);
  const supported = usePhotoWorkspace(s => s.state?.features?.perspectiveCrop === true);
  const initialQuad = (): CropQuad => [[0, 0], [document.width, 0], [document.width, document.height], [0, document.height]];
  const [quad, setQuad] = useState<CropQuad>(initialQuad), [automaticSize, setAutomaticSize] = useState(true), [manualSize, setManualSize] = useState<[number, number]>([document.width, document.height]);
  const [interpolation, setInterpolation] = useState("bicubic"), [live, setLive] = useState(false), [dragging, setDragging] = useState(false), [applying, setApplying] = useState(false);
  const stage = useRef<SVGSVGElement>(null), gesture = useRef<{ index: number; id: number; baseline: CropQuad } | null>(null);
  const identity = JSON.stringify([projectId, document.id, document.version, viewKey]), initial = useRef(identity), stale = initial.current !== identity;
  const [width, height] = automaticSize ? cropDimensions(quad) : manualSize;
  const valid = supported && validCropQuad(quad, document.width, document.height) && [width, height].every(v => Number.isInteger(v) && v >= 1 && v <= 100_000) && width * height <= 268_435_456;
  const locked = busy || applying || stale;
  const params = { quad, width, height, interpolation };
  const preview = usePhotoCommandPreview(document, projectId, PERSPECTIVE_CROP_COMMAND, params, { automatic: live, enabled: valid && !locked && !dragging, viewKey });
  const dialog = useDesignDialog<HTMLFormElement>(() => { if (gesture.current) finish(true); else close(); }, locked, { additionalRoots: () => canvas ? [stage.current] : [] });
  useEffect(() => { if (stale) close(); }, [stale, close]);
  useEffect(() => beginXDesignActivity("photo-operation", "Apply or cancel perspective crop before switching projects."), []);
  const replace = (index: number, point: XY) => setQuad(current => current.map((p, i) => i === index ? point : p) as CropQuad);
  const finish = (cancel: boolean) => {
    const current = gesture.current; gesture.current = null; setDragging(false);
    if (cancel && current) setQuad(current.baseline);
    if (current && stage.current?.hasPointerCapture?.(current.id)) stage.current.releasePointerCapture(current.id);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || locked) return;
    const p = geometryPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), document.width, document.height);
    replace(current.index, [Math.max(0, Math.min(document.width, p[0])), Math.max(0, Math.min(document.height, p[1]))]);
  };
  const surface = <svg ref={stage} className={`xd-photo-geometry-stage${canvas ? " xd-photo-main-geometry" : ""}`} aria-label="Perspective crop canvas" viewBox={`0 0 ${document.width} ${document.height}`} onPointerMove={move} onPointerUp={event => { if (gesture.current?.id === event.pointerId) { move(event); finish(false); } }} onPointerCancel={event => { if (gesture.current?.id === event.pointerId) finish(true); }} onLostPointerCapture={event => { if (gesture.current?.id === event.pointerId) finish(true); }} onKeyDownCapture={event => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); } }}>
    {!canvas && <image href={convertFileSrc(document.previewPath)} width={document.width} height={document.height} />}
    {validCropQuad(quad, document.width, document.height) && <polygon className="xd-photo-warp-guide" points={quad.map(p => p.join(",")).join(" ")} vectorEffect="non-scaling-stroke" />}
    {quad.map((p, index) => p.every(Number.isFinite) && <circle key={index} role="button" tabIndex={locked ? -1 : 0} aria-label={`${cornerNames[index]} crop corner`} aria-disabled={locked} className="xd-photo-warp-handle" cx={p[0]} cy={p[1]} r={canvas ? 6 / canvas.zoom : document.width / 70} onPointerDown={event => { if (locked || event.button !== 0 || gesture.current) return; event.preventDefault(); event.stopPropagation(); gesture.current = { index, id: event.pointerId, baseline: structuredClone(quad) }; setDragging(true); stage.current?.setPointerCapture?.(event.pointerId); }} onKeyDown={event => { if (locked || gesture.current || !event.key.startsWith("Arrow")) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1; replace(index, [Math.max(0, Math.min(document.width, p[0] + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))), Math.max(0, Math.min(document.height, p[1] + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)))]); }} />)}
  </svg>;
  const field = (label: string, value: number, change: (value: number) => void, max: number) => <label>{label}<input aria-label={label} type="number" min={0} max={max} step="any" value={Number.isFinite(value) ? value : ""} disabled={locked || dragging} onChange={event => change(event.currentTarget.valueAsNumber)} /></label>;
  const controls = <div className="xd-photo-special-controls" inert={locked}>
    {quad.map((p, index) => <div key={index}>{field(`${cornerNames[index]} X`, p[0], x => replace(index, [x, p[1]]), document.width)}{field(`${cornerNames[index]} Y`, p[1], y => replace(index, [p[0], y]), document.height)}</div>)}
    <label><input type="checkbox" aria-label="Crop automatic size" checked={automaticSize} disabled={dragging} onChange={event => { setManualSize([width, height]); setAutomaticSize(event.target.checked); }} />Size from opposing edges</label>
    {automaticSize ? <p>Corrected size: {width} × {height} px</p> : <>{field("Crop output width", width, value => setManualSize([value, height]), 100_000)}{field("Crop output height", height, value => setManualSize([width, value]), 100_000)}</>}
    <label>Interpolation<select aria-label="Crop interpolation" value={interpolation} disabled={dragging} onChange={event => setInterpolation(event.target.value)}>{["nearest", "bilinear", "bicubic"].map(value => <option key={value}>{value}</option>)}</select></label>
    <button type="button" disabled={dragging} onClick={() => { setQuad(initialQuad()); setManualSize([document.width, document.height]); setAutomaticSize(true); }}>Reset crop</button>
  </div>;
  const feedback = <><div className="xd-photo-preview-actions"><label><input type="checkbox" checked={live} disabled={locked || document.width * document.height > 16_777_216} onChange={event => setLive(event.target.checked)} />Live preview</label><button type="button" disabled={locked || dragging || !valid || preview.loading} onClick={() => { void preview.preview(); }}>{preview.loading ? "Rendering…" : "Preview crop"}</button></div>{preview.url && <div className="xd-photo-special-preview"><img src={preview.url} alt="Unapplied corrected crop" /><p role="status">{preview.stale ? "Updating corrected crop…" : "Unapplied corrected crop"}</p></div>}{preview.error && <p role="alert">{preview.error}</p>}</>;
  const form = <form ref={dialog} role="dialog" aria-modal={canvas ? undefined : true} aria-label="Perspective Crop" className={canvas ? "xd-photo-geometry-inspector" : "xd-photo-dialog xd-photo-special-dialog"} onSubmit={event => { event.preventDefault(); if (!valid || locked || gesture.current) return; setApplying(true); void runPhotoCommand(PERSPECTIVE_CROP_COMMAND, params).then(close).catch(() => {}).finally(() => setApplying(false)); }}>
    <header><h3>Perspective Crop</h3><p>Place corners clockwise around a photographed page or screen. Drag, use arrow keys or enter coordinates.</p></header>
    <p>Text, shapes, fills and filtered Smart Objects retain their editable source inside Smart Objects. The corrected rectangle crops exterior pixels and clears the selection. Guides that become angled are removed.</p>
    {!supported && <p role="alert">Perspective crop requires an updated native engine.</p>}
    {!valid && supported && <p role="alert">Use four convex clockwise corners inside the image and a valid whole output size.</p>}
    {canvas ? <>{controls}{feedback}</> : <div className="xd-photo-special-body"><div className="xd-photo-special-preview">{surface}{feedback}</div>{controls}</div>}
    {error && <p role="alert">{error}</p>}<div className="xd-photo-dialog-actions"><button type="button" disabled={locked} onClick={close}>Cancel</button><button type="submit" disabled={locked || dragging || !valid}>Apply</button></div>
  </form>;
  return canvas ? <>{createPortal(surface, canvas.element)}{form}</> : <div className="xd-photo-dialog-scrim">{form}</div>;
}
