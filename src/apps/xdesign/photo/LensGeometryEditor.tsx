import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { FilterNumericControl } from './FilterStructuredOptions';
import { validLensLine, type AdaptiveWideAngleConstraint } from './lensFilters';

type Point = [number, number];
type Values = Record<string, unknown>;
type Props = { wide: boolean; values: Values; width: number; height: number; image: string; curves?: unknown; disabled: boolean; change: (key: string, value: unknown) => void };
type Drag = { pointer: number; index: number; endpoint: 'a' | 'b'; original: unknown; published: unknown };
const MAX_LINES = 128;
const point = (value: unknown, fallback: Point): Point => Array.isArray(value) && value.length === 2 && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)) ? [...value] as Point : fallback;

export function lensPointFromClient(rect: { left: number; top: number; width: number; height: number }, width: number, height: number, x: number, y: number): Point | undefined {
  const scale = Math.min(rect.width / width, rect.height / height);
  if (!(scale > 0) || ![width, height, x, y, rect.left, rect.top, scale].every(Number.isFinite)) return;
  const left = rect.left + (rect.width - width * scale) / 2, top = rect.top + (rect.height - height * scale) / 2;
  return [Math.max(0, Math.min(width, (x - left) / scale)), Math.max(0, Math.min(height, (y - top) / scale))];
}

export function LensGeometryEditor({ wide, values, width, height, image, curves, disabled, change }: Props) {
  const key = wide ? 'constraints' : 'straighten';
  const [selected, setSelected] = useState(0), drag = useRef<Drag | null>(null);
  const svg = useRef<SVGSVGElement>(null), current = useRef(values); current.current = values;
  const raw = wide ? Array.isArray(values.constraints) ? values.constraints : [] : values.straighten == null ? [] : [values.straighten];
  const excessive = raw.length > MAX_LINES;
  const lines: AdaptiveWideAngleConstraint[] = excessive ? [] : raw.map(value => {
    const source = wide && value && typeof value === 'object' ? value as Values : {};
    const pair = wide ? [source.a, source.b] : Array.isArray(value) ? value : [];
    return { ...source, a: point(pair[0], [0, height / 2]), b: point(pair[1], [width, height / 2]), orientation: ['free', 'horizontal', 'vertical'].includes(String(source.orientation)) ? source.orientation as AdaptiveWideAngleConstraint['orientation'] : 'free' };
  });
  const index = Math.min(selected, Math.max(0, lines.length - 1)), active = lines[index];
  const publish = (next: AdaptiveWideAngleConstraint[]) => {
    if (disabled) return;
    const output = wide ? next : next.length ? [next[0]!.a, next[0]!.b] : undefined;
    if (drag.current) drag.current.published = structuredClone(output);
    change(key, output);
  };
  const replace = (at: number, endpoint: 'a' | 'b', next: Point) => {
    if (!active || disabled) return;
    publish(lines.map((line, i) => i === at ? { ...line, [endpoint]: next } : line));
  };
  const release = () => {
    const pointer = drag.current?.pointer; drag.current = null;
    if (pointer !== undefined && svg.current?.hasPointerCapture?.(pointer)) svg.current.releasePointerCapture(pointer);
  };
  useEffect(() => { if (disabled || drag.current && JSON.stringify(values[key]) !== JSON.stringify(drag.current.published)) release(); }, [disabled, values[key]]);
  useEffect(() => () => release(), []);
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const owned = drag.current;
    if (!owned || owned.pointer !== event.pointerId || disabled) return;
    const next = lensPointFromClient(event.currentTarget.getBoundingClientRect(), width, height, event.clientX, event.clientY);
    if (next) replace(owned.index, owned.endpoint, next);
  };
  const cancel = () => { const owned = drag.current; release(); if (owned && !disabled) change(key, structuredClone(owned.original)); };
  const radius = Math.max(width, height) / 32;
  const curvePoints = (at: number) => {
    const curve = Array.isArray(curves) ? curves[at] : undefined;
    return Array.isArray(curve) && curve.length >= 2 && curve.length <= 256 && curve.every(value => Array.isArray(value) && value.length === 2 && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))) ? curve.map(value => value.join(',')).join(' ') : undefined;
  };
  return <section aria-label={wide ? 'Wide-angle constraints' : 'Lens straightening'}>
    <p className="xd-photo-section-help">Mark lines on the original image. Drag endpoints or use arrow keys; Shift moves 10 pixels.</p>
    <svg ref={svg} className="xd-photo-lens-geometry" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-label="Original image geometry" onPointerMove={move} onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { move(event); release(); } }} onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) cancel(); }} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) drag.current = null; }} onKeyDown={event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
      <image href={image} width={width} height={height}/>
      {lines.map((line, at) => <g key={at} className={at === index ? 'is-selected' : undefined}>
        {curvePoints(at) ? <polyline points={curvePoints(at)} fill="none" vectorEffect="non-scaling-stroke"/> : <line x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} vectorEffect="non-scaling-stroke"/>}
        {(['a', 'b'] as const).map(endpoint => <circle key={endpoint} cx={line[endpoint][0]} cy={line[endpoint][1]} r={radius} tabIndex={disabled ? -1 : 0} role="button" aria-disabled={disabled} aria-label={`${wide ? 'Constraint' : 'Straighten'} ${at + 1} ${endpoint === 'a' ? 'start' : 'end'}`} onFocus={() => setSelected(at)} onPointerDown={event => {
          if (disabled || event.button !== 0 || drag.current) return;
          event.preventDefault(); setSelected(at); event.currentTarget.focus?.();
          drag.current = { pointer: event.pointerId, index: at, endpoint, original: structuredClone(current.current[key]), published: structuredClone(current.current[key]) };
          svg.current?.setPointerCapture?.(event.pointerId);
        }} onKeyDown={event => {
          if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1, [x, y] = line[endpoint];
          replace(at, endpoint, [Math.max(0, Math.min(width, x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0))), Math.max(0, Math.min(height, y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)))]);
        }}/>)}
      </g>)}
    </svg>
    {excessive ? <p role="alert">This list exceeds the {MAX_LINES}-line editor limit.</p> : <>
      {wide && lines.length > 0 && <label>Constraint<select aria-label="Selected wide-angle constraint" disabled={disabled} value={index} onChange={event => { release(); setSelected(Number(event.currentTarget.value)); }}>{lines.map((_, at) => <option key={at} value={at}>{at + 1}</option>)}</select></label>}
      {active && <>
        {(['a', 'b'] as const).flatMap(endpoint => [0, 1].map(axis => <FilterNumericControl key={`${endpoint}/${axis}`} spec={{ key: `${endpoint}/${axis}`, label: `${endpoint === 'a' ? 'Start' : 'End'} ${axis === 0 ? 'X' : 'Y'} (px)`, min: 0, max: axis === 0 ? width : height, value: 0, step: 'any' }} value={active[endpoint][axis]} disabled={disabled} change={value => { const next: Point = [...active[endpoint]]; next[axis] = value; replace(index, endpoint, next); }}/>))}
        {wide && <label>Orientation<select aria-label="Constraint orientation" disabled={disabled} value={active.orientation} onChange={event => publish(lines.map((line, at) => at === index ? { ...line, orientation: event.currentTarget.value as AdaptiveWideAngleConstraint['orientation'] } : line))}>{['free', 'horizontal', 'vertical'].map(value => <option key={value}>{value}</option>)}</select></label>}
        {!validLensLine([active.a, active.b], width, height) && <p role="alert">Use two distinct endpoints inside the image.</p>}
        <button type="button" disabled={disabled} onClick={() => { release(); publish(lines.filter((_, at) => at !== index)); setSelected(Math.max(0, index - 1)); }}>Remove {wide ? 'constraint' : 'straightening line'}</button>
      </>}
      <button type="button" disabled={disabled || (wide ? lines.length >= MAX_LINES : lines.length > 0)} onClick={() => { release(); publish([...lines, { a: [width * .1, height * .5], b: [width * .9, height * .5], orientation: 'free' }]); setSelected(lines.length); }}>{wide ? 'Add constraint' : 'Add straightening line'}</button>
    </>}
  </section>;
}
