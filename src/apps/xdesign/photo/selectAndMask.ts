import type { SelectionSample } from "./selectionSettings";
import type { PhotoState } from "./types";

export type SelectAndMaskTool = "quick" | "edge" | "brush";
export type SelectAndMaskMode = "add" | "subtract";
export const SELECT_AND_MASK_TOOLS: { id: SelectAndMaskTool; label: string }[] = [
  { id: "quick", label: "Quick Selection Tool" }, { id: "edge", label: "Refine Edge Brush Tool" }, { id: "brush", label: "Brush Tool" },
];
export const strokeMode = (mode: SelectAndMaskMode, alt: boolean): SelectAndMaskMode => alt ? mode === "add" ? "subtract" : "add" : mode;
export const quickSelectionParams = (points: SelectionSample[], size: number, mode: SelectAndMaskMode, sampleAllLayers: boolean) => ({ points, size, mode, sampleAllLayers });
// The Brush Tool paints the selection itself, so it has no layers to sample.
export const brushSelectionParams = (points: SelectionSample[], size: number, hardness: number, mode: SelectAndMaskMode) => ({ points, size, hardness, mode });
// Dialogs hold their opening state by snapshot id: at the History limit each new step keeps the
// current index while dropping the oldest state, so indexes can't tell whether anything changed.
export const historyId = (state: PhotoState | null | undefined) => state?.historySources?.find(source => source.current)?.id ?? null;
export function selectAndMaskFold(base: string | null, state: PhotoState | null | undefined, edited: boolean): [string, Record<string, unknown>] | null {
  const now = historyId(state);
  return edited && base !== null && now !== null && now !== base ? ["history.fold", { fromId: base, label: "Select and Mask" }] : null;
}
export function selectAndMaskRevert(base: string | null, state: PhotoState | null | undefined, edited: boolean): [string, Record<string, unknown>] | null {
  const now = historyId(state);
  return edited && base !== null && now !== base ? ["history.select", { id: base, discardRedo: true }] : null;
}
