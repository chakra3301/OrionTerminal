import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { FILTERS, type NumberControl } from "./controls";
import { adjustmentDefaults } from "./adjustmentSettings";
import { usePhotoCommandPreview } from "./commandPreview";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";

type Values = Record<string, unknown>;
type Edit = { index: number; command: string; params: Values };
const COMMANDS = new Set([
  "filter.blur.gaussianBlur", "filter.blur.boxBlur", "filter.blur.motionBlur",
  "filter.blur.radialBlur", "filter.blur.surfaceBlur", "filter.sharpen.unsharpMask", "filter.sharpen.smartSharpen",
]);
export const EXISTING_NUMERIC_ACTIONS = FILTERS.filter(action => COMMANDS.has(action.id));
const object = (value: unknown): value is Values => !!value && typeof value === "object" && !Array.isArray(value);
const workspaceKey = (state: ReturnType<typeof usePhotoWorkspace.getState>) => JSON.stringify([state.projectId, state.documentId, state.shapeId, state.source, state.stateVersion]);
const displayNumber = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
const parsed = (text: string) => text.trim() === "" ? NaN : Number(text);
const validNumber = (number: number, field: NumberControl) => Number.isFinite(number) && Number.isFinite(Math.fround(number)) && number >= field.min && number <= field.max;

export function ExistingNumericFilterDialog({ document, layer, existing, canvas = null, close }: { document: PhotoDocument; layer: PhotoLayer; existing: Edit; canvas?: HTMLElement | null; close: () => void }) {
  const projectId = usePhotoWorkspace(state => state.projectId), busy = usePhotoWorkspace(state => state.busy), workspace = usePhotoWorkspace(workspaceKey);
  const action = EXISTING_NUMERIC_ACTIONS.find(action => action.id === existing.command), filter = layer.smartFilters?.[existing.index];
  const supported = object(existing.params) && object(filter?.params);
  const key = JSON.stringify([workspace, projectId, document.id, document.version, document.width, document.height, layer.id, existing.index, existing.command, existing.params, filter?.command, filter?.params]);
  const captured = useRef(key), capturedWorkspace = useRef(workspace), current = useRef(key), mounted = useRef(true), retired = useRef(false), submitting = useRef(false);
  current.current = key;
  const stale = captured.current !== key || !supported || !projectId || !action || !layer.smartObject || !Number.isSafeInteger(layer.id) || layer.id < 0 || !Number.isSafeInteger(existing.index) || existing.index < 0 || filter?.command !== existing.command || JSON.stringify(filter.params) !== JSON.stringify(existing.params);
  const [opening] = useState<Values>(() => object(existing.params) ? structuredClone(existing.params) : {});
  const [values, setValues] = useState<Values>(() => structuredClone(opening)), committed = useRef(values);
  const [drafts, setDrafts] = useState<Record<string, string>>({}), draftRef = useRef(drafts);
  const [live, setLive] = useState(document.width * document.height <= 16_777_216), [applying, setApplying] = useState(false), [dismissed, setDismissed] = useState(false), [error, setError] = useState<string | null>(null);
  const locked = busy || applying || dismissed || stale, lockedRef = useRef(locked); lockedRef.current = locked;
  const defaults = action ? adjustmentDefaults(action, "RGB") : {}, effective = { ...defaults, ...values };
  const valid = (settings: Values, raw: Record<string, string>) => supported && !!action && (action.fields ?? []).every(field => {
    if (Object.hasOwn(raw, field.key) && !validNumber(parsed(raw[field.key]!), field)) return false;
    return JSON.stringify(settings[field.key]) === JSON.stringify(existing.params[field.key]) || typeof settings[field.key] === "number" && validNumber(settings[field.key] as number, field);
  }) && (action.options ?? []).every(option => JSON.stringify(settings[option.key]) === JSON.stringify(existing.params[option.key]) || option.choices?.includes(String(settings[option.key])) === true);
  const settingsValid = valid(values, drafts), previewable = document.width * document.height <= 16_777_216;
  const params = { layer: layer.id, index: existing.index, params: values };
  const preview = usePhotoCommandPreview(document, projectId, "layer.smartFilter.setParams", params, { automatic: live, enabled: !locked && settingsValid && previewable, cancelable: true });
  const latestPreview = useRef(preview); latestPreview.current = preview;
  const fresh = () => mounted.current && !retired.current && !submitting.current && !lockedRef.current && current.current === captured.current && workspaceKey(usePhotoWorkspace.getState()) === capturedWorkspace.current && !usePhotoWorkspace.getState().busy;
  const dismiss = () => { if (!fresh()) return; retired.current = true; setDismissed(true); close(); };
  const dialog = useDesignDialog<HTMLFormElement>(dismiss, locked);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (stale && !retired.current) { retired.current = true; close(); } }, [stale, close]);
  const replace = (next: Values) => { committed.current = next; setValues(next); setError(null); };
  const number = (field: NumberControl, text: string) => {
    if (!fresh()) return;
    draftRef.current = { ...draftRef.current, [field.key]: text }; setDrafts(draftRef.current);
    const value = parsed(text);
    if (validNumber(value, field)) replace({ ...committed.current, [field.key]: value });
  };
  const label = `Edit ${action?.label ?? "Smart"} Filter`;
  const reset = () => { if (!fresh()) return; draftRef.current = {}; setDrafts({}); replace(structuredClone(opening)); };
  return <PhotoDialog dialog={dialog} title={action?.label ?? "Smart Filter"} label={label} className="xd-photo-action-dialog" beside noValidate busy={locked} okDisabled={!settingsValid} close={dismiss} reset={reset} preview={{ checked: live, disabled: locked || !settingsValid || !previewable, busy: live && preview.loading, change: checked => {
    if (!fresh()) return;
    if (!checked) { setLive(false); return; }
    if (!valid(committed.current, draftRef.current) || !previewable) return;
    setLive(true); flushSync(() => setValues({ ...committed.current }));
    if (fresh()) void latestPreview.current.preview();
  } }} onSubmit={event => {
    event.preventDefault(); if (!fresh() || !valid(committed.current, draftRef.current)) return;
    submitting.current = true; setApplying(true); setError(null);
    const request = { layer: layer.id, index: existing.index, params: structuredClone(committed.current) };
    void runPhotoCommand("layer.smartFilter.setParams", request).then(() => {
      if (mounted.current && !retired.current && current.current === captured.current && workspaceKey(usePhotoWorkspace.getState()) === capturedWorkspace.current) { retired.current = true; close(); }
    }).catch(failure => {
      if (mounted.current && !retired.current && current.current === captured.current && workspaceKey(usePhotoWorkspace.getState()) === capturedWorkspace.current) { submitting.current = false; setApplying(false); setError(String(failure)); }
    });
  }}>
    <div className="xd-photo-action-controls">{!supported && <p role="alert">These imported filter settings are preserved, but their structure cannot be edited here.</p>}<div className="xd-ps-dialog-grid">{(supported ? action?.fields ?? [] : []).map(field => {
        const text = drafts[field.key] ?? displayNumber(effective[field.key], field.value), invalid = Object.hasOwn(drafts, field.key) && !validNumber(parsed(text), field);
        return <label className="xd-ps-dialog-field" key={field.key}><span>{field.label}:</span><input type="number" aria-label={field.label} aria-invalid={invalid || undefined} min={field.min} max={field.max} step="any" disabled={locked} value={text} onChange={event => number(field, event.currentTarget.value)}/></label>;
      })}{(supported ? action?.options ?? [] : []).map(option => {
        const value = typeof effective[option.key] === "string" ? effective[option.key] as string : String(option.value);
        return <label className="xd-ps-dialog-field" key={option.key}><span>{option.label}:</span><select aria-label={option.label} disabled={locked} value={value} onChange={event => { if (fresh() && option.choices?.includes(event.currentTarget.value)) replace({ ...committed.current, [option.key]: event.currentTarget.value }); }}>{[...new Set([value, ...(option.choices ?? [])])].map(choice => <option key={choice}>{choice}</option>)}</select></label>;
      })}</div>
        {(layer.smartFiltersEnabled === false || filter?.visible === false) && <p className="xd-photo-section-help">This filter is hidden. The full image preview keeps its current visibility.</p>}
        {supported && !settingsValid && <p role="alert">Enter finite values within the displayed ranges before previewing or applying.</p>}
        {preview.error && <p role="alert">{preview.error}</p>}{!previewable && <p className="xd-photo-section-help">Preview is unavailable above 16 megapixels. Numeric filter settings remain editable.</p>}
      </div>{error && <p role="alert">{error}</p>}
    {canvas && live && preview.url && createPortal(<img className="xd-photo-canvas-preview" src={preview.url} alt="" draggable={false}/>, canvas)}
  </PhotoDialog>;
}
