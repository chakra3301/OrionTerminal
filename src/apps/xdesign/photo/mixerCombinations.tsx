import { create } from "zustand";
import { MenuButton } from "../EditorMenus";
import { paintColorHex } from "./imageColors";
import type { PaintOptions } from "./PaintToolOptions";
import "./vectorBars.css";

// Photoshop's "Useful mixer brush combinations" as [name, Wet, Load, Mix]; helpx names them but not their values.
const COMBINATIONS: [string, number, number, number][] = [
  ["Dry", 0, 50, 0], ["Dry, Light Load", 0, 1, 0], ["Dry, Heavy Load", 0, 100, 0],
  ["Moist", 10, 5, 50], ["Moist, Light Mix", 10, 5, 20], ["Moist, Heavy Mix", 10, 5, 90],
  ["Wet", 50, 50, 50], ["Wet, Light Mix", 50, 50, 20], ["Wet, Heavy Mix", 50, 50, 90],
  ["Very Wet", 100, 50, 50], ["Very Wet, Light Mix", 100, 50, 20], ["Very Wet, Heavy Mix", 100, 50, 90],
];

export function MixerCombination({ values, disabled, change }: { values: PaintOptions; disabled: boolean; change: (values: PaintOptions) => void }) {
  const current = COMBINATIONS.find(([, wet, load, mix]) => values.wet === wet && values.load === load && values.mix === mix)?.[0] ?? "Custom";
  return <select aria-label="Mixer brush combination" title="Useful mixer brush combinations" disabled={disabled} value={current} onChange={event => {
    const chosen = COMBINATIONS.find(([name]) => name === event.target.value);
    if (chosen) change({ ...values, wet: chosen[1], load: chosen[2], mix: chosen[3] });
  }}><option value="Custom">Custom</option>{COMBINATIONS.map(([name]) => <option key={name} value={name}>{name}</option>)}</select>;
}

// The engine keeps a Current Brush Load per image until the app quits, and reports it only from Load and Clean, so it is kept here per image too; `null` is a clean brush.
export const useMixerLoads = create<{ loads: Record<string, string | null>; set: (image: string, load: string | null) => void }>(set => ({ loads: {}, set: (image, load) => set(state => ({ loads: { ...state.loads, [image]: load } })) }));
const hex = (color: unknown) => paintColorHex(color, typeof color === "string" ? color : "") || null;
export const mixerLoadOf = (reply: unknown) => reply && typeof reply === "object" && (reply as { loaded?: unknown }).loaded === true ? hex((reply as { color?: unknown }).color) : null;
/** A stroke refills the brush with its colour, or empties it; with neither, the engine does not say what the mixing left, so the last load stays shown. */
export const mixerLoadAfterStroke = (load: string | null, color: unknown, options: PaintOptions) => options.loadAfterStroke !== false ? hex(color) : options.cleanAfterStroke !== false ? null : load;

export function MixerBrushLoad({ load, disabled, run }: { load: string | null; disabled: boolean; run: (id: "paint.mixerBrush.load" | "paint.mixerBrush.clean") => void }) {
  return <MenuButton label="Current brush load" className="xd-ps-paint-trigger" disabled={disabled} items={[{ label: "Load Brush", run: () => run("paint.mixerBrush.load") }, { label: "Clean Brush", run: () => run("paint.mixerBrush.clean") }, "-", { label: "Load Solid Colors Only", checked: true, disabled: true }]}>
    <span className={`xd-ps-paint-swatch${load ? "" : " is-none"}`} style={load ? { background: load } : undefined}/>
  </MenuButton>;
}
