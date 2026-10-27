import { AlignCenter, AlignHorizontalDistributeCenter, AlignHorizontalDistributeEnd, AlignHorizontalDistributeStart, AlignHorizontalSpaceAround, AlignLeft, AlignRight, AlignVerticalDistributeCenter, AlignVerticalDistributeEnd, AlignVerticalDistributeStart, AlignVerticalSpaceAround, ArrowDownUp, Brush, Ellipsis, FlipHorizontal2, Gauge, Settings2, SprayCan, Type as TypeIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MenuButton } from "../EditorMenus";
import { DeleteCropPresetDialog, NewCropPresetDialog, applyCropPreset, matchingCropPreset, useCropPresets } from "./CropPresets";
import type { MenuEntry } from "../menuModel";
import { InfoNote } from "./OptionsBarControls";
import { GradientEditorDialog, GradientPick, gradientCss, type EditedGradient } from "./GradientEditorDialog";

export const TYPE_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"] as const;
export const TYPE_ANTIALIAS = ["none", "sharp", "crisp", "strong", "smooth"] as const;
export const PATH_OPS = [["new", "New Shape Layer"], ["combine", "Combine Shapes"], ["subtract", "Subtract Front Shape"], ["intersect", "Intersect Shape Areas"], ["exclude", "Exclude Overlapping Shapes"]] as const;
export type TypeStyle = typeof TYPE_STYLES[number];
export type TypeAlign = "left" | "center" | "right";
export type PathOp = typeof PATH_OPS[number][0];
export type ShapeStyle = { fill: boolean; stroke: boolean; strokeColor: string; strokeWidth: number };

// Regular must reset weight/italic when restyling an existing layer, but stay out of type.create's params.
export const typeStyleParams = (style: TypeStyle, reset = false) => ({ ...(style.includes("Bold") ? { weight: 700 } : reset ? { weight: 400 } : {}), ...(style.includes("Italic") ? { italic: true } : reset ? { italic: false } : {}) });
export const shapeStyleParams = (style: ShapeStyle, fill: unknown) => ({ fill: style.fill ? fill : null, ...(style.stroke ? { stroke: { color: style.strokeColor, width: style.strokeWidth } } : {}) });

export function IconCluster<T extends string>({ label, value, options, change, disabled }: { label: string; value: T; options: readonly (readonly [T, string, LucideIcon])[]; change: (value: T) => void; disabled?: boolean }) {
  return <div role="group" aria-label={label} className="xd-ps-icon-cluster">{options.map(([key, name, Icon]) => <button key={key} aria-label={name} title={name} aria-pressed={value === key} disabled={disabled} onClick={() => change(key)}><Icon size={16} /></button>)}</div>;
}
const ALIGNS = [["left", "Left align text", AlignLeft], ["center", "Center text", AlignCenter], ["right", "Right align text", AlignRight]] as const;
const ORIENTATIONS = [["horizontal", "Horizontal type", TypeIcon], ["vertical", "Vertical type", ArrowDownUp]] as const;

export type TypeBarProps = { font: string; size: number; style: TypeStyle; align: TypeAlign; antialias: string; orientation: string; fonts: { listId: string; list: ReactNode }; warpDisabled: boolean;
  // The swatch edits freely, then `commitColor` applies it (a native colour picker fires input events while dragging).
  color?: string; changeColor?: (color: string) => void; commitColor?: () => void;
  patch: (patch: Partial<{ font: string; size: number; style: TypeStyle; align: TypeAlign; antialias: string; orientation: string }>) => void; warp: () => void };
export function TypeBar({ font, size, style, align, antialias, orientation, fonts, warpDisabled, color, changeColor, commitColor, patch, warp }: TypeBarProps) {
  return <>
    <IconCluster label="Text orientation" value={orientation as "horizontal" | "vertical"} options={ORIENTATIONS} change={value => patch({ orientation: value })} />
    <label>Font<input aria-label="Text font" list={fonts.listId} value={font} onChange={event => patch({ font: event.target.value })} />{fonts.list}</label>
    <select aria-label="Text font style" value={style} onChange={event => patch({ style: event.target.value as TypeStyle })}>{TYPE_STYLES.map(value => <option key={value}>{value}</option>)}</select>
    <label>Size<input aria-label="Text size" type="number" min="1" max="10000" value={size} onChange={event => patch({ size: Math.max(1, Math.min(10000, event.target.valueAsNumber || 1)) })} /><span>pt</span></label>
    <select aria-label="Text anti-aliasing" value={antialias} onChange={event => patch({ antialias: event.target.value })}>{TYPE_ANTIALIAS.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select>
    <IconCluster label="Text alignment" value={align} options={ALIGNS} change={value => patch({ align: value })} />
    {color !== undefined && changeColor && <input type="color" aria-label="Type tool color" title="Text color" value={color} onChange={event => changeColor(event.target.value)} onBlur={commitColor} />}
    <button aria-label="Create warped text" title="Create warped text" disabled={warpDisabled} onClick={warp}>Warp Text…</button>
  </>;
}

export function ShapeStyleFields({ style, change }: { style: ShapeStyle; change: (patch: Partial<ShapeStyle>) => void }) {
  return <>
    <label><input type="checkbox" aria-label="Shape fill" checked={style.fill} onChange={event => change({ fill: event.target.checked })} />Fill</label>
    <label><input type="checkbox" aria-label="Shape stroke" checked={style.stroke} onChange={event => change({ stroke: event.target.checked })} />Stroke</label>
    <input type="color" aria-label="Stroke color" disabled={!style.stroke} value={style.strokeColor} onChange={event => change({ strokeColor: event.target.value })} />
    <label>Width<input aria-label="Stroke width" className="xd-ps-number" type="number" min="0" max="1000" disabled={!style.stroke} value={style.strokeWidth} onChange={event => change({ strokeWidth: Math.max(0, Math.min(1000, event.target.valueAsNumber || 0)) })} /><span>px</span></label>
  </>;
}
export function PathOpSelect({ value, change, merge }: { value: PathOp; change: (value: PathOp) => void; merge?: () => void }) {
  return <select aria-label="Path operation" title="Path operations" value={value} onChange={event => { if (event.target.value === "merge") { event.target.value = value; merge?.(); } else change(event.target.value as PathOp); }}>
    {PATH_OPS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    <option value="merge" disabled={!merge}>Merge Shape Components</option>
  </select>;
}

export type CropRatio = Partial<Record<"style" | "ratioWidth" | "ratioHeight" | "sizeWidth" | "sizeWidthUnit" | "sizeHeight" | "sizeHeightUnit" | "resolution" | "resolutionUnit", unknown>>;
export type CropSizeValues = Partial<Record<"style" | "sizeWidthUnit" | "sizeHeightUnit" | "resolutionUnit", string> & Record<"sizeWidth" | "sizeHeight" | "resolution", number>>;
// Photoshop's W x H x Resolution presets, listed after Front Image.
const CROP_SIZE_PRESETS: [string, number, number, string, number][] = [["4 x 5 in 300 ppi", 4, 5, "in", 300], ["8.5 x 11 in 300 ppi", 8.5, 11, "in", 300], ["1024 x 768 px 92 ppi", 1024, 768, "px", 92], ["1280 x 800 px 113 ppi", 1280, 800, "px", 113], ["1366 x 768 px 135 ppi", 1366, 768, "px", 135]];
export const CROP_SIZES = ["Front Image", ...CROP_SIZE_PRESETS.map(([name]) => name)];
const PER_INCH: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4 };
const LENGTH = /^\s*(\d*\.?\d+)\s*(px|in|cm|mm)?\s*$/i;
const decimals = (value: number) => Number(value.toFixed(2));
/** The ppi the Resolution field asks for, in pixels per inch, or the document's when it is empty. */
export function cropResolution(values: CropRatio, documentPpi: number) {
  const set = Number(values.resolution);
  return set > 0 ? values.resolutionUnit === "cm" ? decimals(set * 2.54) : set : documentPpi;
}
/** The pixels and ppi a W x H x Resolution crop resamples to, or null until both sides have a size. */
export function cropSizePixels(values: CropRatio, documentPpi: number) {
  const width = Number(values.sizeWidth), height = Number(values.sizeHeight);
  if (values.style !== "size" || !(width > 0) || !(height > 0)) return null;
  const ppi = cropResolution(values, documentPpi);
  const pixels = (value: number, unit: unknown) => Math.max(1, Math.round(typeof unit === "string" && unit in PER_INCH ? value / PER_INCH[unit]! * ppi : value));
  return { width: pixels(width, values.sizeWidthUnit), height: pixels(height, values.sizeHeightUnit), ppi };
}
/** The Ratio menu's entry for a size, or "size" when it matches no preset. */
export function cropSizeName(values: CropRatio) {
  return CROP_SIZE_PRESETS.find(([, w, h, unit, ppi]) => values.sizeWidth === w && values.sizeHeight === h && values.sizeWidthUnit === unit && values.sizeHeightUnit === unit && values.resolution === ppi && values.resolutionUnit !== "cm")?.[0] ?? "size";
}
/** Choosing a size from the Ratio menu or the crop context menu; Front Image takes the image's own. */
export function cropSizeChoice(name: string, original: [number, number], resolution: number): CropSizeValues | null {
  if (name === "Front Image") return { style: "size", sizeWidth: original[0], sizeWidthUnit: "px", sizeHeight: original[1], sizeHeightUnit: "px", resolution, resolutionUnit: "in" };
  const preset = CROP_SIZE_PRESETS.find(([label]) => label === name);
  return preset ? { style: "size", sizeWidth: preset[1], sizeWidthUnit: preset[3], sizeHeight: preset[2], sizeHeightUnit: preset[3], resolution: preset[4], resolutionUnit: "in" } : null;
}
// Photoshop's Ratio dropdown with its W : H pair and swap; `apply` refits the crop box like the context menu does.
type CropRatioProps = { values: CropRatio; ratios: readonly (readonly [string, number, number])[]; original: [number, number]; resolution: number; disabled: boolean; apply: (width: number, height: number) => void; applySize: (values: CropSizeValues) => void; clear: () => void };
// Saved presets follow the sizes, as in Photoshop, and win the label over a built-in entry with the same values.
export function CropRatioSelect({ values, ratios, original, resolution, disabled, apply, applySize, clear }: CropRatioProps) {
  const presets = useCropPresets(), saved = matchingCropPreset(presets, values), [dialog, setDialog] = useState<"new" | "delete" | null>(null), anchor = useRef<HTMLSelectElement>(null);
  const fixed = values.style === "fixedRatio", w = Number(values.ratioWidth), h = Number(values.ratioHeight);
  const known = saved ? `preset:${saved.name}` : values.style === "size" ? cropSizeName(values) : fixed ? w * original[1] === h * original[0] ? "original" : ratios.find(([, rw, rh]) => rw * h === rh * w)?.[0] ?? "custom" : "none";
  const close = () => setDialog(null), host = anchor.current?.closest(".xd-photo");
  const open = dialog === "new" ? <NewCropPresetDialog values={values} close={close} /> : dialog === "delete" ? <DeleteCropPresetDialog presets={presets} close={close} /> : null;
  return <><select ref={anchor} aria-label="Crop ratio" disabled={disabled} value={known} onChange={event => {
    const value = event.target.value, size = cropSizeChoice(value, original, resolution), preset = value.startsWith("preset:") && presets.find(item => `preset:${item.name}` === value);
    if (value === "new" || value === "delete") setDialog(value); else if (preset) applyCropPreset(preset.values, { apply, applySize, clear });
    else if (value === "none") clear(); else if (value === "size") applySize({ style: "size", sizeWidth: 0, sizeHeight: 0, resolution: 0 }); else if (size) applySize(size); else if (value === "original") apply(...original);
    else { const ratio = ratios.find(([name]) => name === value); if (ratio) apply(ratio[1], ratio[2]); }
  }}>
    <option value="none">Ratio</option><option value="size">W x H x Resolution</option><option value="original">Original Ratio</option>{ratios.map(([name]) => <option key={name} value={name}>{name}</option>)}{known === "custom" && <option value="custom">Custom</option>}
    {CROP_SIZES.map(name => <option key={name} value={name}>{name}</option>)}
    {presets.map(preset => <option key={preset.name} value={`preset:${preset.name}`}>{preset.name}</option>)}
    <option value="new">New Crop Preset…</option><option value="delete" disabled={!presets.length}>Delete Crop Preset…</option></select>
    {open && (host ? createPortal(open, host) : open)}</>;
}
// Photoshop's length fields read "4 in" or "1024 px", applying what was typed on Enter or blur; a bare number keeps the field's unit.
function CropLength({ label, value, unit, disabled, commit }: { label: string; value: number; unit: string; disabled: boolean; commit: (value: number, unit: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null), shown = value > 0 ? `${decimals(value)} ${unit}` : "";
  const finish = () => {
    if (draft === null) return; setDraft(null);
    const match = LENGTH.exec(draft);
    if (!draft.trim()) commit(0, unit); else if (match) commit(Number(match[1]), match[2]?.toLowerCase() ?? unit);
  };
  return <input aria-label={label} className="xd-ps-number is-length" type="text" disabled={disabled} value={draft ?? shown} onChange={event => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } else if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } }} />;
}
function CropSizeFields({ values, disabled, applySize, children, labelled }: Pick<CropRatioProps, "values" | "disabled" | "applySize"> & { children?: ReactNode; labelled?: boolean }) {
  const width = Number(values.sizeWidth) || 0, height = Number(values.sizeHeight) || 0, resolution = Number(values.resolution) || 0;
  const widthUnit = String(values.sizeWidthUnit ?? "px"), heightUnit = String(values.sizeHeightUnit ?? "px"), resolutionUnit = values.resolutionUnit === "cm" ? "cm" : "in";
  const field = (text: string, input: ReactNode) => labelled ? <label>{text}{input}</label> : input;
  return <>
    {field("W:", <CropLength label="Crop width" value={width} unit={widthUnit} disabled={disabled} commit={(sizeWidth, sizeWidthUnit) => applySize({ sizeWidth, sizeWidthUnit })} />)}
    <button aria-label="Swap crop size" title="Swap width and height" disabled={disabled} onClick={() => applySize({ sizeWidth: height, sizeWidthUnit: heightUnit, sizeHeight: width, sizeHeightUnit: widthUnit })}>⇄</button>
    {field("H:", <CropLength label="Crop height" value={height} unit={heightUnit} disabled={disabled} commit={(sizeHeight, sizeHeightUnit) => applySize({ sizeHeight, sizeHeightUnit })} />)}
    {field("Resolution:", <input aria-label="Crop resolution" className="xd-ps-number" type="number" min="0" max="100000" disabled={disabled} value={resolution > 0 ? resolution : ""} onChange={event => applySize({ resolution: Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber > 0 ? event.target.valueAsNumber : 0 })} />)}
    <select aria-label="Crop resolution unit" disabled={disabled} value={resolutionUnit} onChange={event => { const unit = event.target.value; applySize({ resolution: Number((unit === "cm" ? resolution / 2.54 : resolution * 2.54).toFixed(3)), resolutionUnit: unit }); }}><option value="in">{labelled ? "Pixels/in" : "px/in"}</option><option value="cm">{labelled ? "Pixels/cm" : "px/cm"}</option></select>
    {children}
    <button aria-label="Clear crop size" title="Clear the width, height and resolution" disabled={disabled || !labelled && !width && !height && !resolution} onClick={() => applySize({ sizeWidth: 0, sizeHeight: 0, resolution: 0 })}>Clear</button>
  </>;
}
// Photoshop's Perspective Crop bar: W ⇄ H, Resolution, Front Image, Clear and Show Grid. Empty sizes keep the size from the corners.
export function PerspectiveCropBar({ values, original, resolution, disabled, change }: { values: CropRatio & { showGrid?: unknown }; original: [number, number]; resolution: number; disabled: boolean; change: (values: CropSizeValues & { showGrid?: boolean }) => void }) {
  return <>
    <CropSizeFields values={values} disabled={disabled} applySize={change} labelled>
      <button aria-label="Front Image" title="Use the image's size and resolution" disabled={disabled} onClick={() => change(cropSizeChoice("Front Image", original, resolution)!)}>Front Image</button>
    </CropSizeFields>
    <label><input type="checkbox" aria-label="Show grid" checked={values.showGrid !== false} disabled={disabled} onChange={event => change({ showGrid: event.target.checked })} />Show Grid</label>
  </>;
}
// Unconstrained, Photoshop shows the pair empty and only constrains the box once both sides have a value.
export function CropRatioFields(props: CropRatioProps) {
  const { values, disabled, apply, clear } = props, fixed = values.style === "fixedRatio";
  const [pending, setPending] = useState<[number, number]>([NaN, NaN]);
  const [w, h] = fixed ? [Number(values.ratioWidth), Number(values.ratioHeight)] : pending;
  const set = (next: [number, number]) => { if (next[0] > 0 && next[1] > 0) { setPending([NaN, NaN]); apply(...next); } else if (!fixed) setPending(next); };
  const field = (value: number) => Number.isFinite(value) ? value : "";
  if (values.style === "size") return <><CropRatioSelect {...props} /><CropSizeFields {...props} /></>;
  return <>
    <CropRatioSelect {...props} />
    <input aria-label="Crop ratio width" className="xd-ps-number" type="number" min="0.01" max="100000" disabled={disabled} value={field(w)} onChange={event => set([event.target.valueAsNumber, h])} />
    <button aria-label="Swap crop ratio" title="Swap width and height" disabled={disabled} onClick={() => set([h, w])}>⇄</button>
    <input aria-label="Crop ratio height" className="xd-ps-number" type="number" min="0.01" max="100000" disabled={disabled} value={field(h)} onChange={event => set([w, event.target.valueAsNumber])} />
    <button aria-label="Clear crop ratio" title="Clear the ratio" disabled={disabled || !fixed && !Number.isFinite(w) && !Number.isFinite(h)} onClick={() => { setPending([NaN, NaN]); if (fixed) clear(); }}>Clear</button>
  </>;
}

// Generative Expand stays listed but off: the engine has no generative model to expand with.
export function CropFillField({ value, deleteCroppedPixels, disabled, change }: { value: string; deleteCroppedPixels: boolean; disabled: boolean; change: (fill: string) => void }) {
  return <>
    <label>Fill:<select aria-label="Crop fill" disabled={disabled} value={value} onChange={event => change(event.target.value)}>
      <option value="background">{deleteCroppedPixels ? "Background (default)" : "Transparent (default)"}</option>
      <option value="generativeExpand" disabled>Generative Expand</option>
      <option value="contentAware">Content-Aware Fill</option>
    </select></label>
    <InfoNote label="Fill options">
      <p><b>Background (default):</b> Fill the expanded area with your background color or transparent pixels</p>
      <p><b>Generative expand:</b> Generate high-quality new content to fill expanded space, with or without a text prompt</p>
      <p><b>Content-aware fill:</b> Sample content from part of the image and use it to fill a small area</p>
    </InfoNote>
  </>;
}

const DISTRIBUTE = [["topEdges", "Distribute top edges", AlignVerticalDistributeStart], ["verticalCenters", "Distribute vertical centers", AlignVerticalDistributeCenter], ["bottomEdges", "Distribute bottom edges", AlignVerticalDistributeEnd], ["vertically", "Distribute vertically", AlignVerticalSpaceAround],
  ["leftEdges", "Distribute left edges", AlignHorizontalDistributeStart], ["horizontalCenters", "Distribute horizontal centers", AlignHorizontalDistributeCenter], ["rightEdges", "Distribute right edges", AlignHorizontalDistributeEnd], ["horizontally", "Distribute horizontally", AlignHorizontalSpaceAround]] as const;
// Photoshop folds Distribute behind the Move bar's "..." button.
export function DistributeMenu({ disabled, run }: { disabled: boolean; run: (command: string) => void }) {
  const [open, setOpen] = useState(false);
  return <><button aria-label="More alignment and distribute options" title="Distribute" aria-expanded={open} className="xd-ps-more" disabled={disabled} onClick={() => setOpen(value => !value)}><Ellipsis size={16} /></button>
    {open && <div role="group" aria-label="Distribute" className="xd-ps-icon-cluster">{DISTRIBUTE.map(([edge, name, Icon]) => <button key={edge} aria-label={name} title={name} disabled={disabled} onClick={() => run(`layer.distribute.${edge}`)}><Icon size={16} /></button>)}</div>}</>;
}

type Gradient = { name: string; stops: [number, string][]; transparency: [number, number][] };
/** The Gradient tool's swatch. Classic gradient edits it in the Gradient Editor (the swatch previews each edit, OK keeps it); the live Gradient tool picks presets from it, as in Photoshop. */
export function GradientToolPick({ current, live, foreground, background, disabled, select }: { current: Gradient; live: boolean; foreground: string; background: string; disabled: boolean; select: (params: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState<{ root: Element; draft: EditedGradient<string> | null } | null>(null);
  const hex = (color: string) => color === "foreground" ? foreground : color === "background" ? background : color;
  const gradient = { stops: current.stops, opacity: current.transparency.map(([at, alpha]): [number, number] => [at, alpha / 100]) }, shown = editing?.draft ?? gradient;
  // A classic gradient paints pixels, so it leaves a selected Gradient Fill layer alone.
  const target = live ? {} : { applyToLayer: false };
  return <>
    <GradientPick css={gradientCss(shown.stops, shown.opacity, hex)} disabled={disabled} edit={live ? undefined : event => setEditing({ root: event.currentTarget.closest(".xd-photo") ?? document.body, draft: null })} choose={(_, preset, group) => select({ preset, group, ...target })}/>
    {editing && createPortal(<GradientEditorDialog<string> gradient={gradient} name={current.name} hex={hex} color={value => value} preview={draft => setEditing(open => open && { ...open, draft })}
      choose={(next, name) => { setEditing(null); select({ name, stops: next.stops, transparency: next.opacity.map(([at, alpha]) => [at, Math.round(alpha * 100)]), ...target }); }} close={() => setEditing(null)}/>, editing.root)}
  </>;
}

// Which brush-bar controls Photoshop shows per painting tool; each reads and writes the engine's BrushSettings.
export type BrushBarItem = "airbrush" | "angle" | "pressureOpacity" | "pressureSize" | "symmetry";
export const BRUSH_BAR_ITEMS: Record<string, readonly BrushBarItem[]> = {
  "paint.stroke": ["airbrush", "angle", "pressureOpacity", "pressureSize", "symmetry"],
  "paint.pencil": ["angle", "pressureOpacity", "pressureSize", "symmetry"],
  erase: ["airbrush", "angle", "pressureOpacity", "pressureSize", "symmetry"],
  "paint.cloneStamp": ["airbrush", "angle", "pressureOpacity", "pressureSize"],
  "paint.patternStamp": ["airbrush", "angle", "pressureOpacity", "pressureSize"],
  "paint.historyBrush": ["airbrush", "angle", "pressureOpacity", "pressureSize"],
  "paint.dodge": ["airbrush", "angle", "pressureSize"], "paint.burn": ["airbrush", "angle", "pressureSize"], "paint.sponge": ["airbrush", "angle", "pressureSize"],
  "paint.healingBrush": ["pressureSize"], "paint.spotHealing": ["pressureSize"],
};
export type BrushBarSettings = Partial<{ angle: number; buildUp: boolean; pressureOpacity: boolean; pressureSize: boolean }>;
export type SymmetryChoice = { current: string; saved: string[]; hasWorkPath: boolean; choose: (name: string | null) => void };

export function BrushSettingsToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return <button type="button" className="xd-ps-toggle" aria-label="Brush Settings panel" title="Toggle the Brush Settings panel" aria-pressed={open} onClick={toggle}><Settings2 size={16} /></button>;
}

export function BrushBarItems({ tool, settings, patch, symmetry }: { tool: string; settings: BrushBarSettings; patch: (patch: BrushBarSettings) => void; symmetry?: SymmetryChoice }) {
  const items = BRUSH_BAR_ITEMS[tool];
  const [angle, setAngle] = useState(String(settings.angle ?? 0));
  useEffect(() => setAngle(String(Math.round(settings.angle ?? 0))), [settings.angle]);
  if (!items) return null;
  const toggle = (key: "buildUp" | "pressureOpacity" | "pressureSize", label: string, Icon: LucideIcon) =>
    <button key={key} type="button" className="xd-ps-toggle" aria-label={label} title={label} aria-pressed={!!settings[key]} onClick={() => patch({ [key]: !settings[key] })}><Icon size={16} /></button>;
  const symmetryItems: MenuEntry[] = symmetry ? [
    { label: "Off", radio: true, checked: symmetry.current === "", run: () => symmetry.choose(null) },
    "-",
    { label: "Work Path", radio: true, checked: symmetry.current === "work", disabled: !symmetry.hasWorkPath, run: () => symmetry.choose("work") },
    { label: "Selected Shape Layer Path", radio: true, checked: symmetry.current === "layer", run: () => symmetry.choose("layer") },
    ...symmetry.saved.map((name): MenuEntry => ({ label: name, radio: true, checked: symmetry.current === `saved:${name}`, run: () => symmetry.choose(`saved:${name}`) })),
  ] : [];
  return <>
    {items.includes("airbrush") && toggle("buildUp", "Airbrush", SprayCan)}
    {items.includes("angle") && <label>Angle<input aria-label="Brush angle" className="xd-ps-number" type="number" min="-180" max="180" value={angle} onChange={event => { setAngle(event.target.value); const value = event.target.valueAsNumber; if (Number.isFinite(value)) patch({ angle: Math.max(-180, Math.min(180, value)) }); }} /><span>°</span></label>}
    {items.includes("pressureOpacity") && toggle("pressureOpacity", "Always use pressure for opacity", Gauge)}
    {items.includes("pressureSize") && toggle("pressureSize", "Always use pressure for size", Brush)}
    {items.includes("symmetry") && symmetry && <MenuButton label="Painting symmetry" icon={FlipHorizontal2} iconOnly items={symmetryItems} />}
  </>;
}
