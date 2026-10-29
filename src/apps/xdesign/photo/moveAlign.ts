import { useState } from "react";

export const MOVE_ALIGN_TO_KEY = "orion.xdesign.move-align-to.v1";
export type AlignTo = "selection" | "canvas";

export function loadAlignTo(): AlignTo {
  try { return localStorage.getItem(MOVE_ALIGN_TO_KEY) === "canvas" ? "canvas" : "selection"; } catch { return "selection"; }
}
export function saveAlignTo(value: AlignTo) {
  try { localStorage.setItem(MOVE_ALIGN_TO_KEY, value); } catch { /* The choice stays for this session when storage is unavailable. */ }
}
/** Photoshop's Selection aligns to a pixel selection when there is one; otherwise the engine's `auto` picks the layers, or the canvas for a lone layer. */
export const alignParams = (to: AlignTo, hasSelection: boolean): Record<string, string> => to === "canvas" ? { to: "canvas" } : hasSelection ? { to: "selection" } : {};

export function useAlignTo() {
  const [value, setValue] = useState(loadAlignTo);
  return [value, (next: AlignTo) => { setValue(next); saveAlignTo(next); }] as const;
}
