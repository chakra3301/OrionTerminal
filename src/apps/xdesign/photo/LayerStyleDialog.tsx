import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { PhotoDialog } from "./photoDialog";
import { useDesignDialog } from "../useDesignDialog";
import { ColorPickerDialog } from "./ColorPickerDialog";
import { GradientEditorDialog, GradientPick, gradientCss } from "./GradientEditorDialog";
import { PresetPreview } from "./PresetPreview";
import { BLENDS, ContourEditor } from "./LayerEffects";
import { blendOptions } from "./blendOptions";
import { CanvasDraftPreview, type CanvasDraft } from "./CanvasDraftPreview";
import { documentUnder } from "./ColorRangeDialog";
import { GRADIENT_METHODS, bakeRemembered, unbaked, type GradientMethod } from "./gradientMethod";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer, PhotoState } from "./types";
import "./layerStyleDialog.css";

/** Photoshop's list order. `key` is the `layer.layerStyle.<key>` command, `type` the serde tag in `layer.effects.items`. */
const FX = [
  { key: "bevelEmboss", type: "BevelEmboss", label: "Bevel & Emboss", multi: false },
  { key: "stroke", type: "Stroke", label: "Stroke", multi: true },
  { key: "innerShadow", type: "InnerShadow", label: "Inner Shadow", multi: true },
  { key: "innerGlow", type: "InnerGlow", label: "Inner Glow", multi: false },
  { key: "satin", type: "Satin", label: "Satin", multi: false },
  { key: "colorOverlay", type: "ColorOverlay", label: "Color Overlay", multi: true },
  { key: "gradientOverlay", type: "GradientOverlay", label: "Gradient Overlay", multi: true },
  { key: "patternOverlay", type: "PatternOverlay", label: "Pattern Overlay", multi: false },
  { key: "outerGlow", type: "OuterGlow", label: "Outer Glow", multi: false },
  { key: "dropShadow", type: "DropShadow", label: "Drop Shadow", multi: true },
] as const;
export { FX as LAYER_STYLE_EFFECTS };
export type LayerStyleEffect = (typeof FX)[number]["key"];
export type LayerStylePane = "styles" | "blending" | "contour" | "texture" | LayerStyleEffect;
type Sel = { pane: LayerStylePane; nth: number };
type Settings = Record<string, unknown>;
type Fx = {
  s: Settings; colors: Record<string, string>; global?: { angle: number; altitude: number }; patterns: { id: string; name: string }[];
  set: (path: string[], value: unknown) => Promise<void>; setGlobal: (patch: { angle?: number; altitude?: number }) => Promise<void>; pick: (path: string[], title: string) => void; editGradient: (path: string[]) => void;
  preview: (path: string[], value: unknown) => void; previewGlobal: (patch: { angle?: number; altitude?: number }) => void; endPreview: () => void;
};
type Draft = (command: string | null, params?: Record<string, unknown>) => void;
const Ctx = createContext<Fx>(null as never);

const norm = (text: string) => text.toLowerCase().replace("(add)", "").replace(/[^a-z]/g, "");
export const blendLabel = (variant: string) => variant === "LinearDodge" ? "Linear Dodge (Add)" : variant === "PassThrough" ? "Pass Through" : variant.replace(/([a-z])([A-Z])/g, "$1 $2");
const at = (value: unknown, path: string[]) => path.reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], value);
const find = (layers: PhotoLayer[], id: number): PhotoLayer | undefined => { for (const layer of layers) { if (layer.id === id) return layer; const inner = layer.children && find(layer.children, id); if (inner) return inner; } };
const historyId = (state: PhotoState | null | undefined) => state?.historySources?.find(source => source.current)?.id ?? null;
const hexOf = (color: unknown) => { const c = (color as { c?: number[] } | undefined)?.c ?? [0, 0, 0]; return `#${c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`; };
const cssOf = (color: unknown, opacity = 1) => { const c = (color as { c?: number[]; alpha?: number } | undefined) ?? {}, [r, g, b] = (c.c ?? [0, 0, 0]).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)); return `rgba(${r},${g},${b},${(c.alpha ?? 1) * opacity})`; };
const rgbColor = (hex: string, alpha: number) => ({ mode: "Rgb", c: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(0), alpha });
type Gradient = Settings & { stops: [number, unknown][]; opacity_stops?: [number, number][] };
/** A stored gradient as the user set it, with its Method. The engine blends stops linearly, so other methods reach it baked. */
const unbake = (gradient: Gradient): { gradient: Gradient; method: GradientMethod } => {
  const found = unbaked(gradient.stops.map(([t, color]) => [t, hexOf(color)]));
  return found ? { gradient: { ...gradient, stops: found.stops.map(([t, hex]) => [t, rgbColor(hex, 1)]) }, method: found.method } : { gradient, method: "classic" };
};
const bake = (gradient: Gradient, method: GradientMethod): Gradient => {
  const stops = bakeRemembered(gradient.stops.map(([t, color]) => [t, hexOf(color)]), method);
  return stops ? { ...gradient, stops: stops.map(([t, hex]) => [t, rgbColor(hex, 1)]) } : gradient;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Photoshop keeps one default per effect kind (shared by every instance); the engine has no store for it, so it lives in the browser. */
const DEFAULTS_KEY = "xdesign.photo.layerStyleDefaults";
const readDefaults = (): Record<string, Settings> => { try { const stored = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? "{}"); return stored && typeof stored === "object" ? stored : {}; } catch { return {}; } };
const writeDefault = (type: string, settings: Settings) => { try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ ...readDefaults(), [type]: settings })); return true; } catch { return false; } };
/** Factory settings per effect kind, read once from a throwaway effect the engine builds. */
const factory = new Map<string, Settings>();

const MOVABLE = ["DropShadow", "InnerShadow", "Satin", "PatternOverlay", "GradientOverlay"];

/** A rough CSS rendering of the enabled effects on a sample square: shown for orientation, the canvas is the real render. */
const squash = (value: number, max: number) => Math.max(-max, Math.min(max, value * 0.5));
function sampleStyle(items: { type: string; enabled: boolean; settings: unknown }[]): CSSProperties {
  const shadows: string[] = [], overlays: string[] = [];
  for (const { type, enabled, settings } of items) {
    if (!enabled) continue;
    const s = settings as Settings, n = (key: string) => Number(s[key]) || 0, opacity = Number(at(s, ["common", "opacity"]));
    const op = Number.isFinite(opacity) ? opacity : 1, angle = n("angle") * Math.PI / 180, size = n("size");
    const reach = `${squash(-Math.cos(angle) * n("distance"), 14)}px ${squash(Math.sin(angle) * n("distance"), 14)}px`;
    const paint = s.paint as { Color?: unknown; Gradient?: { stops: [number, unknown][] } } | undefined;
    const glow = paint?.Color ?? paint?.Gradient?.stops?.[0]?.[1];
    if (type === "DropShadow") shadows.push(`${reach} ${squash(size, 10)}px ${squash(size * n("spread"), 6)}px ${cssOf(s.color, op)}`);
    else if (type === "InnerShadow") shadows.push(`inset ${reach} ${squash(size, 10)}px ${squash(size * n("spread"), 6)}px ${cssOf(s.color, op)}`);
    else if (type === "Satin") shadows.push(`inset ${reach} ${squash(size, 10)}px ${cssOf(s.color, op)}`);
    else if (type === "OuterGlow") shadows.push(`0 0 ${squash(size, 10)}px ${squash(size * n("spread"), 6)}px ${cssOf(glow, op)}`);
    else if (type === "InnerGlow") shadows.push(`inset 0 0 ${squash(size, 10)}px ${squash(size * n("spread"), 6)}px ${cssOf(glow, op)}`);
    else if (type === "Stroke") { const w = Math.max(1, Math.min(5, size * 0.5)), color = cssOf(glow, op), where = s.position; if (where !== "Inside") shadows.push(`0 0 0 ${where === "Center" ? w / 2 : w}px ${color}`); if (where !== "Outside") shadows.push(`inset 0 0 0 ${where === "Center" ? w / 2 : w}px ${color}`); }
    else if (type === "BevelEmboss") { const lit = s.up === false ? -1 : 1, soft = Math.max(1, Math.min(4, size * 0.3)); shadows.push(`inset ${lit * 2}px ${lit * 2}px ${soft}px ${cssOf(s.highlight_color, Number(at(s, ["highlight", "opacity"])) || 1)}`, `inset ${-lit * 2}px ${-lit * 2}px ${soft}px ${cssOf(s.shadow_color, Number(at(s, ["shadow", "opacity"])) || 1)}`); }
    else if (type === "ColorOverlay") { const color = cssOf(s.color, op); overlays.push(`linear-gradient(${color},${color})`); }
    else if (type === "GradientOverlay") { const stops = (at(s, ["gradient", "stops"]) as [number, unknown][] | undefined) ?? []; if (stops.length > 1) overlays.push(`linear-gradient(${90 - (Number(at(s, ["gradient", "angle"])) || 0)}deg,${stops.map(([at, color]) => `${cssOf(color, op)} ${at * 100}%`).join(",")})`); }
  }
  return { boxShadow: shadows.join(",") || undefined, backgroundImage: overlays.join(",") || undefined };
}

/** A value being dragged or typed stays on screen until its commit lands; one commit per gesture keeps the history short. */
function useDraft(shown: number, commit: (value: number) => Promise<void> | void, min: number, max: number, live?: (value: number | null) => void) {
  const [draft, setDraft] = useState<number | null>(null), [held, setHeld] = useState<number | null>(null), latest = useRef<number | null>(null);
  const change = (value: number) => { latest.current = value; setDraft(value); if (Number.isFinite(value)) live?.(Math.min(max, Math.max(min, value))); };
  const flush = () => {
    const value = latest.current; latest.current = null; setDraft(null);
    if (value === null) return;
    const next = Math.min(max, Math.max(min, value));
    if (!Number.isFinite(value) || next === shown) { live?.(null); return; }
    setHeld(next); void Promise.resolve(commit(next)).finally(() => setHeld(null));
  };
  return { value: draft ?? held ?? shown, change, flush };
}

/** Photoshop's Shading globe: the dot sits at the light's angle, nearer the centre the higher its altitude. One drag sets both. */
function Globe() {
  const fx = useContext(Ctx), linked = !!fx.global && fx.s.use_global_light === true;
  const shown = linked ? fx.global! : { angle: Number(fx.s.angle), altitude: Number(fx.s.altitude) };
  const [drag, setDrag] = useState<{ angle: number; altitude: number } | null>(null), [held, setHeld] = useState<{ angle: number; altitude: number } | null>(null), latest = useRef<{ angle: number; altitude: number } | null>(null);
  const turn = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), reach = box.width / 2 * 10 / 12 || 1;
    const dx = event.clientX - box.left - box.width / 2, dy = box.top + box.height / 2 - event.clientY;
    const next = { angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI), altitude: Math.round(Math.acos(Math.min(1, Math.hypot(dx, dy) / reach)) * 180 / Math.PI) };
    latest.current = next; setDrag(next);
    if (linked) fx.previewGlobal(next); else fx.preview([], { ...fx.s, ...next });
  };
  const flush = () => {
    const next = latest.current; latest.current = null; setDrag(null);
    if (!next) return;
    if (next.angle === shown.angle && next.altitude === shown.altitude) return fx.endPreview();
    setHeld(next); void Promise.resolve(linked ? fx.setGlobal(next) : fx.set([], { ...fx.s, ...next })).finally(() => setHeld(null));
  };
  const value = drag ?? held ?? shown, radians = value.angle * Math.PI / 180, reach = Math.cos(value.altitude * Math.PI / 180) * 10;
  return <svg className="xd-ls-dial" viewBox="-12 -12 24 24" role="img" aria-label="Angle and altitude globe" onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); turn(event); }} onPointerMove={event => { if (event.buttons) turn(event); }} onPointerUp={flush}><circle r="10"/><line x2={Math.cos(radians) * reach} y2={-Math.sin(radians) * reach}/><circle className="xd-ls-dot" cx={Math.cos(radians) * reach} cy={-Math.sin(radians) * reach} r="1.8"/></svg>;
}

function Num({ label, path, unit, min, max, scale = 1, slider = true, dial = false, glob }: { label: string; path: string[]; unit: string; min: number; max: number; scale?: number; slider?: boolean; dial?: boolean | "globe"; glob?: "angle" | "altitude" }) {
  const fx = useContext(Ctx), linked = glob && fx.global && fx.s.use_global_light === true;
  const shown = Number(((linked ? fx.global![glob] : Number(at(fx.s, path)) * scale)).toFixed(2));
  const draft = useDraft(shown, value => linked ? fx.setGlobal({ [glob]: value }) : fx.set(path, value / scale), min, max,
    value => value === null ? fx.endPreview() : linked ? fx.previewGlobal({ [glob]: value }) : fx.preview(path, value / scale));
  const track = useRef<SVGSVGElement>(null);
  const turn = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    draft.change(Math.round(Math.atan2(box.top + box.height / 2 - event.clientY, event.clientX - box.left - box.width / 2) * 180 / Math.PI));
  };
  const radians = draft.value * Math.PI / 180;
  return <div className="xd-ls-row">
    <span className="xd-ls-label">{label}:</span>
    {dial === "globe" ? <Globe/> : dial ? <svg ref={track} className="xd-ls-dial" viewBox="-12 -12 24 24" role="img" aria-label={`${label} dial`} onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); turn(event); }} onPointerMove={event => { if (event.buttons) turn(event); }} onPointerUp={draft.flush}><circle r="10"/><line x2={Math.cos(radians) * 10} y2={-Math.sin(radians) * 10}/></svg>
      : slider ? <input type="range" aria-label={`${label} slider`} min={min} max={max} step="any" value={draft.value} onChange={event => draft.change(event.target.valueAsNumber)} onPointerUp={draft.flush} onKeyUp={draft.flush} onBlur={draft.flush}/> : <span/>}
    <input type="number" aria-label={label} min={min} max={max} value={Number.isNaN(draft.value) ? "" : draft.value} onChange={event => draft.change(event.target.valueAsNumber)} onBlur={draft.flush} onKeyDown={event => { if (event.key === "Enter") draft.flush(); }}/>
    <span className="xd-ls-unit">{unit}</span>
  </div>;
}

function Pick({ label, value, options, onValue, title }: { label: string; value: string; options: [string, string][]; onValue: (value: string) => void; title?: string }) {
  return <div className="xd-ls-row is-wide"><span className="xd-ls-label">{label}:</span><select aria-label={title ?? label} value={value} onChange={event => onValue(event.target.value)}>{options.some(([v]) => v === value) ? null : <option value={value}>{value}</option>}{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></div>;
}

function Tick({ label, path, onValue, checked }: { label: string; path?: string[]; onValue?: (checked: boolean) => void; checked?: boolean }) {
  const fx = useContext(Ctx), on = checked ?? at(fx.s, path ?? []) === true;
  return <label className="xd-ls-tick"><input type="checkbox" checked={on} onChange={event => onValue ? onValue(event.target.checked) : void fx.set(path ?? [], event.target.checked)}/>{label}</label>;
}

function Swatch({ path, title }: { path: string[]; title: string }) {
  const fx = useContext(Ctx), hex = fx.colors[`/${path.join("/")}`] ?? hexOf(at(fx.s, path));
  return <button type="button" className="xd-ls-swatch" aria-label={title} title={title} style={{ background: hex }} onClick={() => fx.pick(path, title)}/>;
}

function Blend({ path = ["common", "blend"], color, colorTitle, label = "Blend Mode" }: { path?: string[]; color?: string[]; colorTitle?: string; label?: string }) {
  const fx = useContext(Ctx), value = String(at(fx.s, path));
  return <div className="xd-ls-row is-wide"><span className="xd-ls-label">{label}:</span><span className="xd-ls-inline"><select aria-label={label} value={value} onChange={event => void fx.set(path, event.target.value)}>{blendOptions(BLENDS, blendLabel)}</select>{color && <Swatch path={color} title={colorTitle ?? "Color"}/>}</span></div>;
}

const CURVE_POINTS = (contour: unknown) => (contour as { Custom?: { points: { input: number; output: number }[] } } | undefined)?.Custom?.points;
function Contour({ path, antiAlias, label = "Contour" }: { path: string[]; antiAlias?: string[]; label?: string }) {
  const fx = useContext(Ctx), value = at(fx.s, path), points = CURVE_POINTS(value), custom = !!points;
  return <>
    <div className="xd-ls-row is-wide"><span className="xd-ls-label">{label}:</span><span className="xd-ls-inline">
      <svg className="xd-ls-curve" viewBox="0 0 100 100" aria-hidden="true"><polyline points={(points ?? [{ input: 0, output: 0 }, { input: 1, output: 1 }]).map(p => `${p.input * 100},${100 - p.output * 100}`).join(" ")}/></svg>
      <select aria-label={label} value={custom ? "Custom" : "Linear"} onChange={event => void fx.set(path, event.target.value === "Linear" ? "Linear" : { Custom: { name: "Custom", points: [{ input: 0, output: 0 }, { input: 1, output: 1 }] } })}><option>Linear</option><option>Custom</option></select>
      {antiAlias && <Tick label="Anti-aliased" path={antiAlias}/>}
    </span></div>
    {custom && <ContourEditor value={value} path={path} commit={fx.set} disabled={false}/>}
  </>;
}

const GRADIENT_STYLES: [string, string][] = ["Linear", "Radial", "Angle", "Reflected", "Diamond"].map(style => [style, style]);
function GradientEditor({ path, scaleRange = [10, 150], movable = false, withMethod = false }: { path: string[]; scaleRange?: [number, number]; movable?: boolean; withMethod?: boolean }) {
  const fx = useContext(Ctx), stored = at(fx.s, path) as Gradient | undefined;
  if (!stored) return null;
  const { gradient, method } = unbake(stored);
  return <>
    <div className="xd-ls-row is-wide"><span className="xd-ls-label">Gradient:</span><span className="xd-ls-inline">
      <GradientPick css={gradientCss(stored.stops, stored.opacity_stops ?? [], hexOf)} edit={() => fx.editGradient(path)} choose={preset => void fx.set(path, bake({ ...gradient, stops: preset.stops.map(([t, c]) => [t, rgbColor(c, 1)]), opacity_stops: preset.opacity }, method))}/>
      <Tick label="Reverse" path={[...path, "reverse"]}/>
    </span></div>
    <Pick label="Style" value={String(at(fx.s, [...path, "style"]))} options={GRADIENT_STYLES} onValue={value => void fx.set([...path, "style"], value)}/>
    <Tick label="Align with Layer" path={[...path, "align"]}/>
    {movable && <button type="button" className="xd-ls-snap" onClick={() => void fx.set([...path, "offset"], [0, 0])}>Reset Alignment</button>}
    <Num label="Angle" path={[...path, "angle"]} unit="°" min={-180} max={180} dial/>
    <Num label="Scale" path={[...path, "scale"]} unit="%" min={scaleRange[0]} max={scaleRange[1]} scale={100}/>
    {withMethod && <Pick label="Method" value={method} options={GRADIENT_METHODS} onValue={next => void fx.set(path, bake(gradient, next as GradientMethod))}/>}
  </>;
}

/** Strokes and glows hold either a colour or a gradient under `paint`; Photoshop's Fill Type / colour-or-gradient choice. */
function Paint({ label = "Fill Type", gradientScale, withMethod }: { label?: string; gradientScale?: [number, number]; withMethod?: boolean }) {
  const fx = useContext(Ctx), paint = fx.s.paint as Record<string, unknown>, kind = Object.keys(paint ?? {})[0] ?? "Color";
  const color = kind === "Color" ? paint.Color : (paint[kind] as { stops?: [number, unknown][] }).stops?.[0]?.[1] ?? rgbColor("#ffffbe", 1);
  const to = (next: string) => {
    if (next === kind) return;
    const gradient: Gradient = { stops: [[0, color], [1, color]], opacity_stops: [[0, 1], [1, 0]], style: "Linear", angle: 90, scale: 1, reverse: false, align: true, offset: [0, 0] };
    void fx.set(["paint"], next === "Color" ? { Color: color } : { Gradient: withMethod ? bake(gradient, "smooth") : gradient });
  };
  return <>
    <Pick label={label} value={kind} options={[["Color", "Color"], ["Gradient", "Gradient"], ...(kind === "Pattern" ? [["Pattern", "Pattern"] as [string, string]] : [])]} onValue={to}/>
    {kind === "Color" && <div className="xd-ls-row is-wide"><span className="xd-ls-label">Color:</span><Swatch path={["paint", "Color"]} title="Select color"/></div>}
    {kind === "Gradient" && <GradientEditor path={["paint", "Gradient"]} scaleRange={gradientScale} withMethod={withMethod}/>}
  </>;
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => <fieldset className="xd-ps-dialog-group xd-ls-group"><legend>{title}</legend>{children}</fieldset>;
const COMMON_OPACITY = <Num label="Opacity" path={["common", "opacity"]} unit="%" min={0} max={100} scale={100}/>;
const QUALITY_NOISE = <Num label="Noise" path={["noise"]} unit="%" min={0} max={100} scale={100}/>;

function Shadow({ inner, ...rest }: { inner: boolean }) {
  void rest; const fx = useContext(Ctx);
  return <>
    <Group title="Structure">
      <Blend color={["color"]} colorTitle="Set color of shadow"/>
      {COMMON_OPACITY}
      <Num label="Angle" path={["angle"]} unit="°" min={-180} max={180} dial glob="angle"/>
      <Tick label="Use Global Light" path={["use_global_light"]}/>
      <Num label="Distance" path={["distance"]} unit="px" min={0} max={250}/>
      <Num label={inner ? "Choke" : "Spread"} path={["spread"]} unit="%" min={0} max={100} scale={100}/>
      <Num label="Size" path={["size"]} unit="px" min={0} max={250}/>
    </Group>
    <Group title="Quality">
      <Contour path={["contour"]} antiAlias={["anti_alias"]}/>
      {QUALITY_NOISE}
    </Group>
    {!inner && <Tick label="Layer Knocks Out Drop Shadow" path={["knocks_out"]}/>}
    {fx.s.use_global_light === true && <p className="xd-ls-hint">Angle follows the document's global light.</p>}
  </>;
}

function Glow({ inner }: { inner: boolean }) {
  const fx = useContext(Ctx);
  return <>
    <Group title="Structure">
      <Blend/>
      {COMMON_OPACITY}
      {QUALITY_NOISE}
      <Paint label="Fill Type" gradientScale={[10, 150]}/>
    </Group>
    <Group title="Elements">
      <Pick label="Technique" value={String(fx.s.technique)} options={[["Softer", "Softer"], ["Precise", "Precise"]]} onValue={value => void fx.set(["technique"], value)}/>
      {inner && <Pick label="Source" value={String(fx.s.source)} options={[["Center", "Center"], ["Edge", "Edge"]]} onValue={value => void fx.set(["source"], value)}/>}
      <Num label={inner ? "Choke" : "Spread"} path={["spread"]} unit="%" min={0} max={100} scale={100}/>
      <Num label="Size" path={["size"]} unit="px" min={0} max={250}/>
    </Group>
    <Group title="Quality">
      <Contour path={["contour"]} antiAlias={["anti_alias"]}/>
      <Num label="Range" path={["range"]} unit="%" min={1} max={100} scale={100}/>
      <Num label="Jitter" path={["jitter"]} unit="%" min={0} max={100} scale={100}/>
    </Group>
  </>;
}

function PatternPicker({ label = "Pattern", value, onPick }: { label?: string; value: string; onPick: (id: string, name: string) => void }) {
  const fx = useContext(Ctx);
  return <Pick label={label} title={label} value={value} options={fx.patterns.map(pattern => [pattern.id, pattern.name])} onValue={id => onPick(id, fx.patterns.find(pattern => pattern.id === id)?.name ?? id)}/>;
}

function Bevel() {
  const fx = useContext(Ctx), s = fx.s;
  return <>
    <Group title="Structure">
      <Pick label="Style" value={String(s.style)} options={[["OuterBevel", "Outer Bevel"], ["InnerBevel", "Inner Bevel"], ["Emboss", "Emboss"], ["PillowEmboss", "Pillow Emboss"], ["StrokeEmboss", "Stroke Emboss"]]} onValue={value => void fx.set(["style"], value)}/>
      <Pick label="Technique" value={String(s.technique)} options={[["Smooth", "Smooth"], ["ChiselHard", "Chisel Hard"], ["ChiselSoft", "Chisel Soft"]]} onValue={value => void fx.set(["technique"], value)}/>
      <Num label="Depth" path={["depth"]} unit="%" min={1} max={1000} scale={100}/>
      <div className="xd-ls-row is-wide"><span className="xd-ls-label">Direction:</span><span className="xd-ls-inline" role="radiogroup" aria-label="Direction">
        {([["Up", true], ["Down", false]] as const).map(([text, up]) => <label key={text} className="xd-ls-tick"><input type="radio" name="xd-ls-direction" checked={(s.up !== false) === up} onChange={() => void fx.set(["up"], up)}/>{text}</label>)}
      </span></div>
      <Num label="Size" path={["size"]} unit="px" min={0} max={250}/>
      <Num label="Soften" path={["soften"]} unit="px" min={0} max={16}/>
    </Group>
    <Group title="Shading">
      <Num label="Angle" path={["angle"]} unit="°" min={-180} max={180} dial="globe" glob="angle"/>
      <Tick label="Use Global Light" path={["use_global_light"]}/>
      <Num label="Altitude" path={["altitude"]} unit="°" min={0} max={90} slider={false} glob="altitude"/>
      <Contour path={["gloss_contour"]} label="Gloss Contour"/>
      <Blend path={["highlight", "blend"]} label="Highlight Mode" color={["highlight_color"]} colorTitle="Set color of highlight"/>
      <Num label="Opacity" path={["highlight", "opacity"]} unit="%" min={0} max={100} scale={100}/>
      <Blend path={["shadow", "blend"]} label="Shadow Mode" color={["shadow_color"]} colorTitle="Set color of shadow"/>
      <Num label="Opacity" path={["shadow", "opacity"]} unit="%" min={0} max={100} scale={100}/>
    </Group>
  </>;
}

function BevelContour() {
  const fx = useContext(Ctx);
  return <Group title="Contour"><Contour path={["contour", "contour"]} antiAlias={["contour", "anti_alias"]} label="Contour"/><Num label="Range" path={["contour", "range"]} unit="%" min={1} max={100} scale={100}/>{void fx}</Group>;
}

function BevelTexture({ pattern }: { pattern: (id: string, name: string) => void }) {
  const fx = useContext(Ctx);
  return <Group title="Elements">
    <PatternPicker value={String(at(fx.s, ["texture", "id"]))} onPick={pattern}/>
    <button type="button" className="xd-ls-snap" onClick={() => void fx.set(["texture", "phase"], [0, 0])}>Snap to Origin</button>
    <Num label="Scale" path={["texture", "scale"]} unit="%" min={1} max={1000} scale={100}/>
    <Num label="Depth" path={["texture", "depth"]} unit="%" min={-1000} max={1000} scale={100}/>
    <Tick label="Invert" path={["texture", "invert"]}/>
    <Tick label="Link with Layer" path={["texture", "link"]}/>
  </Group>;
}

function Stroke() {
  const fx = useContext(Ctx);
  return <>
    <Group title="Structure">
      <Num label="Size" path={["size"]} unit="px" min={1} max={250}/>
      <Pick label="Position" value={String(fx.s.position)} options={[["Outside", "Outside"], ["Inside", "Inside"], ["Center", "Center"]]} onValue={value => void fx.set(["position"], value)}/>
      <Blend/>
      {COMMON_OPACITY}
      <Paint withMethod/>
    </Group>
  </>;
}

function Satin() {
  return <Group title="Structure">
    <Blend color={["color"]} colorTitle="Set color of satin"/>
    {COMMON_OPACITY}
    <Num label="Angle" path={["angle"]} unit="°" min={-180} max={180} dial/>
    <Num label="Distance" path={["distance"]} unit="px" min={0} max={250}/>
    <Num label="Size" path={["size"]} unit="px" min={0} max={250}/>
    <Contour path={["contour"]} antiAlias={["anti_alias"]}/>
    <Tick label="Invert" path={["invert"]}/>
  </Group>;
}

function PatternOverlay({ choose }: { choose: (id: string) => void }) {
  const fx = useContext(Ctx);
  return <Group title="Pattern">
    <Blend/>
    {COMMON_OPACITY}
    <PatternPicker value={String(fx.s.id)} onPick={choose}/>
    <button type="button" className="xd-ls-snap" onClick={() => void fx.set(["phase"], [0, 0])}>Snap to Origin</button>
    <Num label="Angle" path={["angle"]} unit="°" min={-180} max={180} dial/>
    <Num label="Scale" path={["scale"]} unit="%" min={1} max={1000} scale={100}/>
    <Tick label="Link with Layer" path={["link"]}/>
  </Group>;
}

/** Blend If thumbs: black and white each have a low and a high half; Alt-dragging an unsplit pair tears it in two, as Photoshop does. */
function BlendIfSlider({ label, values, commit, live }: { label: string; values: number[]; commit: (next: number[]) => void; live: (next: number[] | null) => void }) {
  const [draft, setDraft] = useState<number[] | null>(null), track = useRef<HTMLDivElement>(null), drag = useRef<{ index: number; pair: boolean } | null>(null), latest = useRef<number[] | null>(null);
  const shown = draft ?? values, split = (a: number, b: number) => shown[a] !== shown[b];
  const move = (event: PointerEvent<HTMLElement>) => {
    const grab = drag.current, box = track.current?.getBoundingClientRect();
    if (!grab || !box?.width) return;
    const x = Math.round(Math.max(0, Math.min(255, (event.clientX - box.left) / box.width * 255))), next = [...(latest.current ?? shown)], i = grab.index;
    if (grab.pair) { const low = i < 2, value = low ? Math.min(x, next[2]!) : Math.max(x, next[1]!); next[low ? 0 : 2] = value; next[low ? 1 : 3] = value; }
    else next[i] = Math.max(next[i - 1] ?? 0, Math.min(next[i + 1] ?? 255, x));
    latest.current = next; setDraft(next); live(next);
  };
  const end = () => { const next = latest.current; drag.current = null; latest.current = null; setDraft(null); if (next && next.join() !== values.join()) commit(next); else if (next) live(null); };
  const read = (a: number, b: number) => split(a, b) ? `${shown[a]} / ${shown[b]}` : String(shown[a]);
  return <div className="xd-ls-blendif">
    <span className="xd-ls-label">{label}:</span>
    <span className="xd-ls-readout">{read(0, 1)}<i/>{read(2, 3)}</span>
    <div className="xd-ls-track" ref={track} role="group" aria-label={`${label} sliders`}>
      {[0, 1, 2, 3].map(i => <span key={i} className={`xd-ls-thumb ${i < 2 ? "is-black" : "is-white"}${split(i < 2 ? 0 : 2, i < 2 ? 1 : 3) ? " is-split" : ""}${i % 2 ? " is-high" : " is-low"}`} role="slider" tabIndex={0} aria-label={`${label} ${i < 2 ? "black" : "white"} ${i % 2 ? "end" : "start"}`} aria-valuemin={0} aria-valuemax={255} aria-valuenow={shown[i]} style={{ left: `${shown[i]! / 255 * 100}%` }}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); const paired = !split(i < 2 ? 0 : 2, i < 2 ? 1 : 3); drag.current = { index: i, pair: paired && !event.altKey }; latest.current = [...shown]; }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onKeyDown={(event: KeyboardEvent) => { const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0; if (!step) return; event.preventDefault(); const next = [...shown]; next[i] = Math.max(next[i - 1] ?? 0, Math.min(next[i + 1] ?? 255, next[i]! + step)); commit(next); }}/>)}
    </div>
  </div>;
}

function Blending({ layer, state, run, draft }: { layer: PhotoLayer; state: PhotoState; run: (command: string, params?: Record<string, unknown>) => Promise<void>; draft: Draft }) {
  const [channel, setChannel] = useState(0), group = !!layer.children;
  const range = layer.blendIf?.find(entry => entry.channel === channel) ?? { channel, thisLayer: [0, 0, 255, 255], underlying: [0, 0, 255, 255] };
  const four = (values: number[]) => values.length === 2 ? [values[0]!, values[0]!, values[1]!, values[1]!] : values;
  const blendingDraft = (key: string) => (value: number | null) => value === null ? draft(null) : draft("layer.layerStyle.blendingOptions", { [key]: value });
  const opacity = useDraft(Math.round(layer.opacity * 100), value => run("layer.layerStyle.blendingOptions", { opacity: value }), 0, 100, blendingDraft("opacity"));
  const fill = useDraft(Math.round(layer.fill * 100), value => run("layer.layerStyle.blendingOptions", { fillOpacity: value }), 0, 100, blendingDraft("fillOpacity"));
  const number = (label: string, draft: ReturnType<typeof useDraft>) => <div className="xd-ls-row">
    <span className="xd-ls-label">{label}:</span>
    <input type="range" aria-label={`${label} slider`} min={0} max={100} value={draft.value} onChange={event => draft.change(event.target.valueAsNumber)} onPointerUp={draft.flush} onKeyUp={draft.flush} onBlur={draft.flush}/>
    <input type="number" aria-label={label} min={0} max={100} value={Number.isNaN(draft.value) ? "" : draft.value} onChange={event => draft.change(event.target.valueAsNumber)} onBlur={draft.flush} onKeyDown={event => { if (event.key === "Enter") draft.flush(); }}/>
    <span className="xd-ls-unit">%</span>
  </div>;
  const commitRange = (field: "thisLayer" | "underlying") => (next: number[]) => void run("layer.layerStyle.blendingOptions", { blendIf: { channel, [field]: next } });
  const previewRange = (field: "thisLayer" | "underlying") => (next: number[] | null) => next ? draft("layer.layerStyle.blendingOptions", { blendIf: { channel, [field]: next } }) : draft(null);
  const channels = [{ name: "Gray", value: 0 }, ...(state.channels?.colors ?? []).map((color, index) => ({ name: color.name, value: index + 1 }))];
  return <>
    <Group title="General Blending">
      <div className="xd-ls-row is-wide"><span className="xd-ls-label">Blend Mode:</span><select aria-label="Blend Mode" value={BLENDS.find(blend => norm(blend) === norm(layer.blend)) ?? (group ? "PassThrough" : "Normal")} onChange={event => void run("layer.layerStyle.blendingOptions", { blend: event.target.value })}>{group && <option value="PassThrough">Pass Through</option>}{blendOptions(BLENDS, blendLabel)}</select></div>
      {number("Opacity", opacity)}
    </Group>
    <Group title="Advanced Blending">{number("Fill Opacity", fill)}</Group>
    <Group title="Blend If">
      <div className="xd-ls-row is-wide"><span className="xd-ls-label">Blend If:</span><select aria-label="Blend If channel" value={channel} onChange={event => setChannel(Number(event.target.value))}>{channels.map(entry => <option key={entry.value} value={entry.value}>{entry.name}</option>)}</select></div>
      <BlendIfSlider label="This Layer" values={four(range.thisLayer)} commit={commitRange("thisLayer")} live={previewRange("thisLayer")}/>
      <BlendIfSlider label="Underlying Layer" values={four(range.underlying)} commit={commitRange("underlying")} live={previewRange("underlying")}/>
      <p className="xd-ls-hint">Alt-drag a slider half to split it.</p>
    </Group>
  </>;
}

function StylesPane({ state, apply }: { state: PhotoState; apply: (preset: string, group: string, add: boolean) => void }) {
  const groups = state.presets?.styles ?? [];
  if (!groups.length) return <p className="xd-ls-hint">No styles are loaded.</p>;
  return <>{groups.map(group => <Group key={group.name} title={group.name}><div className="xd-ls-styles">{group.presets.map(preset => <button type="button" key={preset.name} className="xd-ls-style" title={`${preset.name}${preset.effects.length ? ` · ${preset.effects.join(", ")}` : ""}`} aria-label={`Use style ${preset.name}`} onClick={event => apply(preset.name, group.name, event.shiftKey)}><PresetPreview kind="style" preset={preset.name} group={group.name} revision={state.presets?.revision}/></button>)}</div></Group>)}</>;
}

function NewStyle({ close, create }: { close: () => void; create: (name: string, effects: boolean, blending: boolean) => void }) {
  const form = useDesignDialog<HTMLFormElement>(close), [name, setName] = useState("Style 1"), [effects, setEffects] = useState(true), [blending, setBlending] = useState(true);
  return <PhotoDialog dialog={form} title="New Style" className="xd-ls-new" close={close} okDisabled={!name.trim() || !(effects || blending)} onSubmit={event => { event.preventDefault(); create(name.trim(), effects, blending); }}>
    <div className="xd-ls-row is-wide"><span className="xd-ls-label">Name:</span><input type="text" aria-label="Style name" autoFocus maxLength={255} value={name} onChange={event => setName(event.target.value)}/></div>
    <Tick label="Include Layer Effects" checked={effects} onValue={setEffects}/>
    <Tick label="Include Layer Blending Options" checked={blending} onValue={setBlending}/>
  </PhotoDialog>;
}

const TEXTURE = (id: string, name: string) => ({ name, id, scale: 1, depth: 1, invert: false, link: true, phase: [0, 0] });

const settle = (work: Promise<unknown>) => work.then(() => {}, () => {});

/** Photoshop's Layer Style dialog. Edits run as real engine commands so the canvas previews them; Cancel returns to the history state it opened at and OK folds them into one Layer Style step. */
export function LayerStyleDialog({ layerId, initial = "blending", onClose, document, canvas = null, untilShown = settle }: { layerId: number; initial?: LayerStylePane; onClose: () => void; document?: PhotoDocument; canvas?: HTMLElement | null; untilShown?: (work: Promise<unknown>) => Promise<void> }) {
  const state = usePhotoWorkspace(s => s.state), layer = state ? find(state.layers, layerId) : undefined;
  const [sel, setSel] = useState<Sel>({ pane: initial, nth: 0 }), [preview, setPreview] = useState(true), [menu, setMenu] = useState(false), [naming, setNaming] = useState(false), [error, setError] = useState("");
  const [picking, setPicking] = useState<{ path: string[]; title: string } | null>(null), [gradientAt, setGradientAt] = useState<string[] | null>(null), [live, setLive] = useState<CanvasDraft | null>(null);
  const opened = useRef({ base: historyId(state), reset: historyId(state), top: null as string | null, started: false });
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const items = layer?.effects?.items ?? [];
  const current = () => { const next = usePhotoWorkspace.getState().state; return next ? find(next.layers, layerId) : undefined; };
  // A slider's drag shows on the canvas as a preview and commits once on release; the last frame stays until that commit is shown.
  const draft: Draft = (command, params = {}) => setLive(command ? { command, params: { layer: layerId, ...params } } : null);
  const run = (command: string, params: Record<string, unknown> = {}) => {
    const work = runPhotoCommand(command, { layer: layerId, ...params }).then(() => setError(""), failure => { setError(message(failure)); });
    pending.current = work;
    setLive(current => current && { ...current, committing: true });
    void untilShown(work).then(() => setLive(current => current?.committing ? null : current));
    return work;
  };
  const instances = (type: string) => items.map((effect, index) => ({ effect, index })).filter(entry => entry.effect.type === type);
  const enabledPath = (type: string) => type === "BevelEmboss" ? ["enabled"] : ["common", "enabled"];
  const edit = (index: number, path: string[], value: unknown) => run("layer.layerStyle.editEffect", { index, path, value });
  const switched = (settings: Settings, type: string, enabled: boolean) => {
    const next = structuredClone(settings), path = enabledPath(type);
    let holder: Settings = next; for (const key of path.slice(0, -1)) holder = holder[key] as Settings;
    holder[path.at(-1)!] = enabled;
    return next;
  };
  // Photoshop's factory settings put a new Gradient Overlay at the Smooth Method.
  const smooth = (settings: Settings) => ({ ...settings, gradient: bake(settings.gradient as Gradient, "smooth") });

  /** A new effect starts from the default Make Default saved for its kind, else Photoshop's factory settings. */
  const addEffect = async (def: (typeof FX)[number]) => {
    const before = current()?.effects?.items.length ?? 0;
    await run(`layer.layerStyle.${def.key}`, { add: true });
    const made = current()?.effects?.items[before];
    if (made?.type !== def.type) return;
    const saved = readDefaults()[def.type];
    if (saved) await edit(before, [], switched(saved, def.type, made.enabled));
    else if (def.type === "GradientOverlay") await edit(before, ["gradient"], smooth(made.settings as Settings).gradient);
  };
  const add = (key: LayerStyleEffect, more = false) => {
    const def = FX.find(entry => entry.key === key)!, count = instances(def.type).length;
    setMenu(false);
    if (count && !more) { setSel({ pane: key, nth: 0 }); return Promise.resolve(); }
    setSel({ pane: key, nth: count });
    return addEffect(def);
  };
  useEffect(() => {
    if (opened.current.started || !layer) return; opened.current.started = true;
    const def = FX.find(entry => entry.key === initial);
    if (def && !instances(def.type).length) void addEffect(def).then(() => { opened.current.reset = historyId(usePhotoWorkspace.getState().state); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!layer) onClose(); }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (pane: LayerStylePane, nth = 0) => { setMenu(false); setSel({ pane, nth }); };
  const toggle = (key: LayerStyleEffect, nth: number) => {
    const def = FX.find(entry => entry.key === key)!, found = instances(def.type)[nth];
    if (!found) return void add(key);
    select(key, nth); void edit(found.index, enabledPath(def.type), !found.effect.enabled);
  };
  const patterns = (state?.presets?.patterns ?? []).flatMap(group => group.presets.map(pattern => ({ id: pattern.id, name: pattern.name })));
  /** Textures resolve patterns from the document, and only Pattern Overlay copies one in: add and drop a throwaway overlay. */
  const withPatternInDocument = async (id: string) => {
    const before = current()?.effects?.items.length ?? 0;
    await run("layer.layerStyle.patternOverlay", { pattern: id, add: true });
    if ((current()?.effects?.items.length ?? 0) > before) await run("layer.layerStyle.removeEffect", { index: before });
  };
  const toggleSub = async (sub: "contour" | "texture") => {
    const bevel = instances("BevelEmboss")[0];
    select(sub);
    if (!bevel) { await add("bevelEmboss"); await run("layer.layerStyle.bevelEmboss", { contour: sub === "contour", texture: sub === "texture" ? patterns[0]?.id : undefined }); return; }
    const value = (bevel.effect.settings as Settings)[sub];
    if (value) return void edit(bevel.index, [sub], null);
    if (sub === "contour") return void edit(bevel.index, ["contour"], { contour: "Linear", range: 0.5, anti_alias: false });
    if (!patterns[0]) return void setError("There are no patterns to use as a texture.");
    await withPatternInDocument(patterns[0].id); await edit(bevel.index, ["texture"], TEXTURE(patterns[0].id, patterns[0].name));
  };
  const pickTexture = async (index: number, id: string, name: string) => { await withPatternInDocument(id); await edit(index, ["texture", "id"], id); await edit(index, ["texture", "name"], name); };
  const chooseOverlayPattern = (index: number, id: string) => { const s = items[index]?.settings as Settings & { common: { blend: string; opacity: number; enabled: boolean } }; return run("layer.layerStyle.patternOverlay", { pattern: id, enabled: s.common.enabled, blend: s.common.blend, opacity: s.common.opacity * 100, scale: Number(s.scale) * 100, angle: s.angle, link: s.link, phaseX: (s.phase as number[])[0], phaseY: (s.phase as number[])[1] }); };

  const selected = (() => {
    if (sel.pane === "styles" || sel.pane === "blending") return null;
    const type = sel.pane === "contour" || sel.pane === "texture" ? "BevelEmboss" : FX.find(entry => entry.key === sel.pane)!.type;
    return instances(type)[sel.pane === "contour" || sel.pane === "texture" ? 0 : sel.nth] ?? null;
  })();
  const sameType = selected ? instances(selected.effect.type) : [];
  const position = selected ? sameType.findIndex(entry => entry.index === selected.index) : -1;
  const reorder = (step: -1 | 1) => { const neighbour = sameType[position + step]; if (selected && neighbour) { void run("layer.layerStyle.moveEffect", { index: selected.index, to: neighbour.index }); setSel(current => ({ ...current, nth: position + step })); } };
  const remove = () => { if (!selected) return; void run("layer.layerStyle.removeEffect", { index: selected.index }); setSel(sel.pane === "contour" || sel.pane === "texture" ? { pane: "bevelEmboss", nth: 0 } : { ...sel, nth: Math.max(0, sel.nth - 1) }); };

  const makeDefault = () => { if (selected && !writeDefault(selected.effect.type, selected.effect.settings as Settings)) setError("This browser would not keep the default."); };
  const resetToDefault = async () => {
    if (!selected) return;
    const { index, effect } = selected, def = FX.find(entry => entry.type === effect.type)!;
    let saved = readDefaults()[effect.type] ?? factory.get(effect.type);
    if (!saved) {
      const before = current()?.effects?.items.length ?? 0;
      await run(`layer.layerStyle.${def.key}`, { add: true });
      const made = current()?.effects?.items[before];
      if (made) { saved = effect.type === "GradientOverlay" ? smooth(made.settings as Settings) : made.settings as Settings; factory.set(effect.type, saved); await run("layer.layerStyle.removeEffect", { index: before }); }
    }
    if (saved) await edit(index, [], switched(saved, effect.type, effect.enabled));
  };

  // Photoshop moves the selected effect when the image is dragged: distance and angle for shadows and satin, the origin for a pattern, the centre for a gradient.
  const moveRef = useRef<{ selected: typeof selected; light: PhotoState["globalLight"]; edit: typeof edit; run: typeof run; draft: Draft; bounds: PhotoLayer["bounds"] }>(null as never);
  moveRef.current = { selected, light: state?.globalLight, edit, run, draft, bounds: layer?.bounds };
  const moving = selected?.effect.type ?? "";
  useEffect(() => {
    const host = canvas?.closest(".xd-ps-canvas") ?? canvas;
    if (!canvas || !host || !document || !preview || !MOVABLE.includes(moving)) return;
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      // The dialog's scrim lies over the stage, so a press on it counts when the visible document is under it.
      const onImage = target instanceof Element && (host.contains(target) || target.matches(".xd-ps-dialog-scrim") && !!documentUnder(canvas, event.clientX, event.clientY));
      if (event.button !== 0 || !onImage || target.closest("[role=dialog]")) return;
      const { selected: effect, light, edit: commit, run: runCommand, draft: show, bounds } = moveRef.current;
      if (!effect) return;
      event.preventDefault(); event.stopPropagation();
      const width = canvas.getBoundingClientRect().width, scale = width ? document.width / width : 1;
      const s = effect.effect.settings as Settings, type = effect.effect.type, linked = (type === "DropShadow" || type === "InnerShadow") && s.use_global_light === true && !!light;
      const angle0 = (linked ? light!.angle : Number(s.angle)) * Math.PI / 180, distance0 = Number(s.distance) || 0, phase0 = (s.phase as number[] | undefined) ?? [0, 0];
      let result: { value: Settings; angle: number } | null = null;
      const move = (next: globalThis.PointerEvent) => {
        const dx = (next.clientX - event.clientX) * scale, dy = (next.clientY - event.clientY) * scale;
        if (type === "PatternOverlay") result = { value: { ...s, phase: [Math.round(phase0[0]! + dx), Math.round(phase0[1]! + dy)] }, angle: 0 };
        else if (type === "GradientOverlay") {
          // The engine keeps the centre as a fraction of the layer's bounds.
          const gradient = s.gradient as Settings, [, , width, height] = bounds ?? [0, 0, document.width, document.height], offset0 = (gradient.offset as number[] | undefined) ?? [0, 0];
          result = { value: { ...s, gradient: { ...gradient, offset: [offset0[0]! + dx / Math.max(1, width), offset0[1]! + dy / Math.max(1, height)].map(value => Math.round(value * 1e4) / 1e4) } }, angle: 0 };
        }
        else {
          const x = -Math.cos(angle0) * distance0 + dx, y = Math.sin(angle0) * distance0 + dy, distance = Math.min(250, Math.round(Math.hypot(x, y)));
          const angle = distance ? Math.round(Math.atan2(y, -x) * 180 / Math.PI) : Math.round(angle0 * 180 / Math.PI);
          result = { value: { ...s, angle, distance }, angle };
        }
        show("layer.layerStyle.editEffect", { index: effect.index, path: [], value: result.value });
      };
      const end = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
        const done = result;
        if (!done) return show(null);
        void (async () => { if (linked) await runCommand("layer.layerStyle.globalLight", { ...light, angle: done.angle }); await commit(effect.index, [], done.value); })();
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [canvas, document, preview, moving]);

  // Host commands refuse to overlap, so these wait for an edit still committing (a field's blur when OK is clicked).
  const revert = (to: string | null, discardRedo = false) => pending.current.then(() => {
    const now = historyId(usePhotoWorkspace.getState().state);
    if (to !== null && now !== to) return runPhotoCommand("history.select", discardRedo ? { id: to, discardRedo } : { id: to });
  }).catch(() => {});
  const cancel = () => { void revert(opened.current.base, true); onClose(); };
  const form = useDesignDialog<HTMLFormElement>(cancel);
  const ok = () => {
    const { base, top } = opened.current;
    void (preview ? pending.current : revert(top)).then(() => {
      const now = historyId(usePhotoWorkspace.getState().state);
      if (base !== null && now !== null && now !== base) return runPhotoCommand("history.fold", { fromId: base, label: "Layer Style" });
    }).catch(() => {});
    onClose();
  };
  const reset = () => { void revert(opened.current.reset); setError(""); setPreview(true); };
  const togglePreview = (on: boolean) => {
    setPreview(on);
    if (!on) { opened.current.top = historyId(usePhotoWorkspace.getState().state); void revert(opened.current.base); }
    else void revert(opened.current.top);
  };
  const create = (name: string, includeEffects: boolean, includeBlending: boolean) => { setNaming(false); void run("style.presets.new", { name, includeEffects, includeBlending }); };

  if (!state || !layer) return null;
  const light = state.globalLight;
  const bevel = instances("BevelEmboss")[0], bevelSettings = bevel?.effect.settings as Settings | undefined;
  const title = sel.pane === "styles" ? "Styles" : sel.pane === "blending" ? "Blending Options" : sel.pane === "contour" ? "Contour" : sel.pane === "texture" ? "Texture" : FX.find(entry => entry.key === sel.pane)!.label;
  const fxFor = (effect: { index: number; effect: (typeof items)[number] }): Fx => ({
    s: effect.effect.settings, colors: effect.effect.colors, global: light, patterns,
    set: (path, value) => edit(effect.index, path, value),
    setGlobal: patch => run("layer.layerStyle.globalLight", { ...light, ...patch }),
    pick: (path, picker) => setPicking({ path, title: picker }),
    editGradient: setGradientAt,
    preview: (path, value) => draft("layer.layerStyle.editEffect", { index: effect.index, path, value }),
    previewGlobal: patch => draft("layer.layerStyle.globalLight", { ...light, ...patch }),
    endPreview: () => draft(null),
  });
  const stored = selected && gradientAt ? at(selected.effect.settings, gradientAt) as Gradient | undefined : undefined, editing = stored && unbake(stored);
  const body = (() => {
    if (sel.pane === "styles") return <StylesPane state={state} apply={(preset, group, addToStyle) => void run("style.presets.apply", { preset, group, add: addToStyle })}/>;
    if (sel.pane === "blending") return <Blending layer={layer} state={state} run={run} draft={draft}/>;
    if (!selected) return <p className="xd-ls-hint">{sel.pane === "contour" || sel.pane === "texture" ? "Turn on Bevel & Emboss to edit its " + title.toLowerCase() + "." : `${title} is off. Tick its box to add it.`}</p>;
    const fx = fxFor(selected);
    const settings = selected.effect.settings as Settings;
    const pane = sel.pane === "contour" ? (settings.contour ? <BevelContour/> : <p className="xd-ls-hint">Tick Contour to shape the bevel.</p>)
      : sel.pane === "texture" ? (settings.texture ? <BevelTexture pattern={(id, name) => pickTexture(selected.index, id, name)}/> : <p className="xd-ls-hint">Tick Texture to add a pattern to the bevel.</p>)
      : ({ DropShadow: <Shadow inner={false}/>, InnerShadow: <Shadow inner/>, OuterGlow: <Glow inner={false}/>, InnerGlow: <Glow inner/>, Stroke: <Stroke/>, Satin: <Satin/>,
        ColorOverlay: <Group title="Color"><Blend color={["color"]} colorTitle="Select overlay color"/>{COMMON_OPACITY}</Group>,
        GradientOverlay: <Group title="Gradient"><Blend/><Tick label="Dither" path={["dither"]}/>{COMMON_OPACITY}<GradientEditor path={["gradient"]} movable withMethod/></Group>,
        PatternOverlay: <PatternOverlay choose={id => chooseOverlayPattern(selected.index, id)}/>, BevelEmboss: <Bevel/> } as Record<string, ReactNode>)[selected.effect.type];
    const effectPane = FX.some(entry => entry.key === sel.pane);
    return <><Ctx.Provider value={fx}>{pane}</Ctx.Provider>
      {effectPane && <div className="xd-ls-defaults"><button type="button" onClick={makeDefault}>Make Default</button><button type="button" onClick={() => void resetToDefault()}>Reset to Default</button></div>}</>;
  })();
  const effectRow = (key: LayerStyleEffect, label: string, multi: boolean, entry: ReturnType<typeof instances>[number] | undefined, nth: number, count: number) => {
    const name = count > 1 ? `${label} ${nth + 1}` : label, on = entry?.effect.enabled === true, active = sel.pane === key && sel.nth === nth;
    return <div key={`${key}/${nth}`} className={`xd-ls-item${active ? " is-selected" : ""}`}>
      <input type="checkbox" aria-label={name} checked={on} onChange={() => toggle(key, nth)}/>
      <button type="button" className="xd-ls-name" onClick={() => entry ? select(key, nth) : void add(key)}>{label}</button>
      {multi && <button type="button" className="xd-ls-plus" aria-label={`Add another ${label}`} title="Add another" onClick={() => void add(key, true)}>+</button>}
    </div>;
  };
  const subRow = (sub: "contour" | "texture", label: string) => <div className={`xd-ls-item is-sub${sel.pane === sub ? " is-selected" : ""}`}>
    <input type="checkbox" aria-label={label} checked={!!bevelSettings?.[sub]} onChange={() => void toggleSub(sub)}/>
    <button type="button" className="xd-ls-name" onClick={() => select(sub)}>{label}</button>
  </div>;
  return <>
    <PhotoDialog dialog={form} title="Layer Style" className="xd-ls-dialog" beside close={cancel} reset={reset} onSubmit={event => { event.preventDefault(); ok(); }}
      preview={{ checked: preview, change: togglePreview }} buttons={<><button type="button" disabled={!preview} onClick={() => setNaming(true)}>New Style…</button><span className="xd-ls-sample" role="img" aria-label="Style preview"><i style={preview ? sampleStyle(items) : undefined}/></span></>}>
      <div className="xd-ls-body">
        <nav className="xd-ls-list" aria-label="Layer style sections">
          <button type="button" className={`xd-ls-item xd-ls-name${sel.pane === "styles" ? " is-selected" : ""}`} onClick={() => select("styles")}>Styles</button>
          <button type="button" className={`xd-ls-item xd-ls-name${sel.pane === "blending" ? " is-selected" : ""}`} onClick={() => select("blending")}>Blending Options</button>
          {FX.map(def => { const found = instances(def.type), rows = found.length ? found : [undefined]; return <div key={def.key} className="xd-ls-kind">
            {rows.map((entry, nth) => effectRow(def.key, def.label, def.multi, entry, nth, rows.length))}
            {def.key === "bevelEmboss" && <>{subRow("contour", "Contour")}{subRow("texture", "Texture")}</>}
          </div>; })}
          <div className="xd-ls-tools">
            <span className="xd-ls-menu"><button type="button" className="xd-ls-fx" aria-label="Add an effect" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}>fx</button>
              {menu && <div className="xd-ls-popup" role="menu">{FX.map(def => <button type="button" role="menuitem" key={def.key} onClick={() => void add(def.key, def.multi && instances(def.type).length > 0)}>{def.label}…</button>)}</div>}</span>
            <button type="button" aria-label="Move effect up" disabled={position < 1} onClick={() => reorder(-1)}><ChevronUp size={13}/></button>
            <button type="button" aria-label="Move effect down" disabled={position < 0 || position >= sameType.length - 1} onClick={() => reorder(1)}><ChevronDown size={13}/></button>
            <button type="button" aria-label="Delete effect" disabled={!selected} onClick={remove}><Trash2 size={13}/></button>
          </div>
        </nav>
        <fieldset className="xd-ls-pane" disabled={!preview} aria-label={title}><h4>{title}</h4>{body}{error && <p role="alert" className="xd-ls-error">{error}</p>}</fieldset>
      </div>
    </PhotoDialog>
    {document && <CanvasDraftPreview document={document} draft={preview ? live : null} canvas={canvas}/>}
    {naming && <NewStyle close={() => setNaming(false)} create={create}/>}
    {selected && gradientAt && editing && <GradientEditorDialog<unknown> gradient={{ stops: editing.gradient.stops, opacity: editing.gradient.opacity_stops ?? [] }} hex={hexOf} color={(hex, from) => rgbColor(hex, (from as { alpha?: number } | undefined)?.alpha ?? 1)}
      preview={next => fxFor(selected).preview(gradientAt, bake({ ...editing.gradient, stops: next.stops, opacity_stops: next.opacity }, editing.method))}
      choose={next => { void edit(selected.index, gradientAt, bake({ ...editing.gradient, stops: next.stops, opacity_stops: next.opacity }, editing.method)); setGradientAt(null); }}
      close={() => { draft(null); setGradientAt(null); }}/>}
    {picking && selected && <ColorPickerDialog title={picking.title} color={fxFor(selected).colors[`/${picking.path.join("/")}`] ?? hexOf(at(selected.effect.settings, picking.path))} close={() => { draft(null); setPicking(null); }} preview={hex => fxFor(selected).preview(picking.path, rgbColor(hex, (at(selected.effect.settings, picking.path) as { alpha?: number } | undefined)?.alpha ?? 1))} choose={hex => { const base = at(selected.effect.settings, picking.path) as { alpha?: number } | undefined; void edit(selected.index, picking.path, rgbColor(hex, base?.alpha ?? 1)); setPicking(null); }}/>}
  </>;
}
