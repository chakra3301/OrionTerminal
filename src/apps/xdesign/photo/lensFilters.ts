import type { PhotoAction } from "./controls";

const number = (key: string, label: string, min: number, max: number, value: number, step = 1) => ({ key, label, min, max, value, step });
const enumeration = (key: string, label: string, value: string, choices: string[]) => ({ key, label, kind: "enum" as const, value, choices });
const boolean = (key: string, label: string, value: boolean) => ({ key, label, kind: "boolean" as const, value });
const color = (key: string, label: string, value: string) => ({ key, label, kind: "color" as const, value });

export type AdaptiveWideAngleConstraint = {
  a: [number, number];
  b: [number, number];
  orientation: "free" | "horizontal" | "vertical";
};

export type AdaptiveWideAngleSettings = {
  model: "auto" | "fisheye" | "perspective" | "fullSpherical";
  focalLength: number;
  cropFactor: number;
  scale: number;
  interpolation: "nearest" | "bilinear" | "bicubic";
  constraints: AdaptiveWideAngleConstraint[];
};

export const LENS_CORRECTION_ACTION: PhotoAction = {
  id: "filter.lensCorrection",
  label: "Lens Correction",
  category: "Distort",
  fields: [
    number("focalLength", "Focal length (mm)", 0, 200, 0, 0.1),
    number("distortion", "Remove distortion", -100, 100, 0, 0.1),
    number("redCyan", "Red / cyan fringe", -100, 100, 0, 0.1),
    number("blueYellow", "Blue / yellow fringe", -100, 100, 0, 0.1),
    number("vignetteAmount", "Vignette amount", -100, 100, 0, 0.1),
    number("vignetteMidpoint", "Vignette midpoint", 0, 100, 50, 0.1),
    number("vertical", "Vertical perspective", -100, 100, 0, 0.1),
    number("horizontal", "Horizontal perspective", -100, 100, 0, 0.1),
    number("angle", "Angle", -180, 180, 0, 0.1),
    number("scale", "Scale (%)", 50, 150, 100, 0.1),
  ],
  options: [
    enumeration("profile", "Profile", "none", ["none", "auto", "generic"]),
    boolean("correctDistortion", "Correct distortion", true),
    boolean("correctVignette", "Correct vignette", true),
    boolean("correctCA", "Correct chromatic aberration", true),
    boolean("autoScale", "Auto scale to fit", false),
    enumeration("edge", "Edge behavior", "transparency", ["transparency", "edgeExtension", "black", "white", "color"]),
    color("edgeColor", "Edge color", "#000000"),
  ],
  defaults: {
    focalLength: 0, profile: "none", correctDistortion: true, correctVignette: true, correctCA: true,
    autoScale: false, distortion: 0, redCyan: 0, blueYellow: 0, vignetteAmount: 0,
    vignetteMidpoint: 50, vertical: 0, horizontal: 0, angle: 0, scale: 100,
    edge: "transparency", edgeColor: "#000000",
  },
  structured: "lens",
};

export const ADAPTIVE_WIDE_ANGLE_ACTION: PhotoAction = {
  id: "filter.adaptiveWideAngle",
  label: "Adaptive Wide Angle",
  category: "Distort",
  fields: [
    number("focalLength", "Focal length (mm)", 0, 200, 0, 0.1),
    number("cropFactor", "Crop factor", 0.1, 10, 1, 0.01),
    number("scale", "Scale (%)", 50, 150, 100, 0.1),
  ],
  options: [
    enumeration("model", "Lens model", "auto", ["auto", "fisheye", "perspective", "fullSpherical"]),
    enumeration("interpolation", "Interpolation", "bicubic", ["nearest", "bilinear", "bicubic"]),
  ],
  defaults: { model: "auto", focalLength: 0, cropFactor: 1, scale: 100, interpolation: "bicubic", constraints: [] },
  structured: "wide",
};

export const LENS_FILTERS: PhotoAction[] = [LENS_CORRECTION_ACTION, ADAPTIVE_WIDE_ANGLE_ACTION];

const finiteIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export const validLensPoint = (value: unknown, width: number, height: number): value is [number, number] => Array.isArray(value) && value.length === 2 && finiteIn(value[0], 0, width) && finiteIn(value[1], 0, height);
export function validLensLine(value: unknown, width: number, height: number): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [a, b] = value;
  return validLensPoint(a, width, height) && validLensPoint(b, width, height) && (a[0] !== b[0] || a[1] !== b[1]);
}

export function validAdaptiveWideAngleSettings(settings: Record<string, unknown>, width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  if (!["auto", "fisheye", "perspective", "fullSpherical"].includes(String(settings.model))) return false;
  if (!["nearest", "bilinear", "bicubic"].includes(String(settings.interpolation))) return false;
  if (!finiteIn(settings.focalLength, 0, 200) || !finiteIn(settings.cropFactor, 0.1, 10) || !finiteIn(settings.scale, 50, 150)) return false;
  if (!Array.isArray(settings.constraints) || settings.constraints.length > 128) return false;
  return settings.constraints.every(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const line = value as Record<string, unknown>;
    return validLensLine([line.a, line.b], width, height) && ["free", "horizontal", "vertical"].includes(String(line.orientation));
  });
}
