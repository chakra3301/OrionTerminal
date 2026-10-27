import { useRef, useState, type ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignHorizontalDistributeEnd, AlignHorizontalDistributeStart, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, AlignVerticalDistributeEnd, AlignVerticalDistributeStart, AlignVerticalSpaceAround, FlipHorizontal2, FlipVertical2, Link2, Link2Off, RotateCw, Check, Eye, Square, SquareDashed, SquareDashedMousePointer, SquarePlus, Trash2, type LucideIcon } from "lucide-react";
import { InspectorSection } from "../EditorChrome";
import { unitsPerPixel, usePreferences, type RulerUnit } from "./preferences";
import { runPhotoCommand } from "./runtime";
import type { PhotoLayer } from "./types";

type Quad = [number, number][];
const attempt = (work: Promise<unknown>) => { void work.catch(() => {}); };
const round = (value: number) => Math.round(value * 100) / 100;
const UNIT_LABELS: Record<RulerUnit, string> = { pixels: "px", inches: "in", centimeters: "cm", millimeters: "mm", points: "pt", picas: "pica", percent: "%" };

export function Field({ label, name, unit, value, disabled, commit }: { label: ReactNode; name: string; unit: string; value: number; disabled: boolean; commit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null), cancelled = useRef(false);
  const finish = () => {
    const text = draft, next = Number(text), cancel = cancelled.current;
    setDraft(null); cancelled.current = false;
    if (!cancel && text !== null && text.trim() !== "" && Number.isFinite(next) && next !== round(value)) commit(next);
  };
  return <label title={name}>{label}<input aria-label={name} type="number" step="any" disabled={disabled} value={draft ?? round(value)} onChange={event => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={event => { if (event.key !== "Enter" && event.key !== "Escape") return; event.preventDefault(); event.stopPropagation(); cancelled.current = event.key === "Escape"; event.currentTarget.blur(); }}/>{unit}</label>;
}

// Photoshop's Transform cluster: W and H resize from the top-left corner (linked keeps the aspect), X and Y move the layer,
// and the angle turns it about its centre. Pixel layers keep no rotation, so the angle reads 0° again once applied.
// Sizes and positions read in the ruler unit, percent being of the canvas width or height as on the rulers.
export function TransformSection({ layer, size: [width, height], resolution, disabled }: { layer: PhotoLayer; size: [number, number]; resolution: number; disabled: boolean }) {
  const [linked, setLinked] = useState(true);
  const unit = usePreferences(state => state.rulerUnit), pointSize = usePreferences(state => state.pointSize);
  const frame = layer.transformBounds ?? layer.bounds;
  if (!frame) return null;
  // An empty frame means the selection misses every pixel of the layer, so there is nothing to transform or move from.
  const [x, y, w, h] = frame, locked = disabled || !w || !h || !!layer.locks?.position || !!layer.locks?.all;
  const corners: Quad = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const transform = (quad: Quad) => attempt(runPhotoCommand("edit.transform", { layer: layer.id, rect: [x, y, x + w, y + h], quad }));
  const resize = (width: number, height: number) => { if (width > 0 && height > 0) transform([[x, y], [x + width, y], [x + width, y + height], [x, y + height]]); };
  const move = (dx: number, dy: number) => { if (dx || dy) attempt(runPhotoCommand("layer.translate", { layer: layer.id, dx, dy })); };
  const rotate = (degrees: number) => {
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = x + w / 2, cy = y + h / 2;
    transform(corners.map(([px, py]) => [cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos]));
  };
  const kx = unitsPerPixel(unit, resolution, pointSize, width), ky = unitsPerPixel(unit, resolution, pointSize, height), label = UNIT_LABELS[unit];
  const LinkIcon = linked ? Link2 : Link2Off;
  return <InspectorSection title="Transform" defaultOpen><div className="xd-photo-transform">
    <div><Field label="W" name="Width" unit={label} value={w * kx} disabled={locked} commit={value => { const next = value / kx; resize(next, linked ? h * next / w : h); }}/>
      <button type="button" aria-label="Link width and height" title="Link width and height" aria-pressed={linked} disabled={locked} onClick={() => setLinked(!linked)}><LinkIcon size={13}/></button>
      <Field label="H" name="Height" unit={label} value={h * ky} disabled={locked} commit={value => { const next = value / ky; resize(linked ? w * next / h : w, next); }}/></div>
    <div><Field label="X" name="X position" unit={label} value={x * kx} disabled={locked} commit={next => move(Math.round(next / kx - x), 0)}/><span/>
      <Field label="Y" name="Y position" unit={label} value={y * ky} disabled={locked} commit={next => move(0, Math.round(next / ky - y))}/></div>
    <div><Field label={<RotateCw size={12}/>} name="Angle" unit="°" value={0} disabled={locked} commit={rotate}/>
      <button type="button" aria-label="Flip horizontal" title="Flip horizontal" disabled={locked} onClick={() => transform([corners[1]!, corners[0]!, corners[3]!, corners[2]!])}><FlipHorizontal2 size={14}/></button>
      <button type="button" aria-label="Flip vertical" title="Flip vertical" disabled={locked} onClick={() => transform([corners[3]!, corners[2]!, corners[1]!, corners[0]!])}><FlipVertical2 size={14}/></button></div>
  </div></InspectorSection>;
}

type Icons = readonly (readonly [string, string, LucideIcon])[];
const ALIGN: Icons = [["leftEdges", "Align left edges", AlignStartVertical], ["horizontalCenters", "Align horizontal centers", AlignCenterVertical], ["rightEdges", "Align right edges", AlignEndVertical], ["topEdges", "Align top edges", AlignStartHorizontal], ["verticalCenters", "Align vertical centers", AlignCenterHorizontal], ["bottomEdges", "Align bottom edges", AlignEndHorizontal]];
const DISTRIBUTE: Icons = [["topEdges", "Distribute top edges", AlignVerticalDistributeStart], ["verticalCenters", "Distribute vertical centers", AlignVerticalDistributeCenter], ["bottomEdges", "Distribute bottom edges", AlignVerticalDistributeEnd], ["leftEdges", "Distribute left edges", AlignHorizontalDistributeStart], ["horizontalCenters", "Distribute horizontal centers", AlignHorizontalDistributeCenter], ["rightEdges", "Distribute right edges", AlignHorizontalDistributeEnd]];
const SPACING: Icons = [["vertically", "Distribute vertical spacing", AlignVerticalSpaceAround], ["horizontally", "Distribute horizontal spacing", AlignHorizontalSpaceAround]];

// As in Photoshop, "Selection" aligns to an active selection, else to the selected layers, and a lone layer with nothing
// selected goes to the canvas; distributing needs three or more layers.
export function AlignSection({ layers, hasSelection, disabled }: { layers: number; hasSelection: boolean; disabled: boolean }) {
  const [alignTo, setAlignTo] = useState<"selection" | "canvas">("selection");
  const to = alignTo === "canvas" ? "canvas" : hasSelection ? "selection" : layers > 1 ? "layers" : "canvas";
  const icons = (entries: Icons, run: (id: string) => void, off: boolean) => entries.map(([id, label, Icon]) => <button key={id} type="button" aria-label={label} title={label} disabled={disabled || off} onClick={() => run(id)}><Icon size={14}/></button>);
  const distribute = (id: string) => attempt(runPhotoCommand(`layer.distribute.${id}`, {}));
  return <InspectorSection title="Align and Distribute" defaultOpen><div className="xd-photo-align">
    <div>{icons(ALIGN, id => attempt(runPhotoCommand(`layer.align.${id}`, { to })), false)}</div>
    <div>{icons(DISTRIBUTE, distribute, layers < 3)}</div>
    <div>{icons(SPACING, distribute, layers < 3)}<label>Align To<select aria-label="Align to" disabled={disabled} value={alignTo} onChange={event => setAlignTo(event.target.value as "selection" | "canvas")}><option value="selection">Selection</option><option value="canvas">Canvas</option></select></label></div>
  </div></InspectorSection>;
}

type MaskAction = readonly [label: string, Icon: LucideIcon, run: () => void, off?: boolean];

// Density and Feather are absent: the engine keeps no per-mask density or feather, and does not report whether a mask is enabled,
// so the enable button toggles. Shown under the layer clusters, as the editor has no "mask targeted" state.
export function MaskSection({ layer, view, hasSelection, disabled, refine, colorRange }: { layer: PhotoLayer; view: string; hasSelection: boolean; disabled: boolean; refine: () => void; colorRange: () => void }) {
  const run = (id: string, params: Record<string, unknown> = {}) => attempt(runPhotoCommand(id, params));
  const footer = (actions: readonly MaskAction[]) => <div className="xd-photo-mask-footer">{actions.map(([label, Icon, onClick, off]) => <button key={label} type="button" aria-label={label} title={label} disabled={disabled || off} onClick={onClick}><Icon size={14}/></button>)}</div>;
  if (!layer.hasMask) return <InspectorSection title="Layer Mask" defaultOpen={false}>{footer([
    ["Add pixel mask", SquarePlus, () => run("layer.layerMask.revealAll")],
    ["Hide all (add black mask)", Square, () => run("layer.layerMask.hideAll")],
    ["Mask selection", SquareDashedMousePointer, () => run("layer.layerMask.revealSelection"), !hasSelection],
  ])}</InspectorSection>;
  return <InspectorSection title="Layer Mask" defaultOpen>
    <label className="xd-photo-property">View<select aria-label="Layer mask view" disabled={disabled} value={view} onChange={event => run("view.layerMask", { layer: layer.id, mode: event.target.value })}><option value="off">Composite</option><option value="gray">Grayscale mask</option><option value="overlay">Red overlay</option></select></label>
    <div className="xd-photo-action-list"><button type="button" disabled={disabled || !hasSelection} onClick={refine}>Select and Mask…</button><button type="button" disabled={disabled} onClick={colorRange}>Color Range…</button></div>
    {footer([
      ["Load Selection from Mask", SquareDashed, () => run("select.loadSelection", { channel: "mask", layer: layer.id })],
      ["Apply Mask", Check, () => run("layer.layerMask.apply")],
      ["Disable/Enable Mask", Eye, () => run("layer.layerMask.enabled", { layer: layer.id })],
      ["Delete Mask", Trash2, () => run("layer.layerMask.delete")],
    ])}
  </InspectorSection>;
}
