import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PhotoDocument, PhotoLayer } from './types';
import { runPhotoCommand, usePhotoWorkspace } from './runtime';
import { usePhotoCommandPreview } from './commandPreview';
import { useDesignDialog } from '../useDesignDialog';
import { PhotoDialog } from './photoDialog';
import { BlurGeometryEditor } from './BlurGeometryEditor';
import { blurGeometryMode } from './blurGeometry';
import { EXTENDED_FILTERS } from './extendedFilters';
import { adjustmentDefaults } from './adjustmentSettings';
import { FilterNumericControl, FilterStructuredOptions, structuredFilterOverrides } from './FilterStructuredOptions';
import { FIT_BLUR_VIEW, type BlurViewport } from './blurViewport';
import { photoPreviewRegions } from './previewRegions';

type Values = Record<string, unknown>;
type Edit = { index: number; command: string; params: Values };
type Input = { png: string; width: number; height: number; revision: number };
const object = (value: unknown): Values => value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};
export const EXISTING_BLUR_ACTIONS = EXTENDED_FILTERS.filter(action => action.id.startsWith('filter.blurGallery.') && !!blurGeometryMode(action));
function filterInput(value: unknown, document: PhotoDocument): Omit<Input, 'revision'> | null {
  const metadata = object(value), input = object(metadata.input), factor = Math.max(1, Math.ceil(Math.max(document.width, document.height) / 2048));
  if (JSON.stringify(metadata.bounds) !== JSON.stringify([0, 0, document.width, document.height]) || input.width !== document.width || input.height !== document.height || input.pixelWidth !== Math.ceil(document.width / factor) || input.pixelHeight !== Math.ceil(document.height / factor) || typeof input.png !== 'string' || !input.png.length || input.png.length > 24 * 1024 * 1024) return null;
  try {
    const header = atob(input.png.slice(0, 44)), dimension = (start: number) => [0, 1, 2, 3].reduce((value, index) => value * 256 + header.charCodeAt(start + index), 0);
    if (!header.startsWith('\x89PNG\r\n\x1a\n') || header.slice(12, 16) !== 'IHDR' || dimension(16) !== input.pixelWidth || dimension(20) !== input.pixelHeight) return null;
  } catch { return null; }
  return { png: input.png, width: document.width, height: document.height };
}

export function ExistingBlurFilterDialog({ document, layer, existing, close }: { document: PhotoDocument; layer: PhotoLayer; existing: Edit; close: () => void }) {
  const projectId = usePhotoWorkspace(state => state.projectId), busy = usePhotoWorkspace(state => state.busy), action = EXISTING_BLUR_ACTIONS.find(action => action.id === existing.command), filter = layer.smartFilters?.[existing.index];
  const key = JSON.stringify([projectId, document.id, document.version, document.width, document.height, layer.id, existing.index, existing.command, existing.params, filter?.command, filter?.params]), captured = useRef(key), current = useRef(key), submitting = useRef(false); current.current = key;
  const stale = captured.current !== key || !action || !layer.smartObject || filter?.command !== existing.command || JSON.stringify(filter.params) !== JSON.stringify(existing.params);
  const [opening] = useState<Values>(() => structuredClone(existing.params)), [values, setValues] = useState<Values>(() => structuredClone(opening)), [live, setLive] = useState(document.width * document.height <= 16_777_216), [applying, setApplying] = useState(false), [input, setInput] = useState<Input | null>(null), [error, setError] = useState<string | null>(null), [epoch, setEpoch] = useState(0);
  const locked = busy || applying || stale, lockedRef = useRef(locked), committed = useRef(values); lockedRef.current = locked;
  const mode = action && blurGeometryMode(action), defaults = action ? adjustmentDefaults(action, 'RGB') : {}, effective = { ...defaults, ...values };
  // Empty lists explicitly clear native shallow-merged arrays, then resume scalar settings.
  for (const field of ['pins', 'paths']) if (Array.isArray(effective[field]) && !effective[field].length) delete effective[field];
  const valid = (action?.fields ?? []).every(field => JSON.stringify(values[field.key]) === JSON.stringify(existing.params[field.key]) || typeof values[field.key] === 'number' && Number.isFinite(values[field.key]) && Number(values[field.key]) >= field.min && Number(values[field.key]) <= field.max);
  const detailSource = JSON.stringify([key, epoch]), [detailView, setDetailView] = useState({ source: '', viewport: FIT_BLUR_VIEW, frame: { width: 0, height: 0 }, pixelRatio: 1 });
  const changedView = useCallback((viewport: BlurViewport, frame: { width: number; height: number }, pixelRatio: number) => { const next = { source: detailSource, viewport, frame, pixelRatio }; setDetailView(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); }, [detailSource]);
  const regions = detailView.source === detailSource ? photoPreviewRegions(document, detailView.viewport, detailView.frame, detailView.pixelRatio) : undefined;
  const previewable = document.width * document.height <= 16_777_216, params = { layer: layer.id, index: existing.index, params: values }, preview = usePhotoCommandPreview(document, projectId, 'layer.smartFilter.setParams', params, { automatic: live, enabled: !locked && valid && previewable, existingBlurCommand: action?.id, regions }), result = object(object(preview.result).blurEdit), dialog = useDesignDialog<HTMLFormElement>(close, locked);
  useEffect(() => { if (stale) { setInput(null); close(); } }, [stale, close]);
  useEffect(() => { if (!stale) { const next = filterInput(object(preview.result).blurEdit, document); if (next) setInput(current => current?.png === next.png ? current : { ...next, revision: (current?.revision ?? 0) + 1 }); } }, [preview.result, stale, document.width, document.height]);
  const replace = (next: Values) => { if (lockedRef.current || current.current !== captured.current) return; committed.current = next; setValues(next); };
  const change = (field: string, value: unknown) => replace({ ...committed.current, [field]: (field === 'pins' || field === 'paths') && value === undefined ? [] : value });
  const overrides = action ? structuredFilterOverrides(action, effective) : new Set<string>();
  const title = action?.label ?? 'Blur Gallery';
  return <PhotoDialog dialog={dialog} title={title} label={`Edit ${title} Filter`} className="xd-photo-special-dialog" noValidate busy={locked} okDisabled={!valid} close={close} reset={() => { replace(structuredClone(opening)); setEpoch(epoch => epoch + 1); }} preview={{ checked: live, disabled: locked || !previewable, busy: live && preview.loading, change: checked => { if (lockedRef.current) return; setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (lockedRef.current || current.current !== captured.current || !valid || submitting.current) return;
    submitting.current = true; setApplying(true); setError(null); void runPhotoCommand('layer.smartFilter.setParams', { layer: layer.id, index: existing.index, params: committed.current }).then(() => { if (current.current === captured.current) close(); }).catch(error => { submitting.current = false; setApplying(false); setError(String(error)); });
  }}>
    <div className="xd-photo-special-body"><div className="xd-photo-special-preview"><img src={live && preview.url ? preview.url : convertFileSrc(document.previewPath)} alt="Full image preview"/>{preview.error && <p role="alert">{preview.error}</p>}</div>
      <div className="xd-photo-special-controls"><p className="xd-photo-section-help">Input when this filter runs</p>{input && mode && !stale ? <BlurGeometryEditor key={`${captured.current}/${epoch}`} mode={mode} label={action!.label} values={effective} width={input.width} height={input.height} image={`data:image/png;base64,${input.png}`} sourceKey={detailSource} interactionKey={String(input.revision)} disabled={locked} viewChange={changedView} tiles={object(result.input).png === input.png ? preview.inputTiles : []} change={patch => replace({ ...committed.current, ...patch })}/> : <p role="status">{previewable ? 'Preview the filter input to edit geometry.' : 'Geometry preview is unavailable above 16 megapixels. Numeric filter settings remain editable.'}</p>}
        {action && <><FilterStructuredOptions action={action} values={effective} disabled={locked} change={change}/>{(action.fields ?? []).map(field => <FilterNumericControl key={field.key} spec={field} value={effective[field.key]} disabled={locked || overrides.has(field.key)} change={value => change(field.key, value)}/>)}</>}
        {(layer.smartFiltersEnabled === false || filter?.visible === false || result.stackEnabled === false || result.filterVisible === false) && <p className="xd-photo-section-help">This filter is hidden. Geometry shows its input when enabled; the full image preview keeps its current visibility.</p>}
        {!valid && <p role="alert">Use valid filter settings before previewing or applying.</p>}
      </div></div>{error && <p role="alert">{error}</p>}
  </PhotoDialog>;
}
