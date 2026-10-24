import { COLOR_RANGE_PRESETS, COLOR_RANGE_PREVIEWS, FOCUS_FIELDS, REFINE_FIELDS, SELECTION_MODES, SELECTION_OUTPUTS, selectionDefaults, type SelectionPreviewView, type SelectionSettings, type SelectionWorkflow } from "./selectionSettings";

export const SELECTION_PREFERENCES_KEY = "orion.xdesign.selection-workspaces.v1";
const MAX_BYTES = 32 * 1024;
const views: SelectionPreviewView[] = ["mask", "overlay", "black", "white", "transparent", "result"];
type Saved = { options: SelectionSettings; view: SelectionPreviewView; brushSize: number };
type Preferences = { workflows: Partial<Record<SelectionWorkflow, Saved>>; writable: boolean; notice: string | null };

export function sanitizeSelectionPreferences(kind: SelectionWorkflow, value: unknown): SelectionSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as SelectionSettings, result: SelectionSettings = {};
  const fields = kind === "refine" ? [...REFINE_FIELDS, { key: "amount", min: 0, max: 100 }] : kind === "focus" ? FOCUS_FIELDS : [
    { key: "sampleFuzziness", min: 0, max: 200 }, { key: "toneFuzziness", min: 0, max: 100 },
    ...["shadowLevel", "highlightLevel", "midLow", "midHigh"].map(key => ({ key, min: 0, max: 255 })), { key: "range", min: 0, max: 100 },
  ];
  for (const { key, min, max } of fields) if (typeof input[key] === "number" && Number.isFinite(input[key]) && Number(input[key]) >= min && Number(input[key]) <= max) result[key] = input[key];
  for (const key of kind === "refine" ? ["smartRadius", "sampleAllLayers", "decontaminate"] : kind === "focus" ? ["sampleAllLayers"] : ["localized", "invert", "sampleAllLayers"]) if (typeof input[key] === "boolean") result[key] = input[key];
  const choices = kind === "refine" ? { output: SELECTION_OUTPUTS } : kind === "focus" ? { mode: SELECTION_MODES } : { mode: SELECTION_MODES, select: COLOR_RANGE_PRESETS, selectionPreview: COLOR_RANGE_PREVIEWS };
  for (const [key, allowed] of Object.entries(choices)) if (typeof input[key] === "string" && allowed.includes(String(input[key]))) result[key] = input[key];
  if (Number(result.midLow ?? 105) > Number(result.midHigh ?? 150)) { delete result.midLow; delete result.midHigh; }
  return result;
}

export function readSelectionPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(SELECTION_PREFERENCES_KEY);
    if (raw === null) return { workflows: {}, writable: true, notice: null };
    if (raw.length * 2 > MAX_BYTES) throw new Error("Selection preferences exceed the limit");
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || (saved as SelectionSettings).schemaVersion !== 1) throw new Error("Unsupported selection preferences");
    const input = (saved as SelectionSettings).workflows;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid selection preferences");
    const workflows: Preferences["workflows"] = {};
    for (const kind of ["refine", "focus", "color"] as const) {
      const value = (input as SelectionSettings)[kind];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as SelectionSettings;
      workflows[kind] = { options: sanitizeSelectionPreferences(kind, entry.options), view: views.includes(entry.view as SelectionPreviewView) ? entry.view as SelectionPreviewView : "mask", brushSize: typeof entry.brushSize === "number" && Number.isFinite(entry.brushSize) && entry.brushSize >= 1 && entry.brushSize <= 5000 ? entry.brushSize : 30 };
    }
    return { workflows, writable: true, notice: null };
  } catch {
    return { workflows: {}, writable: false, notice: "Saved selection settings could not be read. This session uses default options." };
  }
}

export function saveSelectionPreferences(kind: SelectionWorkflow, remember: boolean, options: SelectionSettings, view: SelectionPreviewView, brushSize: number): string | null {
  const current = readSelectionPreferences();
  if (!current.writable) return current.notice;
  const workflows = { ...current.workflows };
  if (remember) workflows[kind] = { options: sanitizeSelectionPreferences(kind, options), view: views.includes(view) ? view : "mask", brushSize: Number.isFinite(brushSize) && brushSize >= 1 && brushSize <= 5000 ? brushSize : 30 };
  else delete workflows[kind];
  try { localStorage.setItem(SELECTION_PREFERENCES_KEY, JSON.stringify({ schemaVersion: 1, workflows })); return null; }
  catch { return "The selection was applied, but its remembered settings could not be saved."; }
}

export const rememberedSelectionValues = (kind: SelectionWorkflow, foreground: Parameters<typeof selectionDefaults>[1], saved?: Saved) => ({ ...selectionDefaults(kind, foreground), ...saved?.options });
