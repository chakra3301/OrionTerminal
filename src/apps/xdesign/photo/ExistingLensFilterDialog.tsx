import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PhotoDocument, PhotoLayer } from "./types";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { LensGeometryEditor } from "./LensGeometryEditor";
import { FilterNumericControl } from "./FilterStructuredOptions";
import { ADAPTIVE_WIDE_ANGLE_ACTION, LENS_CORRECTION_ACTION, validLensLine } from "./lensFilters";

type Values = Record<string, unknown>;
type Edit = { index: number; command: string; params: Values };
type Input = { png: string; width: number; height: number };
const object = (value: unknown): Values => value && typeof value === "object" && !Array.isArray(value) ? value as Values : {};
function inputImage(value: unknown, document: PhotoDocument): Input | null {
  const input = object(value);
  const factor = Math.max(1, Math.ceil(Math.max(document.width, document.height) / 2048));
  if (input.width !== document.width || input.height !== document.height || ![input.pixelWidth, input.pixelHeight].every(value => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2048) || typeof input.png !== "string" || !input.png.length || input.png.length > 24 * 1024 * 1024) return null;
  if (input.pixelWidth !== Math.ceil(document.width / factor) || input.pixelHeight !== Math.ceil(document.height / factor)) return null;
  try {
    const header = atob(input.png.slice(0, 44));
    const dimension = (start: number) => [0, 1, 2, 3].reduce((value, index) => value * 256 + header.charCodeAt(start + index), 0);
    if (!header.startsWith("\x89PNG\r\n\x1a\n") || header.slice(12, 16) !== "IHDR" || dimension(16) !== input.pixelWidth || dimension(20) !== input.pixelHeight) return null;
  } catch { return null; }
  return { png: input.png, width: document.width, height: document.height };
}

export function ExistingLensFilterDialog({ document, layer, existing, close }: { document: PhotoDocument; layer: PhotoLayer; existing: Edit; close: () => void }) {
  const projectId = usePhotoWorkspace(state => state.projectId), busy = usePhotoWorkspace(state => state.busy);
  const filter = layer.smartFilters?.[existing.index], wide = existing.command === "filter.adaptiveWideAngle";
  const action = wide ? ADAPTIVE_WIDE_ANGLE_ACTION : LENS_CORRECTION_ACTION;
  const key = JSON.stringify([projectId, document.id, document.version, layer.id, existing.index, existing.command, existing.params, filter?.command, filter?.params]);
  const captured = useRef(key), current = useRef(key), submitting = useRef(false); current.current = key;
  const stale = captured.current !== key || !layer.smartObject || !["filter.lensCorrection", "filter.adaptiveWideAngle"].includes(existing.command) || filter?.command !== existing.command || JSON.stringify(filter.params) !== JSON.stringify(existing.params);
  const [opening] = useState<Values>(() => structuredClone(existing.params)), [values, setValues] = useState<Values>(() => structuredClone(opening)), [live, setLive] = useState(document.width * document.height <= 16_777_216), [applying, setApplying] = useState(false), [error, setError] = useState<string | null>(null), [input, setInput] = useState<Input | null>(null);
  const locked = busy || applying || stale, effective = { ...action.defaults, ...values }, previewable = document.width * document.height <= 16_777_216;
  const changed = (field: string) => JSON.stringify(values[field]) !== JSON.stringify(existing.params[field]);
  const geometryValid = wide ? !changed("constraints") || Array.isArray(values.constraints) && values.constraints.length <= 128 && values.constraints.every(value => { const line = object(value); return validLensLine([line.a, line.b], document.width, document.height) && (line.orientation === undefined || ["free", "horizontal", "vertical"].includes(String(line.orientation))); }) : !changed("straighten") || values.straighten === null || values.straighten === undefined || validLensLine(values.straighten, document.width, document.height);
  const valid = geometryValid && (!wide || (effective.interpolation ?? "bicubic") === "bicubic") && (action.fields ?? []).every(field => !changed(field.key) || typeof values[field.key] === "number" && Number.isFinite(values[field.key]) && Number(values[field.key]) >= field.min && Number(values[field.key]) <= field.max);
  const params = { layer: layer.id, index: existing.index, params: values };
  const preview = usePhotoCommandPreview(document, projectId, "layer.smartFilter.setParams", params, { automatic: live, enabled: !locked && valid && previewable });
  const result = object(object(preview.result).lensEdit), resolved = object(result.resolved), dialog = useDesignDialog<HTMLFormElement>(close, locked);
  useEffect(() => { if (stale) close(); }, [stale, close]);
  useEffect(() => { if (stale) setInput(null); else { const next = inputImage(object(object(preview.result).lensEdit).input, document); if (next) setInput(next); } }, [preview.result, stale, document.width, document.height]);
  const change = (field: string, value: unknown) => { if (!locked) setValues(current => ({ ...current, [field]: !wide && field === "straighten" && value === undefined ? null : value })); };
  const geometryValues = { ...values, ...(!wide && values.straighten === null ? { straighten: undefined } : {}) };
  const label = `Edit ${action.label} Filter`, autoScale = !wide && effective.autoScale === true;
  return <PhotoDialog dialog={dialog} title={action.label} label={label} className="xd-photo-special-dialog" noValidate busy={locked} okDisabled={!valid} close={close} reset={() => { if (!locked) setValues(structuredClone(opening)); }} preview={{ checked: live, disabled: locked || !previewable, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (locked || !valid || submitting.current) return;
    submitting.current = true; setApplying(true); setError(null);
    void runPhotoCommand("layer.smartFilter.setParams", params).then(() => { if (current.current === key) close(); }).catch(error => { submitting.current = false; setApplying(false); setError(String(error)); });
  }}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview"><img src={live && preview.url ? preview.url : convertFileSrc(document.previewPath)} alt="Full image preview"/>{preview.error && <p role="alert">{preview.error}</p>}</div>
      <div className="xd-photo-special-controls"><p className="xd-photo-section-help">Input when this filter runs</p>{input && !stale ? <LensGeometryEditor key={captured.current} wide={wide} values={geometryValues} width={input.width} height={input.height} image={`data:image/png;base64,${input.png}`} curves={result.curves} disabled={locked} change={change}/> : <p role="status">{previewable ? "Preview the filter input to edit geometry." : "Geometry preview is unavailable above 16 megapixels. Numeric filter settings remain editable."}</p>}
        {(action.fields ?? []).map(field => <FilterNumericControl key={field.key} spec={field} value={effective[field.key]} disabled={locked || field.key === "scale" && autoScale} change={value => change(field.key, value)}/>)}
        {(action.options ?? []).map(option => { const value = effective[option.key] ?? option.value; return option.kind === "boolean" ? <label className="xd-ps-dialog-check" key={option.key}><input type="checkbox" aria-label={option.label} disabled={locked} checked={value === true} onChange={event => change(option.key, event.currentTarget.checked)}/>{option.label}</label> : <label className="xd-ps-dialog-field" key={option.key}><span>{option.label}:</span>{option.kind === "color" ? <input type="color" aria-label={option.label} disabled={locked} value={typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={event => change(option.key, event.currentTarget.value)}/> : <select aria-label={option.label} disabled={locked} value={String(value)} onChange={event => change(option.key, event.currentTarget.value)}>{[...new Set([String(value), ...(wide && option.key === "interpolation" ? ["bicubic"] : option.choices ?? [])])].map(choice => <option key={choice}>{choice}</option>)}</select>}</label>; })}
        {autoScale && <p className="xd-photo-section-help">Automatic scale: <output aria-label="Automatic scale">{typeof resolved.scale === "number" ? `${resolved.scale.toFixed(3)}%` : "Preview to calculate"}</output></p>}
        {wide && <p className="xd-photo-section-help">Smart Objects use bicubic interpolation.</p>}
        {(layer.smartFiltersEnabled === false || filter?.visible === false || result.stackEnabled === false || result.filterVisible === false) && <p className="xd-photo-section-help">This filter is hidden. Geometry shows its input when enabled; the full image preview keeps its current visibility.</p>}
        {!valid && <p role="alert">Use valid geometry and supported filter settings before previewing or applying.</p>}
      </div></div>{error && <p role="alert">{error}</p>}
  </PhotoDialog>;
}
