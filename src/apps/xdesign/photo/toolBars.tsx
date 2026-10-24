import { AlignCenter, AlignHorizontalDistributeCenter, AlignHorizontalDistributeEnd, AlignHorizontalDistributeStart, AlignHorizontalSpaceAround, AlignLeft, AlignRight, AlignVerticalDistributeCenter, AlignVerticalDistributeEnd, AlignVerticalDistributeStart, AlignVerticalSpaceAround, ArrowDownUp, Brush, Ellipsis, FlipHorizontal2, Gauge, Settings2, SprayCan, Type as TypeIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MenuButton } from "../EditorMenus";
import type { MenuEntry } from "../menuModel";

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
export function PathOpSelect({ value, change }: { value: PathOp; change: (value: PathOp) => void }) {
  return <select aria-label="Path operation" title="Path operations" value={value} onChange={event => change(event.target.value as PathOp)}>{PATH_OPS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>;
}

export type CropRatio = Partial<{ style: unknown; ratioWidth: unknown; ratioHeight: unknown }>;
// Photoshop's Ratio dropdown with its W : H pair and swap; `apply` refits the crop box like the context menu does.
export function CropRatioFields({ values, ratios, original, disabled, apply, clear }: { values: CropRatio; ratios: readonly (readonly [string, number, number])[]; original: [number, number]; disabled: boolean; apply: (width: number, height: number) => void; clear: () => void }) {
  const fixed = values.style === "fixedRatio", w = Number(values.ratioWidth), h = Number(values.ratioHeight);
  const known = fixed ? w * original[1] === h * original[0] ? "original" : ratios.find(([, rw, rh]) => rw * h === rh * w)?.[0] ?? "custom" : "none";
  return <>
    <label>Ratio<select aria-label="Crop ratio" disabled={disabled} value={known} onChange={event => { const value = event.target.value; if (value === "none") clear(); else if (value === "original") apply(...original); else { const preset = ratios.find(([name]) => name === value); if (preset) apply(preset[1], preset[2]); } }}>
      <option value="none">Unconstrained</option><option value="original">Original Ratio</option>{ratios.map(([name]) => <option key={name} value={name}>{name}</option>)}{known === "custom" && <option value="custom">Custom</option>}</select></label>
    {fixed && <><input aria-label="Crop ratio width" className="xd-ps-number" type="number" min="0.01" max="100000" disabled={disabled} value={w} onChange={event => event.target.valueAsNumber > 0 && apply(event.target.valueAsNumber, h)} />
      <button aria-label="Swap crop ratio" title="Swap width and height" disabled={disabled} onClick={() => apply(h, w)}>⇄</button>
      <input aria-label="Crop ratio height" className="xd-ps-number" type="number" min="0.01" max="100000" disabled={disabled} value={h} onChange={event => event.target.valueAsNumber > 0 && apply(w, event.target.valueAsNumber)} /></>}
    <button aria-label="Clear crop ratio" title="Clear the ratio" disabled={disabled || !fixed} onClick={clear}>Clear</button>
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
export const gradientCss = (gradient: Gradient, foreground: string, background: string) => `linear-gradient(90deg, ${gradient.stops.map(([at, color]) => `${color === "foreground" ? foreground : color === "background" ? background : color} ${Math.round(at * 100)}%`).join(", ")})`;
export function GradientPresetSelect({ current, groups, foreground, background, disabled, select }: { current: Gradient; groups: { name: string; presets: Gradient[] }[]; foreground: string; background: string; disabled: boolean; select: (preset: string, group: string) => void }) {
  const owner = groups.find(group => group.presets.some(item => item.name === current.name));
  return <span className="xd-ps-gradient-pick"><span className="xd-ps-gradient-swatch" aria-hidden style={{ background: gradientCss(current, foreground, background) }} />
    <select aria-label="Gradient preset" disabled={disabled} value={owner ? `${owner.name}/${current.name}` : current.name} onChange={event => { const [group, ...name] = event.target.value.split("/"); select(name.join("/"), group!); }}>
      {!owner && <option value={current.name}>{current.name}</option>}
      {groups.map(group => <optgroup key={group.name} label={group.name}>{group.presets.map(item => <option key={`${group.name}/${item.name}`} value={`${group.name}/${item.name}`}>{item.name}</option>)}</optgroup>)}</select></span>;
}

// Which brush-bar controls Photoshop shows per painting tool; each reads and writes the engine's BrushSettings.
export type BrushBarItem = "airbrush" | "angle" | "pressureOpacity" | "pressureSize" | "symmetry";
export const BRUSH_BAR_ITEMS: Record<string, readonly BrushBarItem[]> = {
  "paint.stroke": ["airbrush", "angle", "pressureOpacity", "pressureSize", "symmetry"],
  "paint.pencil": ["angle", "pressureOpacity", "pressureSize", "symmetry"],
  erase: ["airbrush", "angle", "pressureOpacity", "pressureSize", "symmetry"],
  "paint.cloneStamp": ["airbrush", "angle", "pressureOpacity", "pressureSize"],
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
