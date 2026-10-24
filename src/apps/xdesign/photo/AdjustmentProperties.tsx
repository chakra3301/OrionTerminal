import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, ChartSpline, Contrast, Eye, EyeOff, History, Rainbow, RotateCcw, SlidersHorizontal, SquareArrowDownLeft, SunMedium, Trash2, type LucideIcon } from "lucide-react";
import { AdjustmentControls, rgbHex, type Settings } from "./actionControls";
import { gradientMapParams, gradientMapValues } from "./gradientMethod";
import { ADJUSTMENTS, type PhotoAction } from "./controls";
import { adjustmentDefaults, hasFiniteSettings } from "./adjustmentSettings";
import { AdjustmentPresetRow, stable } from "./AdjustmentPresetRow";
import { usePhotoCommandPreview } from "./commandPreview";
import { controlsLocked, runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";
import "./adjustmentProperties.css";

const ICONS: Record<string, LucideIcon> = { brightnessContrast: SunMedium, levels: ChartColumn, curves: ChartSpline, exposure: Contrast, hueSaturation: Rainbow };
const SETTLE_MS = 200;

export const adjustmentActionFor = (layer: Pick<PhotoLayer, "adjustment" | "adjustmentKind">): PhotoAction | undefined =>
  layer.adjustment && layer.adjustmentKind ? ADJUSTMENTS.find(action => action.id === layer.adjustmentKind) : undefined;

/** Creates the layer with neutral values; Properties then shows it, so no modal is involved. */
export const addAdjustmentLayer = (action: PhotoAction): Promise<unknown> => {
  const tools = usePhotoWorkspace.getState().state?.tools;
  // Photoshop starts a Gradient Map from the foreground to the background colour.
  return runPhotoCommand(`layer.newAdjustmentLayer.${action.id}`, action.id === "gradientMap" ? gradientMapParams({ stops: [[0, rgbHex(tools?.foreground, "#000000")], [1, rgbHex(tools?.background, "#ffffff")]], method: "perceptual" }) : {});
};

export function adjustmentCommandParams(action: PhotoAction, values: Settings, layer: number): Settings {
  const params: Settings = { ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)), layer };
  if (action.id === "channelMixer" && !values.monochrome) delete params.gray;
  return action.id === "gradientMap" ? gradientMapParams(params) : params;
}

function seeded(action: PhotoAction, mode: string, layer: PhotoLayer): Settings {
  const values = { ...adjustmentDefaults(action, mode, layer.adjustmentParams), ...structuredClone(action.id === "gradientMap" ? gradientMapValues(layer.adjustmentParams ?? {}) : layer.adjustmentParams ?? {}) };
  // The native description omits the table itself; an imported LUT must stay embedded until replaced.
  if (action.id === "colorLookup") delete values.lut;
  return values;
}

const settle = (work: Promise<unknown>) => work.then(() => {}, () => {});

export function AdjustmentProperties({ layer, document, canvas = null, untilShown = settle }: { layer: PhotoLayer; document: PhotoDocument; canvas?: HTMLElement | null; untilShown?: (work: Promise<unknown>) => Promise<void> }) {
  const action = adjustmentActionFor(layer), mode = usePhotoWorkspace(state => state.state?.mode ?? "RGB");
  if (!action) return <p className="xd-photo-section-help">This adjustment came from another application and cannot be edited here.</p>;
  return <AdjustmentEditor key={layer.id} action={action} layer={layer} document={document} canvas={canvas} mode={mode} untilShown={untilShown}/>;
}

function AdjustmentEditor({ action, layer, document, canvas, mode, untilShown }: { action: PhotoAction; layer: PhotoLayer; document: PhotoDocument; canvas: HTMLElement | null; mode: string; untilShown: (work: Promise<unknown>) => Promise<void> }) {
  const locked = usePhotoWorkspace(controlsLocked), projectId = usePhotoWorkspace(state => state.projectId), viewKey = usePhotoWorkspace(state => state.state?.viewKey);
  const server = seeded(action, mode, layer), serverSignature = stable(server);
  const [values, setValues] = useState<Settings>(() => structuredClone(server)), opening = useRef(structuredClone(server));
  const [channel, setChannel] = useState(""), [range, setRange] = useState(action.id === "colorBalance" ? "midtones" : action.id === "hueSaturation" ? "master" : "reds");
  const [loadingFile, setLoadingFile] = useState(false), [error, setError] = useState("");
  const [pointer, setPointer] = useState(false), [typing, setTyping] = useState(false), [peek, setPeek] = useState(false);
  const [edits, setEdits] = useState(0), [settled, setSettled] = useState(0), [acked, setAcked] = useState(0), [holding, setHolding] = useState(0);
  const edited = useRef(0), sent = useRef(0), flight = useRef(0), latest = useRef(values); latest.current = values;
  const shown = useRef(untilShown); shown.current = untilShown;

  const send = useCallback(() => {
    if (edited.current === sent.current || !hasFiniteSettings(latest.current)) return;
    const number = edited.current; sent.current = number; flight.current++; setHolding(count => count + 1);
    const work = runPhotoCommand("layer.setAdjustment", adjustmentCommandParams(action, latest.current, layer.id));
    work.catch(failure => setError(String(failure))).finally(() => { flight.current--; setAcked(count => Math.max(count, number)); setSettled(count => count + 1); });
    void shown.current(work).then(() => setHolding(count => count - 1));
  }, [action, layer.id]);
  const edit = (next: Settings | ((current: Settings) => Settings)) => { setValues(next); edited.current++; setEdits(edited.current); };
  const change = (key: string, value: unknown) => { if (!locked) edit(current => ({ ...current, [key]: value })); };
  const setAll: typeof setValues = next => { if (!locked) edit(next); };

  useEffect(() => {
    if (!edits || pointer || typing || edited.current === sent.current) return;
    const timer = window.setTimeout(send, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [edits, pointer, typing, send]);
  // Undo, redo and engine normalisation arrive through the layer; adopt them only while no edit is pending.
  useEffect(() => {
    if (edited.current !== sent.current || flight.current || pointer || typing || stable(latest.current) === serverSignature) return;
    setValues(structuredClone(server));
  }, [serverSignature, settled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const release = () => { setPointer(false); setPeek(false); };
    window.addEventListener("pointerup", release); window.addEventListener("pointercancel", release); window.addEventListener("blur", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release); };
  }, []);

  const command = (name: string, params: Settings = {}) => { setError(""); void runPhotoCommand(name, { layer: layer.id, ...params }).catch(failure => setError(String(failure))); };
  const reset = () => {
    if (locked) return;
    const number = edited.current; sent.current = number; setError("");
    flight.current++;
    runPhotoCommand("layer.setAdjustment", { layer: layer.id }).catch(failure => setError(String(failure))).finally(() => { flight.current--; setAcked(count => Math.max(count, number)); setSettled(count => count + 1); });
  };
  const previous = usePhotoCommandPreview(document, projectId, "layer.setAdjustment", adjustmentCommandParams(action, opening.current, layer.id), { automatic: peek, enabled: peek, delay: 100, viewKey });
  // Each commit writes an image version, so edits show on the canvas as previews and commit once the control is let go.
  const drafting = edits > acked && !peek && hasFiniteSettings(values);
  const draft = usePhotoCommandPreview(document, projectId, "layer.setAdjustment", adjustmentCommandParams(action, values, layer.id), { automatic: true, enabled: drafting, delay: 0, viewKey });
  // The last frame stays until the committed image is shown, so the unedited pixels never flash back.
  const lastDraft = useRef<string | null>(null);
  if (draft.url) lastDraft.current = draft.url; else if (!drafting && !holding) lastDraft.current = null;
  const draftURL = !peek && (drafting || holding > 0) ? draft.url ?? lastDraft.current : null;

  const Icon = ICONS[action.id] ?? SlidersHorizontal;
  const grab = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.target instanceof Element && event.target.closest("input[type=range], input[type=color], svg, .xd-photo-tone-strip")) setPointer(true); };

  return <div className="xd-photo-adjustment-editor" onPointerDown={grab}
    onFocus={event => { if (event.target instanceof HTMLInputElement && event.target.type === "number") setTyping(true); }}
    onBlur={event => { if (event.target instanceof HTMLInputElement && event.target.type === "number") setTyping(false); }}
    onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "number") send(); }}>
    <div className="xd-photo-adjustment-header"><Icon size={14} aria-hidden/><strong>{action.label}</strong><span>{layer.name}</span></div>
    <AdjustmentPresetRow action={action} mode={mode} values={values} locked={locked} apply={next => { if (!locked) edit(next); }} fail={setError}/>
    <div className="xd-ps-dialog-grid has-sliders xd-photo-action-grid">
      <AdjustmentControls action={action} values={values} setValues={setAll} change={change} locked={locked} mode={mode} layer={layer} channel={channel} setChannel={setChannel} range={range} setRange={setRange} loadingFile={loadingFile} setLoadingFile={setLoadingFile} setLocalError={setError} source={{ document, layer: layer.id, below: true }} canvas={canvas}/>
    </div>
    {!hasFiniteSettings(values) && <p role="alert">Enter a number in every field.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="xd-photo-adjustment-footer" role="toolbar" aria-label="Adjustment layer">
      <button type="button" aria-label={layer.clipped ? "Release clipping mask" : "Clip to layer below"} title={layer.clipped ? "Release clipping mask" : "This adjustment affects the layer below (click to clip to the layer below)"} aria-pressed={layer.clipped} disabled={locked} onClick={() => command(layer.clipped ? "layer.releaseClippingMask" : "layer.createClippingMask")}><SquareArrowDownLeft size={14}/></button>
      <button type="button" aria-label="View previous state" title="Press to view previous state" aria-pressed={peek} disabled={locked} onPointerDown={() => setPeek(true)} onKeyDown={event => { if (event.key === " " || event.key === "Enter") setPeek(true); }} onKeyUp={() => setPeek(false)} onBlur={() => setPeek(false)}><History size={14}/></button>
      <button type="button" aria-label="Reset to adjustment defaults" title="Reset to adjustment defaults" disabled={locked} onClick={reset}><RotateCcw size={14}/></button>
      <button type="button" aria-label="Toggle layer visibility" title="Toggle layer visibility" aria-pressed={layer.visible} disabled={locked} onClick={() => command("layer.setProps", { visible: !layer.visible })}>{layer.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
      <button type="button" aria-label="Delete this adjustment layer" title="Delete this adjustment layer" disabled={locked} onClick={() => command("layer.delete")}><Trash2 size={14}/></button>
    </div>
    {peek && canvas && previous.url && createPortal(<img className="xd-photo-canvas-preview" src={previous.url} alt="" draggable={false}/>, canvas)}
    {canvas && draftURL && createPortal(<img className="xd-photo-canvas-preview" src={draftURL} alt="" draggable={false}/>, canvas)}
  </div>;
}
