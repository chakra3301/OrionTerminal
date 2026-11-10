import type { PhotoColor, PhotoLayer } from "./types";

export type SelectionWorkflow = "refine" | "focus" | "color";
export type SelectionPreviewView = "mask" | "overlay" | "black" | "white" | "transparent" | "result";
export type SelectionSettings = Record<string, unknown>;
export type SelectionSample = [number, number];
export type SelectionBrush = { points: SelectionSample[]; size: number; erase: boolean };
export const MAX_EDGE_BRUSH_POINTS = 8192;
export const MAX_EDGE_BRUSH_STROKES = 128;
export const SELECTION_TITLES = { refine: "Select and Mask", focus: "Focus Area", color: "Color Range" };
export const SELECTION_COMMANDS = { refine: "select.refineEdge", focus: "select.focusArea", color: "select.colorRange" };
export const COLOR_RANGE_PRESETS = ["sampledColors", "reds", "yellows", "greens", "cyans", "blues", "magentas", "highlights", "midtones", "shadows", "outOfGamut"];
export const COLOR_RANGE_PREVIEWS = ["none", "mask", "black", "white", "overlay"];
export const SELECTION_OUTPUTS = ["selection", "layerMask", "newLayer", "newLayerWithMask"];
export const SELECTION_MODES = ["replace", "add", "subtract", "intersect"];
export const MAX_SELECTION_SAMPLES = 64;
export type SelectionNumber = { key: string; label: string; min: number; max: number; step: number };
export const REFINE_FIELDS: SelectionNumber[] = [
  { key: "radius", label: "Radius (px)", min: 0, max: 250, step: .1 },
  { key: "smooth", label: "Smooth", min: 0, max: 100, step: .1 },
  { key: "feather", label: "Feather (px)", min: 0, max: 250, step: .1 },
  { key: "contrast", label: "Contrast (%)", min: 0, max: 100, step: .1 },
  { key: "shiftEdge", label: "Shift edge (%)", min: -100, max: 100, step: .1 },
];
export const FOCUS_FIELDS: SelectionNumber[] = [
  { key: "range", label: "Focus range", min: 0, max: 1, step: .01 },
  { key: "noise", label: "Image noise", min: 0, max: 1, step: .01 },
];
export function selectionDefaults(kind: SelectionWorkflow, foreground: PhotoColor): SelectionSettings {
  if (kind === "refine") return { radius: 0, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0, decontaminate: false, amount: 100, output: "selection", sampleAllLayers: false, quickSize: 30, brushToolSize: 30, brushToolHardness: 100 };
  if (kind === "focus") return { range: .5, noise: 0, sampleAllLayers: true, mode: "replace" };
  return { select: "sampledColors", colors: [foreground], points: [], subtractPoints: [], sampleFuzziness: 40, toneFuzziness: 20, shadowLevel: 65, highlightLevel: 190, midLow: 105, midHigh: 150, localized: false, range: 100, invert: false, sampleAllLayers: true, mode: "replace" };
}
export function effectiveSelectionOutput(settings: SelectionSettings): string {
  const output = String(settings.output);
  return settings.decontaminate === true && ["selection", "layerMask"].includes(output) ? "newLayerWithMask" : output;
}
export function selectionRequest(kind: SelectionWorkflow, settings: SelectionSettings, context: { width: number; height: number; hasSelection: boolean; layer?: PhotoLayer | null }): { command: string; params: Record<string, unknown>; problem: string | null } {
  const params: Record<string, unknown> = {}, errors: string[] = [];
  const number = (key: string, label: string, min: number, max: number, nativeKey = key) => {
    const value = settings[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) errors.push(`Enter ${label} between ${min} and ${max}.`);
    else params[nativeKey] = value;
  };
  const choice = (key: string, allowed: string[]) => {
    const value = settings[key]; if (typeof value !== "string" || !allowed.includes(value)) errors.push(`Choose a valid ${key}.`); else params[key] = value;
  };
  params.sampleAllLayers = settings.sampleAllLayers === true;
  if (kind === "refine") {
    for (const field of REFINE_FIELDS) number(field.key, field.label, field.min, field.max);
    choice("output", SELECTION_OUTPUTS);
    params.smartRadius = settings.smartRadius === true; params.decontaminate = settings.decontaminate === true;
    if (params.decontaminate) number("amount", "decontamination amount", 0, 100);
    params.output = effectiveSelectionOutput(settings);
    if (!context.hasSelection) errors.push("Make a selection to refine.");
    if (params.output !== "selection" && !context.layer) errors.push("Select a layer for this output.");
    if (["newLayer", "newLayerWithMask"].includes(String(params.output)) && context.layer && context.layer.hasPixels !== true && !(context.layer.hasPixels === undefined && context.layer.kind === "Raster")) errors.push("This output needs a layer with pixels.");
    if (settings.edgeBrushes !== undefined) {
      const brushes = settings.edgeBrushes;
      if (!Array.isArray(brushes) || brushes.length > MAX_EDGE_BRUSH_STROKES) errors.push("Use at most 128 edge-refinement strokes.");
      else {
        let count = 0;
        for (const brush of brushes) {
          if (!brush || typeof brush !== "object" || typeof brush.size !== "number" || !Number.isFinite(brush.size) || brush.size < 1 || brush.size > 5000 || typeof brush.erase !== "boolean" || !Array.isArray(brush.points) || !brush.points.length) { errors.push("Choose a valid edge brush and draw a stroke."); continue; }
          count += brush.points.length;
          if (brush.points.some((point: unknown) => !Array.isArray(point) || point.length !== 2 || point.some((value, axis) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= (axis ? context.height : context.width)))) errors.push("Edge brush points must be inside the image.");
        }
        if (count > MAX_EDGE_BRUSH_POINTS) errors.push("Use at most 8192 edge brush points before applying.");
        if (brushes.length) params.edgeBrushes = brushes;
      }
    }
  } else {
    choice("mode", SELECTION_MODES);
    if (kind === "focus") for (const field of FOCUS_FIELDS) number(field.key, field.label, field.min, field.max);
    else {
      choice("select", COLOR_RANGE_PRESETS); params.invert = settings.invert === true;
      if (settings.select === "sampledColors") {
        number("sampleFuzziness", "fuzziness", 0, 200, "fuzziness");
        let count = 0;
        const validColor = (color: unknown) => typeof color === "string" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color) || Array.isArray(color) && (color.length === 3 || color.length === 4) && color.every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 3.4028234663852886e38);
        for (const key of ["colors", "points", "subtractPoints"]) {
          const samples = settings[key];
          if (!Array.isArray(samples)) { errors.push("Choose valid color samples."); continue; }
          count += samples.length;
          if (!samples.every(sample => key === "colors" ? validColor(sample) : Array.isArray(sample) && sample.length === 2 && sample.every(value => typeof value === "number" && Number.isFinite(value)) && sample[0] >= 0 && sample[0] < context.width && sample[1] >= 0 && sample[1] < context.height)) errors.push("Sample points must be inside the image.");
          else if (samples.length) params[key] = samples;
        }
        if (count > MAX_SELECTION_SAMPLES) errors.push(`Use at most ${MAX_SELECTION_SAMPLES} color samples.`);
        if (!count) errors.push("Pick a point on the image or add a sample color.");
        else if (!(params.colors as unknown[] | undefined)?.length && !(params.points as unknown[] | undefined)?.length) errors.push("Add a positive sample before subtracting colors.");
        params.localized = settings.localized === true;
        if (params.localized) {
          if (!(params.points as unknown[] | undefined)?.length && !(params.subtractPoints as unknown[] | undefined)?.length) errors.push("Localized clusters need a sample point on the image.");
          number("range", "localized range", 0, 100);
        }
      } else if (["shadows", "midtones", "highlights"].includes(String(settings.select))) {
        number("toneFuzziness", "tonal fuzziness", 0, 100, "fuzziness");
        if (settings.select === "midtones") {
          number("midLow", "midtones low", 0, 255); number("midHigh", "midtones high", 0, 255);
          if (Number(settings.midLow) > Number(settings.midHigh)) errors.push("Midtones low must not exceed midtones high.");
          params.tonalRange = [settings.midLow, settings.midHigh]; delete params.midLow; delete params.midHigh;
        } else number(settings.select === "shadows" ? "shadowLevel" : "highlightLevel", "tonal level", 0, 255, "tonalRange");
      }
    }
  }
  return { command: SELECTION_COMMANDS[kind], params, problem: errors[0] ?? null };
}
export function selectionSamplePoint(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }, width: number, height: number): SelectionSample | null {
  if (![x, y, bounds.left, bounds.top, bounds.width, bounds.height, width, height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return null;
  const scale = Math.min(bounds.width / width, bounds.height / height), left = bounds.left + (bounds.width - width * scale) / 2, top = bounds.top + (bounds.height - height * scale) / 2;
  const px = (x - left) / scale, py = (y - top) / scale;
  return px >= 0 && py >= 0 && px < width && py < height ? [Math.floor(px), Math.floor(py)] : null;
}
