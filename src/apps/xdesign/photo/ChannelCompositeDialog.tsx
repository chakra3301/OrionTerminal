import { useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { useDesignDialog } from "../useDesignDialog";
import { CHANNEL_BLENDS, MAX_CHANNEL_PIXELS, changeSourceLayer, channelLayers, initialSource, sourceChoices, sourceKey, type ChannelSource } from "./channelSources";
import { usePhotoCommandPreview } from "./commandPreview";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoState } from "./types";
import { useChannelSources } from "./useChannelSources";
import { PhotoDialog } from "./photoDialog";

export type ChannelCompositeKind = "apply" | "calculations" | "load";
const TITLES = { apply: "Apply Image", calculations: "Calculations", load: "Load Selection" };

function SourceControls({ label, state, source, disabled, change, documents, current }: { label: string; state: PhotoState | null; source: ChannelSource; disabled: boolean; change: (source: ChannelSource) => void; documents:PhotoDocument[]; current:PhotoDocument }) {
  const choices = state ? sourceChoices(state, source) : [];
  return <fieldset className="xd-ps-dialog-group" disabled={disabled}>
    <legend>{label}</legend>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Image:</span><select aria-label={`${label} image`} value={source.document?.photoId??current.id} onChange={event=>{const photo=documents.find(photo=>photo.id===event.target.value);if(photo)change({...(photo.id!==current.id?{document:{photoId:photo.id,version:photo.version}}:{}),layer:"merged",channel:"composite",invert:source.invert});}}>{documents.map(photo=><option key={photo.id} value={photo.id}>{photo.name}{photo.id===current.id?" · Current image":""}</option>)}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Layer:</span><select disabled={!state} aria-label={`${label} layer`} value={source.layer} onChange={event => {if(state)change(changeSourceLayer(state, source, event.target.value === "merged" ? "merged" : Number(event.target.value)));}}>
        <option value="merged">Merged</option>{state&&channelLayers(state.layers).map(({ layer, label }) => <option key={layer.id} value={layer.id}>{label}</option>)}
      </select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Channel:</span><select disabled={!state} aria-label={`${label} channel`} value={sourceKey(source)} onChange={event => { const selected = choices.find(choice => choice.key === event.target.value); if (selected) change({ ...source, channel: selected.channel }); }}>{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check xd-ps-dialog-indent"><input aria-label={`${label} invert`} type="checkbox" checked={source.invert} onChange={event => change({ ...source, invert: event.target.checked })}/>Invert</label></div>
    </div>
    {!state&&<p role="status">Loading source channels…</p>}
  </fieldset>;
}

export function ChannelCompositeDialog({ kind, document, mask = false, canvas = null, close }: { kind: ChannelCompositeKind; document: PhotoDocument; mask?: boolean; canvas?: HTMLElement | null; close: () => void }) {
  const state = usePhotoWorkspace(workspace => workspace.state), busy = usePhotoWorkspace(workspace => workspace.busy), projectId = usePhotoWorkspace(workspace => workspace.projectId);
  // Freeze the document/view identity. A changed target must be reviewed before Apply.
  const [identity] = useState(() => ({ version: document.version, viewKey: state?.viewKey }));
  const [source1, setSource1] = useState<ChannelSource>(() => state ? initialSource(state, kind === "load") : { layer: "merged", channel: "composite", invert: false });
  const [source2, setSource2] = useState<ChannelSource>({ layer: "merged", channel: "composite", invert: false });
  const [maskSource, setMaskSource] = useState<ChannelSource>(() => state ? initialSource(state, true) : source2), [masked, setMasked] = useState(false);
  const [blending, setBlending] = useState("multiply"), [opacity, setOpacity] = useState(100), [scale, setScale] = useState(1), [offset, setOffset] = useState(0), [preserve, setPreserve] = useState(false);
  const [result, setResult] = useState("newChannel"), [name, setName] = useState(""), [operation, setOperation] = useState("new"), [localError, setLocalError] = useState("");
  const supported = document.width * document.height <= MAX_CHANNEL_PIXELS;
  const [live, setLive] = useState(isTauri() && supported);
  const unchanged = document.version === identity.version && state?.viewKey === identity.viewKey;
  const sources=useChannelSources(document,state,projectId,[source1,...(kind==="calculations"?[source2]:[]),...(masked?[maskSource]:[])]);
  const validSource = (source: ChannelSource) => {const state=sources.resolve(source);return !!state&&sources.valid(source)&&sourceChoices(state,source).some(choice=>choice.key===sourceKey(source));};
  const numericBlend = blending === "add" || blending === "subtract";
  const transparencyTarget = !mask && !state?.layerMaskView && state?.channels?.target?.kind !== "alpha" && !(state?.quickMask && state.channels?.target?.kind !== "color");
  const valid = unchanged && !!state && supported && validSource(source1) && (kind !== "calculations" || validSource(source2)) && (!masked || validSource(maskSource)) && Number.isFinite(opacity) && opacity >= 0 && opacity <= 100 && (!numericBlend || Number.isFinite(scale) && Number.isFinite(offset) && scale >= 1 && scale <= 2 && offset >= -255 && offset <= 255) && (kind !== "calculations" || result === "selection" || new TextEncoder().encode(name.trim()).length <= 512);
  const command = kind === "apply" ? "image.applyImage" : kind === "calculations" ? "image.calculations" : "select.loadSelection";
  const blendParams = { blending, opacity, ...(numericBlend ? { scale, offset } : {}), ...(masked ? { mask: maskSource } : {}) };
  const params: Record<string, unknown> = kind === "load" ? { ...source1, operation } : kind === "calculations" ? { source1, source2, ...blendParams, result, ...(result !== "selection" && name.trim() ? { name: name.trim() } : {}) } : { source: source1, ...blendParams, preserveTransparency: transparencyTarget && preserve, ...(mask ? { target: "mask" } : {}) };
  const preview = usePhotoCommandPreview(document, projectId, command, params, { automatic: live, enabled: !busy && valid, viewKey: state?.viewKey });
  const dialog = useDesignDialog<HTMLFormElement>(close, busy);
  const title = TITLES[kind];
  const number = (label: string, shownLabel: string, value: number, min: number, max: number, step: number, change: (value: number) => void, unit?: string) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{shownLabel}:</span><input aria-label={label} type="number" required min={min} max={max} step={step} disabled={busy} value={Number.isFinite(value) ? value : ""} onChange={event => change(event.target.valueAsNumber)}/>{unit && <span className="xd-ps-dialog-unit">{unit}</span>}</label></div>;
  const reset = () => { if (!state) return; setSource1(initialSource(state, kind === "load")); setSource2({ layer: "merged", channel: "composite", invert: false }); setMaskSource(initialSource(state, true)); setMasked(false); setBlending("multiply"); setOpacity(100); setScale(1); setOffset(0); setPreserve(false); setResult("newChannel"); setName(""); setOperation("new"); setLocalError(""); };
  return <PhotoDialog dialog={dialog} title={title} busy={busy} okDisabled={!valid} className="xd-photo-channel-composite" beside close={close} reset={reset} preview={{ checked: live, disabled: busy || !supported, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (busy || !valid || !event.currentTarget.checkValidity()) return;
    setLocalError(""); void runPhotoCommand(command, params).then(close).catch(error => setLocalError(String(error)));
  }}>
      {state && <SourceControls label={kind === "calculations" ? "Source 1" : "Source"} state={sources.resolve(source1)} source={source1} disabled={busy} change={setSource1} documents={sources.documents} current={document}/>}
      {kind === "calculations" && state && <><SourceControls label="Source 2" state={sources.resolve(source2)} source={source2} disabled={busy} change={setSource2} documents={sources.documents} current={document}/><button type="button" disabled={busy} onClick={() => { setSource1(source2); setSource2(source1); }}>Swap sources</button></>}
      {kind !== "load" && <fieldset className="xd-ps-dialog-group" disabled={busy}><legend>Blending</legend>
        <div className="xd-ps-dialog-grid">
          <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Mode:</span><select aria-label="Channel blending" value={blending} onChange={event => setBlending(event.target.value)}>{CHANNEL_BLENDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
          {number("Channel opacity (%)", "Opacity", opacity, 0, 100, .1, setOpacity, "%")}{numericBlend && <>{number("Channel scale", "Scale", scale, 1, 2, .01, setScale)}{number("Channel offset", "Offset", offset, -255, 255, .1, setOffset)}</>}
          {kind === "apply" && <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Preserve transparency" type="checkbox" disabled={!transparencyTarget} checked={transparencyTarget && preserve} onChange={event => setPreserve(event.target.checked)}/>Preserve Transparency</label></div>}
          <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Use compositing mask" type="checkbox" checked={masked} onChange={event => setMasked(event.target.checked)}/>Mask…</label></div>
        </div>
      </fieldset>}
      {masked && state && <SourceControls label="Mask" state={sources.resolve(maskSource)} source={maskSource} disabled={busy} change={setMaskSource} documents={sources.documents} current={document}/>}
      {kind === "calculations" && <fieldset className="xd-ps-dialog-group" disabled={busy}><legend>Result</legend><div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Destination:</span><select aria-label="Calculation result" value={result} onChange={event => setResult(event.target.value)}><option value="newDocument">New Document</option><option value="newChannel">New Channel</option><option value="selection">Selection</option></select></label></div>{result !== "selection" && <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Result channel name" value={name} maxLength={512} placeholder={result==="newDocument"?"Calculation":"Automatic alpha name"} onChange={event => setName(event.target.value)}/></label></div>}</div></fieldset>}
      {kind === "load" && <div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Operation:</span><select aria-label="Selection operation" disabled={busy} value={operation} onChange={event => setOperation(event.target.value)}><option value="new">New Selection</option><option value="add">Add to Selection</option><option value="subtract">Subtract from Selection</option><option value="intersect">Intersect with Selection</option></select></label></div></div>}
      {!supported && <p role="alert">The image exceeds the 256 megapixel editing limit.</p>}
      {sources.error&&<p role="alert">{sources.error}</p>}
      {![source1,...(kind==="calculations"?[source2]:[]),...(masked?[maskSource]:[])].every(sources.valid)&&<p role="alert">A source image changed. Choose its current version again before applying.</p>}
      {!unchanged && <p role="alert">The image or edit target changed. Reopen this dialog to review the current target.</p>}
    {preview.error && <p role="alert">{preview.error}</p>}{localError && <p role="alert">{localError}</p>}
    {canvas && live && preview.url && createPortal(<img className="xd-photo-canvas-preview" src={preview.url} alt="" draggable={false}/>, canvas)}
  </PhotoDialog>;
}
