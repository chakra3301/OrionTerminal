import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@open-pencil/core/editor';
import type { LibraryRevisionSummary } from './libraryCatalog';
import { pencilLibraries } from './librarySession';
import type { PencilLibrarySummary } from './roomLibraryCatalog';

type Props = { editor: Editor; library: PencilLibrarySummary; revisionId?: string; enabled: boolean; busy: boolean; readOnly: boolean; sourceKey: string; refreshKey: string; review(revisionId: string): Promise<void> };
type Loaded = { editor: Editor; identity: string; rows: LibraryRevisionSummary[] | null; error: string };

export function LibraryRevisionPicker({ editor, library, revisionId, enabled, busy, readOnly, sourceKey, refreshKey, review }: Props) {
  const [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0), [preparing, setPreparing] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null), [chosen, setChosen] = useState({ identity: '', id: '' }), [reviewError, setReviewError] = useState('');
  const identity = JSON.stringify([sourceKey, refreshKey, library.libraryId, library.latestRevisionId, revisionId, attempt]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ editor, identity, open, readOnly }); current.current = { editor, identity, open, readOnly };
  useEffect(() => {
    if (!open) return;
    let cancelled = false; setLoaded(null); setReviewError(''); setPreparing(false);
    void Promise.resolve().then(() => pencilLibraries(editor).listRevisions(library.libraryId)).then(rows => {
      if (!cancelled) setLoaded({ editor, identity, rows, error: '' });
    }).catch(error => { if (!cancelled) setLoaded({ editor, identity, rows: null, error: String(error) }); });
    return () => { cancelled = true; };
  }, [open, editor, identity]);
  const owned = loaded?.editor === editor && loaded.identity === identity ? loaded : null, rows = owned?.rows;
  const selectedId = rows?.some(row => row.revisionId === chosen.id) && chosen.identity === identity ? chosen.id : rows?.find(row => row.revisionId === revisionId)?.revisionId ?? rows?.find(row => row.revisionId === library.latestRevisionId)?.revisionId ?? rows?.at(-1)?.revisionId ?? '';
  const selected = rows?.find(row => row.revisionId === selectedId);
  const prepare = async () => {
    if (!selected || !enabled || readOnly || busy || preparing || selectedId === revisionId) return;
    const owner = current.current; setPreparing(true); setReviewError('');
    try { await review(selectedId); }
    catch (error) { if (mounted.current && current.current.editor === owner.editor && current.current.identity === owner.identity && current.current.open && !current.current.readOnly) setReviewError(String(error)); }
    finally { if (mounted.current && current.current.editor === owner.editor && current.current.identity === owner.identity) setPreparing(false); }
  };
  return <div className="xd-library-revisions">
    <button type="button" aria-expanded={open} disabled={busy || preparing} onClick={() => setOpen(value => !value)}>{open ? 'Hide revision history' : 'Revision history'}</button>
    {open && <div role="group" aria-label={`${library.name} revision history`}>
      <p>{library.origin === 'room' ? 'Downloaded revisions' : 'Saved revisions'}. Choosing a revision leaves the canvas unchanged until you review and apply it.</p>
      {!owned && <p role="status">Loading revision history…</p>}
      {owned?.error && <><p role="alert">{owned.error}</p><button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry revision history</button></>}
      {rows && !rows.length && <p>No saved revisions are available.</p>}
      {!!rows?.length && <><label>Revision<select aria-label={`${library.name} revision`} value={selectedId} disabled={busy || preparing} onChange={event => { setChosen({ identity, id: event.currentTarget.value }); setReviewError(''); }}>{[...rows].reverse().map(row => <option key={row.revisionId} value={row.revisionId}>Revision {row.step} · {row.name}{row.revisionId === revisionId ? ' · Current' : ''}{row.revisionId === library.latestRevisionId ? ' · Latest saved' : ''}</option>)}</select></label>
        {selected && <><p>{selected.assetCount} components · <time dateTime={selected.publishedAt}>{selected.publishedAt}</time></p>{selected.description && <p>{selected.description}</p>}<p className="xd-library-revision-id">Revision ID: {selected.revisionId}</p></>}
        {!enabled && <p>Enable this library before applying a different revision.</p>}
        <button type="button" disabled={busy || preparing || readOnly || !enabled || !selected || selectedId === revisionId} onClick={() => void prepare()}>{preparing ? 'Preparing revision…' : 'Review revision'}</button>
      </>}
      {reviewError && <p role="alert">{reviewError}</p>}
    </div>}
  </div>;
}
