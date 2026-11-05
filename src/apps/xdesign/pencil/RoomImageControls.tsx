import { useState } from 'react';
import type { SceneNode } from '@open-pencil/scene-graph';
import { InspectorSection } from '../EditorChrome';
import { useDesignDialog } from '../useDesignDialog';
import { useXDesign } from '../store';
import { editPencilImage, pencilPhotoDocumentId, pencilRoomImageBinding, pencilRoomImageCandidates, usePencilWorkspace } from './runtime';
import { readRoomImagePluginData, roomImageReferenceText } from './roomImageReferences';
import type { CanvasRoomSession, RoomUiState, RoomImageDraft, RoomImagePlacementDraft } from './roomSession';

function ImageReview({ room, draft, close }: { room: CanvasRoomSession; draft: RoomImageDraft; close(): void }) {
  const busy = usePencilWorkspace(state => state.busy), readOnly = usePencilWorkspace(state => state.readOnly);
  const [error, setError] = useState(''), dialog = useDesignDialog<HTMLDivElement>(close, busy);
  const manifest = draft.manifest;
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Review shared image"><form onSubmit={event => {
    event.preventDefault(); setError(''); void room.publishCanvasImage(draft).then(close).catch(error => setError(String(error)));
  }}>
    <header><strong>Review shared image</strong><button type="button" disabled={busy} onClick={close}>Close</button></header>
    <p>{manifest.name}</p><p>{manifest.width} × {manifest.height} pixels</p>
    <p>{manifest.previousRevisionId ? 'Publish this editable revision to the room. Placements using the previous revision will update; other saved revisions stay available.' : 'Publish this image’s editable contents to the room. Its linked placements will use the shared revision.'}</p>
    <p>{(manifest.archiveBytes / (1024 * 1024)).toFixed(1)} MB</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy || readOnly}>{busy ? 'Publishing…' : 'Publish image'}</button>
  </form></div>;
}

function ImagePlacementReview({ room, draft, close }: { room: CanvasRoomSession; draft: RoomImagePlacementDraft; close(): void }) {
  const busy = usePencilWorkspace(state => state.busy), readOnly = usePencilWorkspace(state => state.readOnly);
  const [error, setError] = useState(''), dialog = useDesignDialog<HTMLDivElement>(close, busy);
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Use published image"><form onSubmit={event => {
    event.preventDefault(); setError(''); void room.applyImagePlacement(draft).then(close).catch(error => setError(String(error)));
  }}>
    <header><strong>Use published image</strong><button type="button" disabled={busy} onClick={close}>Close</button></header>
    <p>{draft.name}</p><p>{draft.width} × {draft.height} pixels</p>
    <p>Use revision {draft.revisionId.slice(0, 8)} for {draft.placements} linked {draft.placements === 1 ? 'placement' : 'placements'}. Current image edits stay saved on this device.</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy || readOnly}>{busy ? 'Applying…' : 'Use published image'}</button>
  </form></div>;
}

export function RoomImageControls({ room, state, node }: { room: CanvasRoomSession; state: RoomUiState; node: SceneNode | null | undefined }) {
  const workspaceBusy = usePencilWorkspace(value => value.busy), readOnly = usePencilWorkspace(value => value.readOnly);
  const documents = useXDesign(value => value.photoDocuments), [draft, setDraft] = useState<RoomImageDraft | null>(null), [error, setError] = useState('');
  const [placementDraft, setPlacementDraft] = useState<RoomImagePlacementDraft | null>(null), [publishedChoice, setPublishedChoice] = useState('');
  const pending = state.images?.pending, busy = workspaceBusy || ['loading', 'preparing', 'transferring'].includes(state.images?.phase ?? 'loading');
  const reference = node && readRoomImagePluginData(node.pluginData), binding = node && pencilRoomImageBinding(node.id), photoId = node && pencilPhotoDocumentId(node.id), source = photoId && documents[photoId];
  const connected = !!state.connection?.actor && ['online', 'readonly', 'syncing'].includes(state.connection.phase);
  const editable = !!node?.fills.some(fill => fill.type === 'IMAGE') && !!source;
  const changed = !!binding && !!source && binding.photo.version !== source.version;
  const candidates = node ? pencilRoomImageCandidates(node.id) : [], candidate = candidates.find(item => roomImageReferenceText(item.reference) === publishedChoice) ?? candidates[0];
  const run = (work: () => Promise<unknown>) => { setError(''); void work().catch(error => setError(String(error))); };
  if (!reference && !editable && !pending) return null;
  return <>
    <InspectorSection title="Shared image">
      {reference && <p>{binding ? changed ? 'Unpublished image edits' : 'Editable contents saved on this device' : 'Editable contents available from the room'}</p>}
      {!pending && reference && !binding && <button disabled={busy || !connected} onClick={() => run(() => room.hydrateRoomImage(node!.id))}>Download editable contents</button>}
      {!pending && editable && <button disabled={busy || readOnly} onClick={() => run(() => editPencilImage(node!.id))}>Open in Image</button>}
      {!pending && editable && <button disabled={busy || readOnly || !connected || !!reference && !changed} onClick={() => run(async () => setDraft(await room.reviewCanvasImage(node!.id)))}>Review image publication</button>}
      {!pending && editable && candidate && <>
        <p>{readOnly ? 'A published revision is saved here. Restore editor access to use it for these placements.' : 'A published revision is available for these placements.'}</p>
        {candidates.length > 1 && <select aria-label="Published image revision" disabled={busy || readOnly} value={roomImageReferenceText(candidate.reference)} onChange={event => setPublishedChoice(event.target.value)}>
          {candidates.map(item => <option key={roomImageReferenceText(item.reference)} value={roomImageReferenceText(item.reference)}>{item.photo.name} (revision {item.reference.revisionId.slice(0, 8)})</option>)}
        </select>}
        <button disabled={busy || readOnly || !connected} onClick={() => run(async () => setPlacementDraft(await room.reviewImagePlacement(node!.id, candidate.reference)))}>Review published image</button>
      </>}
      {pending && <>
        <p>{pending.name}</p><p role="status">{pending.complete ? 'Transfer complete. Save its original result to finish.' : pending.approved ? 'Image transfer pending' : 'Image prepared for review'}</p>
        {state.images!.totalChunks > 0 && <progress aria-label="Shared image transfer" value={state.images!.completedChunks} max={state.images!.totalChunks}/>}
        <button disabled={busy || !connected} onClick={() => run(async () => setDraft(await room.recoverCanvasImage()))}>{pending.complete ? 'Finish image transfer' : pending.approved ? 'Recover image transfer' : 'Review prepared image'}</button>
        <button disabled={busy || !connected || pending.complete} onClick={() => run(() => room.dismissCanvasImage())}>Dismiss transfer</button>
      </>}
      {(error || state.images?.error) && <p role="alert">{error || state.images?.error}</p>}
    </InspectorSection>
    {draft && <ImageReview room={room} draft={draft} close={() => setDraft(null)}/>}
    {placementDraft && <ImagePlacementReview room={room} draft={placementDraft} close={() => setPlacementDraft(null)}/>}
  </>;
}
