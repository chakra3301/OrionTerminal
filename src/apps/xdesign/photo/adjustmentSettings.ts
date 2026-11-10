import type { PhotoAction } from "./controls";

export const HUE_RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas"];
export const SELECTIVE_RANGES = [...HUE_RANGES, "whites", "neutrals", "blacks"];
export const IDENTITY_CURVE: [number, number][] = [[0, 0], [255, 255]];
export const PHOTO_FILTER_PRESETS = [
  ["Warming 85", "#ec8a00"], ["Warming LBA", "#fa9600"], ["Warming 81", "#ebb113"],
  ["Cooling 80", "#006dff"], ["Cooling LBB", "#005dff"], ["Cooling 82", "#00b5ff"],
  ["Red", "#ea1a1a"], ["Orange", "#f38417"], ["Yellow", "#f9e31c"], ["Green", "#19c919"],
  ["Cyan", "#1dcbea"], ["Blue", "#1d35ea"], ["Violet", "#9b1dea"], ["Magenta", "#e318e3"],
  ["Sepia", "#ac7a33"], ["Deep red", "#ff0000"], ["Deep blue", "#0022cd"],
  ["Deep emerald", "#008c00"], ["Deep yellow", "#ffd500"], ["Underwater", "#00c2b1"],
] as const;

type Curve = [number, number][];
const preset = (name: string, values: Record<string, unknown>) => ({ name, values });
const exposurePreset = (name: string, exposure: number) => preset(name, { exposure, offset: 0, gamma: 1 });
const curvePreset = (name: string, points: Curve) => preset(`${name} (RGB)`, { points });
const mixerPreset = (name: string, gray: number[]) => preset(`Black & White with ${name} (RGB)`, { monochrome: true, gray });
const grayPreset = (name: string, [reds, yellows, greens, cyans, blues, magentas]: number[]) => preset(name, { reds, yellows, greens, cyans, blues, magentas });
/** Decoded from the preset files shipped with Photoshop. Curves presets are RGB-only. */
export const ADJUSTMENT_PRESETS: Record<string, { name: string; values: Record<string, unknown> }[]> = {
  levels: [
    preset("Darker", { inBlack: 15 }), preset("Increase Contrast 1", { inBlack: 10, inWhite: 245 }), preset("Increase Contrast 2", { inBlack: 20, inWhite: 235 }),
    preset("Increase Contrast 3", { inBlack: 30, inWhite: 225 }), preset("Lighten Shadows", { gamma: 1.6 }), preset("Lighter", { inWhite: 230 }),
    preset("Midtones Brighter", { gamma: 1.25 }), preset("Midtones Darker", { gamma: 0.75 }),
  ],
  curves: [
    curvePreset("Darker", [[0, 0], [130, 101], [255, 255]]),
    curvePreset("Increase Contrast", [[0, 0], [38, 17], [212, 231], [231, 250], [255, 255]]),
    curvePreset("Lighter", [[0, 0], [103, 125], [255, 255]]),
    curvePreset("Linear Contrast", [[0, 0], [78, 73], [177, 182], [255, 255]]),
    curvePreset("Medium Contrast", [[0, 0], [73, 56], [163, 164], [255, 255]]),
    curvePreset("Negative", [[0, 255], [255, 0]]),
    curvePreset("Strong Contrast", [[0, 0], [77, 50], [151, 153], [175, 188], [255, 255]]),
    preset("Cross Process (RGB)", { red: [[0, 0], [64, 40], [128, 125], [175, 190], [255, 255]], green: [[0, 0], [64, 48], [97, 128], [190, 208], [255, 208]], blue: [[0, 0], [59, 24], [181, 223], [255, 255]] }),
    preset("Color Negative (RGB)", { red: [[33, 255], [119, 127], [185, 0]], green: [[28, 255], [77, 127], [132, 0]], blue: [[25, 255], [60, 127], [108, 0]] }),
  ],
  exposure: [exposurePreset("Minus 1.0", -1), exposurePreset("Minus 2.0", -2), exposurePreset("Plus 1.0", 1), exposurePreset("Plus 2.0", 2)],
  hueSaturation: [
    preset("Cyanotype", { colorize: true, hue: 215, saturation: 25 }), preset("Increase Saturation More", { saturation: 30 }), preset("Increase Saturation", { saturation: 10 }),
    preset("Old Style", { saturation: -40, lightness: 5 }), preset("Red Boost", { hue: -5, saturation: 20 }), preset("Sepia", { colorize: true, hue: 35, saturation: 25 }),
    preset("Strong Saturation", { saturation: 50 }), preset("Yellow Boost", { hue: 5, saturation: 20 }),
  ],
  channelMixer: [
    mixerPreset("Blue Filter", [0, 0, 100, 0]), mixerPreset("Green Filter", [0, 100, 0, 0]), mixerPreset("Orange Filter", [50, 50, 0, 0]),
    mixerPreset("Red Filter", [100, 0, 0, 0]), mixerPreset("Yellow Filter", [34, 66, 0, 0]), preset("Black & White Infrared (RGB)", { monochrome: true, gray: [-70, 200, -30, 0] }),
  ],
  blackWhite: [
    grayPreset("Blue Filter", [0, 0, 0, 110, 110, 110]), grayPreset("Darker", [30, 50, 30, 50, 10, 70]), grayPreset("Green Filter", [50, 120, 90, 50, 0, 0]),
    grayPreset("High Contrast Blue Filter", [-50, -50, -50, 150, 150, 150]), grayPreset("High Contrast Red Filter", [120, 120, -10, -50, -50, 120]),
    grayPreset("Infrared", [-40, 235, 144, -68, -3, -107]), grayPreset("Lighter", [50, 70, 50, 70, 30, 90]), grayPreset("Maximum Black", [0, 0, 0, 0, 0, 0]),
    grayPreset("Maximum White", [100, 100, 100, 100, 100, 100]), grayPreset("Neutral Density", [128, 128, 100, 100, 128, 100]),
    grayPreset("Red Filter", [120, 110, -10, -50, 0, 120]), grayPreset("Yellow Filter", [120, 110, 40, -30, 0, 70]),
  ],
};

export function toneChannels(mode: string, settings: Record<string, unknown>): string[] {
  if (["cyan", "magenta", "yellow", "black"].some(key => key in settings)) return ["cyan", "magenta", "yellow", "black"];
  if ("a" in settings || "b" in settings || "lightness" in settings) return ["lightness", "a", "b"];
  if (["red", "green", "blue"].some(key => key in settings)) return ["red", "green", "blue"];
  return mode.toLowerCase() === "cmyk" ? ["cyan", "magenta", "yellow", "black"]
    : mode.toLowerCase() === "lab" ? ["lightness", "a", "b"] : ["red", "green", "blue"];
}

/** Complete neutral values for Reset; opening an edit keeps its authoritative imported values. */
export function adjustmentDefaults(action: PhotoAction, mode: string, base: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {
    ...Object.fromEntries((action.fields ?? []).map(field => [field.key, field.value])),
    ...Object.fromEntries((action.options ?? []).map(option => [option.key, option.value])),
    ...structuredClone(action.defaults ?? {}),
  };
  if (action.id.startsWith("filter.")) return values;
  if (action.id === "levels" || action.id === "curves") {
    const channel = action.id === "levels" ? { ...values } : IDENTITY_CURVE;
    if (action.id === "curves") values.points = structuredClone(IDENTITY_CURVE);
    for (const key of toneChannels(mode, base)) values[key] = structuredClone(channel);
  }
  if (action.id === "brightnessContrast") values.legacy = false;
  if (action.id === "hueSaturation") {
    values.colorize = false;
    HUE_RANGES.forEach((key, index) => { values[key] = { hue: 0, saturation: 0, lightness: 0, range: [-45, -15, 15, 45].map(value => value + index * 60) }; });
  }
  if (action.id === "colorBalance") return { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
  if (action.id === "channelMixer") return { red: [100, 0, 0, 0], green: [0, 100, 0, 0], blue: [0, 0, 100, 0], monochrome: false };
  if (action.id === "blackWhite") Object.assign(values, { tint: false, tintColor: "#e1d3b3" });
  if (action.id === "photoFilter") Object.assign(values, { color: "#ec8a00", preserveLuminosity: true });
  if (action.id === "gradientMap") return { stops: [[0, "#000000"], [1, "#ffffff"]], reverse: false, dither: false, method: "perceptual" };
  if (action.id === "selectiveColor") return { method: "relative", ...Object.fromEntries(SELECTIVE_RANGES.map(key => [key, [0, 0, 0, 0]])) };
  if (action.id === "colorLookup") return { lut: "none", interpolation: "trilinear", dither: true };
  return values;
}

export function adjustmentCommand(action: PhotoAction, adjustment: boolean, layerId?: number): string {
  if (layerId !== undefined) return "layer.setAdjustment";
  if (adjustment) return `layer.newAdjustmentLayer.${action.id}`;
  return action.id.startsWith("filter.") ? action.id : `image.adjustments.${action.id}`;
}

export function hasFiniteSettings(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteSettings);
  if (value && typeof value === "object") return Object.values(value).every(hasFiniteSettings);
  return true;
}
