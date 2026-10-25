import { useEffect, useState } from "react";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { CropRatio, CropSizeValues } from "./toolBars";

export const CROP_PRESETS_KEY = "orion.xdesign.crop-presets.v1";
const CROP_PRESETS_CHANGED = "orion:crop-presets";
export type CropPreset = { name: string; values: CropRatio };

/** The options a preset keeps for its kind of crop, with Photoshop's default units filled in. */
function presetValues(values: CropRatio): CropRatio {
  if (values.style === "fixedRatio") return { style: "fixedRatio", ratioWidth: Number(values.ratioWidth) || 0, ratioHeight: Number(values.ratioHeight) || 0 };
  if (values.style !== "size") return { style: "normal" };
  return { style: "size", sizeWidth: Number(values.sizeWidth) || 0, sizeWidthUnit: String(values.sizeWidthUnit ?? "px"), sizeHeight: Number(values.sizeHeight) || 0, sizeHeightUnit: String(values.sizeHeightUnit ?? "px"), resolution: Number(values.resolution) || 0, resolutionUnit: values.resolutionUnit === "cm" ? "cm" : "in" };
}
function loadPresets(): CropPreset[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CROP_PRESETS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is CropPreset => typeof item?.name === "string" && !!item.name && typeof item.values === "object" && !!item.values) : [];
  } catch { return []; }
}
function storePresets(next: CropPreset[]) {
  try { localStorage.setItem(CROP_PRESETS_KEY, JSON.stringify(next)); } catch { /* Presets stay for this session when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(CROP_PRESETS_CHANGED, { detail: next }));
}
// Photoshop replaces a preset saved under a name already in the list.
export function saveCropPreset(name: string, values: CropRatio) {
  const presets = loadPresets(), preset = { name, values: presetValues(values) }, index = presets.findIndex(item => item.name === name);
  storePresets(index === -1 ? [...presets, preset] : presets.map((item, at) => at === index ? preset : item));
}
/** Deletes the named preset, or every one when `name` is null. */
export function deleteCropPreset(name: string | null) { storePresets(name === null ? [] : loadPresets().filter(item => item.name !== name)); }

export function useCropPresets() {
  const [presets, setPresets] = useState(loadPresets);
  useEffect(() => { const sync = (event: Event) => setPresets((event as CustomEvent<CropPreset[]>).detail); window.addEventListener(CROP_PRESETS_CHANGED, sync); return () => window.removeEventListener(CROP_PRESETS_CHANGED, sync); }, []);
  return presets;
}
// Unconstrained already reads as Ratio, so only ratio and size presets take over the menu's label.
export function matchingCropPreset(presets: CropPreset[], values: CropRatio) {
  const current = JSON.stringify(presetValues(values));
  return values.style === "fixedRatio" || values.style === "size" ? presets.find(preset => JSON.stringify(presetValues(preset.values)) === current) : undefined;
}
export function applyCropPreset(values: CropRatio, { apply, applySize, clear }: { apply: (width: number, height: number) => void; applySize: (values: CropSizeValues) => void; clear: () => void }) {
  const preset = presetValues(values);
  if (preset.style === "fixedRatio") apply(Number(preset.ratioWidth), Number(preset.ratioHeight)); else if (preset.style === "size") applySize(preset as CropSizeValues); else clear();
}

const trim = (value: number, places = 2) => Number(value.toFixed(places));
/** The name Photoshop fills in for the current crop: "16 : 9", "800 x 600 px 72 ppi", "4 in x 600 px 28.346 ppcm" or "4 in W". */
export function cropPresetName(values: CropRatio) {
  const preset = presetValues(values);
  if (preset.style === "fixedRatio") return `${trim(Number(preset.ratioWidth))} : ${trim(Number(preset.ratioHeight))}`;
  if (preset.style !== "size") return "Unconstrained";
  const width = Number(preset.sizeWidth), height = Number(preset.sizeHeight), resolution = Number(preset.resolution), widthUnit = String(preset.sizeWidthUnit), heightUnit = String(preset.sizeHeightUnit);
  const size = width > 0 && height > 0 ? widthUnit === heightUnit ? `${trim(width)} x ${trim(height)} ${widthUnit}` : `${trim(width)} ${widthUnit} x ${trim(height)} ${heightUnit}`
    : width > 0 ? `${trim(width)} ${widthUnit} W` : height > 0 ? `${trim(height)} ${heightUnit} H` : "";
  return [size, resolution > 0 && `${trim(resolution, 3)} ${preset.resolutionUnit === "cm" ? "ppcm" : "ppi"}`].filter(Boolean).join(" ");
}

export function NewCropPresetDialog({ values, close }: { values: CropRatio; close: () => void }) {
  const [name, setName] = useState(() => cropPresetName(values)), [missing, setMissing] = useState(false);
  const dialog = useDesignDialog<HTMLFormElement>(close);
  return <PhotoDialog dialog={dialog} title="New Crop Preset" className="xd-ps-crop-preset" noValidate close={close} onSubmit={event => {
    event.preventDefault();
    if (!name.trim()) { setMissing(true); return; }
    saveCropPreset(name.trim(), values); close();
  }}>
    <div className="xd-ps-dialog-grid"><label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Crop preset name" maxLength={240} value={name} onFocus={event => event.currentTarget.select()} onChange={event => { setName(event.target.value); setMissing(false); }}/></label></div>
    {missing && <p role="alert">You must specify a name for the crop preset.</p>}
  </PhotoDialog>;
}

function ConfirmDeleteCropPreset({ name, close, confirm }: { name: string | null; close: () => void; confirm: () => void }) {
  const dialog = useDesignDialog<HTMLFormElement>(close);
  return <PhotoDialog dialog={dialog} title="Delete Crop Preset" label="Confirm crop preset deletion" ok="Yes" cancel={false} buttons={<button type="button" onClick={close}>No</button>} close={close} onSubmit={event => { event.preventDefault(); confirm(); }}>
    <p>{name === null ? "Do you really want to delete all the crop presets?" : `Do you really want to delete the crop preset '${name}'?`}</p>
  </PhotoDialog>;
}

// An empty value stands for All Crop Presets; a saved preset always has a name.
export function DeleteCropPresetDialog({ presets, close }: { presets: CropPreset[]; close: () => void }) {
  const [chosen, setChosen] = useState(presets[0]?.name ?? ""), [confirming, setConfirming] = useState(false);
  const dialog = useDesignDialog<HTMLFormElement>(close);
  return <>
    <PhotoDialog dialog={dialog} title="Delete Crop Preset" ok="Delete" close={close} onSubmit={event => { event.preventDefault(); setConfirming(true); }}>
      <div className="xd-ps-dialog-grid"><label className="xd-ps-dialog-field"><span>Preset:</span><select aria-label="Crop preset to delete" value={chosen} onChange={event => setChosen(event.target.value)}>
        {presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}<option value="">All Crop Presets</option></select></label></div>
    </PhotoDialog>
    {confirming && <ConfirmDeleteCropPreset name={chosen || null} close={() => setConfirming(false)} confirm={() => { deleteCropPreset(chosen || null); close(); }}/>}
  </>;
}
