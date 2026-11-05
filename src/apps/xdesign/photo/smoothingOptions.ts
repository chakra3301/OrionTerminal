import type { MenuEntry } from "../menuModel";

const OPTIONS = [["pulledString", "Pulled String Mode"], ["catchUp", "Stroke Catch-up"], ["catchUpOnEnd", "Catch-up on Stroke End"], ["adjustForZoom", "Adjust for Zoom"]] as const;

/** Photoshop's Smoothing gear: the brush's `smoothing` switches, each written back as one `tools.setBrush`. */
export function smoothingMenu(settings: Record<string, unknown> | undefined, disabled: boolean, set: (patch: Record<string, boolean>) => void): MenuEntry[] {
  const smoothing = settings?.smoothing as Record<string, unknown> | undefined;
  return OPTIONS.map(([key, label]) => ({ label, checked: smoothing?.[key] === true, disabled: disabled || typeof smoothing?.[key] !== "boolean", run: () => set({ [key]: smoothing?.[key] !== true }) }));
}
