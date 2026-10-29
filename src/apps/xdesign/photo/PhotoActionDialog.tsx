import { LensGeometryEditor } from "./LensGeometryEditor";
import { BlurGeometryEditor } from './BlurGeometryEditor';
import { blurGeometryMode, readBlurGeometry } from './blurGeometry';
import { validAdaptiveWideAngleSettings, validLensLine } from "./lensFilters";
import { FilterStructuredOptions, structuredFilterOverrides } from './FilterStructuredOptions';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { ADJUSTMENTS, type PhotoAction } from "./controls";
import { FilterThumbnail } from "./FilterThumbnail";
import { AdjustmentPresetRow } from "./AdjustmentPresetRow";
import { AdjustmentControls, controlKit, CurveEditor, rgbHex } from "./actionControls";
import { PS_SLIDER_ACTIONS } from "./psSliders";
import { adjustmentCommand, adjustmentDefaults, hasFiniteSettings } from "./adjustmentSettings";
import { gradientMapParams, gradientMapValues } from "./gradientMethod";
import { usePhotoCommandPreview } from "./commandPreview";
import { useImageViewPreview } from "./imageView";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PlaneTarget } from "./toneControls";
import type { PhotoDocument, PhotoLayer } from "./types";
import { FIT_BLUR_VIEW, type BlurViewport } from './blurViewport';
import { photoPreviewRegions } from './previewRegions';

type Settings = Record<string, unknown>;
export { CurveEditor };
// Photoshop keeps each command's last values for the session; a different project starts from the defaults again.
const remembered = new Map<string, Settings>(); let rememberedProject: unknown;
const NOT_REMEMBERED = new Set(["foreground", "background", "file", "data", "lut"]);
export const forgetRememberedValues = () => { remembered.clear(); rememberedProject = undefined; };
function recall(action: PhotoAction, projectId: unknown, defaults: Settings): Settings {
  if (rememberedProject !== projectId) { remembered.clear(); rememberedProject = projectId; }
  const usable = (key: string, value: unknown) => {
    const base = defaults[key], field = action.fields?.find(item => item.key === key), option = action.options?.find(item => item.key === key);
    if (typeof value !== typeof base || Array.isArray(value) !== Array.isArray(base)) return false;
    if (field) return typeof value === "number" && value >= field.min && value <= field.max;
    return !option?.choices || option.choices.includes(value as string);
  };
  return Object.fromEntries(Object.entries(remembered.get(action.id) ?? {}).filter(([key, value]) => key in defaults && usable(key, value)));
}
function remember(action: PhotoAction, projectId: unknown, values: Settings) {
  if (rememberedProject !== projectId) { remembered.clear(); rememberedProject = projectId; }
  remembered.set(action.id, Object.fromEntries(Object.entries(values).filter(([key]) => !NOT_REMEMBERED.has(key) && key !== action.file?.key)));
}
const object = (value: unknown): Settings => value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};
type SmartBlurInput = { png: string; mode: 'source' | 'cache'; bounds: { x: number; y: number; width: number; height: number }; stackEnabled?: boolean; revision: number };
function smartBlurInput(value: unknown, document: PhotoDocument): Omit<SmartBlurInput, 'revision'> | null {
  const metadata = object(value), input = object(metadata.input), bounds = metadata.bounds, factor = Math.max(1, Math.ceil(Math.max(document.width, document.height) / 2048));
  if ((metadata.mode !== 'source' && metadata.mode !== 'cache') || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(value => Number.isSafeInteger(value)) || bounds[0] < -0x8000_0000 || bounds[0] > 0x7fff_ffff || bounds[1] < -0x8000_0000 || bounds[1] > 0x7fff_ffff || bounds[2] <= 0 || bounds[2] > 0xffff_ffff || bounds[3] <= 0 || bounds[3] > 0xffff_ffff || metadata.mode === 'source' && JSON.stringify(bounds) !== JSON.stringify([0, 0, document.width, document.height]) || input.width !== document.width || input.height !== document.height || input.pixelWidth !== Math.ceil(document.width / factor) || input.pixelHeight !== Math.ceil(document.height / factor) || typeof input.png !== 'string' || !input.png.length || input.png.length > 24 * 1024 * 1024) return null;
  try {
    const header = atob(input.png.slice(0, 44)), dimension = (start: number) => [0, 1, 2, 3].reduce((value, index) => value * 256 + header.charCodeAt(start + index), 0);
    if (!header.startsWith('\x89PNG\r\n\x1a\n') || header.slice(12, 16) !== 'IHDR' || dimension(16) !== input.pixelWidth || dimension(20) !== input.pixelHeight) return null;
  } catch { return null; }
  return { png: input.png, mode: metadata.mode, bounds: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }, ...(typeof metadata.stackEnabled === 'boolean' ? { stackEnabled: metadata.stackEnabled } : {}) };
}

const settle = (work: Promise<unknown>) => work.then(() => {}, () => {});

export function PhotoActionDialog({ action, adjustment, layer, document, canvas = null, onClose, untilShown = settle }: { action: PhotoAction; adjustment: boolean; layer?: PhotoLayer; document: PhotoDocument; canvas?: HTMLElement | null; onClose: () => void; untilShown?: (work: Promise<unknown>) => Promise<void> }) {
  const busy = usePhotoWorkspace(state => state.busy), projectId = usePhotoWorkspace(state => state.projectId), workspaceError = usePhotoWorkspace(state => state.error), mode = usePhotoWorkspace(state => state.state?.mode ?? "RGB");
  const geometry = !!blurGeometryMode(action) || action.structured === "lens" || action.structured === "wide";
  // Other dialogs preview on the canvas, which already shows the image view.
  const imageState = usePhotoWorkspace(state => state.state), view = useImageViewPreview(geometry ? document : null, projectId, imageState);
  const defaults = adjustmentDefaults(action, mode, layer?.adjustmentParams);
  if (action.id.startsWith("filter.")) for (const key of ["foreground", "background"] as const) if (action.options?.some(option => option.key === key) && imageState?.tools?.[key]) defaults[key] = structuredClone(imageState.tools[key]);
  if (action.id === "gradientMap" && !layer?.adjustmentParams && imageState?.tools?.foreground && imageState.tools.background) defaults.stops = [[0, rgbHex(imageState.tools.foreground, "#000000")], [1, rgbHex(imageState.tools.background, "#ffffff")]];
  const canRemember = !layer && !adjustment && !geometry && !action.structured;
  const [opening] = useState<Settings>(() => {
    const initial = { ...defaults, ...(canRemember ? structuredClone(recall(action, projectId, defaults)) : {}), ...structuredClone(layer?.adjustmentParams ? action.id === "gradientMap" ? gradientMapValues(layer.adjustmentParams) : layer.adjustmentParams : {}) };
    // Native parameter descriptions omit the table itself. An imported LUT must stay embedded until the user replaces it.
    if (layer && action.id === "colorLookup") delete initial.lut;
    return initial;
  });
  const [values, setValues] = useState<Settings>(() => structuredClone(opening));
  const [channel, setChannel] = useState(""), [range, setRange] = useState(action.id === "colorBalance" ? "midtones" : action.id === "hueSaturation" ? "master" : "reds");
  // The native preview reduces large images for adjustments, which look the same smaller; filters measure in pixels.
  const previewAllowed = document.width * document.height <= 16_777_216 || ADJUSTMENTS.some(entry => entry.id === action.id);
  const [live, setLive] = useState(isTauri() && previewAllowed), [localError, setLocalError] = useState(""), [loadingFile, setLoadingFile] = useState(false);
  const command = adjustmentCommand(action, adjustment, layer?.id), params: Settings = { ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)), ...(layer ? { layer: layer.id } : {}) };
  const blurMode = blurGeometryMode(action), blurReady = !blurMode || !!readBlurGeometry(blurMode, values);
  if (action.id === "channelMixer" && !values.monochrome) delete params.gray;
  if (action.id === "gradientMap") { const baked = gradientMapParams(values); delete params.method; params.stops = baked.stops; }
  const finite = hasFiniteSettings(values), mapReady = !action.file || typeof values[action.file.key] === "string" && !!String(values[action.file.key]).trim();
  const galleryReady = action.structured !== "gallery" || Array.isArray(values.effects) && values.effects.some(effect => object(effect).visible !== false);
  const geometryReady = action.structured === "wide" ? validAdaptiveWideAngleSettings(values, document.width, document.height) : action.structured !== "lens" || values.straighten === undefined || validLensLine(values.straighten, document.width, document.height);
  const pendingLayers = [...imageState?.layers ?? []]; let smartTarget = false, rasterMask = false;
  while (pendingLayers.length) { const candidate = pendingLayers.pop()!; if (candidate.id === (layer?.id ?? imageState?.activeLayer)) { smartTarget = !!candidate.smartObject; rasterMask = candidate.hasMask; break; } pendingLayers.push(...candidate.children ?? []); }
  const maskTarget = params.target === "mask" || params.target === undefined && rasterMask && imageState?.layerMaskView?.layer === imageState?.activeLayer && (imageState?.channels?.target?.kind ?? "composite") === "composite" && !imageState?.quickMask && !imageState?.channels?.quickMask;
  const channelTarget = params.target === "quickMask" || params.target !== null && typeof params.target === "object" && typeof (params.target as Record<string, unknown>).channel === "number" || params.target === undefined && (imageState?.channels?.target?.kind === "alpha" || (imageState?.channels?.target?.kind ?? "composite") === "composite" && (!!imageState?.quickMask || !!imageState?.channels?.quickMask));
  const smartPixels = smartTarget && !maskTarget && !channelTarget;
  // Levels, Curves and Threshold read a mask, Quick Mask or alpha channel through the target the commit edits; the other samplers read only the image's colours.
  const imagePixels = !!layer || adjustment || !maskTarget && !channelTarget;
  const planeTarget = imagePixels || !["levels", "curves", "threshold"].includes(action.id) ? undefined : (params.target ?? (maskTarget ? "mask" : imageState?.channels?.target?.kind === "alpha" ? { channel: imageState.channels.target.index } : "quickMask")) as PlaneTarget;
  const interpolationReady = action.structured !== "wide" || !smartPixels || values.interpolation === "bicubic";
  const valid = finite && mapReady && galleryReady && geometryReady && interpolationReady && blurReady;
  const ordinarySmartBlur = !!blurMode && smartPixels;
  const galleryIdentity = JSON.stringify([projectId, document.id, document.version, document.width, document.height, action.id, layer?.id ?? imageState?.activeLayer, imageState?.viewKey, params.target, imageState?.channels?.target, imageState?.layerMaskView, imageState?.quickMask, imageState?.channels?.quickMask, imageState?.hasSelection, imageState?.selectionBounds, ordinarySmartBlur]);
  const capturedGallery = useRef(galleryIdentity), currentGallery = useRef(galleryIdentity), guardedGallery = useRef(false), submitting = useRef(false), mounted = useRef(true);
  currentGallery.current = galleryIdentity; if (ordinarySmartBlur) guardedGallery.current = true;
  const staleGallery = guardedGallery.current && capturedGallery.current !== galleryIdentity;
  const [applying, setApplying] = useState(false), [held, setHeld] = useState<string | null>(null), [input, setInput] = useState<SmartBlurInput | null>(null), [toolSlot, setToolSlot] = useState<HTMLDivElement | null>(null);
  const locked = busy || loadingFile || staleGallery || applying, lockedRef = useRef(locked); lockedRef.current = locked;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (staleGallery) { setInput(null); onClose(); } }, [staleGallery, onClose]);
  const dialog = useDesignDialog<HTMLFormElement>(onClose, locked);
  const change = (key: string, value: unknown) => { if (!lockedRef.current) setValues(current => ({ ...current, [key]: value })); };
  const blurBounds = ordinarySmartBlur ? input?.bounds : imageState?.hasSelection && imageState.selectionBounds ? { x: imageState.selectionBounds[0], y: imageState.selectionBounds[1], width: imageState.selectionBounds[2], height: imageState.selectionBounds[3] } : undefined;
  const blurSourceKey = JSON.stringify([projectId, document.id, document.version, document.width, document.height, imageState?.activeLayer, imageState?.viewKey, blurBounds, blurMode, ...(ordinarySmartBlur ? [input?.mode] : [])]);
  const [detailView, setDetailView] = useState({ source: '', viewport: FIT_BLUR_VIEW, frame: { width: 0, height: 0 }, pixelRatio: 1 });
  const changedView = useCallback((viewport: BlurViewport, frame: { width: number; height: number }, pixelRatio: number) => {
    const next = { source: blurSourceKey, viewport, frame, pixelRatio }; setDetailView(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, [blurSourceKey]);
  const regions = blurMode && (!ordinarySmartBlur || !!input) && detailView.source === blurSourceKey ? photoPreviewRegions(document, detailView.viewport, detailView.frame, detailView.pixelRatio) : undefined;
  const preview = usePhotoCommandPreview(document, projectId, command, params, { automatic: live, enabled: !locked && valid && previewAllowed, viewKey: imageState?.viewKey, regions, cancelable: imageState?.canCancelPreview === true, ordinarySmartBlur: ordinarySmartBlur ? true : undefined });
  const inputResult = object(object(preview.result).blurEdit);
  useEffect(() => { if (ordinarySmartBlur && !staleGallery) {
    const next = smartBlurInput(object(preview.result).blurEdit, document);
    if (next) setInput(current => current?.png === next.png && current.mode === next.mode && current.stackEnabled === next.stackEnabled && JSON.stringify(current.bounds) === JSON.stringify(next.bounds) ? current : { ...next, revision: (current?.revision ?? 0) + (current?.png === next.png ? 0 : 1) });
  } }, [preview.result, ordinarySmartBlur, staleGallery, document.width, document.height]);
  const override = structuredFilterOverrides(action, values);
  const fields = (action.fields ?? []).filter(field => !override.has(field.key));
  const anyStep = !!blurMode;
  const kit = controlKit({ action, values, change, locked, anyStep, ps: PS_SLIDER_ACTIONS.has(action.id) }),{ toggle, color, enumeration } = kit;
  const reset = () => { if (lockedRef.current) return; setValues(structuredClone(opening)); setChannel(""); setLocalError(""); };
  let controls: ReactNode = <AdjustmentControls action={action} values={values} setValues={setValues} change={change} locked={locked} mode={mode} layer={layer} fields={fields} anyStep={anyStep} channel={channel} setChannel={setChannel} range={range} setRange={setRange} loadingFile={loadingFile} setLoadingFile={setLoadingFile} setLocalError={setLocalError} source={planeTarget ? { document, layer: imageState?.activeLayer ?? undefined, below: false, target: planeTarget } : !imagePixels ? undefined : layer ? { document, layer: layer.id, below: true } : adjustment ? { document, below: true } : { document, layer: imageState?.activeLayer ?? undefined, below: false }} canvas={imagePixels || planeTarget ? canvas : null} toolSlot={toolSlot} psSliders={PS_SLIDER_ACTIONS.has(action.id)}/>;
  if (action.id.startsWith("filter.")) controls = <>{(action.structured === "lens" || action.structured === "wide") && <LensGeometryEditor wide={action.structured === "wide"} values={values} width={document.width} height={document.height} curves={object(preview.result).curves} image={view.active ? view.url ?? "" : convertFileSrc(document.previewPath)} disabled={locked || view.active && !view.url} change={change}/>} {controls}{action.options?.filter(option => !override.has(option.key)).map(option => <Fragment key={option.key}>{option.kind === "boolean" ? toggle(option.key, option.label, undefined, option.text) : option.kind === "color" ? color(option.key, option.label, String(option.value), option.text) : enumeration(option, option.key === "interpolation" && action.structured === "wide" && smartPixels ? ["bicubic"] : option.choices ?? [])}</Fragment>)}{action.file && <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{action.file.label}:</span><button type="button" disabled={locked} onClick={() => { const context = currentGallery.current, field = action.file!.key; setLoadingFile(true); setLocalError(""); void open({ multiple: false, filters: [{ name: action.file!.label, extensions: action.file!.extensions }] }).then(file => { if (typeof file === "string" && mounted.current && currentGallery.current === context) setValues(current => ({ ...current, [field]: file })); }).catch(error => { if (mounted.current && currentGallery.current === context) setLocalError(String(error)); }).finally(() => { if (mounted.current) setLoadingFile(false); }); }}>{values[action.file.key] ? String(values[action.file.key]).split(/[\\/]/).at(-1) : "Choose displacement map…"}</button></label></div>}{action.structured === "wide" && smartPixels && <p className="xd-photo-section-help">Smart Objects use bicubic interpolation.</p>}<FilterStructuredOptions action={action} values={values} disabled={locked} change={change}/></>;
  controls = <div className="xd-ps-dialog-grid has-sliders xd-photo-action-grid">{controls}</div>;
  const thumbnail = action.id.startsWith("filter.") && !action.structured && <FilterThumbnail src={live && preview.url ? preview.url : convertFileSrc(document.previewPath)} width={document.width} height={document.height} label={action.label}/>;
  const notes = <>{!previewAllowed && <p className="xd-photo-section-help">Apply renders this large image at full resolution.</p>}{preview.error && <p role="alert">{preview.error}</p>}</>;
  return <PhotoDialog dialog={dialog} title={action.label} className={geometry ? "xd-photo-special-dialog" : "xd-photo-action-dialog"} beside={!geometry} busy={locked} okDisabled={!valid} close={onClose} reset={reset} buttons={["levels", "curves", "brightnessContrast", "exposure", "blackWhite"].includes(action.id) ?<div ref={setToolSlot} className="xd-photo-tone-tools"/> : undefined} preview={{ checked: live, disabled: locked || !previewAllowed, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => { event.preventDefault(); if (lockedRef.current || !valid || !event.currentTarget.checkValidity() || guardedGallery.current && (submitting.current || currentGallery.current !== capturedGallery.current)) return; if (guardedGallery.current) submitting.current = true; setApplying(true); setHeld(live ? preview.url : null); setLocalError(""); const work = runPhotoCommand(command, params), displayed = untilShown(work); void work.then(() => { if (canRemember) remember(action, projectId, values); return displayed; }).then(() => { if (!mounted.current) return; if (!guardedGallery.current) { setApplying(false); setHeld(null); onClose(); } else if (currentGallery.current === capturedGallery.current) onClose(); }).catch(error => { if (mounted.current) { submitting.current = false; setApplying(false); setHeld(null); setLocalError(String(error)); } }); }}>
    {geometry ? <div className="xd-photo-special-body"><div className="xd-photo-special-preview">{ordinarySmartBlur ? <><img src={live && preview.url ? preview.url : view.active ? view.url ?? undefined : convertFileSrc(document.previewPath)} alt="Full image preview"/><p className="xd-photo-section-help">Input when this filter runs</p>{input && blurMode && !staleGallery ? <BlurGeometryEditor mode={blurMode} label={action.label} values={values} width={document.width} height={document.height} bounds={input.bounds} sourceKey={blurSourceKey} interactionKey={String(input.revision)} viewChange={changedView} tiles={object(inputResult.input).png === input.png && inputResult.mode === input.mode && JSON.stringify(inputResult.bounds) === JSON.stringify([input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height]) ? preview.inputTiles : []} image={`data:image/png;base64,${input.png}`} disabled={locked} change={patch => { if (!lockedRef.current) setValues(current => ({ ...current, ...patch })); }}/>: <p role="status">{previewAllowed ? live ? 'Loading the Smart Object input…' : 'Turn on Preview to edit geometry on the Smart Object input.' : 'Geometry preview is unavailable above 16 megapixels. Numeric filter settings remain editable.'}</p>}{input?.mode === 'cache' && <p className="xd-photo-section-help">The source is unavailable. Geometry uses cached Smart Object pixels and the current selection.</p>}{input?.mode === 'source' && input.stackEnabled === false && <p className="xd-photo-section-help">Geometry shows all prior filters enabled. The full image preview keeps the stack visibility.</p>}</> : blurMode ? <BlurGeometryEditor mode={blurMode} label={action.label} values={values} width={document.width} height={document.height} bounds={blurBounds} sourceKey={blurSourceKey} viewChange={changedView} tiles={live ? preview.tiles : preview.originalTiles} image={live && preview.url ? preview.url : view.active ? view.url ?? '' : convertFileSrc(document.previewPath)} disabled={locked || view.active && !view.url} change={patch => setValues(current => ({ ...current, ...patch }))}/> : <img src={live && preview.url ? preview.url : view.active ? view.url ?? undefined : convertFileSrc(document.previewPath)} alt={`${action.label} preview`}/>}{view.active&&!view.url&&<p role="status">{view.error??"Rendering image view…"}</p>}{notes}</div><div className="xd-photo-special-controls">{controls}</div></div> : <><div className="xd-photo-action-controls">{thumbnail}{!action.id.startsWith("filter.") && <AdjustmentPresetRow action={action} mode={mode} values={values} locked={locked} apply={next => { if (!lockedRef.current) setValues(next); }} fail={setLocalError}/>}{controls}</div>{notes}</>}
    {!geometryReady && <p role="alert">Use distinct line endpoints inside the original image.</p>}{!interpolationReady && <p role="alert">Choose bicubic interpolation for this Smart Object.</p>}{!finite && <p role="alert">Enter a number in every field.</p>}{!mapReady && <p role="status">Choose a displacement map before previewing or applying this filter.</p>}{!galleryReady && <p role="status">Add or enable a gallery effect before previewing or applying.</p>}{(localError || workspaceError) && <p role="alert">{localError || workspaceError}</p>}{!geometry && canvas && (held ?? (live && preview.url)) && createPortal(<img className="xd-photo-canvas-preview" src={held ?? preview.url!} alt="" draggable={false}/>, canvas)}
  </PhotoDialog>;
}
