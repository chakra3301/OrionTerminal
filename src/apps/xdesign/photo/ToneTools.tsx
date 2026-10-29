import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Grid2x2, Grid3x3, Pencil, Spline } from "lucide-react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { ClipSignal, CurvePoint, CurveView, HistogramSource } from "./toneControls";
import { readCurveDisplay, saveCurveDisplay, type CurveDisplay } from "./curveTools";
import { ClippingOverlay, toneLuts, useTonePixels, type ClipTone } from "./toneClipping";
import { AUTO_DEFAULTS, autoPatch, curvePointFor, labLevels, labSamplePatch, readAutoOptions, saveAutoOptions, samplePatch, useAutoColors, useImageDrag, useToneSampler, type AutoAlgorithm, type AutoOptions, type ToneTarget } from "./toneSampler";
import { OnImageButton } from "./psAdjustControls";

type Settings = Record<string, unknown>;
// Photoshop keeps the Auto options for the session; Save as Defaults also keeps them for the next one.
let sessionOptions: AutoOptions | null = null;
const TONES: [ToneTarget, string][] = [["black", "Sample in image to set black point"], ["gray", "Sample in image to set gray point"], ["white", "Sample in image to set white point"]];
const ALGORITHMS: [AutoAlgorithm, string][] = [["monochromatic", "Enhance Monochromatic Contrast"], ["perChannel", "Enhance Per Channel Contrast"], ["darkLight", "Find Dark & Light Colors"], ["brightnessContrast", "Enhance Brightness and Contrast"]];
const hex = (rgb: number[]) => "#" + rgb.map(value => Math.round(value).toString(16).padStart(2, "0")).join("");
const rgbOf = (value: string) => [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];

function Eyedropper({ tone }: { tone: ToneTarget }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className={`xd-photo-eyedropper-ink is-${tone}`} d="M3 21v-3l9-9 3 3-9 9Z"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
  </svg>;
}

const SHOW: [keyof CurveDisplay, string][] = [["overlays", "Channel Overlays"], ["histogram", "Histogram"], ["baseline", "Baseline"], ["intersection", "Intersection Line"]];

/** Levels and Curves: Auto, its options and the black, gray and white point eyedroppers, and the Curves tools. A dialog
 * puts Auto and Options… in its button column through `slot`, as Photoshop's dialogs do; Properties keeps Auto by the
 * channel and the tools in a column beside the graph. Eyedroppers work on RGB, gray and Lab images; CMYK and Lab keep Auto
 * on the shown channel. */
export function ToneAdjustment({ kind, head, editor, values, setValues, channel, rgb, gray, lab = false, pigmentDefault = false, smooth, histograms, channelAuto, locked, source, canvas, slot, fail }: {
  kind: "levels" | "curves"; head: ReactNode; editor: ReactNode | ((view: CurveView & { aside?: ReactNode }) => ReactNode); values: Settings; setValues: Dispatch<SetStateAction<Settings>>;
  /** The channel shown: "composite", one of red, green and blue, or Lab's lightness, a or b. */
  channel: string; rgb: boolean; gray: boolean; lab?: boolean;
  /** Photoshop shows CMYK and gray curves as ink percentages. */
  pigmentDefault?: boolean; smooth?: () => void;
  histograms: number[][] | null; channelAuto: (() => void) | null; locked: boolean; source?: HistogramSource; canvas?: HTMLElement | null; slot?: HTMLElement | null; fail: (message: string) => void;
}) {
  const [armed, setArmed] = useState<ToneTarget | null>(null), [options, setOptions] = useState(() => sessionOptions ?? (sessionOptions = readAutoOptions())), [choosing, setChoosing] = useState(false);
  const [pencil, setPencil] = useState(false), [pigment, setPigment] = useState(pigmentDefault), [display, setDisplay] = useState(readCurveDisplay);
  // Photoshop shows clipping while Alt-dragging the black or white input, or always in Curves with Show Clipping on.
  const [clip, setClip] = useState<{ tone: ClipTone; alt: boolean } | null>(null), [showClipping, setShowClipping] = useState(false);
  const signal: ClipSignal = (tone, alt) => setClip(current => !tone ? null : current?.tone === tone && current.alt === alt ? current : { tone, alt });
  // Clipping is shown from the image's colours, so a mask, Quick Mask or alpha channel has none.
  const plane = !!source?.target, clippable = rgb || gray && !plane;
  const clipping = clippable && !locked && clip && (clip.alt || kind === "curves" && showClipping) ? clip.tone : null;
  const pixels = useTonePixels(source, canvas, !!clipping, fail);
  const shownChannels = gray ? ["composite"] : channel === "composite" ? ["red", "green", "blue"] : [channel];
  const show = (patch: Partial<CurveDisplay>) => setDisplay(current => { const next = { ...current, ...patch }; saveCurveDisplay(next); return next; });
  const host = useRef<HTMLDivElement>(null), amount = useId();
  const sampling = (rgb || lab || plane) && !!source && !!canvas && isTauri();
  useToneSampler(canvas ?? null, source, sampling && !!armed && !locked && !choosing, color => { if (armed) setValues(current => ({ ...current, ...(lab ? labSamplePatch(kind, armed, color, current, options) : samplePatch(kind, armed, color, current, gray, options)) })); }, fail);
  // The on-image tool adds or picks the point at the pressed pixel's level, and dragging up raises it on the graph.
  const [adjusting, setAdjusting] = useState(false), curveKey = channel === "composite" ? "points" : channel, shown = useRef(values); shown.current = values;
  useImageDrag(canvas ?? null, source, sampling && kind === "curves" && adjusting && !locked && !choosing, "ns", color => {
    const level = channel === "composite" ? (color[0] + color[1] + color[2]) / 3 : lab ? labLevels(color)[["lightness", "a", "b"].indexOf(channel)] ?? 0 : color[["red", "green", "blue"].indexOf(channel)] ?? 0;
    const current = shown.current[curveKey], picked = curvePointFor(Array.isArray(current) && current.length >= 2 ? current as CurvePoint[] : [[0, 0], [255, 255]], Math.round(level));
    if (!picked) return null;
    const start = picked.points.find(([x]) => x === picked.x)![1];
    setValues(current => ({ ...current, [curveKey]: picked.points }));
    return (_, dy) => { const output = Math.max(0, Math.min(255, Math.round(start + (pigment ? dy : -dy)))); setValues(current => ({ ...current, [curveKey]: picked.points.map((point): CurvePoint => point[0] === picked.x ? [point[0], output] : point) })); };
  }, fail);
  const handButton = kind === "curves" && <OnImageButton title="Click and drag in image to modify the curve" armed={adjusting} disabled={locked || !sampling} toggle={() => { setArmed(null); setPencil(false); setAdjusting(current => !current); }}/>;
  // The options being tried in the dialog, else the chosen ones: the host's colours are read for their clipping.
  const [trying, setTrying] = useState<AutoOptions | null>(null), wanted = trying ?? options;
  const colors = useAutoColors(source, rgb && !locked && (wanted.algorithm === "darkLight" || wanted.snap), wanted.shadowClip, wanted.highlightClip);
  const automatic = (using: AutoOptions) => rgb && histograms?.length === 4 ? autoPatch(kind, histograms, gray, using, using.shadowClip === wanted.shadowClip && using.highlightClip === wanted.highlightClip ? colors : null) : null;
  const canAuto = !locked && (rgb ? !!automatic(options) : !!channelAuto);
  const opening = useRef<Settings>(values);
  const openOptions = () => { opening.current = values; setTrying(options); setChoosing(true); };
  useEffect(() => { const patch = choosing && trying && colors ? automatic(trying) : null; if (patch) setValues({ ...opening.current, ...patch }); }, [colors]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = (event: { altKey: boolean }) => {
    if (event.altKey && rgb && !locked) { openOptions(); return; }
    if (!canAuto) return;
    const patch = automatic(options);
    if (patch) setValues(current => ({ ...current, ...patch })); else channelAuto?.();
  };
  const autoButton = <button type="button" title={rgb ? "Alt-click for Auto Options" : undefined} disabled={!canAuto} onClick={auto}>Auto</button>;
  const eyedroppers = <div className="xd-photo-tone-eyedroppers" role="toolbar" aria-label="Eyedroppers">{TONES.map(([tone, name]) => <button key={tone} type="button" aria-label={name} title={name} aria-pressed={armed === tone} disabled={locked || !sampling || gray && tone === "gray"} onClick={() => { setAdjusting(false); setArmed(current => current === tone ? null : tone); }}><Eyedropper tone={tone}/></button>)}</div>;
  const chooser = choosing && <AutoOptionsDialog options={options} close={() => { setValues(opening.current); setTrying(null); setChoosing(false); }}
    change={next => { setTrying(next); const patch = automatic(next); if (patch) setValues({ ...opening.current, ...patch }); }}
    accept={(next, keep) => { sessionOptions = next; setOptions(next); if (keep) saveAutoOptions(next); setTrying(null); setChoosing(false); }}/>;
  const curves = kind === "curves", smoothButton = curves && <button type="button" title="Smooth the curve values" disabled={locked || !pencil || !smooth} onClick={smooth}>Smooth</button>;
  const tools = curves && <div className="xd-photo-curve-tools" role="toolbar" aria-label="Curve tools">
    <button type="button" aria-label="Edit points to modify the curve" title="Edit points to modify the curve" aria-pressed={!pencil} disabled={locked} onClick={() => setPencil(false)}><Spline size={14}/></button>
    <button type="button" aria-label="Draw to modify the curve" title="Draw to modify the curve" aria-pressed={pencil} disabled={locked} onClick={() => setPencil(true)}><Pencil size={14}/></button>
  </div>;
  const clippingBox = <label className="xd-ps-dialog-check"><input type="checkbox" checked={showClipping} disabled={!clippable} onChange={event => setShowClipping(event.target.checked)}/>Show Clipping</label>;
  const view: CurveView & { aside?: ReactNode } = { pencil, pigment, display, toggleGrid: () => show({ detailed: !display.detailed }), clip: signal, aside: slot ? <div className="xd-photo-curve-aside"><div className="xd-photo-curve-aside-row">{handButton}{eyedroppers}</div>{clippingBox}</div> : undefined };
  return <div className="xd-photo-tone" ref={host}>
    <div className="xd-photo-tone-head">{head}{!slot && autoButton}</div>
    <div className="xd-photo-tone-body">{slot ? tools : <div className="xd-photo-tone-column">{handButton}{eyedroppers}{tools}{smoothButton}</div>}{typeof editor === "function" ? editor(view) : editor}</div>
    {curves && !slot && clippingBox}
    {curves && <details className="xd-photo-curve-display" open={!!slot}><summary>Curve Display Options</summary>
      <div className="xd-photo-curve-display-row">
        <div role="radiogroup" aria-label="Show Amount of" className="xd-ps-dialog-radios"><span>Show Amount of:</span>
          <label className="xd-ps-dialog-check"><input type="radio" name={amount} checked={!pigment} onChange={() => setPigment(false)}/>Light (0-255)</label>
          <label className="xd-ps-dialog-check"><input type="radio" name={amount} checked={pigment} onChange={() => setPigment(true)}/>Pigment/Ink %</label>
        </div>
        <div className="xd-photo-curve-grids" role="radiogroup" aria-label="Grid">
          <button type="button" role="radio" aria-label="Show simple grid" title="Show simple grid" aria-checked={!display.detailed} onClick={() => show({ detailed: false })}><Grid2x2 size={14}/></button>
          <button type="button" role="radio" aria-label="Show detailed grid" title="Show detailed grid" aria-checked={display.detailed} onClick={() => show({ detailed: true })}><Grid3x3 size={14}/></button>
        </div>
      </div>
      <div className="xd-photo-curve-display-row"><span>Show:</span>{SHOW.map(([key, text]) => <label key={key} className="xd-ps-dialog-check"><input type="checkbox" checked={display[key]} onChange={event => show({ [key]: event.target.checked })}/>{text}</label>)}</div>
    </details>}
    {slot && createPortal(<div className="xd-photo-tone-slot">{smoothButton}{autoButton}<button type="button" disabled={locked || !rgb} onClick={openOptions}>Options…</button>{kind === "levels" && eyedroppers}</div>, slot)}
    {chooser && createPortal(chooser, host.current?.closest(".xd-photo") ?? window.document.body)}
    {clipping && canvas && pixels && <ClippingOverlay canvas={canvas} pixels={pixels} tone={clipping} luts={toneLuts(kind, values, shownChannels)} channels={gray ? [0] : shownChannels.map(key => ["red", "green", "blue"].indexOf(key))}/>}
  </div>;
}

function AutoOptionsDialog({ options, change, accept, close }: { options: AutoOptions; change: (options: AutoOptions) => void; accept: (options: AutoOptions, keep: boolean) => void; close: () => void }) {
  const [draft, setDraft] = useState(options), [keep, setKeep] = useState(false);
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const update = (patch: Partial<AutoOptions>) => { const next = { ...draft, ...patch }; setDraft(next); change(next); };
  const clip = (key: "shadowClip" | "highlightClip") => <label className="xd-ps-dialog-field"><span>Clip:</span><input aria-label={key === "shadowClip" ? "Shadows clip" : "Highlights clip"} type="number" min={0} max={9.99} step={.01} value={draft[key].toFixed(2)}
    onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) update({ [key]: Math.max(0, Math.min(9.99, value)) }); }}/><span className="xd-ps-dialog-unit">%</span></label>;
  const target = (key: "shadows" | "midtones" | "highlights", label: string) => <label className="xd-ps-dialog-field"><span>{label}:</span><input aria-label={`${label} target color`} type="color" value={hex(draft[key])} onChange={event => update({ [key]: rgbOf(event.target.value) })}/></label>;
  return <PhotoDialog dialog={dialog} title="Auto Color Correction Options" className="xd-photo-auto-options" close={close} reset={() => update(AUTO_DEFAULTS)} onSubmit={event => { event.preventDefault(); accept(draft, keep); }}>
    <fieldset className="xd-ps-dialog-group"><legend>Algorithms</legend>
      <div role="radiogroup" aria-label="Algorithms" className="xd-ps-dialog-radios">{ALGORITHMS.map(([id, label]) => <label key={id} className="xd-ps-dialog-check"><input type="radio" name="auto-algorithm" checked={draft.algorithm === id} onChange={() => update({ algorithm: id })}/>{label}</label>)}</div>
      <label className="xd-ps-dialog-check"><input type="checkbox" checked={draft.snap} onChange={event => update({ snap: event.target.checked })}/>Snap Neutral Midtones</label>
    </fieldset>
    <fieldset className="xd-ps-dialog-group xd-photo-auto-targets"><legend>Target Colors &amp; Clipping</legend>
      <div>{target("shadows", "Shadows")}{clip("shadowClip")}</div>
      <div>{target("midtones", "Midtones")}</div>
      <div>{target("highlights", "Highlights")}{clip("highlightClip")}</div>
    </fieldset>
    <label className="xd-ps-dialog-check"><input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)}/>Save as defaults</label>
  </PhotoDialog>;
}
