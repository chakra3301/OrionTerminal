import { useRef, useState, type PointerEvent } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { usePhotoCommandPreview } from "./commandPreview";
import { geometryPoint } from "./GeometryDialog";
import { useImageViewPreview } from "./imageView";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";

export const TEXT_WARP_STYLES = ["none", "arc", "arcLower", "arcUpper", "arch", "bulge", "shellLower", "shellUpper", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze", "twist"];
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, value => value.toUpperCase());
export function textWarpStyle(value?: string): string {
  return TEXT_WARP_STYLES.find(style => style.toLowerCase() === value?.replace(/^warp/i, "").toLowerCase()) ?? value ?? "none";
}
export function textBoxGeometry(layer: PhotoLayer) {
  const transform = layer.text?.transform ?? [1, 0, 0, 1, 0, 0], shape = layer.text?.shape;
  const localX = shape?.kind === "box" ? shape.x : 0, localY = shape?.kind === "box" ? shape.y : 0;
  return { transform, x: transform[4] + transform[0] * localX + transform[2] * localY, y: transform[5] + transform[1] * localX + transform[3] * localY,
    width: shape?.kind === "box" ? shape.width : 100, height: shape?.kind === "box" ? shape.height : 100, box: shape?.kind === "box" };
}

export function PhotoTextGeometryDialog({ kind, document, layer, close }: { kind: "box" | "warp"; document: PhotoDocument; layer: PhotoLayer; close: () => void }) {
  const busy = usePhotoWorkspace(state => state.busy), projectId = usePhotoWorkspace(state => state.projectId), state = usePhotoWorkspace(state => state.state), workspaceError = usePhotoWorkspace(state => state.error);
  const source = textBoxGeometry(layer), warp = layer.text?.warp;
  const [opening] = useState(() => ({ x: source.x, y: source.y, width: source.width, height: source.height, style: textWarpStyle(layer.text?.warp?.style), bend: layer.text?.warp?.bend ?? 50, horizontal: layer.text?.warp?.horizontalDistortion ?? 0, vertical: layer.text?.warp?.verticalDistortion ?? 0, orientation: layer.text?.warp?.orientation ?? "horizontal" }));
  const [x, setX] = useState(source.x), [y, setY] = useState(source.y), [width, setWidth] = useState(source.width), [height, setHeight] = useState(source.height);
  const [style, setStyle] = useState(textWarpStyle(warp?.style)), [bend, setBend] = useState(warp?.bend ?? 50), [horizontal, setHorizontal] = useState(warp?.horizontalDistortion ?? 0), [vertical, setVertical] = useState(warp?.verticalDistortion ?? 0), [orientation, setOrientation] = useState(warp?.orientation ?? "horizontal");
  const allowed = document.width * document.height <= 16_777_216;
  const [live, setLive] = useState(isTauri() && allowed), [error, setError] = useState<string | null>(null);
  const drag = useRef<{ id: number; kind: "origin" | "size"; start: [number, number]; geometry: [number, number, number, number] } | null>(null);
  const command = kind === "warp" ? "type.warpText" : "type.edit";
  const params = kind === "warp" ? { layer: layer.id, style, bend, horizontalDistortion: horizontal, verticalDistortion: vertical, orientation }
    : { layer: layer.id, ...(source.box ? { box: [x, y, width, height] } : { move: [x - source.x, y - source.y] }) };
  const valid = kind === "warp" ? TEXT_WARP_STYLES.includes(style) && [bend, horizontal, vertical].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
    : [x, y, width, height].every(Number.isFinite) && Math.abs(x) <= 1_000_000 && Math.abs(y) <= 1_000_000 && width >= 1 && height >= 1 && width <= 100_000 && height <= 100_000;
  const changed = kind === "warp" ? style !== textWarpStyle(warp?.style) || style !== "none" && (bend !== (warp?.bend ?? 50) || horizontal !== (warp?.horizontalDistortion ?? 0) || vertical !== (warp?.verticalDistortion ?? 0) || orientation !== (warp?.orientation ?? "horizontal"))
    : x !== source.x || y !== source.y || source.box && (width !== source.width || height !== source.height);
  const preview = usePhotoCommandPreview(document, projectId, command, params, { automatic: live, enabled: allowed && valid && !busy && changed, viewKey: state?.viewKey });
  const view = useImageViewPreview(document, projectId, state), dialog = useDesignDialog<HTMLFormElement>(close, busy);
  const [a, b, c, d] = source.transform, determinant = a! * d! - b! * c!;
  const corner = (u: number, v: number): [number, number] => [x + a! * u + c! * v, y + b! * u + d! * v];
  const point = (event: PointerEvent<SVGSVGElement>) => geometryPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), document.width, document.height);
  const finish = (event: PointerEvent<SVGSVGElement>, cancel: boolean) => {
    const current = drag.current; if (!current || current.id !== event.pointerId) return;
    if (!cancel) move(event);
    drag.current = null;
    if (cancel) { setX(current.geometry[0]); setY(current.geometry[1]); setWidth(current.geometry[2]); setHeight(current.geometry[3]); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handle = (position: [number, number], target: "origin" | "size") => <circle role="button" tabIndex={busy ? -1 : 0} aria-label={target === "origin" ? "Text origin handle" : "Paragraph size handle"} cx={position[0]} cy={position[1]} r={Math.max(document.width, document.height) / 90} onPointerDown={event => {
    if (busy || event.button !== 0 || drag.current || target === "size" && Math.abs(determinant) < 1e-8) return;
    const surface = event.currentTarget.ownerSVGElement!;
    drag.current = { id: event.pointerId, kind: target, start: geometryPoint(event.clientX, event.clientY, surface.getBoundingClientRect(), document.width, document.height), geometry: [x, y, width, height] };
    surface.setPointerCapture(event.pointerId);
  }} onKeyDown={event => {
    if (busy) return;
    const step = event.shiftKey ? 10 : 1, dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0, dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return; event.preventDefault(); event.stopPropagation();
    if (target === "origin") { setX(value => value + dx); setY(value => value + dy); }
    else { setWidth(value => Math.max(1, Math.min(100_000, value + dx))); setHeight(value => Math.max(1, Math.min(100_000, value + dy))); }
  }}/>;
  const number = (name: string, text: string, unit: string, value: number, change: (value: number) => void, min: number, max: number) => <label className="xd-ps-dialog-field"><span>{text}:</span><input aria-label={name} type="number" required step="any" min={min} max={max} disabled={busy} value={Number.isFinite(value) ? value : ""} onChange={event => change(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">{unit}</span></label>;
  const image = live && preview.url ? preview.url : view.active ? view.url ?? undefined : convertFileSrc(document.previewPath);
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current || current.id !== event.pointerId || busy) return;
    const next = point(event), dx = next[0] - current.start[0], dy = next[1] - current.start[1];
    if (current.kind === "origin") { setX(current.geometry[0] + dx); setY(current.geometry[1] + dy); }
    else { setWidth(Math.max(1, Math.min(100_000, current.geometry[2] + (d! * dx - c! * dy) / determinant))); setHeight(Math.max(1, Math.min(100_000, current.geometry[3] + (-b! * dx + a! * dy) / determinant))); }
  };
  return <PhotoDialog dialog={dialog} title={kind === "warp" ? "Warp Text" : "Text Position & Box"} label={kind === "warp" ? "Warp text" : "Text position & box"} className="xd-photo-special-dialog" busy={busy} okDisabled={!valid} close={close}
    reset={() => { setX(opening.x); setY(opening.y); setWidth(opening.width); setHeight(opening.height); setStyle(opening.style); setBend(opening.bend); setHorizontal(opening.horizontal); setVertical(opening.vertical); setOrientation(opening.orientation); }}
    buttons={kind === "warp" && <button type="button" disabled={busy} onClick={() => setStyle("none")}>Remove warp</button>}
    preview={{ checked: live, disabled: busy || !allowed, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (busy || !valid || !event.currentTarget.checkValidity()) return;
    if (!changed) { close(); return; }
    setError(null); void runPhotoCommand(command, params).then(close).catch(error => setError(String(error)));
  }}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview"><svg className="xd-photo-geometry-stage" aria-label="Text geometry canvas" viewBox={`0 0 ${document.width} ${document.height}`} onPointerMove={move} onPointerUp={event => finish(event, false)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
      <image href={image} width={document.width} height={document.height}/>
      {kind === "box" && valid && <>{source.box && <polygon className="xd-photo-warp-guide" points={[[0, 0], [width, 0], [width, height], [0, height]].map(([u, v]) => corner(u!, v!).join(",")).join(" ")} vectorEffect="non-scaling-stroke"/>}{handle([x, y], "origin")}{source.box && handle(corner(width, height), "size")}</>}
    </svg>{preview.error && <p role="alert">{preview.error}</p>}{view.active && !view.url && <p role="status">{view.error ?? "Rendering image view…"}</p>}{!allowed && <p className="xd-photo-section-help">OK renders this large image at full resolution.</p>}</div>
    <div className="xd-photo-special-controls"><div className="xd-ps-dialog-grid">{kind === "warp" ? <><label className="xd-ps-dialog-field"><span>Style:</span><select aria-label="Text warp style" disabled={busy} value={style} onChange={event => setStyle(event.target.value)}>{!TEXT_WARP_STYLES.includes(style) && <option value={style}>Current imported warp · {style}</option>}{TEXT_WARP_STYLES.map(style => <option key={style} value={style}>{label(style)}</option>)}</select></label>{style !== "none" && <>{number("Text warp bend (%)", "Bend", "%", bend, setBend, -100, 100)}{number("Text warp horizontal distortion (%)", "Horizontal Distortion", "%", horizontal, setHorizontal, -100, 100)}{number("Text warp vertical distortion (%)", "Vertical Distortion", "%", vertical, setVertical, -100, 100)}<label className="xd-ps-dialog-field"><span>Axis:</span><select aria-label="Text warp axis" value={orientation} disabled={busy} onChange={event => setOrientation(event.target.value as "horizontal" | "vertical")}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label></>}</> : <>{number("Text origin X (px)", "Origin X", "px", x, setX, -1_000_000, 1_000_000)}{number("Text origin Y (px)", "Origin Y", "px", y, setY, -1_000_000, 1_000_000)}{source.box && <>{number("Paragraph width (px)", "Width", "px", width, setWidth, 1, 100_000)}{number("Paragraph height (px)", "Height", "px", height, setHeight, 1, 100_000)}<p className="xd-photo-section-help">Dimensions are measured before the text layer’s rotation and scaling.</p></>}{!source.box && <p className="xd-photo-section-help">Convert to paragraph text from Typography to enable wrapping and box dimensions.</p>}</>}</div>{!valid && <p role="alert">{kind === "warp" && !TEXT_WARP_STYLES.includes(style) ? "Choose a supported warp style to replace this imported warp, or cancel to preserve it." : "Enter valid geometry values."}</p>}</div></div>
    {(error || workspaceError) && <p role="alert">{error || workspaceError}</p>}
  </PhotoDialog>;
}
