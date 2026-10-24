import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FilterOption, NumberControl, PhotoAction } from './controls';
import { adjustmentDefaults } from './adjustmentSettings';
import { GALLERY_FILTERS } from './galleryFilters';

type Values = Record<string, unknown>;
type Props = { action: PhotoAction; values: Values; disabled: boolean; change: (key: string, value: unknown) => void };
type NumberSpec = { key: string; label: string; min: number; max: number; value: number; step?: number | "any" };
const MAX_ITEMS = 256;
const record = (value: unknown): Values => value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const numberValue = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const identityKernel = () => Array.from({ length: 25 }, (_, index) => index === 12 ? 1 : 0);
const fallback = (values: Values, key: string, defaultValue: number) => numberValue(values[key], defaultValue);
const field = (key: string, label: string, min: number, max: number, value: number, step = 1): NumberControl => ({ key, label, min, max, value, step });
const hexRgb = (value: unknown): [number, number, number] => {
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map(channel => Math.max(0, Math.min(1, numberValue(channel, 0)))) as [number, number, number];
  if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255) as [number, number, number];
  return [1, 1, 1];
};
const rgbHex = (value: unknown) => `#${hexRgb(value).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;

function Numeric({ spec, value, disabled, change, compact = false }: { spec: NumberSpec; value: unknown; disabled: boolean; change: (next: number) => void; compact?: boolean }) {
  const current = numberValue(value, spec.value), [draft, setDraft] = useState(String(current)), committed = useRef(current), published = useRef<number | undefined>(undefined);
  useEffect(() => { if (current !== committed.current) { committed.current = current; if (published.current !== current) setDraft(String(current)); published.current = undefined; } if (disabled) setDraft(String(current)); }, [current, disabled]);
  const restore = () => setDraft(String(current));
  return <label>{!compact && spec.label}<input type="number" required aria-label={spec.label} min={spec.min} max={spec.max} step={spec.step ?? 1} value={draft} disabled={disabled} onChange={event => {
    if (disabled) return;
    setDraft(event.currentTarget.value);
    const next = event.currentTarget.valueAsNumber;
    if (Number.isFinite(next) && next >= spec.min && next <= spec.max) { published.current = next; change(next); }
  }} onBlur={restore} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); } }}/></label>;
}

export { Numeric as FilterNumericControl };

function NumberFields({ specs, source, disabled, update }: { specs: NumberSpec[]; source: Values; disabled: boolean; update: (key: string, value: number) => void }) {
  return <>{specs.map(spec => <Numeric key={spec.key} spec={spec} value={source[spec.key]} disabled={disabled} change={value => update(spec.key, value)}/>)}</>;
}

function singleButton(active: boolean, disabled: boolean, label: string, activate: () => void, clear: () => void) {
  return active
    ? <button type="button" disabled={disabled} onClick={clear}>Use single {label}</button>
    : <button type="button" disabled={disabled} onClick={activate}>Edit {label}</button>;
}

function KernelEditor({ values, disabled, change }: Props) {
  const active = Array.isArray(values.kernel), coefficients = active ? list(values.kernel) : [];
  const replace = (index: number, value: number) => change('kernel', Array.from({ length: 25 }, (_, i) => i === index ? value : numberValue(coefficients[i], 0)));
  return <section aria-label="Custom kernel">
    {singleButton(active, disabled, 'kernel', () => change('kernel', identityKernel()), () => change('kernel', undefined))}
    {active && <><div role="group" aria-label="Kernel coefficients" className="xd-photo-kernel-coefficients">{Array.from({ length: 25 }, (_, index) => <Numeric key={index} compact spec={field(`coefficient-${index}`, `Kernel coefficient ${index + 1}`, -999, 999, 0, 0.01)} value={coefficients[index]} disabled={disabled} change={value => replace(index, value)}/>)}</div>
      <button type="button" disabled={disabled} onClick={() => change('kernel', identityKernel())}>Reset identity kernel</button></>}
  </section>;
}

function PointsEditor({ title, rows, active, keyName, disabled, change, makeRow, activateRows, renderRow }: { title: string; rows: unknown[]; active: boolean; keyName: string; disabled: boolean; change: Props['change']; makeRow: () => unknown; activateRows?: () => unknown[]; renderRow: (item: unknown, index: number, edit: (next: unknown) => void) => ReactNode }) {
  const update = (next: unknown[]) => { if (!disabled) change(keyName, next.slice(0, MAX_ITEMS)); };
  return <section aria-label={title}>
    {singleButton(active, disabled, title.toLowerCase(), () => change(keyName, activateRows?.() ?? [makeRow()]), () => change(keyName, undefined))}
    {rows.length > MAX_ITEMS ? <p role="alert">This list exceeds the {MAX_ITEMS}-item editor limit.</p> : null}
    {active && <>
      {rows.length <= MAX_ITEMS && rows.map((item, index) => <fieldset key={index} aria-label={`${title} ${index + 1}`}>
        {renderRow(item, index, value => update(rows.map((current, at) => at === index ? value : current)))}
        <button type="button" disabled={disabled || rows.length <= 1} aria-label={`Remove ${title} ${index + 1}`} onClick={() => update(rows.filter((_, at) => at !== index))}>Remove</button>
        <button type="button" disabled={disabled || index === 0} aria-label={`Move ${title} ${index + 1} up`} onClick={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; update(next); }}>Move up</button>
        <button type="button" disabled={disabled || index === rows.length - 1} aria-label={`Move ${title} ${index + 1} down`} onClick={() => { const next = [...rows]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; update(next); }}>Move down</button>
      </fieldset>)}
      <button type="button" disabled={disabled || rows.length >= MAX_ITEMS} onClick={() => update([...rows, makeRow()])}>Add {title.toLowerCase()}</button>
    </>}
  </section>;
}

function ShearEditor(props: Props) {
  const { values, disabled, change } = props;
  const points = Array.isArray(values.points) ? list(values.points) : [];
  const amount = fallback(values, 'amount', 0) / 100;
  return <PointsEditor title="Shear points" rows={points} active={Array.isArray(values.points)} keyName="points" disabled={disabled} change={change} makeRow={() => [0.5, amount]} activateRows={() => [[0, 0], [0.5, amount], [1, 0]]} renderRow={(item, index, edit) => {
    const pair = Array.isArray(item) ? item : [0, 0];
    return <><Numeric spec={field(`x-${index}`, 'Point X', 0, 1, 0.5, 0.01)} value={pair[0]} disabled={disabled} change={x => edit([x, numberValue(pair[1], 0)])}/><Numeric spec={field(`y-${index}`, 'Point Y', -1, 1, 0, 0.01)} value={pair[1]} disabled={disabled} change={y => edit([numberValue(pair[0], 0), y])}/></>;
  }}/>
}

function StructuredPins({ action, values, disabled, change }: Props) {
  const mode = action.structured!;
  const active = Array.isArray(values.pins), pins = active ? list(values.pins) : [];
  const seed = (): Values => {
    const x = fallback(values, 'centerX', 0.5), y = fallback(values, 'centerY', 0.5), blur = fallback(values, 'blur', 15);
    if (mode === 'field') return { x, y, blur };
    if (mode === 'iris') return { x, y, radiusX: fallback(values, 'radiusX', 0.35), radiusY: fallback(values, 'radiusY', 0.25), angle: fallback(values, 'angle', 0), roundness: fallback(values, 'roundness', 0), feather: fallback(values, 'feather', 0.5), blur };
    return { x, y, radiusX: fallback(values, 'radiusX', 0.3), radiusY: fallback(values, 'radiusY', 0.3), angle: fallback(values, 'angle', 0), blurAngle: fallback(values, 'blurAngle', 15) };
  };
  const specs: NumberSpec[] = mode === 'field'
    ? [field('x', 'Pin X', 0, 1, 0.5, 0.01), field('y', 'Pin Y', 0, 1, 0.5, 0.01), field('blur', 'Pin blur', 0, 500, 15)]
    : mode === 'iris'
      ? [field('x', 'Pin X', 0, 1, 0.5, 0.01), field('y', 'Pin Y', 0, 1, 0.5, 0.01), field('radiusX', 'Radius X', 0.001, 1, 0.35, 0.01), field('radiusY', 'Radius Y', 0.001, 1, 0.25, 0.01), field('angle', 'Pin angle', -180, 180, 0), field('roundness', 'Roundness', 0, 100, 0), field('feather', 'Feather', 0, 0.99, 0.5, 0.01), field('blur', 'Pin blur', 0, 500, 15)]
      : [field('x', 'Pin X', 0, 1, 0.5, 0.01), field('y', 'Pin Y', 0, 1, 0.5, 0.01), field('radiusX', 'Radius X', 0.001, 1, 0.3, 0.01), field('radiusY', 'Radius Y', 0.001, 1, 0.3, 0.01), field('angle', 'Pin angle', -180, 180, 0), field('blurAngle', 'Blur angle', 0, 360, 15)];
  return <PointsEditor title={`${action.label} pins`} rows={pins} active={active} keyName="pins" disabled={disabled} change={change} makeRow={seed} renderRow={(item, _index, edit) => {
    const pin = record(item);
    return <NumberFields specs={specs.map(spec => ({ ...spec, step: 'any' }))} source={pin} disabled={disabled} update={(key, value) => edit({ ...pin, [key]: value })}/>;
  }}/>
}

function LightsEditor({ values, disabled, change }: Props) {
  const lights = Array.isArray(values.lights) ? list(values.lights) : [];
  const defaults = () => [{ kind: values.lightType ?? 'spot', x: fallback(values, 'lightX', 0.25), y: fallback(values, 'lightY', 0.2), z: fallback(values, 'lightZ', 0.6), targetX: fallback(values, 'targetX', 0.5), targetY: fallback(values, 'targetY', 0.55), angle: fallback(values, 'angle', 135), elevation: fallback(values, 'elevation', 45), color: hexRgb(values.color ?? '#ffffff'), intensity: fallback(values, 'intensity', 75), cone: fallback(values, 'cone', 45), hotspot: fallback(values, 'hotspot', 50), radius: fallback(values, 'radius', 0.8) }];
  return <PointsEditor title="Lights" rows={lights} active={Array.isArray(values.lights)} keyName="lights" disabled={disabled} change={change} makeRow={() => defaults()[0]} renderRow={(item, index, edit) => {
    const light = record(item);
    const specs = [field('x', 'Light X', 0, 1, 0.25, 0.01), field('y', 'Light Y', 0, 1, 0.2, 0.01), field('z', 'Light depth', 0, 10, 0.6, 0.01), field('targetX', 'Target X', 0, 1, 0.5, 0.01), field('targetY', 'Target Y', 0, 1, 0.55, 0.01), field('angle', 'Light angle', -180, 180, 135), field('elevation', 'Elevation', 0, 90, 45), field('intensity', 'Intensity', -100, 100, 75), field('cone', 'Cone', 1, 89, 45), field('hotspot', 'Hotspot', 0, 100, 50), field('radius', 'Point radius', 0.01, 10, 0.8, 0.01)];
    return <><label>Light kind<select aria-label={`Light ${index + 1} kind`} disabled={disabled} value={String(light.kind ?? 'spot')} onChange={event => edit({ ...light, kind: event.currentTarget.value })}>{['spot', 'point', 'infinite'].map(value => <option key={value}>{value}</option>)}</select></label>
      <NumberFields specs={specs} source={light} disabled={disabled} update={(key, value) => edit({ ...light, [key]: value })}/>
      <label>Light color<input type="color" aria-label={`Light ${index + 1} color`} disabled={disabled} value={rgbHex(light.color)} onChange={event => edit({ ...light, color: hexRgb(event.currentTarget.value) })}/></label></>;
  }}/>
}

function PathsEditor(props: Props) {
  const { values, disabled, change } = props;
  const paths = Array.isArray(values.paths) ? list(values.paths) : [];
  const makePath = () => ({ points: [[fallback(values, 'startX', 0.2), fallback(values, 'startY', 0.5)], [fallback(values, 'endX', 0.8), fallback(values, 'endY', 0.5)]], speed: fallback(values, 'speed', 50), taper: fallback(values, 'taper', 0) });
  return <PointsEditor title="Blur paths" rows={paths} active={Array.isArray(values.paths)} keyName="paths" disabled={disabled} change={change} makeRow={makePath} renderRow={(item, index, edit) => {
    const path = record(item), points = list(path.points);
    const setPoints = (next: unknown[]) => edit({ ...path, points: next.slice(0, MAX_ITEMS) });
    return <>{points.length > MAX_ITEMS && <p role="alert">This path exceeds the {MAX_ITEMS}-point editor limit.</p>}<NumberFields specs={[field('speed', 'Path speed', 0, 500, 50), field('taper', 'Path taper', 0, 100, 0)].map(spec => ({ ...spec, step: 'any' }))} source={path} disabled={disabled} update={(key, value) => edit({ ...path, [key]: value })}/>
      {(points.length > MAX_ITEMS ? [] : points).map((point, pointIndex) => { const pair = Array.isArray(point) ? point : [0, 0]; return <div role="group" aria-label={`Path ${index + 1} point ${pointIndex + 1}`} key={pointIndex}>
        <Numeric spec={{ ...field(`x-${pointIndex}`, `Path ${index + 1} point ${pointIndex + 1} X`, 0, 1, 0.5, 0.01), step: 'any' }} value={pair[0]} disabled={disabled} change={x => setPoints(points.map((current, at) => at === pointIndex ? [x, numberValue(pair[1], 0)] : current))}/>
        <Numeric spec={{ ...field(`y-${pointIndex}`, `Path ${index + 1} point ${pointIndex + 1} Y`, 0, 1, 0.5, 0.01), step: 'any' }} value={pair[1]} disabled={disabled} change={y => setPoints(points.map((current, at) => at === pointIndex ? [numberValue(pair[0], 0), y] : current))}/>
        <button type="button" disabled={disabled || points.length <= 2} aria-label={`Remove path ${index + 1} point ${pointIndex + 1}`} onClick={() => setPoints(points.filter((_, at) => at !== pointIndex))}>Remove point</button>
      </div>; })}
      <button type="button" disabled={disabled || points.length >= MAX_ITEMS} onClick={() => setPoints([...points, [0.5, 0.5]])}>Add path point</button></>;
  }}/>
}

function GalleryEditor({ values, disabled, change }: Props) {
  const active = Array.isArray(values.effects);
  const rawEffects = active ? list(values.effects) : [];
  const effects: Values[] = rawEffects.length <= MAX_ITEMS ? rawEffects.map(effect => ({ ...record(effect), params: { ...record(record(effect).params) } })) : [];
  const add = (action = GALLERY_FILTERS[0]!) => ({ filter: action.id.replace('filter.gallery.', ''), params: { ...adjustmentDefaults(action, 'RGB'), ...Object.fromEntries(['foreground', 'background'].filter(key => action.options?.some(option => option.key === key) && values[key] !== undefined).map(key => [key, structuredClone(values[key])])) }, visible: true });
  const update = (index: number, effect: Values) => { if (!disabled) change('effects', effects.map((item, at) => at === index ? effect : item)); };
  return <section aria-label="Filter Gallery effects">
    {singleButton(active, disabled, 'effect stack', () => change('effects', [add()]), () => change('effects', undefined))}
    {active && <>
      {rawEffects.length > MAX_ITEMS ? <p role="alert">This list exceeds the {MAX_ITEMS}-item editor limit.</p> : effects.map((effect, index) => {
        const filter = GALLERY_FILTERS.find(item => item.id === `filter.gallery.${String(effect.filter)}`) ?? GALLERY_FILTERS[0]!;
        const params = record(effect.params);
        const setParam = (key: string, value: unknown) => update(index, { ...effect, params: { ...params, [key]: value } });
        return <fieldset key={index} aria-label={`Gallery effect ${index + 1}`}>
          <label>Effect<select aria-label={`Gallery effect ${index + 1} filter`} disabled={disabled} value={filter.id} onChange={event => {
            const selected = GALLERY_FILTERS.find(item => item.id === event.currentTarget.value) ?? GALLERY_FILTERS[0]!;
            update(index, { ...add(selected), visible: effect.visible !== false });
          }}>{GALLERY_FILTERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><input type="checkbox" aria-label={`Gallery effect ${index + 1} visible`} checked={effect.visible !== false} disabled={disabled} onChange={event => update(index, { ...effect, visible: event.currentTarget.checked })}/>Visible</label>
          <NumberFields specs={(filter.fields ?? []).map(item => ({ ...item }))} source={params} disabled={disabled} update={setParam}/>
          {(filter.options ?? []).map(option => <StructuredOption key={option.key} option={option} value={params[option.key]} disabled={disabled} change={value => setParam(option.key, value)}/>)}
          <button type="button" disabled={disabled} aria-label={`Remove gallery effect ${index + 1}`} onClick={() => change('effects', effects.filter((_, at) => at !== index))}>Delete effect layer</button>
          <button type="button" disabled={disabled || index === 0} aria-label={`Move gallery effect ${index + 1} up`} onClick={() => { const next = [...effects]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; change('effects', next); }}>Move up</button>
          <button type="button" disabled={disabled || index === effects.length - 1} aria-label={`Move gallery effect ${index + 1} down`} onClick={() => { const next = [...effects]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; change('effects', next); }}>Move down</button>
        </fieldset>;
      })}
      <button type="button" disabled={disabled || rawEffects.length >= MAX_ITEMS} onClick={() => change('effects', [...effects, add()])}>New effect layer</button>
    </>}
  </section>;
}

function StructuredOption({ option, value, disabled, change }: { option: FilterOption; value: unknown; disabled: boolean; change: (value: unknown) => void }) {
  if (option.kind === 'color') return <label>{option.label}<input type="color" aria-label={option.label} disabled={disabled} value={rgbHex(value ?? option.value)} onChange={event => change(event.currentTarget.value)}/></label>;
  if (option.kind === 'boolean') return <label><input type="checkbox" aria-label={option.label} disabled={disabled} checked={typeof value === 'boolean' ? value : option.value as boolean} onChange={event => change(event.currentTarget.checked)}/>{option.label}</label>;
  return <label>{option.label}<select aria-label={option.label} disabled={disabled} value={typeof value === 'string' ? value : option.value as string} onChange={event => change(event.currentTarget.value)}>{(option.choices ?? []).map(choice => <option key={choice}>{choice}</option>)}</select></label>;
}

export function structuredFilterOverrides(action: PhotoAction, values: Values): Set<string> {
  const active = (key: string) => Array.isArray(values[key]);
  if (action.structured === 'kernel' && active('kernel')) return new Set(['kernel']);
  if (action.structured === 'shear' && active('points')) return new Set(['amount']);
  if (action.structured === 'lights' && active('lights')) return new Set(['lightType', 'lightX', 'lightY', 'lightZ', 'targetX', 'targetY', 'angle', 'elevation', 'color', 'intensity', 'cone', 'hotspot', 'radius']);
  if (['field', 'iris', 'spin'].includes(action.structured ?? '') && active('pins')) {
    const keys = action.structured === 'field' ? ['centerX', 'centerY', 'blur']
      : action.structured === 'iris' ? ['centerX', 'centerY', 'blur', 'radiusX', 'radiusY', 'angle', 'roundness', 'feather']
        : ['centerX', 'centerY', 'radiusX', 'radiusY', 'angle', 'blurAngle'];
    return new Set(keys);
  }
  if (action.structured === 'paths' && active('paths')) return new Set(['startX', 'startY', 'endX', 'endY', 'speed', 'taper']);
  if (action.structured === 'gallery' && active('effects')) return new Set(['effects']);
  return new Set();
}

export function FilterStructuredOptions(props: Props) {
  const { action } = props;
  switch (action.structured) {
    case 'kernel': return <KernelEditor {...props}/>;
    case 'shear': return <ShearEditor {...props}/>;
    case 'lights': return <LightsEditor {...props}/>;
    case 'field': case 'iris': case 'spin': return <StructuredPins {...props}/>;
    case 'paths': return <PathsEditor {...props}/>;
    case 'gallery': return <GalleryEditor {...props}/>;
    default: return null;
  }
}
