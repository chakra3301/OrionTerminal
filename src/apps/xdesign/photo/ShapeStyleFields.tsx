import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { GradientEditorDialog, GradientPick, gradientCss, onChecker, type EditedGradient } from "./GradientEditorDialog";
import { GradientTypeIcons, usePopover } from "./OptionsBarControls";
import { STROKE_ALIGNS, STROKE_CAPS, STROKE_JOINS, STROKE_PRESETS, setDash, strokePresetOf, type GradientStyle, type PaintKind, type ShapeGradient, type ShapePattern, type ShapeStyle, type StrokeAlign, type StrokeCap, type StrokeJoin } from "./shapeStyle";
import "./vectorBars.css";

/** A typed number that commits once, on Enter or blur; Escape puts the value back. `empty` takes a cleared field (dash/gap pairs). */
export function CommitNumber({ label, value, min, max, step, whole, unit, title, disabled, commit, empty }: { label: string; value: number | null; min: number; max: number; step?: number; whole?: boolean; unit?: string; title?: string; disabled?: boolean; commit: (value: number) => void; empty?: () => void }) {
  const [text, setText] = useState<string | null>(null), cancel = useRef(false);
  const settle = () => {
    const typed = text; setText(null);
    if (cancel.current) { cancel.current = false; return; }
    if (typed === null) return;
    if (!typed.trim()) { if (value !== null) empty?.(); return; }
    const number = Number(typed); if (!Number.isFinite(number)) return;
    const next = Math.max(min, Math.min(max, whole ? Math.round(number) : number));
    if (next !== value) commit(next);
  };
  const input = <input type="number" className="xd-ps-number" aria-label={label} title={title ?? label} min={min} max={max} step={step} disabled={disabled} value={text ?? value ?? ""}
    onChange={event => setText(event.target.value)} onBlur={settle} onKeyDown={event => { if (event.key !== "Enter" && event.key !== "Escape") return; cancel.current = event.key === "Escape"; event.currentTarget.blur(); }}/>;
  return unit ? <>{input}<span className="xd-ps-unit">{unit}</span></> : input;
}

/** A native colour picker fires input while dragging and change once it closes, so only change commits. */
function ColorField({ label, value, disabled, commit }: { label: string; value: string; disabled?: boolean; commit: (color: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null), input = useRef<HTMLInputElement>(null), latest = useRef(commit);
  latest.current = commit;
  useEffect(() => { const node = input.current!, done = () => { setDraft(null); latest.current(node.value); }; node.addEventListener("change", done); return () => node.removeEventListener("change", done); }, []);
  return <input ref={input} type="color" aria-label={label} title={label} disabled={disabled} value={draft ?? value} onChange={event => setDraft(event.target.value)}/>;
}

type Paint = { on: boolean; kind: PaintKind; color: string; gradient: ShapeGradient; pattern: ShapePattern };
type PatternPreset = { id: string; name: string };
const PAINT_KINDS = [["none", "No Color"], ["solid", "Solid Color"], ["gradient", "Gradient"], ["pattern", "Pattern"]] as const;
const OPAQUE: [number, number][] = [[0, 1], [1, 1]];

function PaintPicker({ name, paint, foreground, background, patterns, disabled, change }: { name: "Fill" | "Stroke"; paint: Paint; foreground: string; background: string; patterns: readonly PatternPreset[]; disabled?: boolean; change: (patch: Partial<Paint>) => void }) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState<Element | null>(null);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLSpanElement>(open, close);
  const lower = name.toLowerCase(), current = paint.on ? paint.kind : "none", g = paint.gradient;
  const hex = (color: string) => color === "foreground" ? foreground : color === "background" ? background : color;
  const css = gradientCss(g.stops, g.opacity, hex), swatch = !paint.on ? undefined : paint.kind === "gradient" ? onChecker(css) : paint.color;
  const gradient = (patch: Partial<ShapeGradient>) => change({ gradient: { ...g, ...patch } });
  const p = paint.pattern, known = patterns.some(preset => preset.id === p.id), pattern = (patch: Partial<ShapePattern>) => change({ pattern: { ...p, ...patch } });
  const choose = (kind: (typeof PAINT_KINDS)[number][0]) => change(kind === "none" ? { on: false } : kind === "pattern" && paint.kind !== "pattern" && !known ? { on: true, kind, pattern: { ...p, id: patterns[0]!.id, name: patterns[0]!.name } } : { on: true, kind });
  // Presets may name the foreground and background colours, and an opaque gradient comes back with no opacity stops.
  const edited = (next: EditedGradient<string>) => gradient({ stops: next.stops.map(([at, color]): [number, string] => [at, hex(color)]), opacity: next.opacity.length ? next.opacity : OPAQUE });
  return <span className="xd-ps-paint" {...rootProps}>
    <button ref={anchor} type="button" className="xd-ps-paint-trigger" aria-label={`Shape ${lower} type`} title={`Set shape ${lower} type`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => open ? close(false) : setOpen(true)}>
      <span className={`xd-ps-paint-swatch${paint.on ? "" : " is-none"}${name === "Stroke" ? " is-stroke" : ""}`} style={swatch ? { background: swatch, backgroundSize: "auto,10px 10px" } : undefined}/><ChevronDown size={9}/>
    </button>
    {open && <div ref={pop} className="xd-ps-popover xd-ps-paint-popover" role="dialog" aria-label={name}>
      <div role="group" aria-label={`${name} type`} className="xd-ps-icon-cluster xd-ps-segmented">{PAINT_KINDS.map(([kind, label]) => <button key={kind} type="button" aria-label={label} title={kind === "pattern" && !patterns.length ? "There are no pattern presets" : label} aria-pressed={current === kind} disabled={kind === "pattern" && !patterns.length} onClick={() => choose(kind)}>{label}</button>)}</div>
      {paint.on && paint.kind === "solid" && <label className="xd-ps-row"><span>Color</span><ColorField label={`${name} color`} value={paint.color} commit={color => change({ on: true, kind: "solid", color })}/></label>}
      {paint.on && paint.kind === "gradient" && <>
        <GradientPick css={css} edit={event => setEditing(event.currentTarget.closest(".xd-photo") ?? document.body)} choose={edited}/>
        <GradientTypeIcons value={g.style} change={style => gradient({ style: style as GradientStyle })}/>
        <label className="xd-ps-row"><span>Angle</span><CommitNumber label={`${name} gradient angle`} value={g.angle} min={-180} max={180} unit="°" commit={angle => gradient({ angle })}/></label>
        <label className="xd-ps-row"><span>Scale</span><CommitNumber label={`${name} gradient scale`} value={g.scale} min={10} max={150} unit="%" commit={scale => gradient({ scale })}/></label>
        <label className="xd-ps-row"><input type="checkbox" aria-label={`Reverse ${lower} gradient`} checked={g.reverse} onChange={event => gradient({ reverse: event.target.checked })}/>Reverse</label>
      </>}
      {paint.on && paint.kind === "pattern" && <>
        <label className="xd-ps-row"><span>Pattern</span><select aria-label={`${name} pattern`} value={p.id} onChange={event => { const preset = patterns.find(item => item.id === event.target.value); if (preset) pattern({ id: preset.id, name: preset.name }); }}>{!known && <option value={p.id}>{p.name || p.id}</option>}{patterns.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <label className="xd-ps-row"><span>Angle</span><CommitNumber label={`${name} pattern angle`} value={p.angle} min={-180} max={180} unit="°" commit={angle => pattern({ angle })}/></label>
        <label className="xd-ps-row"><span>Scale</span><CommitNumber label={`${name} pattern scale`} value={p.scale} min={1} max={1000} unit="%" commit={scale => pattern({ scale })}/></label>
      </>}
    </div>}
    {editing && createPortal(<GradientEditorDialog<string> gradient={{ stops: g.stops, opacity: g.opacity }} hex={hex} color={value => value} preview={() => {}} choose={next => { setEditing(null); edited(next); }} close={() => setEditing(null)}/>, editing)}
  </span>;
}

const LinePreview = ({ dashes, cap }: { dashes: readonly number[]; cap: StrokeCap }) => <svg width="44" height="8" viewBox="0 0 44 8" aria-hidden="true"><line x1="3" y1="4" x2="41" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap={cap} strokeDasharray={dashes.length ? dashes.map(value => value * 2).join(" ") : undefined}/></svg>;
const DASHED_DEFAULT = [4, 2];

function StrokeOptions({ style, disabled, change }: { style: ShapeStyle; disabled?: boolean; change: (patch: Partial<ShapeStyle>) => void }) {
  const [open, setOpen] = useState(false), [more, setMore] = useState(false);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLSpanElement>(open, close);
  const preset = strokePresetOf(style), dashed = style.dashes.length > 0;
  const dash = (index: number, value: number | null) => change({ dashes: setDash(style.dashes, index, value) });
  const field = (index: number, label: string) => <label>{label.toLowerCase()}<CommitNumber label={`${label} ${Math.floor(index / 2) + 1}`} value={style.dashes[index] ?? null} min={0} max={1000} disabled={!dashed} commit={value => dash(index, value)} empty={() => dash(index, null)}/></label>;
  return <span className="xd-ps-paint" {...rootProps}>
    <button ref={anchor} type="button" className="xd-ps-paint-trigger" aria-label="Stroke options" title="Set shape stroke type" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => open ? close(false) : setOpen(true)}><LinePreview dashes={style.dashes} cap={style.cap}/><ChevronDown size={9}/></button>
    {open && <div ref={pop} className="xd-ps-popover xd-ps-stroke-popover" role="dialog" aria-label="Stroke Options">
      <div role="group" aria-label="Stroke presets" className="xd-ps-stroke-presets">{STROKE_PRESETS.map(({ name, patch }) => <button key={name} type="button" aria-label={name} title={name} aria-pressed={preset === name} onClick={() => change(patch)}><LinePreview dashes={patch.dashes!} cap={patch.cap ?? style.cap}/></button>)}</div>
      <label className="xd-ps-row"><span>Align:</span><select aria-label="Stroke align" value={style.align} onChange={event => change({ align: event.target.value as StrokeAlign })}>{STROKE_ALIGNS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="xd-ps-row"><span>Caps:</span><select aria-label="Stroke caps" value={style.cap} onChange={event => change({ cap: event.target.value as StrokeCap })}>{STROKE_CAPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="xd-ps-row"><span>Corners:</span><select aria-label="Stroke corners" value={style.join} onChange={event => change({ join: event.target.value as StrokeJoin })}>{STROKE_JOINS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" aria-label="More Options" aria-expanded={more} onClick={() => setMore(value => !value)}>More Options…</button>
      {more && <div role="group" aria-label="Dashed line" className="xd-ps-dashes">
        <label className="xd-ps-dashes-toggle"><input type="checkbox" aria-label="Dashed Line" checked={dashed} onChange={event => change({ dashes: event.target.checked ? DASHED_DEFAULT : [] })}/>Dashed Line</label>
        {[0, 2, 4].map(index => <Fragment key={index}>{field(index, "Dash")}{field(index + 1, "Gap")}</Fragment>)}
      </div>}
    </div>}
  </span>;
}

/** The shape bar's Fill, Stroke, stroke width and Stroke Options. Each call to `change` is one committed edit. `patterns` are the presets from `pattern.list`. */
export function ShapeStyleFields({ style, foreground, background, patterns = [], disabled, change }: { style: ShapeStyle; foreground: string; background: string; patterns?: readonly PatternPreset[]; disabled?: boolean; change: (patch: Partial<ShapeStyle>) => void }) {
  const fill: Paint = { on: style.fill, kind: style.fillKind, color: style.fillColor ?? foreground, gradient: style.fillGradient, pattern: style.fillPattern };
  const stroke: Paint = { on: style.stroke, kind: style.strokeKind, color: style.strokeColor, gradient: style.strokeGradient, pattern: style.strokePattern };
  const fillPatch = (patch: Partial<Paint>) => change({ ...("on" in patch ? { fill: patch.on } : {}), ...(patch.kind ? { fillKind: patch.kind } : {}), ...(patch.color ? { fillColor: patch.color } : {}), ...(patch.gradient ? { fillGradient: patch.gradient } : {}), ...(patch.pattern ? { fillPattern: patch.pattern } : {}) });
  const strokePatch = (patch: Partial<Paint>) => change({ ...("on" in patch ? { stroke: patch.on } : {}), ...(patch.kind ? { strokeKind: patch.kind } : {}), ...(patch.color ? { strokeColor: patch.color } : {}), ...(patch.gradient ? { strokeGradient: patch.gradient } : {}), ...(patch.pattern ? { strokePattern: patch.pattern } : {}) });
  return <>
    <span className="xd-ps-label">Fill:</span><PaintPicker name="Fill" paint={fill} foreground={foreground} background={background} patterns={patterns} disabled={disabled} change={fillPatch}/>
    <span className="xd-ps-label">Stroke:</span><PaintPicker name="Stroke" paint={stroke} foreground={foreground} background={background} patterns={patterns} disabled={disabled} change={strokePatch}/>
    <CommitNumber label="Stroke width" title="Set shape stroke width" value={style.strokeWidth} min={0} max={1000} unit="px" disabled={disabled || !style.stroke} commit={strokeWidth => change({ strokeWidth })}/>
    <StrokeOptions style={style} disabled={disabled} change={change}/>
  </>;
}
