import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder, Settings, Trash2 } from "lucide-react";
import { PhotoDialog } from "./photoDialog";
import { useDesignDialog } from "../useDesignDialog";
import { ColorPickerDialog } from "./ColorPickerDialog";
import { importPreset } from "./PresetPanels";
import { paintColorHex } from "./imageColors";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { GradientPreset } from "./types";
import "./gradientEditor.css";

/** Colour stops in the caller's colour type, opacity stops as 0..1 fractions; no opacity stops means opaque, as in the engine. */
export type EditedGradient<C> = { stops: [number, C][]; opacity: [number, number][] };
type Draft<C> = { stops: [number, C][]; opacity: [number, number][] };
type Kind = "color" | "opacity";
type View = "text" | "small" | "large" | "smallList" | "largeList";
const VIEWS: [View, string][] = [["text", "Text Only"], ["small", "Small Thumbnail"], ["large", "Large Thumbnail"], ["smallList", "Small List"], ["largeList", "Large List"]];
// Photoshop keeps the presets view for the session.
let presetView: View = "small";

const OPAQUE: [number, number][] = [[0, 1], [1, 1]];
const PICK_WIDTH = 280;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 1000) / 1000;
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);
const toHex = (values: number[]) => `#${values.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mixRgb = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i]! - v) * k);
const mixNumber = (a: number, b: number, k: number) => a + (b - a) * k;
/** Linear between stops, as the engine samples them. */
function sample<V>(stops: [number, V][], t: number, mix: (a: V, b: V, k: number) => V): V {
  const after = stops.findIndex(([at]) => at >= t);
  if (after <= 0) return stops[after < 0 ? stops.length - 1 : 0]![1];
  const [p0, a] = stops[after - 1]!, [p1, b] = stops[after]!;
  return mix(a, b, p1 > p0 ? (t - p0) / (p1 - p0) : 0);
}

/** A CSS bar for colour and opacity stops together. */
export function gradientCss<C>(stops: [number, C][], opacity: [number, number][], hex: (color: C) => string) {
  if (!stops.length) return "transparent";
  const colors = stops.map(([t, c]): [number, number[]] => [t, rgb(hex(c))]), alphas = opacity.length ? opacity : OPAQUE;
  const points = [...colors.map(([t, c]): [number, number[], number] => [t, c, sample(alphas, t, mixNumber)]), ...alphas.map(([t, a]): [number, number[], number] => [t, sample(colors, t, mixRgb), a])].sort((a, b) => a[0] - b[0]);
  return `linear-gradient(90deg,${points.map(([t, c, a]) => `rgba(${c.map(Math.round).join(",")},${round(a)}) ${round(t * 100)}%`).join(",")})`;
}

/** A gradient CSS over the transparency checkerboard, as Photoshop draws gradient swatches. */
export const onChecker = (css: string) => `${css},repeating-conic-gradient(var(--xd-text-3) 0 25%,var(--xd-text-2) 0 50%)`;

/** A stop's number field: it can be emptied while typing, and each number typed previews at once. */
function StopField({ label, value, step, disabled, set }: { label: string; value: number | ""; step?: string; disabled: boolean; set: (value: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return <input type="number" aria-label={label} min={0} max={100} step={step} disabled={disabled} value={text ?? value} onChange={event => { setText(event.target.value); if (Number.isFinite(event.target.valueAsNumber)) set(event.target.valueAsNumber); }} onBlur={() => setText(null)}/>;
}

/** A preset's stops as hex colours (foreground and background resolved) and 0..1 opacity stops, empty when opaque. */
export function presetGradient(preset: GradientPreset, foreground: string, background: string): EditedGradient<string> {
  const opacity = preset.transparency.map(([t, a]): [number, number] => [t, a / 100]);
  return { stops: preset.stops.map(([t, c]): [number, string] => [t, c === "foreground" ? foreground : c === "background" ? background : c]), opacity: opacity.every(([, a]) => a >= 1) ? [] : opacity };
}

/** The gradient preset folders: closed until opened, as in Photoshop. */
export function GradientPresets({ view = "small", choose }: { view?: View; choose: (gradient: EditedGradient<string>, name: string, group: string) => void }) {
  const state = usePhotoWorkspace(s => s.state), groups = state?.presets?.gradients ?? [];
  const foreground = paintColorHex(state?.tools?.foreground, "#000000"), background = paintColorHex(state?.tools?.background, "#ffffff");
  const [open, setOpen] = useState<string[]>([]);
  return <div className={`xd-ge-presets is-${view}`}>{groups.map(group => {
    const shown = open.includes(group.name);
    return <div key={group.name} className="xd-ge-group">
      <button type="button" className="xd-ge-folder" aria-expanded={shown} onClick={() => setOpen(list => shown ? list.filter(name => name !== group.name) : [...list, group.name])}>{shown ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<Folder size={13}/><span>{group.name}</span></button>
      {shown && <div className="xd-ge-items">{group.presets.map(preset => {
        const gradient = presetGradient(preset, foreground, background);
        return <button type="button" key={preset.name} className="xd-ge-preset" aria-label={preset.name} title={preset.name} onClick={() => choose(gradient, preset.name, group.name)}>
          {view !== "text" && <i style={{ backgroundImage: onChecker(gradientCss(gradient.stops, gradient.opacity, (c: string) => c)) }}/>}
          {(view === "text" || view.endsWith("List")) && <span>{preset.name}</span>}
        </button>;
      })}</div>}
    </div>;
  })}</div>;
}

/** Photoshop's gradient swatch: a click edits the gradient, the arrow beside it opens the presets. Without `edit` (the live Gradient tool) the swatch opens the presets too. */
export function GradientPick({ css, disabled = false, edit, choose }: { css: string; disabled?: boolean; edit?: (event: MouseEvent<HTMLButtonElement>) => void; choose: (gradient: EditedGradient<string>, name: string, group: string) => void }) {
  const [open, setOpen] = useState<{ top: number; left: number; root: Element } | null>(null), menu = useRef<HTMLSpanElement>(null), list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (!menu.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  // Placed in the workspace under the swatch, since a dialog's scrolling would clip the list.
  const toggle = () => {
    const root = menu.current?.closest(".xd-photo"), box = menu.current?.getBoundingClientRect(), frame = root?.getBoundingClientRect();
    setOpen(shown => shown || !root || !box || !frame ? null : { top: box.bottom - frame.top, left: Math.max(0, Math.min(box.left - frame.left, frame.width - PICK_WIDTH)), root });
  };
  return <span className="xd-ge-pick" ref={menu}>
    <button type="button" className="xd-ge-pick-swatch" aria-label="Edit gradient" title="Click to edit the gradient" disabled={disabled} style={{ backgroundImage: onChecker(css), backgroundSize: "auto,10px 10px" }} onClick={event => { if (!edit) return toggle(); setOpen(null); edit(event); }}/>
    <button type="button" className="xd-ge-pick-more" aria-label="Gradient presets" aria-haspopup="true" aria-expanded={!!open} disabled={disabled} onClick={toggle}><ChevronDown size={12}/></button>
    {open && createPortal(<div ref={list} className="xd-ge-pick-presets" style={{ top: open.top, left: open.left }}><GradientPresets choose={(gradient, name, group) => { setOpen(null); choose(gradient, name, group); }}/></div>, open.root)}
  </span>;
}

/** Photoshop's Gradient Editor: presets, the bar with opacity stops above and colour stops below, and the selected stop's fields. Every edit previews; OK hands back the gradient once. Without `transparency` (Gradient Map) there are no opacity stops. */
export function GradientEditorDialog<C>({ gradient, name: named = "Custom", hex, color, preview, choose, close, transparency = true }: {
  gradient: EditedGradient<C>; name?: string; hex: (color: C) => string; color: (hex: string, from?: C) => C;
  preview: (gradient: EditedGradient<C>) => void; choose: (gradient: EditedGradient<C>, name: string) => void; close: () => void; transparency?: boolean;
}) {
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const opacityOf = (stops: [number, number][]) => transparency && stops.length ? stops : OPAQUE;
  const [draft, setDraft] = useState<Draft<C>>(() => ({ stops: gradient.stops, opacity: opacityOf(gradient.opacity) }));
  const [name, setName] = useState(named), [picked, setPicked] = useState<{ kind: Kind; index: number } | null>(null);
  const [picking, setPicking] = useState<{ before: Draft<C>; name: string } | null>(null), [menu, setMenu] = useState(false), [view, setView] = useState(presetView), [error, setError] = useState("");
  const [leaving, setLeaving] = useState<{ kind: Kind; index: number } | null>(null);
  const latest = useRef(draft); latest.current = draft;
  const drag = useRef<{ kind: Kind; index: number; pointer: number; offset: number; off: boolean } | null>(null);
  // Stops are keyed by position, so when a key moves one past its neighbour or deletes it, focus follows to its new place.
  const refocus = useRef<{ kind: Kind; index: number } | null>(null), bar = useRef<HTMLDivElement>(null);
  useEffect(() => { const to = refocus.current; refocus.current = null; if (to) bar.current?.querySelector<HTMLElement>(`.is-${to.kind} [data-stop="${to.index}"]`)?.focus(); });

  const out = (next: Draft<C>): EditedGradient<C> => ({ stops: next.stops, opacity: next.opacity.every(([, a]) => a >= 1) ? [] : next.opacity });
  const update = (next: Draft<C>, label = "Custom") => { latest.current = next; setDraft(next); setName(label); preview(out(next)); };
  const attempt = (work: Promise<unknown>) => void work.then(() => setError(""), failure => setError(failure instanceof Error ? failure.message : String(failure)));
  const list = (kind: Kind): [number, unknown][] => kind === "color" ? latest.current.stops : latest.current.opacity;
  const put = (kind: Kind, next: [number, unknown][]) => update(kind === "color" ? { ...latest.current, stops: next as [number, C][] } : { ...latest.current, opacity: next as [number, number][] });
  const place = (kind: Kind, index: number, t: number) => {
    const stops = list(kind), stop = stops[index];
    if (!stop || !Number.isFinite(t)) return index;
    const moved: [number, unknown] = [round(clamp(t)), stop[1]];
    if (moved[0] === stop[0]) return index;
    const next = stops.map((s, i) => i === index ? moved : s).sort((a, b) => a[0] - b[0]), at = next.indexOf(moved);
    put(kind, next); setPicked({ kind, index: at });
    return at;
  };
  const add = (kind: Kind, t: number) => {
    const stops = list(kind), at = round(t);
    const value = kind === "color" ? color(toHex(sample(latest.current.stops.map(([p, c]): [number, number[]] => [p, rgb(hex(c))]), at, mixRgb))) : round(sample(latest.current.opacity, at, mixNumber));
    const added: [number, unknown] = [at, value], next = [...stops, added].sort((a, b) => a[0] - b[0]), index = next.indexOf(added);
    put(kind, next); setPicked({ kind, index });
    return index;
  };
  const remove = (kind: Kind, index: number) => { const stops = list(kind); if (stops.length <= 2) return false; put(kind, stops.filter((_, i) => i !== index)); setPicked({ kind, index: Math.max(0, index - 1) }); return true; };
  const recolor = (index: number, value: string, from: C) => put("color", latest.current.stops.map((stop, i) => i === index ? [stop[0], color(value, from)] : stop));

  const strip = (kind: Kind) => {
    const where = (event: PointerEvent<HTMLDivElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      return box.width > 0 && Number.isFinite(event.clientX) ? { x: clamp((event.clientX - box.left) / box.width), away: kind === "color" ? event.clientY - box.bottom : box.top - event.clientY } : null;
    };
    const finish = (event: PointerEvent<HTMLDivElement>) => {
      const current = drag.current; if (current?.kind !== kind || current.pointer !== event.pointerId) return;
      drag.current = null; setLeaving(null);
      if (current.off && event.type === "pointerup") remove(kind, current.index);
    };
    return {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || drag.current) return;
        const point = where(event); if (!point) return;
        const grabbed = event.target instanceof Element ? event.target.closest("[data-stop]") : null;
        const index = grabbed ? Number(grabbed.getAttribute("data-stop")) : add(kind, point.x);
        if (grabbed) setPicked({ kind, index });
        drag.current = { kind, index, pointer: event.pointerId, offset: grabbed ? list(kind)[index]![0] - point.x : 0, off: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current; if (current?.kind !== kind || current.pointer !== event.pointerId) return;
        const point = where(event); if (!point) return;
        current.off = point.away > 24 && list(kind).length > 2; setLeaving(current.off ? { kind, index: current.index } : null);
        if (!current.off) current.index = place(kind, current.index, point.x + current.offset);
      },
      onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
    };
  };
  const stopKeys = (kind: Kind, index: number) => (event: KeyboardEvent) => {
    const step = event.shiftKey ? .1 : .01, delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPicked({ kind, index }); }
    if (delta) { event.preventDefault(); const at = place(kind, index, list(kind)[index]![0] + delta); if (at !== index) refocus.current = { kind, index: at }; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (remove(kind, index)) refocus.current = { kind, index: Math.max(0, index - 1) }; }
  };
  const stops = (kind: Kind) => <div className={`xd-ge-strip is-${kind}`} role="group" aria-label={kind === "color" ? "Color stops" : "Opacity stops"} {...strip(kind)}>
    {(kind === "color" ? draft.stops : draft.opacity).map(([t, value], i) => {
      const on = picked?.kind === kind && picked.index === i, fill = kind === "color" ? hex(value as C) : `rgb(${Array(3).fill(Math.round(255 * (1 - (value as number)))).join(",")})`;
      return <span key={i} data-stop={i} role="button" tabIndex={0} aria-label={`${kind === "color" ? "Color" : "Opacity"} stop ${i + 1}`} aria-pressed={on} className={`xd-ge-stop${leaving?.kind === kind && leaving.index === i ? " is-leaving" : ""}`} style={{ left: `${t * 100}%` }} onClick={() => setPicked({ kind, index: i })} onKeyDown={stopKeys(kind, i)}>
        <svg viewBox="0 0 11 14" aria-hidden="true">{kind === "color" ? <><path d="M5.5 .5L10.5 5V13.5H.5V5Z"/><rect x="2.5" y="6.5" width="6" height="5" fill={fill}/></> : <><path d="M.5 .5H10.5V9L5.5 13.5L.5 9Z"/><rect x="2.5" y="2.5" width="6" height="5" fill={fill}/></>}</svg>
      </span>;
    })}
  </div>;

  const colorStop = picked?.kind === "color" ? draft.stops[picked.index] : undefined, opacityStop = picked?.kind === "opacity" ? draft.opacity[picked.index] : undefined;
  const location = (stop: [number, unknown] | undefined) => stop ? Math.round(stop[0] * 1000) / 10 : "";
  const save = () => attempt(runPhotoCommand("gradient.presets.new", { name: name.trim() || "Custom", stops: draft.stops.map(([t, c]) => [t, hex(c)]), transparency: draft.opacity.map(([t, a]) => [t, Math.round(a * 100)]) }));
  return <>
    <PhotoDialog dialog={dialog} title="Gradient Editor" className="xd-ge-dialog" close={close} onSubmit={event => { event.preventDefault(); choose(out(latest.current), name.trim() || "Custom"); }}
      buttons={<><button type="button" onClick={() => attempt(importPreset("grd", "gradient.presets.importGrd"))}>Import…</button><button type="button" disabled title="Gradients export as .grd from Photoshop only">Export…</button></>}>
      <div className="xd-ge-box">
        <div className="xd-ge-head"><span>Presets</span>
          <span className="xd-ge-gear"><button type="button" aria-label="Preset options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}><Settings size={12}/><ChevronDown size={10}/></button>
            {menu && <div className="xd-ls-popup xd-ge-menu" role="menu">
              {VIEWS.map(([key, label]) => <button type="button" key={key} role="menuitemradio" aria-checked={view === key} onClick={() => { presetView = key; setView(key); setMenu(false); }}>{label}</button>)}
              <div role="separator"/>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); attempt(runPhotoCommand("gradient.presets.reset", { append: true })); }}>Append Default Gradients…</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); attempt(importPreset("grd", "gradient.presets.importGrd")); }}>Import Gradients…</button>
              <button type="button" role="menuitem" disabled>Export Selected Gradients…</button>
            </div>}
          </span>
        </div>
        <GradientPresets view={view} choose={(preset, label) => { setPicked(null); update({ stops: preset.stops.map(([t, c]) => [t, color(c)]), opacity: opacityOf(preset.opacity) }, label); }}/>
      </div>
      <div className="xd-ge-line"><span>Name:</span><input type="text" aria-label="Gradient name" maxLength={255} value={name} onChange={event => setName(event.target.value)}/><button type="button" onClick={save}>New</button></div>
      <div className="xd-ge-line"><span>Type:</span><select aria-label="Gradient Type" defaultValue="Solid"><option>Solid</option><option disabled>Noise</option></select></div>
      <div className="xd-ge-line"><span>Smoothness:</span><input type="number" aria-label="Smoothness" value={100} disabled readOnly title="The engine blends stops linearly"/><span>%</span></div>
      <div className="xd-ge-bar" ref={bar}>
        {transparency && stops("opacity")}
        <span className="xd-ge-ramp" role="img" aria-label="Gradient preview" style={{ backgroundImage: onChecker(gradientCss(draft.stops, draft.opacity, hex)) }}/>
        {stops("color")}
      </div>
      <fieldset className="xd-ps-dialog-group xd-ge-stops"><legend>Stops</legend>
        <div className="xd-ge-row">
          <span>Opacity:</span><StopField label="Stop opacity" disabled={!opacityStop} value={opacityStop ? Math.round(opacityStop[1] * 100) : ""} set={value => { if (picked) put("opacity", latest.current.opacity.map((stop, i) => i === picked.index ? [stop[0], round(clamp(value / 100))] : stop)); }}/><span>%</span>
          <span>Location:</span><StopField label="Opacity stop location" step="any" disabled={!opacityStop} value={location(opacityStop)} set={value => { if (picked) place("opacity", picked.index, value / 100); }}/><span>%</span>
          <button type="button" aria-label="Delete opacity stop" title="Delete" disabled={!opacityStop || draft.opacity.length <= 2} onClick={() => picked && remove("opacity", picked.index)}><Trash2 size={13}/></button>
        </div>
        <div className="xd-ge-row">
          <span>Color:</span><button type="button" className="xd-ge-swatch" aria-label="Stop color" disabled={!colorStop} style={{ background: colorStop ? hex(colorStop[1]) : undefined }} onClick={() => setPicking({ before: latest.current, name })}/><span/>
          <span>Location:</span><StopField label="Color stop location" step="any" disabled={!colorStop} value={location(colorStop)} set={value => { if (picked) place("color", picked.index, value / 100); }}/><span>%</span>
          <button type="button" aria-label="Delete color stop" title="Delete" disabled={!colorStop || draft.stops.length <= 2} onClick={() => picked && remove("color", picked.index)}><Trash2 size={13}/></button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </PhotoDialog>
    {picking && colorStop && picked && <ColorPickerDialog title="Color Picker (Stop Color)" color={hex(picking.before.stops[picked.index]![1])}
      preview={value => recolor(picked.index, value, picking.before.stops[picked.index]![1])}
      choose={value => { recolor(picked.index, value, picking.before.stops[picked.index]![1]); setPicking(null); }}
      close={() => { update(picking.before, picking.name); setPicking(null); }}/>}
  </>;
}
