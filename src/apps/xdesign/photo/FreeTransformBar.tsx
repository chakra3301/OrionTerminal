import { useState } from "react";
import { Ban, Check, Link2, Unlink2 } from "lucide-react";
import { INTERPOLATIONS, cancelFreeTransform, commitFreeTransform, patchFreeTransform, setFreeTransformField, useFreeTransform, type FreeTransformField, type Interpolation } from "./freeTransform";
import { controlsLocked, usePhotoWorkspace } from "./runtime";

function Field({ text, label, field, disabled }: { text: string; label: string; field: FreeTransformField; disabled: boolean }) {
  const value = useFreeTransform(store => store.session?.settings[field] ?? 0), [draft, setDraft] = useState<string | null>(null);
  const [name, unit] = [label.replace(/ \(.*\)$/, ""), label.match(/\((.*)\)$/)?.[1]];
  return <label><span>{text}</span><input aria-label={label} aria-invalid={draft !== null && !Number.isFinite(Number(draft))} type="number" step="any" disabled={disabled} title={name}
    value={draft ?? String(Math.round(value * 100) / 100)} onChange={event => { setDraft(event.target.value); setFreeTransformField(field, event.target.valueAsNumber); }}
    onBlur={() => setDraft(null)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}/>{unit}</label>;
}

export function FreeTransformBar({ untilShown }: { untilShown: (work: Promise<unknown>) => Promise<unknown> }) {
  const session = useFreeTransform(store => store.session), busy = usePhotoWorkspace(controlsLocked);
  if (!session) return null;
  const disabled = busy || !!session.quad;
  return <div className="xd-ps-free-transform" role="group" aria-label="Free Transform" data-mode={session.mode}>
    <Field text="X:" label="Transform X (px)" field="x" disabled={disabled}/><Field text="Y:" label="Transform Y (px)" field="y" disabled={disabled}/>
    <Field text="W:" label="Transform width (%)" field="width" disabled={disabled}/>
    <span className="xd-ps-icon-cluster"><button aria-label="Transform keep proportions" title="Maintain aspect ratio" aria-pressed={session.linked} disabled={busy} onClick={() => patchFreeTransform({ linked: !session.linked })}>{session.linked ? <Link2 size={16}/> : <Unlink2 size={16}/>}</button></span>
    <Field text="H:" label="Transform height (%)" field="height" disabled={disabled}/>
    <Field text="∠" label="Transform angle (°)" field="angle" disabled={disabled}/>
    <Field text="H skew:" label="Transform horizontal skew (°)" field="skewX" disabled={disabled}/><Field text="V skew:" label="Transform vertical skew (°)" field="skewY" disabled={disabled}/>
    <label><span>Interpolation:</span><select aria-label="Transform interpolation" disabled={busy} value={session.interpolation} onChange={event => patchFreeTransform({ interpolation: event.target.value as Interpolation })}>{INTERPOLATIONS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <span className="xd-ps-icon-cluster xd-ps-free-transform-end">
      <button aria-label="Cancel transform" title="Cancel transform (Esc)" onClick={cancelFreeTransform}><Ban size={16}/></button>
      <button aria-label="Commit transform" title="Commit transform (Enter)" disabled={busy} onClick={() => { commitFreeTransform(untilShown)?.catch(() => {}); }}><Check size={16}/></button>
    </span>
  </div>;
}
