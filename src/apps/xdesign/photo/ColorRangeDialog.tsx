import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Pipette } from "lucide-react";
import { useDesignDialog } from "../useDesignDialog";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { nativePaintColor } from "./imageColors";
import { useDialogDrag, useHeldModifiers } from "./photoDialog";
import { readSelectionPreferences, rememberedSelectionValues, saveSelectionPreferences } from "./selectionPreferences";
import { COLOR_RANGE_PRESETS, COLOR_RANGE_PREVIEWS, MAX_SELECTION_SAMPLES, selectionRequest, selectionSamplePoint, type SelectionPreviewView, type SelectionSample } from "./selectionSettings";
import type { PhotoColor, PhotoDocument } from "./types";

const PRESETS: Record<string, string> = { sampledColors: "Sampled Colors", reds: "Reds", yellows: "Yellows", greens: "Greens", cyans: "Cyans", blues: "Blues", magentas: "Magentas", highlights: "Highlights", midtones: "Midtones", shadows: "Shadows", outOfGamut: "Out Of Gamut" };
const PREVIEWS: Record<string, string> = { none: "None", mask: "Grayscale", black: "Black Matte", white: "White Matte", overlay: "Quick Mask" };
type Eyedropper = "replace" | "add" | "subtract";
const EYEDROPPERS: [Eyedropper, string, string][] = [["replace", "Eyedropper Tool", ""], ["add", "Add to Sample", "+"], ["subtract", "Subtract from Sample", "−"]];
const LIVE_PIXELS = 16_777_216;

// The document is partly hidden under the panels when zoomed in, so only its visible part of the stage takes samples.
export function documentUnder(canvas: HTMLElement | null, x: number, y: number) {
  if (!canvas) return null;
  const image = canvas.getBoundingClientRect(), stage = canvas.closest(".xd-photo-stage")?.getBoundingClientRect() ?? image;
  return x >= Math.max(image.left, stage.left) && x < Math.min(image.right, stage.right) && y >= Math.max(image.top, stage.top) && y < Math.min(image.bottom, stage.bottom) ? image : null;
}

// Photoshop's layout: options and the selection thumbnail on the left; OK, Cancel, the sample eyedroppers and Invert on
// the right. The eyedroppers sample the document as well as the thumbnail, and Selection Preview draws on the document.
// Like Photoshop it reads the composite and, with a selection active, selects only within it.
export function ColorRangeDialog({ document, canvas, close }: { document: PhotoDocument; canvas: HTMLElement | null; close: () => void }) {
  const state = usePhotoWorkspace(workspace => workspace.state), projectId = usePhotoWorkspace(workspace => workspace.projectId), busy = usePhotoWorkspace(workspace => workspace.busy), workspaceError = usePhotoWorkspace(workspace => workspace.error);
  const stateVersion = usePhotoWorkspace(workspace => workspace.stateVersion), documentId = usePhotoWorkspace(workspace => workspace.documentId);
  const foreground = nativePaintColor(state?.tools?.foreground) ?? "#000000";
  const [preferences] = useState(readSelectionPreferences);
  const [values, setValues] = useState(() => rememberedSelectionValues("color", foreground, preferences.workflows.color)), opened = useRef(values);
  const [eyedropper, setEyedropper] = useState<Eyedropper>("replace"), [thumbnail, setThumbnail] = useState<"selection" | "image">("selection");
  const [overImage, setOverImage] = useState(false), [localError, setLocalError] = useState("");
  const held = useHeldModifiers(), drag = useDialogDrag();
  const context = useRef({ projectId, id: document.id, version: document.version, viewKey: state?.viewKey });
  const current = () => { const workspace = usePhotoWorkspace.getState(), at = context.current; return projectId === at.projectId && document.id === at.id && document.version === at.version && stateVersion === at.version && documentId === at.id && state?.viewKey === at.viewKey && workspace.projectId === at.projectId && workspace.documentId === at.id && workspace.stateVersion === at.version && workspace.state?.viewKey === at.viewKey; };
  const fresh = current();
  useEffect(() => { if (!fresh && !busy) close(); }, [fresh, busy, close]);
  const dialog = useDesignDialog<HTMLFormElement>(close, busy);
  const request = selectionRequest("color", { ...values, sampleAllLayers: true, mode: state?.hasSelection ? "intersect" : "replace" }, { width: document.width, height: document.height, hasSelection: state?.hasSelection === true });
  const valid = !request.problem && fresh, live = isTauri() && document.width * document.height <= LIVE_PIXELS;
  const view = COLOR_RANGE_PREVIEWS.includes(String(values.selectionPreview)) ? String(values.selectionPreview) : "none";
  const matte = ["black", "white", "overlay"].includes(view) ? view as SelectionPreviewView : undefined;
  const previewing = live && !busy && valid, options = { automatic: true, delay: 150, viewKey: state?.viewKey };
  const mask = usePhotoCommandPreview(document, projectId, request.command, request.params, { ...options, enabled: previewing, selectionView: "mask" });
  const onCanvas = usePhotoCommandPreview(document, projectId, request.command, request.params, { ...options, enabled: previewing && !!matte && !!canvas, selectionView: matte });
  const canvasURL = view === "mask" ? mask.url : matte ? onCanvas.url : null;
  const sampled = values.select === "sampledColors", tonal = ["shadows", "midtones", "highlights"].includes(String(values.select));
  const colors = values.colors as PhotoColor[] | undefined ?? [], points = values.points as SelectionSample[] | undefined ?? [], subtractPoints = values.subtractPoints as SelectionSample[] | undefined ?? [];
  const change = (key: string, value: unknown) => { setValues(current => ({ ...current, [key]: value })); setLocalError(""); };
  const pick = (point: SelectionSample, mode: Eyedropper) => {
    if (mode !== "replace" && colors.length + points.length + subtractPoints.length >= MAX_SELECTION_SAMPLES) { setLocalError(`Use at most ${MAX_SELECTION_SAMPLES} color samples.`); return; }
    const key = mode === "subtract" ? "subtractPoints" : "points";
    setValues(current => mode === "replace" ? { ...current, colors: [], points: [point], subtractPoints: [] } : { ...current, [key]: [...current[key] as SelectionSample[], point] });
    setLocalError("");
  };
  const sample = (event: PointerEvent<HTMLElement>, bounds: DOMRect) => {
    if (busy || !sampled || event.button !== 0 || !current()) return;
    const point = selectionSamplePoint(event.clientX, event.clientY, bounds, document.width, document.height);
    if (point) pick(point, event.altKey ? "subtract" : event.shiftKey ? "add" : eyedropper);
  };
  const documentAt = (x: number, y: number) => documentUnder(canvas, x, y);
  const cancel = (altKey: boolean) => { if (held.alt || altKey) { setValues(opened.current); setEyedropper("replace"); setLocalError(""); } else close(); };
  const field = (name: string, keys: string[], max: number, unit: string, enabled: boolean) => {
    const off = busy || !enabled, slots = keys.length ? keys : [""], label = (index: number) => keys.length > 1 ? `${name} ${index ? "high" : "low"}` : name;
    const read = (key: string) => typeof values[key] === "number" && Number.isFinite(values[key]) ? Number(values[key]) : null;
    const bound = (key: string, value: number) => key === "midLow" ? Math.min(value, Number(values.midHigh)) : key === "midHigh" ? Math.max(value, Number(values.midLow)) : value;
    return <div className={`xd-photo-color-range-field${off ? " is-disabled" : ""}`}>
      <div><span>{name}:</span>{slots.map((key, index) => <input key={index} aria-label={label(index)} type="number" min={0} max={max} step={1} disabled={off} value={enabled ? read(key) ?? "" : ""} onChange={event => change(key, event.target.valueAsNumber)}/>)}{unit && <span>{unit}</span>}</div>
      {slots.map((key, index) => <input key={index} aria-label={`${label(index)} slider`} type="range" min={0} max={max} step={1} disabled={off} value={read(key) ?? 0} onChange={event => change(key, bound(key, event.target.valueAsNumber))}/>)}
    </div>;
  };
  const shown = held.command ? thumbnail === "selection" ? "image" : "selection" : thumbnail, maskShown = shown === "selection" && !!mask.url;
  const error = localError || request.problem || workspaceError || mask.error || onCanvas.error;
  return <div className={`xd-ps-dialog-scrim is-beside${overImage && sampled ? " xd-photo-eyedropper-cursor" : ""}`}
    onPointerDown={event => { const bounds = event.target === event.currentTarget ? documentAt(event.clientX, event.clientY) : null; if (bounds) sample(event, bounds); }}
    onPointerMove={event => { const over = event.target === event.currentTarget && !!documentAt(event.clientX, event.clientY); if (over !== overImage) setOverImage(over); }}
    onWheel={event => { if (event.target === event.currentTarget) canvas?.closest(".xd-photo-stage")?.scrollBy(event.deltaX, event.deltaY); }}>
    <form noValidate ref={dialog} role="dialog" aria-modal="true" aria-label="Color Range" className="xd-ps-dialog" style={drag.style} onSubmit={event => {
      event.preventDefault(); if (busy || !valid) return;
      if (!current()) { setLocalError("The image changed. Reopen Color Range."); return; }
      setLocalError(""); void runPhotoCommand(request.command, request.params).then(() => {
        const notice = saveSelectionPreferences("color", true, values, "mask", 30);
        if (notice) usePhotoWorkspace.setState({ error: notice });
        close();
      }).catch(failure => setLocalError(String(failure)));
    }}>
      <header {...drag.handle}><h3>Color Range</h3></header>
      <div className="xd-ps-dialog-body">
        <div className="xd-photo-color-range-controls">
          <label className="xd-photo-color-range-row">Select:<select aria-label="Select" disabled={busy} value={String(values.select)} onChange={event => change("select", event.target.value)}>{COLOR_RANGE_PRESETS.map(value => <option key={value} value={value}>{PRESETS[value]}</option>)}</select></label>
          <label className="xd-ps-dialog-check"><input aria-label="Localized Color Clusters" type="checkbox" disabled={busy || !sampled} checked={sampled && values.localized === true} onChange={event => change("localized", event.target.checked)}/>Localized Color Clusters</label>
          {field("Fuzziness", sampled ? ["sampleFuzziness"] : tonal ? ["toneFuzziness"] : [], sampled ? 200 : 100, tonal ? "%" : "", sampled || tonal)}
          {field("Range", sampled ? ["range"] : values.select === "midtones" ? ["midLow", "midHigh"] : tonal ? [values.select === "shadows" ? "shadowLevel" : "highlightLevel"] : [], sampled ? 100 : 255, sampled ? "%" : "", sampled ? values.localized === true : tonal)}
          <div className="xd-photo-color-range-thumb"><img className={sampled ? "xd-photo-eyedropper-cursor" : undefined} src={maskShown ? mask.url! : convertFileSrc(document.previewPath)} alt={maskShown ? "Color Range selection" : "Color Range image"} draggable={false} onPointerDown={event => sample(event, event.currentTarget.getBoundingClientRect())}/></div>
          <div className="xd-photo-color-range-views" role="radiogroup" aria-label="Thumbnail">{(["selection", "image"] as const).map(value => <label key={value} className="xd-ps-dialog-check"><input type="radio" name="xd-color-range-thumbnail" aria-label={value === "selection" ? "Selection" : "Image"} disabled={busy} checked={shown === value} onChange={() => setThumbnail(value)}/>{value === "selection" ? "Selection" : "Image"}</label>)}</div>
          <label className="xd-photo-color-range-row">Selection Preview:<select aria-label="Selection Preview" disabled={busy} value={view} onChange={event => change("selectionPreview", event.target.value)}>{COLOR_RANGE_PREVIEWS.map(value => <option key={value} value={value}>{PREVIEWS[value]}</option>)}</select></label>
          {!live && isTauri() && <p role="status">Previews are off for images over 16 megapixels.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="xd-ps-dialog-buttons">
          <button type="submit" disabled={busy || !valid}>OK</button>
          <button type="button" disabled={busy} onClick={event => cancel(event.altKey)}>{held.alt ? "Reset" : "Cancel"}</button>
          <div className="xd-photo-color-range-tools">{EYEDROPPERS.map(([mode, name, mark]) => <button key={mode} type="button" aria-label={name} title={name} aria-pressed={sampled && eyedropper === mode} disabled={busy || !sampled} onClick={() => setEyedropper(mode)}><Pipette size={14}/>{mark && <b aria-hidden="true">{mark}</b>}</button>)}</div>
          <label className="xd-ps-dialog-check"><input aria-label="Invert" type="checkbox" disabled={busy} checked={values.invert === true} onChange={event => change("invert", event.target.checked)}/>Invert</label>
        </div>
      </div>
    </form>
    {canvas && canvasURL && createPortal(<img className="xd-photo-canvas-preview" src={canvasURL} alt="" draggable={false}/>, canvas)}
  </div>;
}
