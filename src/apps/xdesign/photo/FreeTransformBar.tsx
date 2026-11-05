import { useState } from "react";
import { Ban, Check, Grid2x2, Link2, Unlink2 } from "lucide-react";
import { INTERPOLATIONS, commitFreeTransform, discardFreeTransform, freeTransformValue, patchFreeTransform, setFreeTransformField, setShowReference, switchFreeTransformToWarp, useFreeTransform, type FreeTransformField, type HistoryFold, type Interpolation } from "./freeTransform";
import { controlsLocked, usePhotoWorkspace } from "./runtime";

const REFERENCE_POINTS = [[-1, -1, "top left"], [0, -1, "top"], [1, -1, "top right"], [-1, 0, "left"], [0, 0, "center"], [1, 0, "right"], [-1, 1, "bottom left"], [0, 1, "bottom"], [1, 1, "bottom right"]] as const;

function Field({ text, label, field, disabled }: { text: string; label: string; field: FreeTransformField; disabled: boolean }) {
  const value = useFreeTransform(store => store.session ? freeTransformValue(store.session, store.showReference, field) : 0), [draft, setDraft] = useState<string | null>(null);
  const [name, unit] = [label.replace(/ \(.*\)$/, ""), label.match(/\((.*)\)$/)?.[1]];
  return <label><span>{text}</span><input aria-label={label} aria-invalid={draft !== null && !Number.isFinite(Number(draft))} type="number" step="any" disabled={disabled} title={name}
    value={draft ?? String(Math.round(value * 100) / 100)} onChange={event => { setDraft(event.target.value); setFreeTransformField(field, event.target.valueAsNumber); }}
    onBlur={() => setDraft(null)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}/>{unit}</label>;
}

export function FreeTransformBar({ untilShown, warp }: { untilShown: (work: Promise<unknown>) => Promise<unknown>; warp?: (fold?: HistoryFold) => void }) {
  const session = useFreeTransform(store => store.session), shown = useFreeTransform(store => store.showReference), busy = usePhotoWorkspace(controlsLocked);
  if (!session) return null;
  const disabled = busy || !!session.quad;
  return <div className="xd-ps-free-transform" role="group" aria-label="Free Transform" data-mode={session.mode}>
    <input type="checkbox" aria-label="Toggle reference point" title="Toggle reference point" checked={shown} disabled={busy} onChange={event => setShowReference(event.target.checked)}/>
    <span className="xd-ps-reference-point" role="group" aria-label="Reference point location">{REFERENCE_POINTS.map(([rx, ry, name]) => <button key={name} aria-label={`Reference point ${name}`} title="Reference point location" aria-pressed={session.reference[0] === rx && session.reference[1] === ry} disabled={!shown || disabled} onClick={() => patchFreeTransform({ reference: [rx, ry] })}/>)}</span>
    <Field text="X:" label="Transform X (px)" field="x" disabled={disabled}/><Field text="Y:" label="Transform Y (px)" field="y" disabled={disabled}/>
    <Field text="W:" label="Transform width (%)" field="width" disabled={disabled}/>
    <span className="xd-ps-icon-cluster"><button aria-label="Transform keep proportions" title="Maintain aspect ratio" aria-pressed={session.linked} disabled={busy} onClick={() => patchFreeTransform({ linked: !session.linked })}>{session.linked ? <Link2 size={16}/> : <Unlink2 size={16}/>}</button></span>
    <Field text="H:" label="Transform height (%)" field="height" disabled={disabled}/>
    <Field text="∠" label="Transform angle (°)" field="angle" disabled={disabled}/>
    <Field text="H skew:" label="Transform horizontal skew (°)" field="skewX" disabled={disabled}/><Field text="V skew:" label="Transform vertical skew (°)" field="skewY" disabled={disabled}/>
    <label><span>Interpolation:</span><select aria-label="Transform interpolation" disabled={busy} value={session.interpolation} onChange={event => patchFreeTransform({ interpolation: event.target.value as Interpolation })}>{INTERPOLATIONS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <span className="xd-ps-icon-cluster xd-ps-free-transform-end">
      {warp && <button aria-label="Switch between free transform and warp modes" title="Switch between free transform and warp modes" disabled={busy} onClick={() => { void switchFreeTransformToWarp(untilShown, warp); }}><Grid2x2 size={16}/></button>}
      <button aria-label="Cancel transform" title="Cancel transform (Esc)" onClick={discardFreeTransform}><Ban size={16}/></button>
      <button aria-label="Commit transform" title="Commit transform (Enter)" disabled={busy} onClick={() => { commitFreeTransform(untilShown)?.catch(() => {}); }}><Check size={16}/></button>
    </span>
  </div>;
}
