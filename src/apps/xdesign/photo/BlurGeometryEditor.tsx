import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { addBlurPin, insertBlurPathPoint, readBlurGeometry, removeBlurPathPoint, removeBlurPin, setBlurGeometryValue, updateBlurGeometry, type BlurGeometryMode, type BlurGeometryRow, type BlurGeometryTarget } from './blurGeometry';
import { blurDocumentPoint, FIT_BLUR_VIEW, panBlurViewport, zoomBlurViewport, type BlurViewport } from './blurViewport';
import type { PhotoPreviewImageTile } from './commandPreview';

type Values = Record<string, unknown>;
type Point = [number, number];
export type BlurGeometryBounds = { x: number; y: number; width: number; height: number };
type Props = { mode: BlurGeometryMode; label: string; values: Values; width: number; height: number; bounds?: BlurGeometryBounds; image: string; sourceKey: string; interactionKey?: string; disabled: boolean; tiles?: readonly PhotoPreviewImageTile[]; viewChange?: (viewport: BlurViewport, frame: { width: number; height: number }, pixelRatio: number) => void; change: (patch: Values) => void };
type Handle = { target: BlurGeometryTarget; position: Point; label: string; value?: number; max?: number; min?: number };
type Drag = { pointer: number; element: SVGSVGElement; target: BlurGeometryTarget; position: Point; start: Point; clientY: number; original: Values; published: Values; keys: Set<string>; sourceKey: string };
type Pan = { pointer: number; element: SVGSVGElement; start: Point; original: BlurViewport; published: BlurViewport; rect: DOMRect; sourceKey: string };
const sameValues = (a: Values, b: Values) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.is(a[key], b[key]));
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const validBounds = (bounds: BlurGeometryBounds) => [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
const strength = (mode: BlurGeometryMode, row: BlurGeometryRow) => number(row[mode === 'spin' ? 'blurAngle' : mode === 'paths' ? 'speed' : 'blur']);

export function blurPointFromClient(rect: { left: number; top: number; width: number; height: number }, width: number, height: number, bounds: BlurGeometryBounds, x: number, y: number, viewport = FIT_BLUR_VIEW): Point | undefined {
  if (!validBounds(bounds)) return;
  const pixel = blurDocumentPoint(rect, width, height, viewport, x, y);
  return pixel ? [(pixel[0] - bounds.x) / bounds.width, (pixel[1] - bounds.y) / bounds.height] : undefined;
}

export function BlurGeometryEditor({ mode, label, values, width, height, bounds: providedBounds, image, sourceKey, interactionKey, disabled, tiles = [], viewChange, change }: Props) {
  const bounds = providedBounds ?? { x: 0, y: 0, width, height };
  const rows = useMemo(() => readBlurGeometry(mode, values), [mode, values]);
  const available = !!rows && validBounds(bounds) && width > 0 && height > 0 && !!image;
  const [selected, setSelected] = useState(0), [selectedPoint, setSelectedPoint] = useState(0), [panMode, setPanMode] = useState(false);
  const drag = useRef<Drag | null>(null), pan = useRef<Pan | null>(null), svg = useRef<SVGSVGElement>(null), space = useRef(false), focusAfter = useRef<{ target: string; source: string } | null>(null);
  const sourceIdentity = JSON.stringify([sourceKey, mode, width, height, bounds]);
  const interactionIdentity = interactionKey === undefined ? sourceIdentity : JSON.stringify([sourceIdentity, interactionKey]);
  const [viewState, setViewState] = useState({ identity: sourceIdentity, viewport: FIT_BLUR_VIEW });
  const viewport = viewState.identity === sourceIdentity ? viewState.viewport : FIT_BLUR_VIEW, view = useRef(viewport); view.current = viewport;
  const identity = JSON.stringify([interactionIdentity, viewport]);
  const current = useRef({ values, sourceKey: identity, sourceIdentity, interactionIdentity, disabled, available }); current.current = { values, sourceKey: identity, sourceIdentity, interactionIdentity, disabled, available };
  const index = Math.min(selected, Math.max(0, (rows?.length ?? 0) - 1)), active = rows?.[index];
  const pointIndex = Math.min(selectedPoint, Math.max(0, (active?.points?.length ?? 0) - 1));
  const short = Math.min(bounds.width, bounds.height), radius = Math.max(width, height) / (80 * viewport.zoom);
  const pixel = (point: Point): Point => [bounds.x + point[0] * bounds.width, bounds.y + point[1] * bounds.height];
  const center = (row: BlurGeometryRow): Point => pixel([row.x, row.y]);
  const ellipsePoint = (row: BlurGeometryRow, x: number, y: number): Point => {
    const angle = number(row.angle) * Math.PI / 180, [cx, cy] = center(row);
    return [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
  };
  const tiltPoint = (row: BlurGeometryRow, along: number, normal: number): Point => {
    const angle = number(row.angle) * Math.PI / 180, [cx, cy] = center(row);
    return [cx + along * Math.cos(angle) + normal * Math.sin(angle), cy - along * Math.sin(angle) + normal * Math.cos(angle)];
  };
  const outline = (row: BlurGeometryRow, scale = 1) => {
    const exponent = 2 + number(row.roundness) / 100 * 6;
    return Array.from({ length: 97 }, (_, at) => {
      const angle = at / 96 * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      return ellipsePoint(row, Math.sign(c) * Math.abs(c) ** (2 / exponent) * number(row.radiusX) * short * scale, Math.sign(s) * Math.abs(s) ** (2 / exponent) * number(row.radiusY) * short * scale).join(',');
    }).join(' ');
  };
  const release = () => {
    const owned = drag.current ?? pan.current; drag.current = null; pan.current = null;
    if (owned?.element.hasPointerCapture?.(owned.pointer)) owned.element.releasePointerCapture(owned.pointer);
  };
  const owns = (owned: Drag) => !current.current.disabled && current.current.available && current.current.sourceKey === owned.sourceKey && sameValues(current.current.values, owned.published);
  const ownsPan = (owned: Pan) => !current.current.disabled && current.current.available && current.current.interactionIdentity === owned.sourceKey && sameValues(view.current, owned.published);
  const measureView = useRef(viewChange); measureView.current = viewChange;
  const reportView = (next = view.current) => { const rect = svg.current?.getBoundingClientRect(); if (rect && rect.width > 0 && rect.height > 0) measureView.current?.(next, { width: rect.width, height: rect.height }, window.devicePixelRatio || 1); };
  const showView = (next: BlurViewport) => { view.current = next; setViewState({ identity: current.current.sourceIdentity, viewport: next }); reportView(next); };
  const publish = (patch: Values | undefined) => {
    if (!patch || current.current.disabled || !current.current.available) return;
    if (drag.current) {
      if (!owns(drag.current)) { release(); return; }
      for (const key of Object.keys(patch)) drag.current.keys.add(key);
      drag.current.published = { ...current.current.values, ...patch };
    }
    change(patch);
  };
  const cancel = () => {
    const owned = drag.current, restore = owned && owns(owned) ? Object.fromEntries([...owned.keys].map(key => [key, owned.original[key]])) : undefined;
    const panned = pan.current, oldView = panned && ownsPan(panned) ? panned.original : undefined;
    release(); if (restore && Object.keys(restore).length) change(restore); if (oldView) showView(oldView);
  };
  useEffect(() => { if (drag.current && !owns(drag.current) || pan.current && !ownsPan(pan.current)) release(); }, [values, identity, disabled, available]);
  useEffect(() => { if (viewState.identity !== sourceIdentity) { space.current = false; showView(FIT_BLUR_VIEW); setSelected(0); setSelectedPoint(0); } }, [sourceIdentity]);
  useEffect(() => {
    const report = () => reportView(), observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    if (svg.current) observer?.observe(svg.current); window.addEventListener('resize', report); report();
    return () => { observer?.disconnect(); window.removeEventListener('resize', report); };
  }, [sourceIdentity]);
  useEffect(() => { setSelected(index); setSelectedPoint(pointIndex); }, [rows?.length, active?.points?.length, index]);
  useEffect(() => { const pending = focusAfter.current; focusAfter.current = null; if (pending?.source === sourceIdentity && available && !disabled) svg.current?.querySelector<SVGGElement>(`[data-blur-target="${pending.target}"]`)?.focus?.(); }, [values]);
  useEffect(() => {
    const blur = () => { space.current = false; cancel(); }, keyUp = (event: KeyboardEvent) => { if (event.key === ' ') space.current = false; };
    window.addEventListener('blur', blur); window.addEventListener('keyup', keyUp);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('keyup', keyUp); release(); };
  }, []);
  const changeView = (next: BlurViewport | undefined) => { if (!next || current.current.disabled || !current.current.available) return; if (drag.current) cancel(); else release(); showView(next); };
  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  wheel.current = event => {
    if ((!event.ctrlKey && !event.metaKey) || disabled || !available || !svg.current) return;
    const anchor = blurDocumentPoint(svg.current.getBoundingClientRect(), width, height, view.current, event.clientX, event.clientY);
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation(); changeView(zoomBlurViewport(width, height, view.current, view.current.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .01), anchor));
  };
  useEffect(() => { const node = svg.current, onWheel = (event: WheelEvent) => wheel.current(event); node?.addEventListener('wheel', onWheel, { passive: false }); return () => node?.removeEventListener('wheel', onWheel); }, []);
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const panned = pan.current;
    if (panned) {
      if (panned.pointer !== event.pointerId) return;
      if (!ownsPan(panned)) { release(); return; }
      const next = panBlurViewport(panned.rect, width, height, panned.original, event.clientX - panned.start[0], event.clientY - panned.start[1]);
      if (next) { panned.published = next; showView(next); } return;
    }
    const owned = drag.current;
    if (!owned || owned.pointer !== event.pointerId) return;
    if (!owns(owned)) { release(); return; }
    if (owned.target.kind === 'strength') {
      const row = readBlurGeometry(mode, owned.original)?.[owned.target.item];
      if (row) publish(setBlurGeometryValue(mode, owned.original, owned.target.item, 'strength', strength(mode, row) + owned.clientY - event.clientY));
      return;
    }
    const next = blurPointFromClient(event.currentTarget.getBoundingClientRect(), width, height, bounds, event.clientX, event.clientY, view.current);
    if (!next) return;
    const point: Point = [(owned.position[0] - bounds.x) / bounds.width + next[0] - owned.start[0], (owned.position[1] - bounds.y) / bounds.height + next[1] - owned.start[1]];
    publish(updateBlurGeometry(mode, owned.original, owned.target, point, bounds.width, bounds.height));
  };
  const insert = (point: Point) => {
    if (!available || disabled || mode === 'tilt') return;
    release();
    if (mode === 'paths') {
      const next = insertBlurPathPoint(values, index, point, bounds.width, bounds.height); if (!next) return;
      setSelectedPoint(next.point); focusAfter.current = { target: `${index}/point/${next.point}`, source: sourceIdentity }; publish(next.patch);
    } else {
      const next = addBlurPin(mode, values, index, point); if (!next) return;
      setSelected(next.selected); setSelectedPoint(0); focusAfter.current = { target: `${next.selected}/center/`, source: sourceIdentity }; publish(next.patch);
    }
  };
  const remove = (item = index, at = pointIndex) => {
    if (!available || disabled || mode === 'tilt') return;
    release();
    if (mode === 'paths') {
      const patch = removeBlurPathPoint(values, item, at); if (!patch) return;
      setSelected(item); setSelectedPoint(Math.max(0, at - 1)); focusAfter.current = { target: `${item}/point/${Math.max(0, at - 1)}`, source: sourceIdentity }; publish(patch);
    } else {
      const next = removeBlurPin(mode, values, item); if (!next) return;
      setSelected(next.selected); focusAfter.current = { target: `${next.selected}/center/`, source: sourceIdentity }; publish(next.patch);
    }
  };
  const handles: Handle[] = [];
  if (rows && available) {
    if (mode === 'paths') {
      active?.points?.forEach((point, at) => handles.push({ target: { item: index, kind: 'point', point: at }, position: pixel(point), label: `Path ${index + 1} point ${at + 1}` }));
    } else rows.forEach((row, at) => handles.push({ target: { item: at, kind: 'center' }, position: center(row), label: `${mode === 'tilt' ? 'Tilt-Shift' : label} ${at + 1} center` }));
    if (active) {
      const [cx, cy] = center(active);
      handles.push({ target: { item: index, kind: 'strength' }, position: [cx, cy - radius * 4], label: `${mode === 'spin' ? 'Spin angle' : mode === 'paths' ? 'Path speed' : 'Blur'} ${index + 1}`, value: strength(mode, active), min: 0, max: mode === 'spin' ? 360 : 500 });
      if (mode === 'iris' || mode === 'spin') {
        handles.push({ target: { item: index, kind: 'radiusX' }, position: ellipsePoint(active, number(active.radiusX) * short, 0), label: `${label} ${index + 1} horizontal radius` });
        handles.push({ target: { item: index, kind: 'radiusY' }, position: ellipsePoint(active, 0, number(active.radiusY) * short), label: `${label} ${index + 1} vertical radius` });
        handles.push({ target: { item: index, kind: 'angle' }, position: ellipsePoint(active, number(active.radiusX) * short + radius * 4, 0), label: `${label} ${index + 1} rotation`, value: number(active.angle), min: -180, max: 180 });
        if (mode === 'iris') handles.push({ target: { item: index, kind: 'feather' }, position: ellipsePoint(active, -number(active.radiusX) * short * number(active.feather), 0), label: `Iris Blur ${index + 1} feather` });
      } else if (mode === 'tilt') {
        handles.push({ target: { item: 0, kind: 'angle' }, position: tiltPoint(active, short * .4, 0), label: 'Tilt-Shift rotation', value: number(active.angle), min: -90, max: 90 });
        handles.push({ target: { item: 0, kind: 'focus' }, position: tiltPoint(active, 0, short * number(active.focus)), label: 'Tilt-Shift focus width' });
        handles.push({ target: { item: 0, kind: 'transition' }, position: tiltPoint(active, 0, short * (number(active.focus) + number(active.transition))), label: 'Tilt-Shift transition width' });
      }
    }
  }
  return <section className="xd-photo-blur-editor" aria-label={`${label} image controls`}>
    <div className="xd-photo-preview-actions" aria-label="Blur preview view"><button type="button" aria-label="Zoom out blur preview" disabled={disabled || !available || viewport.zoom <= 1} onClick={() => changeView(zoomBlurViewport(width, height, view.current, view.current.zoom / 2))}>−</button><output aria-label="Blur preview zoom">{Number(viewport.zoom.toFixed(2))}× fit</output><button type="button" aria-label="Zoom in blur preview" disabled={disabled || !available || viewport.zoom >= 64} onClick={() => changeView(zoomBlurViewport(width, height, view.current, view.current.zoom * 2))}>+</button><button type="button" disabled={disabled || !available} onClick={() => changeView(FIT_BLUR_VIEW)}>Fit image</button><button type="button" aria-pressed={panMode} disabled={disabled || !available} onClick={() => { cancel(); space.current = false; setPanMode(value => !value); }}>Pan preview</button></div>
    <svg ref={svg} tabIndex={disabled ? -1 : 0} className={`xd-photo-blur-geometry${panMode ? ' can-pan' : ''}`} width={width} height={height} viewBox={`${viewport.x} ${viewport.y} ${width / viewport.zoom} ${height / viewport.zoom}`} aria-label={`${label} preview`} onPointerDown={event => {
      if (disabled || !available || drag.current || pan.current || !(event.button === 1 || event.button === 0 && (panMode || space.current))) return;
      event.preventDefault(); event.stopPropagation();
      pan.current = { pointer: event.pointerId, element: event.currentTarget, start: [event.clientX, event.clientY], original: view.current, published: view.current, rect: event.currentTarget.getBoundingClientRect(), sourceKey: interactionIdentity };
      event.currentTarget.setPointerCapture?.(event.pointerId); event.currentTarget.focus?.();
    }} onPointerMove={move} onPointerUp={event => { if ((drag.current?.pointer ?? pan.current?.pointer) === event.pointerId) { move(event); release(); } }} onPointerCancel={event => { if ((drag.current?.pointer ?? pan.current?.pointer) === event.pointerId) cancel(); }} onLostPointerCapture={event => { if ((drag.current?.pointer ?? pan.current?.pointer) === event.pointerId) cancel(); }} onDoubleClick={event => {
      if (disabled || !available || mode === 'tilt' || panMode || space.current || drag.current || pan.current || event.button !== 0 || (event.target as Element).closest('.xd-photo-blur-handle')) return;
      const point = blurPointFromClient(event.currentTarget.getBoundingClientRect(), width, height, bounds, event.clientX, event.clientY, view.current);
      if (point && point.every(value => value >= 0 && value <= 1)) { event.preventDefault(); event.stopPropagation(); insert(point); }
    }} onKeyUp={event => { if (event.key === ' ') { space.current = false; event.preventDefault(); event.stopPropagation(); } }} onKeyDown={event => {
      if (disabled || !available) return;
      if (event.key === 'Escape' && (drag.current || pan.current)) { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); space.current = true; }
      else if (['+', '=', '-', '_', '0'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); changeView(event.key === '0' ? FIT_BLUR_VIEW : zoomBlurViewport(width, height, view.current, view.current.zoom * (event.key === '-' || event.key === '_' ? .5 : 2))); }
    }}>
      <image href={image} width={width} height={height}/>
      {tiles.map(tile => <image key={`${tile.x}/${tile.y}/${tile.width}/${tile.height}/${tile.scale}`} data-preview-detail="true" aria-hidden="true" href={tile.url} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" style={{ pointerEvents: 'none' }}/>)}
      {providedBounds && <rect className="xd-photo-blur-selection" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" vectorEffect="non-scaling-stroke"/>}
      {mode === 'paths' && rows?.map((row, at) => <polyline className={at === index ? 'is-selected' : undefined} key={at} points={row.points?.map(pixel).map(point => point.join(',')).join(' ')} fill="none" vectorEffect="non-scaling-stroke" onPointerDown={event => { if (!disabled && !drag.current && !pan.current && !panMode && !space.current && event.button === 0) { setSelected(at); setSelectedPoint(0); } }}/>) }
      {active && (mode === 'iris' || mode === 'spin') && <><polyline points={outline(active)} fill="none" vectorEffect="non-scaling-stroke"/>{mode === 'iris' && <polyline className="xd-photo-blur-feather" points={outline(active, number(active.feather))} fill="none" vectorEffect="non-scaling-stroke"/>}</>}
      {active && mode === 'tilt' && [-1, 1].flatMap(sign => [number(active.focus), number(active.focus) + number(active.transition)].map((distance, at) => { const a = tiltPoint(active, -Math.hypot(width, height), sign * distance * short), b = tiltPoint(active, Math.hypot(width, height), sign * distance * short); return <line key={`${sign}/${at}`} className={at ? 'xd-photo-blur-feather' : undefined} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke"/>; }))}
      {handles.map(handle => <g key={`${handle.target.item}/${handle.target.kind}/${handle.target.point ?? ''}`} data-blur-target={`${handle.target.item}/${handle.target.kind}/${handle.target.point ?? ''}`} className={`xd-photo-blur-handle${handle.target.item === index ? ' is-selected' : ''}`} role={handle.value === undefined ? 'button' : 'slider'} tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={handle.label} aria-valuenow={handle.value} aria-valuemin={handle.min} aria-valuemax={handle.max} onFocus={() => { setSelected(handle.target.item); if (handle.target.point !== undefined) setSelectedPoint(handle.target.point); }} onPointerDown={event => {
        if (disabled || !available || panMode || space.current || event.button !== 0 || drag.current || pan.current) return;
        const element = svg.current, start = element && blurPointFromClient(element.getBoundingClientRect(), width, height, bounds, event.clientX, event.clientY, view.current); if (!element || !start) return;
        event.preventDefault(); event.stopPropagation(); setSelected(handle.target.item); event.currentTarget.focus?.();
        drag.current = { pointer: event.pointerId, element, target: handle.target, position: handle.position, start, clientY: event.clientY, original: values, published: values, keys: new Set(), sourceKey: identity };
        element.setPointerCapture?.(event.pointerId);
      }} onKeyDown={event => {
        if (!disabled && available && (event.key === 'Delete' || event.key === 'Backspace') && (handle.target.kind === 'center' || handle.target.kind === 'point')) { event.preventDefault(); event.stopPropagation(); remove(handle.target.item, handle.target.point); return; }
        if (disabled || !available || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); release(); const step = event.shiftKey ? 10 : 1;
        if (handle.target.kind === 'strength' || handle.target.kind === 'angle') {
          publish(setBlurGeometryValue(mode, values, handle.target.item, handle.target.kind, number(handle.value) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step))); return;
        }
        const x = handle.position[0] + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y = handle.position[1] + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        publish(updateBlurGeometry(mode, values, handle.target, [(x - bounds.x) / bounds.width, (y - bounds.y) / bounds.height], bounds.width, bounds.height));
      }}><title>{handle.label}</title><circle className="xd-photo-blur-hit" cx={handle.position[0]} cy={handle.position[1]} r={radius * 2.5}/><circle cx={handle.position[0]} cy={handle.position[1]} r={radius}/></g>)}
    </svg>
    {rows && rows.length > 1 && <label>{mode === 'paths' ? 'Path' : 'Pin'}<select aria-label={`Selected ${mode === 'paths' ? 'blur path' : 'blur pin'}`} value={index} disabled={disabled} onChange={event => { release(); setSelected(Number(event.currentTarget.value)); setSelectedPoint(0); }}>{rows.map((_, at) => <option key={at} value={at}>{at + 1}</option>)}</select></label>}
    {rows && mode !== 'tilt' && <div className="xd-photo-preview-actions"><button type="button" disabled={disabled || !available || (mode === 'paths' ? (active?.points?.length ?? 0) >= 256 : rows.length >= 256)} onClick={() => {
      if (mode === 'paths' && active?.points) { const a = active.points[pointIndex]!, b = active.points[Math.min(pointIndex + 1, active.points.length - 1) === pointIndex ? pointIndex - 1 : pointIndex + 1]!; insert([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
      else insert([(view.current.x + width / (2 * view.current.zoom) - bounds.x) / bounds.width, (view.current.y + height / (2 * view.current.zoom) - bounds.y) / bounds.height]);
    }}>{mode === 'paths' ? 'Add path point' : 'Add pin'}</button><button type="button" disabled={disabled || !available || (mode === 'paths' ? (active?.points?.length ?? 0) <= 2 : rows.length <= 1)} onClick={() => remove()}>{mode === 'paths' ? 'Remove selected point' : 'Remove selected pin'}</button></div>}
    {!rows && <p role="alert">Repair the pin or path list in the numeric controls, or use single settings, before editing it on the image.</p>}
    {active && <p className="xd-photo-section-help">{mode === 'spin' ? 'Spin angle' : mode === 'paths' ? 'Path speed' : 'Blur'}: {Math.round(strength(mode, active) * 100) / 100}{mode === 'spin' ? '°' : ' px'}</p>}
    <p className="xd-photo-section-help">Drag handles to shape the blur. Drag the amount handle up or down. Arrow keys adjust; Shift uses 10 steps. Escape cancels a drag.</p>
    {mode !== 'tilt' && <p className="xd-photo-section-help">Double-click the image to add {mode === 'paths' ? 'a path point' : 'a pin'}. Delete removes the selected {mode === 'paths' ? 'point; keep two points per path' : 'pin; keep one pin'}.</p>}
    <p className="xd-photo-section-help">Use Ctrl or Command with the wheel to zoom; hold Space or use the middle button to pan. + and − zoom; 0 fits the image.</p>
  </section>;
}
