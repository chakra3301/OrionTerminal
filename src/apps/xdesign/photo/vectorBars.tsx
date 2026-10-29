import { useState, type ReactNode } from "react";
import { AlignHorizontalJustifyStart, ChevronDown, Link2, Settings2 as GearIcon } from "lucide-react";
import { MenuButton } from "../EditorMenus";
import { PopupSlider, usePopover } from "./OptionsBarControls";
import { blendOptions } from "./blendOptions";
import { FILL_MODES } from "./imageCommands";
import { TRANSPARENCY_MODES } from "./PaintToolOptions";
import { CommitNumber } from "./ShapeStyleFields";
import { PATH_OPS } from "./toolBars";
import { VECTOR_RANGES, type VectorToolOptions } from "./vectorToolPreferences";
import type { AlignEdge, ShapeConstraint } from "./vectorGeometry";
import "./vectorBars.css";

const round = (value: number) => Math.round(value * 100) / 100;

function LinkToggle({ label, linked, disabled, toggle }: { label: string; linked: boolean; disabled?: boolean; toggle: () => void }) {
  return <span className="xd-ps-icon-cluster"><button type="button" aria-label={label} title={label} aria-pressed={linked} disabled={disabled} onClick={toggle}><Link2 size={14}/></button></span>;
}

/** A gear or chevron that opens a small dialog of settings, closed by an outside click, Escape or tabbing away. */
function Popover({ label, title, icon, children }: { label: string; title: string; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLSpanElement>(open, close);
  return <span className="xd-ps-paint" {...rootProps}>
    <button ref={anchor} type="button" className="xd-ps-paint-trigger" aria-label={label} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? close(false) : setOpen(true)}>{icon ?? <ChevronDown size={9}/>}</button>
    {open && <div ref={pop} className="xd-ps-popover xd-ps-vector-popover" role="dialog" aria-label={label}>{children}</div>}
  </span>;
}

/** W, link and H for the selected shape or path. Each typed size is one resize. */
export function SizeFields({ size, linked, disabled, toggleLink, commit }: { size: { width: number; height: number } | null; linked: boolean; disabled?: boolean; toggleLink: () => void; commit: (width: number, height: number) => void }) {
  const off = disabled || !size, [min, max] = VECTOR_RANGES.constraint;
  const width = (value: number) => size && commit(value, linked ? size.height * value / size.width : size.height);
  const height = (value: number) => size && commit(linked ? size.width * value / size.height : size.width, value);
  return <>
    <span className="xd-ps-label">W:</span><CommitNumber label="Shape width" title="Set shape width" value={size ? round(size.width) : 0} min={min} max={max} unit="px" disabled={off} commit={width}/>
    <LinkToggle label="Link shape width and height" linked={linked} disabled={disabled} toggle={toggleLink}/>
    <span className="xd-ps-label">H:</span><CommitNumber label="Shape height" title="Set shape height" value={size ? round(size.height) : 0} min={min} max={max} unit="px" disabled={off} commit={height}/>
  </>;
}

const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
type Radii = [number, number, number, number];

/** The Rectangle tool's radius: one field for all four corners, and each corner on its own in the popover. */
export function CornerRadiusFields({ radii, linked, toggleLink, change }: { radii: Radii; linked: boolean; toggleLink: () => void; change: (radii: Radii) => void }) {
  const [min, max] = VECTOR_RANGES.radius, same = radii.every(radius => radius === radii[0]);
  const corner = (index: number, value: number) => change(linked ? [value, value, value, value] : radii.map((radius, i) => i === index ? value : radius) as Radii);
  return <>
    <span className="xd-ps-label">Radius:</span><CommitNumber label="Corner radius" title="Set radius of rounded corners" value={same ? radii[0] : null} min={min} max={max} unit="px" commit={value => change([value, value, value, value])}/>
    <Popover label="Corner radii" title="Set each corner's radius">
      <LinkToggle label="Link corner radius values" linked={linked} toggle={toggleLink}/>
      {CORNERS.map((name, index) => <label key={name} className="xd-ps-row"><span>{name}</span><CommitNumber label={`${name} corner radius`} value={radii[index]!} min={min} max={max} unit="px" commit={value => corner(index, value)}/></label>)}
    </Popover>
  </>;
}

/** The shape tools' gear: how a drag sizes the shape. */
export function ShapeGear({ ellipse, constraint, change }: { ellipse: boolean; constraint: ShapeConstraint; change: (constraint: ShapeConstraint) => void }) {
  const [min, max] = VECTOR_RANGES.constraint, kinds = [["unconstrained", "Unconstrained"], ["square", ellipse ? "Circle" : "Square"], ["fixedSize", "Fixed Size"], ["proportional", "Proportional"]] as const;
  const pair = (kind: "fixedSize" | "proportional", name: string, unit?: string) => <span className="xd-ps-row">
    <span>W:</span><CommitNumber label={`${name} width`} value={constraint.width} min={min} max={max} unit={unit} disabled={constraint.kind !== kind} commit={width => change({ ...constraint, kind, width })}/>
    <span>H:</span><CommitNumber label={`${name} height`} value={constraint.height} min={min} max={max} unit={unit} disabled={constraint.kind !== kind} commit={height => change({ ...constraint, kind, height })}/>
  </span>;
  return <Popover label="Shape options" title="Set additional shape and path options" icon={<GearIcon size={16}/>}>
    <div role="radiogroup" aria-label="Shape size" className="xd-ps-vector-popover">{kinds.map(([kind, label]) => <label key={kind} className="xd-ps-row">
      <input type="radio" name="xd-shape-constraint" aria-label={label} checked={constraint.kind === kind} onChange={() => change({ ...constraint, kind })}/>{label}
    </label>)}</div>
    {pair("fixedSize", "Fixed", "px")}{pair("proportional", "Proportional")}
    <label className="xd-ps-row"><input type="checkbox" aria-label="From Center" checked={constraint.fromCenter} onChange={event => change({ ...constraint, fromCenter: event.target.checked })}/>From Center</label>
  </Popover>;
}

type ArrowKey = "arrowStart" | "arrowEnd" | "arrowWidth" | "arrowLength" | "arrowConcavity";

/** The Line tool's gear: Photoshop's arrowheads, sized in percent of the line weight. */
export function LineGear({ options, change }: { options: VectorToolOptions; change: <K extends ArrowKey>(key: K, value: VectorToolOptions[K]) => void }) {
  const percent = (key: "arrowWidth" | "arrowLength" | "arrowConcavity", name: string) => <label className="xd-ps-row"><span>{name}:</span><CommitNumber label={`Arrowhead ${name.toLowerCase()}`} value={options[key]} min={VECTOR_RANGES[key][0]} max={VECTOR_RANGES[key][1]} whole unit="%" commit={value => change(key, value)}/></label>;
  return <Popover label="Line options" title="Set additional shape and path options" icon={<GearIcon size={16}/>}>
    <span className="xd-ps-label">Arrowheads</span>
    <span className="xd-ps-row">
      <label><input type="checkbox" aria-label="Start arrowhead" checked={options.arrowStart} onChange={event => change("arrowStart", event.target.checked)}/>Start</label>
      <label><input type="checkbox" aria-label="End arrowhead" checked={options.arrowEnd} onChange={event => change("arrowEnd", event.target.checked)}/>End</label>
    </span>
    {percent("arrowWidth", "Width")}{percent("arrowLength", "Length")}{percent("arrowConcavity", "Concavity")}
  </Popover>;
}

const ALIGN_ITEMS: [AlignEdge, string][] = [["left", "Align left edges"], ["hcenter", "Align horizontal centers"], ["right", "Align right edges"], ["top", "Align top edges"], ["vcenter", "Align vertical centers"], ["bottom", "Align bottom edges"]];

/** Photoshop's Path Alignment menu: align the selected path's components to each other or to the canvas. */
export function PathAlignMenu({ value, disabled, edgesDisabled, align, alignTo }: { value: "selection" | "canvas"; disabled?: boolean; edgesDisabled?: boolean; align: (edge: AlignEdge) => void; alignTo: (value: "selection" | "canvas") => void }) {
  return <MenuButton label="Path alignment" icon={AlignHorizontalJustifyStart} iconOnly disabled={disabled} items={[...ALIGN_ITEMS.map(([edge, label]) => ({ label, disabled: edgesDisabled, run: () => align(edge) })), "-",
    { label: "Align To Selection", radio: true, checked: value === "selection", run: () => alignTo("selection") }, { label: "Align To Canvas", radio: true, checked: value === "canvas", run: () => alignTo("canvas") }]}/>;
}

/** Shape, Path and, for the shape tools, Pixels. */
export function VectorModeSelect<T extends "shape" | "path" | "pixels">({ value, pixels, label = "Pick tool mode", change }: { value: T; pixels?: boolean; label?: string; change: (value: T) => void }) {
  return <select aria-label={label} title="Pick tool mode" value={value} onChange={event => change(event.target.value as T)}>
    <option value="shape">Shape</option><option value="path">Path</option>{pixels && <option value="pixels">Pixels</option>}
  </select>;
}

export function MakeButtons({ mask, shape = true, disabled, make }: { mask: boolean; shape?: boolean; disabled?: boolean; make: (what: "selection" | "mask" | "shape") => void }) {
  return <><span className="xd-ps-label">Make:</span>
    <button type="button" aria-label="Make selection from path" title="Make selection from path" disabled={disabled} onClick={() => make("selection")}>Selection…</button>
    <button type="button" aria-label="Make vector mask from path" title="Make vector mask from path" disabled={disabled || !mask} onClick={() => make("mask")}>Mask</button>
    <button type="button" aria-label="Make shape from path" title="Make shape from path" disabled={disabled || !shape} onClick={() => make("shape")}>Shape</button>
  </>;
}

type FreeformKey = "magnetic" | "curveFit" | "magneticWidth" | "magneticContrast" | "magneticFrequency" | "magneticPressure";

/** The Freeform Pen's Magnetic checkbox and its gear: Curve Fit, and the magnetic Width, Contrast, Frequency and Pen Pressure. */
export function FreeformFields({ options, change }: { options: VectorToolOptions; change: <K extends FreeformKey>(key: K, value: VectorToolOptions[K]) => void }) {
  const off = !options.magnetic, r = VECTOR_RANGES;
  return <>
    <Popover label="Freeform pen options" title="Set additional pen and path options" icon={<GearIcon size={16}/>}>
      <label className="xd-ps-row"><span>Curve Fit:</span><CommitNumber label="Curve Fit" value={options.curveFit} min={r.curveFit[0]} max={r.curveFit[1]} step={0.5} unit="px" commit={value => change("curveFit", value)}/></label>
      <label className="xd-ps-row"><span>Width:</span><CommitNumber label="Magnetic width" value={options.magneticWidth} min={r.magneticWidth[0]} max={r.magneticWidth[1]} whole unit="px" disabled={off} commit={value => change("magneticWidth", value)}/></label>
      <label className="xd-ps-row"><span>Contrast:</span><CommitNumber label="Magnetic contrast" value={options.magneticContrast} min={r.magneticContrast[0]} max={r.magneticContrast[1]} whole unit="%" disabled={off} commit={value => change("magneticContrast", value)}/></label>
      <label className="xd-ps-row"><span>Frequency:</span><CommitNumber label="Magnetic frequency" value={options.magneticFrequency} min={r.magneticFrequency[0]} max={r.magneticFrequency[1]} whole disabled={off} commit={value => change("magneticFrequency", value)}/></label>
      <label className="xd-ps-row"><input type="checkbox" aria-label="Pen Pressure" checked={options.magneticPressure} disabled={off} onChange={event => change("magneticPressure", event.target.checked)}/>Pen Pressure</label>
    </Popover>
    <label><input type="checkbox" aria-label="Magnetic" checked={options.magnetic} onChange={event => change("magnetic", event.target.checked)}/>Magnetic</label>
  </>;
}

/** The Pen's Auto Add/Delete, and its gear's Rubber Band. */
/** Pixels mode fills each outline as Edit › Fill does; an `opaque` target (a layer whose transparency is locked) greys Behind and Clear. */
export function PixelFields({ options, opaque, change }: { options: VectorToolOptions; opaque?: boolean; change: <K extends "pixelMode" | "pixelOpacity" | "pixelAntiAlias">(key: K, value: VectorToolOptions[K]) => void }) {
  return <>
    <label>Mode<select aria-label="Pixels blend mode" value={options.pixelMode} onChange={event => change("pixelMode", event.target.value)}>{blendOptions(FILL_MODES, undefined, opaque ? TRANSPARENCY_MODES : [])}</select></label>
    <PopupSlider label="Opacity" ariaLabel="Pixels opacity" unit="%" min={VECTOR_RANGES.pixelOpacity[0]} max={VECTOR_RANGES.pixelOpacity[1]} value={options.pixelOpacity} change={value => change("pixelOpacity", value)} commit={value => change("pixelOpacity", value)}/>
    <label><input type="checkbox" aria-label="Anti-alias" checked={options.pixelAntiAlias} onChange={event => change("pixelAntiAlias", event.target.checked)}/>Anti-alias</label>
  </>;
}

export function PenFields({ options, change }: { options: VectorToolOptions; change: <K extends "rubberBand" | "autoAddDelete">(key: K, value: VectorToolOptions[K]) => void }) {
  return <>
    <Popover label="Pen options" title="Set additional pen and path options" icon={<GearIcon size={16}/>}>
      <label className="xd-ps-row"><input type="checkbox" aria-label="Rubber Band" checked={options.rubberBand} onChange={event => change("rubberBand", event.target.checked)}/>Rubber Band</label>
    </Popover>
    <label><input type="checkbox" aria-label="Auto Add/Delete" checked={options.autoAddDelete} onChange={event => change("autoAddDelete", event.target.checked)}/>Auto Add/Delete</label>
  </>;
}

type ComponentOp = Exclude<typeof PATH_OPS[number][0], "new">;
/** Path Selection's path operations act on the selected path components, so there is no New Shape Layer. */
export function ComponentOpSelect({ value, disabled, change, merge }: { value: ComponentOp; disabled?: boolean; change: (value: ComponentOp) => void; merge?: () => void }) {
  return <select aria-label="Path operation" title="Path operations" disabled={disabled} value={value} onChange={event => { if (event.target.value === "merge") { event.target.value = value; merge?.(); } else change(event.target.value as ComponentOp); }}>
    {PATH_OPS.filter(([key]) => key !== "new").map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    <option value="merge" disabled={!merge}>Merge Shape Components</option>
  </select>;
}

export function SelectScopeSelect({ value, change }: { value: "active" | "all"; change: (value: "active" | "all") => void }) {
  return <label>Select:<select aria-label="Select layers" title="Select paths on the active layers or on all layers" value={value} onChange={event => change(event.target.value as "active" | "all")}><option value="active">Active Layers</option><option value="all">All Layers</option></select></label>;
}
