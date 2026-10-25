import type { PhotoColor, PhotoState } from "./types";
import { BLEND_MODES } from "./controls";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { PopupSlider } from "./OptionsBarControls";
import { GRADIENT_METHODS } from "./gradientMethod";

type Field = { key: string; label: string; value: number | string | boolean; min?: number; max?: number; choices?: string[] };
const number = (key: string, label: string, value: number, min = 0, max = 100): Field => ({ key, label, value, min, max });
const choice = (key: string, label: string, value: string, choices: string[]): Field => ({ key, label, value, choices });
const toggle = (key: string, label: string, value: boolean): Field => ({ key, label, value });
const sample = choice("sampleLayer", "Sample", "current", ["current", "currentAndBelow", "all"]);
const sampleAll = toggle("sampleAllLayers", "Sample all layers", false);
const strength = number("strength", "Strength (%)", 50, 1);
const blend = choice("mode", "Blend", "Normal", BLEND_MODES);
const spacing = number("spacing", "Spacing (%)", 25, 1, 1000);
const eraserMode = choice("eraserMode", "Mode", "brush", ["brush", "pencil", "block"]);
const smoothing = number("smoothing", "Smoothing (%)", 0);
const brush = [number("flow", "Flow (%)", 100), number("spacing", "Spacing (%)", 10, 1, 1000), smoothing];
const retouch = [number("flow", "Flow (%)", 100, 1), spacing];
// Photoshop shows these as popup sliders in the options bar; the rest stay plain fields.
const SPOT_TYPES: Record<string, string> = { contentAware: "Content-Aware", createTexture: "Create Texture", proximityMatch: "Proximity Match" };
const SLIDER_FIELDS = ["flow", "smoothing", "strength", "exposure"];
const sourceTransformKeys = ["sourceWidth", "sourceHeight", "rotation", "flipH", "flipV"];
const clone = [sample, toggle("aligned", "Aligned", true), toggle("transformSource", "Transform source", false), number("sourceWidth", "Source width (%)", 100, 1, 1000), number("sourceHeight", "Source height (%)", 100, 1, 1000), number("rotation", "Source rotation (°)", 0, -180, 180), toggle("flipH", "Flip source horizontally", false), toggle("flipV", "Flip source vertically", false), blend, ...retouch];
const tone = [choice("range", "Range", "midtones", ["shadows", "midtones", "highlights"]), number("exposure", "Exposure (%)", 50, 1), toggle("protectTones", "Protect tones", true)];
const selectionEdge = [number("feather", "Feather (px)", 0, 0, 1000), toggle("antiAlias", "Anti-alias", true)];
const CROP_UNITS = ["px", "in", "cm", "mm"];
const rectangle = [choice("style", "Style", "normal", ["normal", "fixedRatio", "fixedSize"]), number("ratioWidth", "Width", 1, .01, 100000), number("ratioHeight", "Height", 1, .01, 100000), number("fixedWidth", "Width (px)", 100, 1, 100000), number("fixedHeight", "Height (px)", 100, 1, 100000), toggle("fromCenter", "Draw from center", false)];
export const PAINT_TOOL_FIELDS: Record<string, Field[]> = {
  "paint.stroke": [blend, ...brush], "paint.pencil": [blend, ...brush, toggle("autoErase", "Auto erase", false)], "erase": [eraserMode, ...brush, toggle("eraseToHistory", "Erase to History", false)],
  "paint.patch": [choice("mode", "Patch mode", "source", ["source", "destination"])],
  "paint.magicEraser": [number("tolerance", "Tolerance", 32, 0, 255), number("opacity", "Opacity (%)", 100, 1, 100), toggle("antiAlias", "Anti-alias", true), toggle("contiguous", "Contiguous", true), toggle("sampleAllLayers", "Sample all layers", false)],
  "paint.backgroundEraser": [choice("sampling", "Sampling", "continuous", ["continuous", "once", "backgroundSwatch"]), choice("limits", "Limits", "contiguous", ["discontiguous", "contiguous", "findEdges"]), number("tolerance", "Tolerance (%)", 50, 0, 100), toggle("protectForegroundColor", "Protect foreground color", false)],
  "paint.cloneStamp": clone, "paint.healingBrush": clone, "paint.spotHealing": [choice("type", "Type", "contentAware", ["contentAware", "createTexture", "proximityMatch"]), ...retouch],
  "paint.historyBrush": [blend, ...retouch],
  "paint.dodge": [...tone, ...retouch], "paint.burn": [...tone, ...retouch],
  "paint.sponge": [choice("mode", "Mode", "desaturate", ["desaturate", "saturate"]), toggle("vibrance", "Protect vibrance", true), ...retouch],
  "paint.blur": [strength, sampleAll, ...retouch], "paint.sharpen": [strength, toggle("protectDetail", "Protect detail", true), sampleAll, ...retouch],
  "paint.smudge": [strength, toggle("fingerPainting", "Finger painting", false), sampleAll, ...retouch],
  "paint.mixerBrush": [number("wet", "Wet (%)", 50), number("load", "Load (%)", 50), number("mix", "Mix (%)", 50), ...brush, sampleAll, toggle("cleanAfterStroke", "Clean after stroke", true), toggle("loadAfterStroke", "Load after stroke", true)],
  "paint.colorReplacement": [choice("mode", "Mode", "color", ["hue", "saturation", "color", "luminosity"]), choice("sampling", "Sampling", "continuous", ["continuous", "once", "backgroundSwatch"]), choice("limits", "Limits", "contiguous", ["discontiguous", "contiguous", "findEdges"]), number("tolerance", "Tolerance (%)", 30), toggle("antiAlias", "Anti-alias", true), ...brush],
  "paint.bucket": [choice("contents", "Fill", "foreground", ["foreground", "pattern"]), number("scale", "Pattern scale (%)", 100, 1, 1000), number("angle", "Pattern angle", 0, -360, 360), number("tolerance", "Tolerance", 32, 0, 255), toggle("contiguous", "Contiguous", true), toggle("antiAlias", "Anti-alias", true)],
  "paint.gradient": [blend, toggle("dither", "Dither", true), choice("method", "Method", "perceptual", GRADIENT_METHODS.map(([id]) => id))],
  "select.magicWand": [number("tolerance", "Tolerance", 32, 0, 255), toggle("contiguous", "Contiguous", true), toggle("antiAlias", "Anti-alias", true), sampleAll],
  "select.rect": [...rectangle, selectionEdge[0]!], "ellipseSelection": [...rectangle, ...selectionEdge],
  "select.lasso": selectionEdge, "polygonLasso": selectionEdge,
  "magneticLasso": [number("width", "Edge width (px)", 10, 1, 256), number("contrast", "Edge contrast (%)", 10, 1), number("frequency", "Fastening frequency", 57), toggle("stylusPressure", "Use tablet pressure", false), ...selectionEdge],
  "select.quick": [number("size", "Selection brush size (px)", 30, 1, 5000), sampleAll, toggle("enhanceEdge", "Enhance edge", false)],
  "select.object": [...rectangle, sampleAll],
  // A size or resolution of 0 is an empty field; an empty resolution keeps the image's.
  "crop": [choice("style", "Ratio", "normal", ["normal", "fixedRatio", "size"]), number("ratioWidth", "Ratio width", 1, .01, 100000), number("ratioHeight", "Ratio height", 1, .01, 100000),
    number("sizeWidth", "Width", 0, 0, 300000), choice("sizeWidthUnit", "Width unit", "px", CROP_UNITS), number("sizeHeight", "Height", 0, 0, 300000), choice("sizeHeightUnit", "Height unit", "px", CROP_UNITS),
    number("resolution", "Resolution", 0, 0, 100000), choice("resolutionUnit", "Resolution unit", "in", ["in", "cm"]), toggle("deleteCroppedPixels", "Delete Cropped Pixels", false), choice("fill", "Fill", "background", ["background", "contentAware"])],
  "straighten": [choice("scope", "Straighten target", "image", ["image", "layers"])],
};
export const CONTINUOUS_RETOUCH_TOOLS=["paint.cloneStamp","paint.healingBrush","paint.spotHealing","paint.dodge","paint.burn","paint.sponge","paint.blur","paint.sharpen","paint.mixerBrush","paint.colorReplacement","paint.smudge","paint.historyBrush"];
export const RETOUCH_PREVIEW_TOOLS = ["paint.mixerBrush", "paint.colorReplacement", "paint.cloneStamp", "paint.healingBrush", "paint.spotHealing", "paint.dodge", "paint.burn", "paint.sponge", "paint.blur", "paint.sharpen", "paint.smudge","paint.historyBrush","paint.backgroundEraser"];
export const NATIVE_STROKE_TOOLS = ["paint.stroke", "paint.pencil", "erase", "paint.magicEraser", ...RETOUCH_PREVIEW_TOOLS];
const normalizedBrush = ["paint.stroke", "paint.pencil", "erase", "paint.mixerBrush", "paint.colorReplacement", "paint.backgroundEraser"];
export type PaintOptions = Record<string, number | string | boolean>;

export function canonicalBlendMode(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return BLEND_MODES.find(mode => mode.toLowerCase().replace(/[^a-z]/g, "") === key || mode === "Linear Dodge (Add)" && key === "lineardodge");
}
export function sanitizePaintOptions(tool: string, value: unknown): PaintOptions {
  const result: PaintOptions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const field of PAINT_TOOL_FIELDS[tool] ?? []) {
    const raw = (value as Record<string, unknown>)[field.key];
    const next = field === blend ? canonicalBlendMode(raw) : field.key === "rotation" && typeof raw === "number" && Number.isFinite(raw) ? ((raw % 360 + 540) % 360) - 180 : raw;
    if (typeof field.value === "number" && typeof next === "number" && Number.isFinite(next) && next >= field.min! && next <= field.max!
      || typeof field.value === "boolean" && typeof next === "boolean"
      || typeof field.value === "string" && typeof next === "string" && field.choices?.includes(next)) result[field.key] = next as number | string | boolean;
  }
  return result;
}
// The engine keeps these fractions as f32, so 0.1 arrives as 0.10000000149; rounding drops that noise but keeps real fractions like 12.5%.
const percent = (fraction: number) => Math.round(fraction * 1e6) / 1e4;
export function paintToolDefaults(tool: string, state: PhotoState | null): PaintOptions {
  const result = Object.fromEntries((PAINT_TOOL_FIELDS[tool] ?? []).map(field => [field.key, field.value]));
  const settings = state?.brush?.settings;
  if (normalizedBrush.includes(tool)) {
    for (const key of ["flow", "spacing"]) if (typeof settings?.[key] === "number" && Number.isFinite(settings[key]) && !(key === "flow" && tool === "paint.pencil")) result[key] = percent(settings[key]);
    const amount = (settings?.smoothing as Record<string, unknown> | undefined)?.amount;
    if (typeof amount === "number" && Number.isFinite(amount)) result.smoothing = percent(amount);
    if (tool === "paint.stroke" || tool === "paint.pencil") result.mode = canonicalBlendMode(settings?.mode) ?? "Normal";
  }
  if (tool === "paint.mixerBrush") {
    const mixer = state?.brush?.settings.mixer as Record<string, unknown> | undefined;
    for (const key of ["wet", "load", "mix", "flow"]) if (typeof mixer?.[key] === "number" && Number.isFinite(mixer[key])) result[key] = percent(Math.max(0, Math.min(1, mixer[key])));
    if (typeof mixer?.sampleAllLayers === "boolean") result.sampleAllLayers = mixer.sampleAllLayers;
  }
  return { ...Object.fromEntries((PAINT_TOOL_FIELDS[tool] ?? []).map(field => [field.key, field.value])), ...sanitizePaintOptions(tool, result) };
}
export function rebaseBrushOptions(options: Record<string, PaintOptions>): Record<string, PaintOptions> {
  return Object.fromEntries(Object.entries(options).map(([tool, values]) => {
    const removed = normalizedBrush.includes(tool) ? ["flow", "spacing", "smoothing", ...(tool === "paint.stroke" || tool === "paint.pencil" ? ["mode"] : []), ...(tool === "paint.mixerBrush" ? ["wet", "load", "mix", "sampleAllLayers"] : [])] : [];
    return [tool, Object.fromEntries(Object.entries(values).filter(([key]) => !removed.includes(key)))];
  }));
}
export function brushOptionBasis(settings?: Record<string, unknown>): string | null {
  return settings ? JSON.stringify([settings.flow,settings.spacing,settings.mode,(settings.smoothing as Record<string,unknown>|undefined)?.amount,settings.mixer]) : null;
}
export function strokeParameters(tool: string, points: readonly number[][], size: number, opacity: number, hardness: number, color: PhotoColor, zoom: number, seed: number | null, options: PaintOptions, mask: boolean, source: [number, number] | null, offset: [number, number] | null): Record<string, unknown> {
  const normalized = normalizedBrush.includes(tool);
  const params: Record<string, unknown> = { points: [...points], size, opacity: normalized ? opacity : Math.round(opacity * 100), hardness: normalized ? hardness : Math.round(hardness * 100), color, zoom, ...options, ...(mask ? { target: "mask" } : {}), ...(seed !== null ? { seed } : {}), ...(tool === "erase" ? { erase: true } : {}) };
  delete params.eraserMode;
  if (tool === "erase" && options.eraserMode === "pencil") { params.hardness = normalized ? 1 : 100; params.brush = { aliased: true }; }
  // Photoshop's Block eraser is a hard square of fixed screen size.
  if (tool === "erase" && options.eraserMode === "block") { params.size = 16 / zoom; params.hardness = normalized ? 1 : 100; params.brush = { aliased: true, angle: 0, roundness: 1, tip: { sampled: { width: 16, height: 16, data: Array(256).fill(1) } } }; }
  delete params.sourceWidth;
  delete params.sourceHeight;
  delete params.transformSource;
  if (normalized) for (const key of ["flow", "spacing", "smoothing"]) if (typeof options[key] === "number" && !(key === "flow" && tool === "paint.mixerBrush")) params[key] = options[key] / 100;
  if (tool === "paint.cloneStamp" || tool === "paint.healingBrush") {
    // Omitted transforms preserve the active native Clone Source slot.
    if (options.transformSource === true) {
      params.scale = [options.sourceWidth ?? 100, options.sourceHeight ?? 100];
      params.rotation = options.rotation ?? 0;
      params.flipH = options.flipH ?? false;
      params.flipV = options.flipV ?? false;
    } else for (const key of ["scale", "rotation", "flipH", "flipV"]) delete params[key];
    if (options.aligned !== false && offset) params.offset = offset;
    else if (source) params.source = source;
  }
  return params;
}

function NumericField({ field, value, disabled, change }: { field: Field; value: number; disabled: boolean; change: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value), published = useRef<number | null>(null);
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    if (published.current === value) { published.current = null; return; }
    published.current = null;
    setDraft(String(value));
  }, [value]);
  useEffect(() => { if (disabled) setDraft(String(value)); }, [disabled, value]);
  const normalize = () => {
    if (disabled) { setDraft(String(value)); return; }
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed) && parsed >= field.min! && parsed <= field.max!) {
      setDraft(String(parsed));
      if (parsed !== value) { published.current = parsed; change(parsed); }
    } else setDraft(String(value));
  };
  return <input aria-label={`Tool ${field.label}`} type="number" min={field.min} max={field.max} step="any" disabled={disabled} value={draft} onChange={event => {
    if (disabled) return;
    const raw = event.target.value; setDraft(raw);
    const parsed = event.target.valueAsNumber;
    if (Number.isFinite(parsed) && parsed >= field.min! && parsed <= field.max!) { published.current = parsed; change(parsed); }
  }} onBlur={normalize} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); }
    else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); normalize(); event.currentTarget.blur(); }
  }}/>;
}

/** `lead` (the brush Opacity) sits after the blend Mode, or first when the tool has none, as in Photoshop's options bar. */
export function PaintToolOptions({ tool, values, disabled, change, presets, selectPattern, lead, hide, before }: { tool: string; values: PaintOptions; disabled: boolean; change: (values: PaintOptions) => void; presets?: PhotoState["presets"]; selectPattern?: (pattern: string) => void; lead?: ReactNode; before?: Record<string, ReactNode>; hide?: string[] }) {
  const patterns = presets?.patterns?.flatMap(group => group.presets.map(preset => ({ ...preset, group: group.name }))) ?? [];
  const patternFields = tool === "paint.bucket" && values.contents === "pattern";
  const visible = (field: Field) => {
    if (["paint.cloneStamp", "paint.healingBrush"].includes(tool) && sourceTransformKeys.includes(field.key)) return values.transformSource === true;
    if (tool === "paint.bucket" && !patternFields && ["scale", "angle"].includes(field.key)) return false;
    if (tool === "crop" && field.key !== "deleteCroppedPixels") return false;
    if (["ratioWidth", "ratioHeight"].includes(field.key)) return values.style === "fixedRatio";
    if (["fixedWidth", "fixedHeight"].includes(field.key)) return values.style === "fixedSize";
    return !hide?.includes(field.key);
  };
  const fields = (PAINT_TOOL_FIELDS[tool] ?? []).filter(visible), leadAt = Math.max(fields.indexOf(blend), fields.findIndex(field => field.key === "eraserMode")) + 1;
  const control = (field: Field) => tool === "paint.spotHealing" && field.key === "type" ? <div key={`${tool}/type`} role="group" aria-label="Spot healing type" className="xd-ps-icon-cluster xd-ps-segmented"><span className="xd-ps-label">Type:</span>{field.choices!.map(value => <button key={value} aria-label={`Tool Type ${value}`} aria-pressed={values.type === value} disabled={disabled} onClick={() => change({ ...values, type: value })}>{SPOT_TYPES[value]}</button>)}</div> : SLIDER_FIELDS.includes(field.key) ? <PopupSlider key={`${tool}/${field.key}`} label={field.label.replace(/ \(%\)$/, "")} ariaLabel={`Tool ${field.label}`} unit="%" min={field.min!} max={field.max!} value={Number(values[field.key])} disabled={disabled} change={value => change({ ...values, [field.key]: value })} commit={() => {}}
      input={<NumericField field={field} value={Number(values[field.key])} disabled={disabled} change={value => change({ ...values, [field.key]: value })}/>}/>
    : typeof field.value === "boolean" ? <label key={`${tool}/${field.key}`}><input aria-label={`Tool ${field.label}`} type="checkbox" disabled={disabled} checked={values[field.key] === true} onChange={event => change({ ...values, [field.key]: event.target.checked })}/>{field.label}</label>
    : <label key={`${tool}/${field.key}`}>{field === blend ? "Mode" : field.label}{field.choices ? <select aria-label={`Tool ${field.label}`} disabled={disabled} value={String(values[field.key])} onChange={event => change({ ...values, [field.key]: event.target.value })}>{field.choices.map(value => <option key={value} value={value}>{value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase())}</option>)}</select> : <NumericField key={`${tool}/${field.key}`} field={field} value={Number(values[field.key])} disabled={disabled} change={value => change({ ...values, [field.key]: value })}/>}</label>;
  const placed = (field: Field) => before?.[field.key] ? <Fragment key={`${tool}/${field.key}/before`}>{before[field.key]}{control(field)}</Fragment> : control(field);
  return <div className="xd-photo-paint-options">{fields.slice(0, leadAt).map(placed)}{lead}{fields.slice(leadAt).map(placed)}{patternFields&&<label>Pattern<select aria-label="Bucket pattern" disabled={disabled||!patterns.length||!selectPattern} value={presets?.pattern??patterns[0]?.id??""} onChange={event=>selectPattern?.(event.target.value)}>{!patterns.length&&<option value="">No pattern presets available</option>}{patterns.map(pattern=><option key={pattern.id} value={pattern.id}>{pattern.name} · {pattern.group}</option>)}</select></label>}</div>;
}
