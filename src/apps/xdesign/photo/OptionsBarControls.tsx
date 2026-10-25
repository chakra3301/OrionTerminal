import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { positionPopup } from "../EditorMenus";
import { PresetPreview } from "./PresetPreview";
import "./optionsBar.css";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type Point = { x: number; y: number };
function usePopover<T extends HTMLElement>(open: boolean, close: (refocus: boolean) => void, point?: Point | null) {
  const root = useRef<T>(null), anchor = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => { if (open) positionPopup(pop.current!, point ? { kind: "point", ...point } : { kind: "below", el: anchor.current!, align: "start" }); }, [open, point]);
  useEffect(() => {
    if (!open) return;
    const down = (event: globalThis.PointerEvent | MouseEvent) => { if (!root.current?.contains(event.target as Node)) closeRef.current(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const rootProps = {
    ref: root,
    onKeyDown: (event: KeyboardEvent) => { if (open && event.key === "Escape") { event.stopPropagation(); closeRef.current(true); } },
    onBlur: (event: FocusEvent) => { if (open && event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) closeRef.current(false); },
  };
  return { anchor, pop, rootProps };
}

/** Enter commits through blur when focused so the blur handler is the single commit path. */
const commitKeys = (commit: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== "Enter" && event.key !== "Escape") return;
  const input = event.currentTarget;
  if (document.activeElement === input) input.blur();
  else if (event.key === "Enter") commit();
};

const Icon = ({ children }: { children: ReactNode }) => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" fill="none" stroke="currentColor" strokeWidth="1">{children}</svg>;

const SELECTION_MODES: Record<string, { label: string; icon: ReactNode }> = {
  replace: { label: "New selection", icon: <Icon><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" fillOpacity=".35" /></Icon> },
  add: { label: "Add to selection", icon: <Icon><path d="M1.5 1.5H10.5V5.5H14.5V14.5H5.5V10.5H1.5Z" fill="currentColor" fillOpacity=".35" /></Icon> },
  subtract: { label: "Subtract from selection", icon: <Icon><rect x="5.5" y="5.5" width="9" height="9" strokeOpacity=".5" /><path d="M1.5 1.5H10.5V5.5H5.5V10.5H1.5Z" fill="currentColor" fillOpacity=".35" /></Icon> },
  intersect: { label: "Intersect with selection", icon: <Icon><rect x="1.5" y="1.5" width="9" height="9" strokeOpacity=".5" /><rect x="5.5" y="5.5" width="9" height="9" strokeOpacity=".5" /><rect x="5.5" y="5.5" width="5" height="5" fill="currentColor" fillOpacity=".6" /></Icon> },
};

export function SelectionModeCluster({ value, modes, disabled, change }: { value: string; modes: readonly string[]; disabled?: boolean; change: (mode: string) => void }) {
  return <div role="group" aria-label="Selection mode" className="xd-ps-icon-cluster">
    {modes.map(mode => { const entry = SELECTION_MODES[mode]; return entry && <button key={mode} type="button" aria-label={entry.label} title={entry.label} aria-pressed={value === mode} disabled={disabled} onClick={() => change(mode)}>{entry.icon}</button>; })}
  </div>;
}

const GRADIENT_TYPES = [["linear", "Linear Gradient"], ["radial", "Radial Gradient"], ["angle", "Angle Gradient"], ["reflected", "Reflected Gradient"], ["diamond", "Diamond Gradient"]] as const;
const stops = (inner = 1) => <><stop offset="0" stopColor="currentColor" stopOpacity={inner} /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></>;

function GradientIcon({ kind }: { kind: string }) {
  const id = useId(), fill = `url(#${id}g)`, clip = `url(#${id}c)`;
  const frame = <rect x="1.5" y="1.5" width="13" height="13" strokeOpacity=".5" />;
  const clipDef = <clipPath id={`${id}c`}><rect x="2" y="2" width="12" height="12" /></clipPath>;
  const body = kind === "linear" ? <><defs><linearGradient id={`${id}g`} x1="0" x2="1" y1="0" y2="0">{stops()}</linearGradient></defs><rect x="2" y="2" width="12" height="12" fill={fill} stroke="none" /></>
    : kind === "radial" ? <><defs><radialGradient id={`${id}g`} cx=".5" cy=".5" r=".5">{stops()}</radialGradient></defs><rect x="2" y="2" width="12" height="12" fill={fill} stroke="none" /></>
    : kind === "reflected" ? <><defs><linearGradient id={`${id}g`} x1=".5" x2="1" y1="0" y2="0" spreadMethod="reflect">{stops()}</linearGradient></defs><rect x="2" y="2" width="12" height="12" fill={fill} stroke="none" /></>
    : kind === "angle" ? <><defs>{clipDef}</defs><g clipPath={clip} stroke="none" fill="currentColor">{Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6 - Math.PI / 2, b = ((i + 1) * Math.PI) / 6 - Math.PI / 2, p = (t: number) => `${(8 + 12 * Math.cos(t)).toFixed(2)} ${(8 + 12 * Math.sin(t)).toFixed(2)}`;
        return <path key={i} d={`M8 8L${p(a)}L${p(b)}Z`} fillOpacity={((i + 1) / 12).toFixed(2)} />;
      })}</g></>
    : <><defs>{clipDef}</defs><g clipPath={clip} stroke="none" fill="currentColor">{Array.from({ length: 6 }, (_, k) => { const d = 10 - k * 1.7; return <path key={k} d={`M8 ${8 - d}L${8 + d} 8L8 ${8 + d}L${8 - d} 8Z`} fillOpacity=".25" />; })}</g></>;
  return <Icon>{frame}{body}</Icon>;
}

export function GradientTypeIcons({ value, disabled, change }: { value: string; disabled?: boolean; change: (type: string) => void }) {
  return <div role="group" aria-label="Gradient type" className="xd-ps-icon-cluster">
    {GRADIENT_TYPES.map(([kind, label]) => <button key={kind} type="button" aria-label={label} title={label} aria-pressed={value === kind} disabled={disabled} onClick={() => change(kind)}><GradientIcon kind={kind} /></button>)}
  </div>;
}

/** `input` replaces the number field for callers that validate their own drafts. */
type PopupSliderProps = { label: string; ariaLabel: string; value: number; min: number; max: number; unit?: string; disabled?: boolean; input?: ReactNode; change: (value: number) => void; commit: (value: number) => void };

export function PopupSlider({ label, ariaLabel, value, min, max, unit, disabled, input, change, commit }: PopupSliderProps) {
  const [open, setOpen] = useState(false), latest = useRef(value), committed = useRef(value), scrub = useRef<{ x: number; value: number; last: number } | null>(null);
  latest.current = value;
  const settle = (v: number) => { committed.current = v; commit(v); };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (latest.current !== committed.current) settle(latest.current);
    if (refocus) anchor.current?.focus();
  };
  const { anchor, pop, rootProps } = usePopover<HTMLSpanElement>(open, close);
  const bound = (v: number) => clamp(v, min, max);
  const down = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrub.current = { x: event.clientX, value: latest.current, last: latest.current };
  };
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current; if (!s) return;
    s.last = bound(s.value + Math.round((event.clientX - s.x) * (event.shiftKey ? 10 : 1)));
    change(s.last);
  };
  const up = () => { const s = scrub.current; scrub.current = null; if (s) settle(s.last); };
  return <span className="xd-ps-popup-slider" {...rootProps}>
    <span className="xd-ps-scrub" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>{label}</span>
    {input ?? <input type="number" className="xd-ps-number" aria-label={ariaLabel} min={min} max={max} value={value} disabled={disabled}
      onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) change(bound(event.target.valueAsNumber)); }}
      onBlur={event => { event.currentTarget.value = String(latest.current); settle(latest.current); }}
      onKeyDown={commitKeys(() => settle(latest.current))} />}
    {unit && <span className="xd-ps-unit">{unit}</span>}
    <button ref={anchor} type="button" className="xd-ps-chevron" aria-label={`Show ${label.replace(/:$/, "").toLowerCase()} slider`} aria-expanded={open} disabled={disabled}
      onClick={() => { if (open) close(false); else { committed.current = latest.current; setOpen(true); } }}><ChevronDown size={10} /></button>
    {open && <div ref={pop} className="xd-ps-popover">
      <input type="range" aria-label={`${ariaLabel} slider`} min={min} max={max} value={value}
        onChange={event => change(Number(event.target.value))}
        onPointerUp={event => settle(Number(event.currentTarget.value))} onKeyUp={event => settle(Number(event.currentTarget.value))} />
    </div>}
  </span>;
}

/** Photoshop's ⓘ button: a short titled note in a popover that OK closes. */
export function InfoNote({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLSpanElement>(open, close);
  return <span className="xd-ps-info" {...rootProps}>
    <button ref={anchor} type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => { if (open) close(false); else setOpen(true); }}><Info size={14} /></button>
    {open && <div ref={pop} className="xd-ps-popover xd-ps-note" role="dialog" aria-label={label}><h4>{label}</h4>{children}<button type="button" onClick={() => close(true)}>OK</button></div>}
  </span>;
}

type Patch = { size?: number; hardness?: number };
export type BrushPreset = { name: string; group: string; size: number; hardness: number };
type BrushPickerProps = {
  size: number; hardness: number; maxSize: number; showHardness?: boolean; presets: BrushPreset[]; revision?: number; disabled?: boolean;
  change: (patch: Patch) => void; commit: (patch: Patch) => void; selectPreset: (name: string) => void;
  /** Opens the picker at this point, as a paint tool's canvas right-click does; `dismiss` clears it. */
  at?: Point | null; dismiss?: () => void;
};

export function BrushPresetPicker({ size, hardness, maxSize, showHardness = true, presets, revision, disabled, change, commit, selectPreset, at, dismiss }: BrushPickerProps) {
  const [opened, setOpened] = useState(false), sizeInput = useRef<HTMLInputElement>(null), open = opened || !!at;
  const close = (refocus: boolean) => { setOpened(false); dismiss?.(); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLDivElement>(open, close, at);
  useLayoutEffect(() => { if (open) sizeInput.current?.focus(); }, [open, at]);
  const tip = Math.max(3, Math.min(size, 18)), percent = Math.round(hardness * 100);
  const sizeOf = (v: number) => clamp(Math.round(v) || 1, 1, maxSize), hardOf = (v: number) => clamp(Math.round(v) || 0, 0, 100) / 100;
  const sizePatch = (v: number): Patch => ({ size: sizeOf(v) }), hardPatch = (v: number): Patch => ({ hardness: hardOf(v) });
  return <div className="xd-ps-brush-picker" {...rootProps}>
    <button ref={anchor} type="button" className="xd-ps-brush-trigger" aria-label="Brush preset picker" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { if (open) close(false); else setOpened(true); }}>
      <span className="xd-ps-brush-tip" style={{ width: tip, height: tip, background: `radial-gradient(circle closest-side, currentColor ${hardness * 100}%, transparent 100%)` }} />
      <span className="xd-ps-brush-size">{Math.round(size)}</span>
      <ChevronDown size={9} />
    </button>
    {open && <div ref={pop} className="xd-ps-popover xd-ps-brush-popover" role="dialog" aria-label="Brush preset picker">
      <label className="xd-ps-row"><span>Size</span>
        <input type="range" aria-label="Brush size slider" min={1} max={maxSize} value={size} onChange={event => change(sizePatch(event.target.valueAsNumber))}
          onPointerUp={event => commit(sizePatch(event.currentTarget.valueAsNumber))} onKeyUp={event => commit(sizePatch(event.currentTarget.valueAsNumber))} />
        <input ref={sizeInput} type="number" className="xd-ps-number" aria-label="Brush size" min={1} max={maxSize} value={Math.round(size)}
          onChange={event => change(sizePatch(event.target.valueAsNumber))}
          onBlur={() => commit({ size: sizeOf(size) })} onKeyDown={commitKeys(() => commit({ size: sizeOf(size) }))} />
        <span className="xd-ps-unit">px</span>
      </label>
      {showHardness && <label className="xd-ps-row"><span>Hardness</span>
        <input type="range" aria-label="Brush hardness slider" min={0} max={100} value={percent} onChange={event => change(hardPatch(event.target.valueAsNumber))}
          onPointerUp={event => commit(hardPatch(event.currentTarget.valueAsNumber))} onKeyUp={event => commit(hardPatch(event.currentTarget.valueAsNumber))} />
        <input type="number" className="xd-ps-number" aria-label="Brush hardness" min={0} max={100} value={percent}
          onChange={event => change(hardPatch(event.target.valueAsNumber))}
          onBlur={() => commit({ hardness })} onKeyDown={commitKeys(() => commit({ hardness }))} />
        <span className="xd-ps-unit">%</span>
      </label>}
      {presets.length > 0 && <div className="xd-ps-brush-presets">
        {presets.map(preset => <button key={preset.name} type="button" aria-label={`Use brush ${preset.name}`} title={`${preset.group} · ${Math.round(preset.size)} px`} onClick={() => selectPreset(preset.name)}>
          <PresetPreview kind="brush" preset={preset.name} revision={revision} /><small>{Math.round(preset.size)}</small>
        </button>)}
      </div>}
    </div>}
  </div>;
}
