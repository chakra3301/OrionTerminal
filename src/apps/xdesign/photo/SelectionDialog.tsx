import { useEffect, useReducer, useRef, useState, type PointerEvent } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { nativePaintColor } from "./imageColors";
import { beginXDesignActivity } from "../runtimeActivity";
import { readSelectionPreferences, rememberedSelectionValues, saveSelectionPreferences } from "./selectionPreferences";
import { MAX_EDGE_BRUSH_POINTS, MAX_EDGE_BRUSH_STROKES, type SelectionBrush } from "./selectionSettings";
import type { PhotoDocument, PhotoLayer } from "./types";
import { SelectionModeCluster } from "./OptionsBarControls";
import { SELECT_AND_MASK_TOOLS, brushSelectionParams, historyId, quickSelectionParams, selectAndMaskFold, selectAndMaskRevert, strokeMode, type SelectAndMaskMode, type SelectAndMaskTool } from "./selectAndMask";
import { FOCUS_FIELDS, REFINE_FIELDS, SELECTION_MODES, SELECTION_OUTPUTS, SELECTION_TITLES, effectiveSelectionOutput, selectionRequest, selectionSamplePoint, type SelectionNumber, type SelectionPreviewView, type SelectionWorkflow } from "./selectionSettings";

const title = (text: string) => text.replace(/\b[a-z]/g, char => char.toUpperCase());
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());
const findLayer = (layers: PhotoLayer[], id: number | null): PhotoLayer | undefined => flatten(layers).find(layer => layer.id === id);
const flatten = (layers: PhotoLayer[]): PhotoLayer[] => layers.flatMap(layer => [layer, ...flatten(layer.children ?? [])]);

export function SelectionDialog({ kind, document, close }: { kind: Exclude<SelectionWorkflow, "color">; document: PhotoDocument; close: () => void }) {
  const state = usePhotoWorkspace(workspace => workspace.state), projectId = usePhotoWorkspace(workspace => workspace.projectId), busy = usePhotoWorkspace(workspace => workspace.busy), workspaceError = usePhotoWorkspace(workspace => workspace.error);
  const workspaceVersion = usePhotoWorkspace(workspace => workspace.stateVersion), workspaceDocument = usePhotoWorkspace(workspace => workspace.documentId);
  const foreground = nativePaintColor(state?.tools?.foreground) ?? "#000000";
  const [preferences] = useState(readSelectionPreferences), saved = preferences.workflows[kind];
  const [opening] = useState(() => ({ values: rememberedSelectionValues(kind, foreground, saved), view: saved?.view ?? "mask" as SelectionPreviewView, brushSize: saved?.brushSize ?? 30 }));
  const [values, setValues] = useState(() => structuredClone(opening.values)), [view, setView] = useState<SelectionPreviewView>(opening.view);
  const [remember, setRemember] = useState(!!saved), [brushSize, setBrushSize] = useState(opening.brushSize), [brushErase, setBrushErase] = useState(false);
  const [brushes, setBrushes] = useState<SelectionBrush[]>([]), [brushDraft, setBrushDraft] = useState<SelectionBrush | null>(null);
  const draft = useRef<SelectionBrush | null>(null), brushPointer = useRef<number | null>(null), brushImage = useRef<HTMLImageElement | null>(null), brushLease = useRef<(() => void) | null>(null);
  const [live, setLive] = useState(isTauri() && document.width * document.height <= 16_777_216), [localError, setLocalError] = useState("");
  const [sampleX, setSampleX] = useState(0), [sampleY, setSampleY] = useState(0);
  const [tool, setTool] = useState<SelectAndMaskTool>("quick"), [mode, setMode] = useState<SelectAndMaskMode>("add");
  const base = useRef(historyId(state)), edited = useRef(false), own = useRef(0), [, rebased] = useReducer((count: number) => count + 1, 0);
  const context = useRef({ projectId, id: document.id, version: document.version, viewKey: state?.viewKey });
  const currentContext = () => { const workspace = usePhotoWorkspace.getState(); return projectId === context.current.projectId && document.id === context.current.id && document.version === context.current.version && workspaceVersion === context.current.version && workspaceDocument === context.current.id && state?.viewKey === context.current.viewKey && workspace.projectId === context.current.projectId && workspace.documentId === context.current.id && workspace.stateVersion === context.current.version && workspace.state?.viewKey === context.current.viewKey; };
  const sameContext = currentContext();
  const edgeBrushSupported = state?.features?.selectionEdgeBrush === true;
  // The dialog's own selection edits move the image version too; it follows them instead of closing.
  useEffect(() => { if (!sameContext && !busy && !own.current) close(); }, [sameContext, busy, close]);
  const edit = (command: string, params: Record<string, unknown>) => {
    if (busy || !currentContext()) return; own.current++; setLocalError("");
    void runPhotoCommand(command, params).then(() => { edited.current = true; }, error => setLocalError(String(error))).finally(() => {
      const workspace = usePhotoWorkspace.getState();
      if (workspace.stateVersion && workspace.projectId === context.current.projectId && workspace.documentId === context.current.id) context.current = { ...context.current, version: workspace.stateVersion, viewKey: workspace.state?.viewKey };
      own.current--; rebased();
    });
  };
  const layer = state && findLayer(state.layers, state.activeLayer), request = selectionRequest(kind, kind === "refine" ? { ...values, edgeBrushes: brushes } : values, { width: document.width, height: document.height, hasSelection: state?.hasSelection === true, layer });
  const valid = !request.problem && sameContext && (!brushes.length || edgeBrushSupported), previewAllowed = document.width * document.height <= 16_777_216;
  const preview = usePhotoCommandPreview(document, projectId, request.command, request.params, { automatic: live, enabled: !busy && valid && previewAllowed, viewKey: state?.viewKey, selectionView: view });
  const cancelBrush = () => {
    const pointer = brushPointer.current; brushPointer.current = null; draft.current = null; setBrushDraft(null);
    if (pointer !== null && brushImage.current?.hasPointerCapture?.(pointer)) brushImage.current.releasePointerCapture(pointer);
    brushLease.current?.(); brushLease.current = null;
  };
  useEffect(() => () => { brushLease.current?.(); brushLease.current = null; }, []);
  const cancelOrClose = () => {
    if (draft.current) { cancelBrush(); return; }
    const revert = selectAndMaskRevert(base.current, usePhotoWorkspace.getState().state, edited.current);
    if (revert) void runPhotoCommand(...revert).catch(() => {});
    close();
  };
  const dialog = useDesignDialog<HTMLFormElement>(cancelOrClose, busy);
  const brushValid = Number.isFinite(brushSize) && brushSize >= 1 && brushSize <= 5000, quickSize = Number(values.quickSize), quickValid = Number.isFinite(quickSize) && quickSize >= 1 && quickSize <= 5000;
  const paintSize = Number(values.brushToolSize), paintHardness = Number(values.brushToolHardness), paintValid = Number.isFinite(paintSize) && paintSize >= 1 && paintSize <= 5000 && Number.isFinite(paintHardness) && paintHardness >= 0 && paintHardness <= 100;
  const brushPointCount = brushes.reduce((count, brush) => count + brush.points.length, 0);
  const appendBrushPoint = (event: PointerEvent<HTMLImageElement>) => {
    if (!draft.current || brushPointer.current !== (event.pointerId ?? 0)) return;
    const point = selectionSamplePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), document.width, document.height);
    if (!point || draft.current.points.at(-1)?.every((value, axis) => value === point[axis])) return;
    if ((tool === "edge" ? brushPointCount : 0) + draft.current.points.length >= MAX_EDGE_BRUSH_POINTS) { cancelBrush(); setLocalError(tool === "edge" ? "Use at most 8192 edge brush points before applying." : `Use at most 8192 points in one ${tool === "quick" ? "Quick Selection" : "Brush Tool"} stroke.`); return; }
    draft.current = { ...draft.current, points: [...draft.current.points, point] }; setBrushDraft(draft.current);
  };
  const finishBrush = (event: PointerEvent<HTMLImageElement>) => {
    if (!draft.current || brushPointer.current !== (event.pointerId ?? 0)) return;
    appendBrushPoint(event); const finished = draft.current, kept = !!finished && currentContext() && !busy;
    if (kept && tool === "edge") setBrushes(current => [...current, finished]);
    cancelBrush();
    if (kept && tool === "quick") edit("select.quick", quickSelectionParams(finished.points, finished.size, finished.erase ? "subtract" : "add", values.sampleAllLayers === true));
    if (kept && tool === "brush") edit("select.brush", brushSelectionParams(finished.points, finished.size, paintHardness, finished.erase ? "subtract" : "add"));
  };
  const change = (key: string, value: unknown) => { setValues(current => ({ ...current, [key]: value })); setLocalError(""); };
  const number = (field: SelectionNumber) => {
    const value = typeof values[field.key] === "number" && Number.isFinite(values[field.key]) ? Number(values[field.key]) : null;
    const slider = value === null ? field.min : Math.max(field.min, Math.min(field.max, Number((field.min + Math.round((value - field.min) / field.step) * field.step).toPrecision(12))));
    const [, name, unit] = field.label.match(/^(.*?) \((.+)\)$/) ?? [, field.label, undefined];
    return <div key={field.key} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{title(name!)}:</span><input aria-label={`Selection ${field.label}`} type="number" required min={field.min} max={field.max} step="any" value={value ?? ""} disabled={busy} onChange={event => change(field.key, event.target.valueAsNumber)}/>{unit && <span className="xd-ps-dialog-unit">{unit}</span>}</label><input aria-label={`Selection ${field.label} slider`} type="range" min={field.min} max={field.max} step={field.step} value={slider} disabled={busy} onChange={event => change(field.key, event.target.valueAsNumber)}/></div>;
  };
  const toggle = (key: string, name: string) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label={`Selection ${name}`} type="checkbox" disabled={busy} checked={values[key] === true} onChange={event => change(key, event.target.checked)}/>{title(name)}</label></div>;
  const select = (key: string, name: string, choices: string[], selected = String(values[key])) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{title(name)}:</span><select aria-label={`Selection ${name}`} disabled={busy} value={selected} onChange={event => change(key, event.target.value)}>{choices.map(value => <option value={value} key={value}>{label(value)}</option>)}</select></label></div>;
  const reset = () => { cancelBrush(); setBrushes([]); setValues(structuredClone(opening.values)); setBrushSize(opening.brushSize); setView(opening.view); setLocalError(""); };
  const output = effectiveSelectionOutput(values), shown = live && !!preview.url, previewURL = shown && preview.url ? preview.url : convertFileSrc(document.previewPath);
  return <PhotoDialog noValidate dialog={dialog} title={SELECTION_TITLES[kind]} className="xd-photo-special-dialog xd-photo-selection-dialog" busy={busy} okDisabled={!valid || !!brushDraft} close={cancelOrClose} reset={reset} preview={{ checked: live, disabled: busy || !previewAllowed || !valid || !!brushDraft, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (busy || !valid || draft.current) return;
    if (!currentContext()) { setLocalError("The image changed. Reopen this selection workflow."); return; }
    setLocalError(""); void runPhotoCommand(request.command, request.params).then(() => {
      const fold = selectAndMaskFold(base.current, usePhotoWorkspace.getState().state, edited.current);
      return fold ? runPhotoCommand(...fold).catch(() => {}) : undefined;
    }).then(() => {
      const notice = saveSelectionPreferences(kind, remember, values, view, brushSize);
      if (notice) usePhotoWorkspace.setState({ error: notice });
      close();
    }).catch(error => setLocalError(String(error)));
  }}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview">
      {kind === "refine" && <div className="xd-photo-preview-actions xd-photo-selection-tools" role="toolbar" aria-label="Select and Mask tools">{SELECT_AND_MASK_TOOLS.map(entry => <button key={entry.id} type="button" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} disabled={busy || !!brushDraft || (entry.id === "edge" && !edgeBrushSupported)} onClick={() => setTool(entry.id)}>{entry.label.replace(/ Tool$/, "")}</button>)}<SelectionModeCluster value={mode} modes={["add", "subtract"]} disabled={busy || !!brushDraft} change={next => setMode(next as SelectAndMaskMode)}/>{tool === "brush" ? <><label>Size:<input aria-label="Selection brush tool size" type="number" min="1" max="5000" step="1" value={Number.isFinite(paintSize) ? paintSize : ""} disabled={busy || !!brushDraft} onChange={event => change("brushToolSize", event.target.valueAsNumber)}/>px</label><label>Hardness:<input aria-label="Selection brush tool hardness" type="number" min="0" max="100" step="1" value={Number.isFinite(paintHardness) ? paintHardness : ""} disabled={busy || !!brushDraft} onChange={event => change("brushToolHardness", event.target.valueAsNumber)}/>%</label></> : <label>Size:<input aria-label="Selection quick selection size" type="number" min="1" max="5000" step="1" value={Number.isFinite(quickSize) ? quickSize : ""} disabled={busy || !!brushDraft} onChange={event => change("quickSize", event.target.valueAsNumber)}/>px</label>}<button type="button" disabled={busy || !!brushDraft} onClick={() => edit("select.subject", { sampleAllLayers: values.sampleAllLayers === true })}>Select Subject</button><button type="button" disabled={busy || !!brushDraft || state?.hasSelection !== true} onClick={() => edit("select.inverse", {})}>Invert</button></div>}
      <div className="xd-photo-selection-image"><img ref={brushImage} src={previewURL} alt={`${SELECTION_TITLES[kind]} ${shown ? `${view} preview` : "source image"}`} draggable={false} style={{ cursor: kind === "refine" ? "crosshair" : undefined, touchAction: kind === "refine" ? "none" : undefined }} onPointerDown={event => {
        if (busy || event.button !== 0 || !currentContext()) return; const point = selectionSamplePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), document.width, document.height);
        if (kind === "refine") {
          const edge = tool === "edge";
          if (!point || draft.current || (tool === "quick" ? !quickValid : tool === "brush" ? !paintValid : !brushValid || !valid || !edgeBrushSupported)) return;
          if (edge && (brushes.length >= MAX_EDGE_BRUSH_STROKES || brushPointCount >= MAX_EDGE_BRUSH_POINTS)) { setLocalError("Apply or clear the edge strokes before drawing more."); return; }
          event.preventDefault(); draft.current = edge ? { size: brushSize, erase: event.altKey || brushErase, points: [point] } : { size: tool === "quick" ? quickSize : paintSize, erase: strokeMode(mode, event.altKey) === "subtract", points: [point] }; brushPointer.current = event.pointerId ?? 0; setBrushDraft(draft.current); setLocalError("");
          brushLease.current = beginXDesignActivity("photo-operation", "Finish or cancel the selection edge stroke before switching projects or disabling XDesign.");
          event.currentTarget.setPointerCapture?.(event.pointerId); return;
        }
      }} onPointerMove={appendBrushPoint} onPointerUp={finishBrush} onPointerCancel={event => { if (brushPointer.current === (event.pointerId ?? 0)) cancelBrush(); }} onLostPointerCapture={event => { if (brushPointer.current === (event.pointerId ?? 0)) cancelBrush(); }}/>
      {brushDraft && <svg aria-hidden="true" viewBox={`0 0 ${document.width} ${document.height}`} preserveAspectRatio="xMidYMid meet"><polyline points={[...brushDraft.points, brushDraft.points.at(-1)!].map(point => point.map(value => value + .5).join(",")).join(" ")} fill="none" stroke={brushDraft.erase ? "var(--neon-magenta)" : "var(--t-primary)"} opacity=".35" strokeWidth={brushDraft.size} strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>View:</span><select aria-label="Selection preview view" value={view} disabled={busy} onChange={event => setView(event.target.value as SelectionPreviewView)}>{(["mask", "overlay", "black", "white", "transparent", "result"] as const).map(value => <option key={value} value={value}>{value === "mask" ? "Black and white mask" : value === "result" ? "Result image" : label(value)}</option>)}</select></label></div></div>
      {!previewAllowed && <p role="status">Temporary selection previews support images up to 16 megapixels. Apply uses the native editing limits.</p>}
      {kind === "refine" && <>{!edgeBrushSupported && <p role="status">Edge brushing requires the updated XDesign image engine.</p>}<div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Edge Brush Size:</span><input aria-label="Selection edge brush size" type="number" min="1" max="5000" step="1" value={Number.isFinite(brushSize) ? brushSize : ""} disabled={busy || !!brushDraft || !edgeBrushSupported} onChange={event => setBrushSize(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">px</span></label></div><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Erase selection refinements" type="checkbox" checked={brushErase} disabled={busy || !!brushDraft || !edgeBrushSupported} onChange={event => setBrushErase(event.target.checked)}/>Erase Refinements</label></div></div><div className="xd-photo-preview-actions"><button type="button" disabled={busy || !!brushDraft || !brushes.length} onClick={() => setBrushes(current => current.slice(0, -1))}>Undo edge stroke</button><button type="button" disabled={busy || !!brushDraft || !brushes.length} onClick={() => setBrushes([])}>Clear edge strokes</button><span role="status">{brushDraft ? "Drawing edge stroke…" : `${brushes.length} edge strokes`}</span></div><fieldset className="xd-ps-dialog-group" disabled={busy || !!brushDraft || !edgeBrushSupported}><legend>Edge brush coordinates</legend><div className="xd-ps-dialog-grid">{["X", "Y"].map((axis, index) => <div key={axis} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{axis}:</span><input aria-label={`Selection edge ${axis}`} type="number" min="0" max={(index ? document.height : document.width) - 1} step="1" value={Number.isFinite(index ? sampleY : sampleX) ? index ? sampleY : sampleX : ""} onChange={event => (index ? setSampleY : setSampleX)(event.target.valueAsNumber)}/><span className="xd-ps-dialog-unit">px</span></label></div>)}</div><button type="button" disabled={!edgeBrushSupported || !brushValid || !Number.isInteger(sampleX) || !Number.isInteger(sampleY) || sampleX < 0 || sampleY < 0 || sampleX >= document.width || sampleY >= document.height || brushes.length >= MAX_EDGE_BRUSH_STROKES || brushPointCount >= MAX_EDGE_BRUSH_POINTS} onClick={() => { setBrushes(current => [...current, { size: brushSize, erase: brushErase, points: [[sampleX, sampleY]] }]); }}>Brush at coordinate</button></fieldset></>}
      {preview.error && <p role="alert">{preview.error}</p>}
    </div><div className="xd-photo-special-controls"><div className="xd-ps-dialog-grid has-sliders">
      {kind === "refine" ? <>{REFINE_FIELDS.map(number)}{toggle("smartRadius", "Smart radius")}{toggle("sampleAllLayers", "Sample all layers")}{toggle("decontaminate", "Decontaminate colors")}{values.decontaminate === true && number({ key: "amount", label: "Decontamination (%)", min: 0, max: 100, step: .1 })}{select("output", "Output to", values.decontaminate === true ? ["newLayer", "newLayerWithMask"] : SELECTION_OUTPUTS, output)}</> : <>{FOCUS_FIELDS.map(number)}{toggle("sampleAllLayers", "Sample all layers")}{select("mode", "Mode", SELECTION_MODES)}</>}
    </div>{kind === "refine" && values.decontaminate === true && <p className="xd-photo-section-help">Decontamination creates a new layer. The native output retains the source layer.</p>}
    </div></div>
    {(request.problem || localError || workspaceError) && <p role="alert">{localError || request.problem || workspaceError}</p>}
    <label className="xd-ps-dialog-check"><input aria-label="Remember selection settings" type="checkbox" checked={remember} disabled={busy || !preferences.writable} onChange={event => setRemember(event.target.checked)}/>Remember Settings After OK</label>{preferences.notice && <p role="status">{preferences.notice}</p>}
  </PhotoDialog>;
}
