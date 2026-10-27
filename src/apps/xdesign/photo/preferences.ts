import { create } from "zustand";

/** Photoshop's Preferences › Units & Rulers and Guides, Grid & Slices, kept for every document. */
export type RulerUnit = "pixels" | "inches" | "centimeters" | "millimeters" | "points" | "picas" | "percent";
export type GridUnit = Exclude<RulerUnit, "percent">;
export type LineStyle = "lines" | "dashed";
export type GridStyle = LineStyle | "dots";
export type Preferences = {
  rulerUnit: RulerUnit;
  screenResolution: number;
  pointSize: "postscript" | "traditional";
  guides: { color: string; style: LineStyle };
  smartGuides: { color: string };
  grid: { color: string; style: GridStyle; every: number; unit: GridUnit; subdivisions: number };
  slices: { color: string; numbers: boolean };
};
type Store = Preferences & { notice: string | null };

export const PREFERENCES_KEY = "orion.xdesign.preferences.v1";
export const RULER_UNITS: [RulerUnit, string][] = [["pixels", "Pixels"], ["inches", "Inches"], ["centimeters", "Centimeters"], ["millimeters", "Millimeters"], ["points", "Points"], ["picas", "Picas"], ["percent", "Percent"]];
// Photoshop's named line colours. Like guide cyan, they are drawn over the image, so they ignore the theme.
export const LINE_COLORS: [string, string][] = [["Light Blue", "#4a9cff"], ["Light Red", "#ff6b6b"], ["Green", "#00c800"], ["Medium Blue", "#3264dc"], ["Yellow", "#ffff00"], ["Magenta", "#ff00ff"], ["Cyan", "#00c8ff"], ["Gray", "#808080"], ["Light Gray", "#c0c0c0"], ["Black", "#000000"]];
export const DEFAULT_PREFERENCES: Preferences = {
  rulerUnit: "pixels", screenResolution: 72, pointSize: "postscript",
  guides: { color: "#00c8ff", style: "lines" }, smartGuides: { color: "#ff00ff" },
  grid: { color: "#808080", style: "lines", every: 1, unit: "inches", subdivisions: 4 },
  slices: { color: "#4a9cff", numbers: true },
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T) => options.includes(value as T) ? value as T : fallback;
const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const RULERS = RULER_UNITS.map(([unit]) => unit), GRID_UNITS = RULERS.filter((unit): unit is GridUnit => unit !== "percent");

/** Keeps every valid field and falls back field by field, so one bad value doesn't reset the rest. */
export function sanitizePreferences(value: unknown): Preferences {
  const saved = record(value) ? value : {}, d = DEFAULT_PREFERENCES;
  const guides = record(saved.guides) ? saved.guides : {}, smart = record(saved.smartGuides) ? saved.smartGuides : {}, grid = record(saved.grid) ? saved.grid : {}, slices = record(saved.slices) ? saved.slices : {};
  return {
    rulerUnit: oneOf(saved.rulerUnit, RULERS, d.rulerUnit),
    screenResolution: number(saved.screenResolution, 1, 9999, d.screenResolution),
    pointSize: oneOf(saved.pointSize, ["postscript", "traditional"] as const, d.pointSize),
    guides: { color: hex(guides.color, d.guides.color), style: oneOf(guides.style, ["lines", "dashed"] as const, d.guides.style) },
    smartGuides: { color: hex(smart.color, d.smartGuides.color) },
    grid: {
      color: hex(grid.color, d.grid.color), style: oneOf(grid.style, ["lines", "dashed", "dots"] as const, d.grid.style),
      every: number(grid.every, 0.01, 99999, d.grid.every), unit: oneOf(grid.unit, GRID_UNITS, d.grid.unit),
      subdivisions: Math.round(number(grid.subdivisions, 1, 100, d.grid.subdivisions)),
    },
    slices: { color: hex(slices.color, d.slices.color), numbers: typeof slices.numbers === "boolean" ? slices.numbers : d.slices.numbers },
  };
}

function read(): Store {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw === null) return { ...DEFAULT_PREFERENCES, notice: null };
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.schemaVersion !== 1) throw new Error("Unsupported preferences");
    return { ...sanitizePreferences(saved.preferences), notice: null };
  } catch {
    return { ...DEFAULT_PREFERENCES, notice: "Saved preferences could not be read; the defaults are in use." };
  }
}

export const usePreferences = create<Store>(() => read());

export const currentPreferences = (): Preferences => {
  const { notice: _notice, ...preferences } = usePreferences.getState();
  return preferences;
};

/** Applies preferences at once, so the open document shows them while the dialog is still open. */
export const previewPreferences = (next: Preferences) => usePreferences.setState(sanitizePreferences(next));

/** Keeps the shown preferences. A failed write keeps them for the session and says so. */
export function savePreferences(next: Preferences): string | null {
  const preferences = sanitizePreferences(next);
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ schemaVersion: 1, preferences }));
    usePreferences.setState({ ...preferences, notice: null });
    return null;
  } catch {
    const notice = "Preferences could not be saved; they last until XDesign closes.";
    usePreferences.setState({ ...preferences, notice });
    return notice;
  }
}

/** How many of `unit` one document pixel spans. Percent is of the axis' length, as on Photoshop's rulers. */
export function unitsPerPixel(unit: RulerUnit, resolution: number, pointSize: Preferences["pointSize"], length = 1): number {
  const ppi = resolution > 0 ? resolution : 72, points = pointSize === "traditional" ? 72.27 : 72;
  switch (unit) {
    case "pixels": return 1;
    case "inches": return 1 / ppi;
    case "centimeters": return 2.54 / ppi;
    case "millimeters": return 25.4 / ppi;
    case "points": return points / ppi;
    case "picas": return points / 12 / ppi;
    case "percent": return 100 / Math.max(1, length);
  }
}
