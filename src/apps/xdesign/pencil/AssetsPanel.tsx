import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { publishableLibraryRoots, readSourceLibraryPublication, type LibraryAssetChange } from "@open-pencil/core/library";
import type { ComponentCatalogLibraryAsset } from "@open-pencil/core/tools";
import { useDesignDialog } from "../useDesignDialog";
import { pencilLibraries, publicationSelection, type PublicationDraft, type LibraryUpdateReview } from "./librarySession";
import { usePencilWorkspace, executeDesignToolAsync, runPencilLibraryAction, libraryPhotoBytes, libraryRoomImageBytes } from "./runtime";
import { LibraryPreviewPanel } from "./LibraryPreviewPanel";
import { orionLibraryCatalog } from "./libraryCatalog";
import type { CanvasRoomSession, RoomUiState } from './roomSession';
import type { RoomLibraryDraft } from './roomLibraryClient';
import type { PencilLibrarySummary } from './roomLibraryCatalog';
import { LibraryRevisionPicker } from './LibraryRevisionPicker';

function Changes({ changes }: { changes: LibraryAssetChange[] }) {
  return <ul className="xd-library-changes">{changes.map(change => <li key={change.asset.key}><span>{change.asset.name}</span><small>{change.kind}</small></li>)}</ul>;
}

function PublishDialog({ close, published }: { close: () => void; published: () => void }) {
  const editor = usePencilWorkspace(s => s.editor)!;
  const publication = readSourceLibraryPublication(editor.graph);
  const roots = publishableLibraryRoots(editor.graph);
  const [selected,setSelected] = useState(()=>publicationSelection(editor.graph));
  const [search,setSearch] = useState("");
  const visibleRoots = roots.filter(root=>root.name.toLowerCase().includes(search.toLowerCase()));
  const [name, setName] = useState(publication?.name ?? `${editor.state.documentName} components`);
  const [description, setDescription] = useState(""); const [saveAsNew, setSaveAsNew] = useState(false);
  const [draft, setDraft] = useState<PublicationDraft | null>(null); const [error, setError] = useState("");
  const busy = usePencilWorkspace(s => s.busy), readOnly = usePencilWorkspace(s => s.readOnly); const dialog = useDesignDialog<HTMLDivElement>(close, busy);
  const submit = async () => {
    setError("");
    try {
      if (draft) { await runPencilLibraryAction(session => session.publish(draft)); published(); }
      else setDraft(await runPencilLibraryAction((session, read) => session.preparePublication(name, description, saveAsNew, libraryPhotoBytes, [...selected], reference => libraryRoomImageBytes(reference, read))));
    } catch (e) { setError(String(e)); }
  };
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Publish component library"><form onSubmit={e => { e.preventDefault(); void submit(); }}>
    <header><strong>{draft ? "Review library revision" : "Publish component library"}</strong><button type="button" disabled={busy} onClick={close}>Close</button></header>
    <p>Save reusable components for every XDesign project on this device. Existing instances keep their revision until you review an update.</p>
    {draft ? <><p><strong>{draft.name}</strong> · {draft.rootIds.length} components or sets</p><Changes changes={draft.changes}/>{!draft.changes.length && <p>No component changes. This revision records the library name and description.</p>}<button type="button" disabled={busy || readOnly} onClick={() => setDraft(null)}>Back</button></> : <fieldset disabled={busy || readOnly}>
      <label>Library name<input aria-label="Library name" autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label>
      <label>Description<textarea aria-label="Library description" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)}/></label>
      {publication && <label className="xd-library-checkbox"><input type="checkbox" checked={saveAsNew} onChange={e => setSaveAsNew(e.target.checked)}/>Save as a new library</label>}
      <div className="xd-library-publish-tools"><strong>{selected.size} of {roots.length} selected</strong><button type="button" onClick={()=>setSelected(new Set(roots.map(root=>root.id)))}>Select all</button><button type="button" onClick={()=>setSelected(new Set())}>Clear</button></div>
      <input aria-label="Search components to publish" placeholder="Search components…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="xd-library-publish-list" role="group" aria-label="Components to publish">{visibleRoots.map(root=><label key={root.id} className="xd-library-checkbox"><input type="checkbox" aria-label={`Publish ${root.name}`} checked={selected.has(root.id)} onChange={e=>setSelected(current=>{const next=new Set(current);if(e.target.checked)next.add(root.id);else next.delete(root.id);return next;})}/><span>{root.name}</span><small>{root.type==="COMPONENT_SET"?`${editor.graph.getChildren(root.id).filter(child=>child.type==="COMPONENT").length} variants`:"Component"}</small></label>)}{!visibleRoots.length&&<p>No matching local components.</p>}</div>
      <p>Includes the selected components, complete variant sets, nested dependencies, variables and embedded images.</p>
      {publication&&!saveAsNew&&<p>Previously published components left unchecked will be removed from the new revision. Review lists every removal; existing instances keep their saved definition.</p>}
    </fieldset>}
    {error && <p role="alert">{error}</p>}<button type="submit" disabled={readOnly||busy||(!draft&&!selected.size&&(!publication||saveAsNew))}>{busy ? "Preparing…" : draft ? "Publish revision" : "Review components"}</button>
  </form></div>;
}

function UpdateDialog({ review, close, updated }: { review: LibraryUpdateReview; close: () => void; updated: () => void }) {
  const busy = usePencilWorkspace(s => s.busy), readOnly = usePencilWorkspace(s => s.readOnly); const dialog = useDesignDialog<HTMLDivElement>(close, busy); const [error, setError] = useState("");
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Review library update"><form onSubmit={e => {
    e.preventDefault(); setError(""); void runPencilLibraryAction(async session => session.applyUpdate(review)).then(updated).catch(e => setError(String(e)));
  }}><header><strong>Update {review.name}</strong><button type="button" disabled={busy} onClick={close}>Close</button></header>
    <p>{review.affectedInstanceCount} instances will update. The canvas update can be undone.</p>
    <p className="xd-library-revision-id">Current revision: {review.currentRevisionId}</p><p className="xd-library-revision-id">Reviewed revision: {review.targetRevisionId}</p>
    <Changes changes={review.changes}/>
    <LibraryPreviewPanel review={review}/>
    {review.fallbackInstanceCount > 0 && <p>{review.fallbackInstanceCount} instances have a removed variant combination and will use the first available variant.</p>}
    {review.removedInstanceCount > 0 && <p>{review.removedInstanceCount} instances use removed components and will retain their saved definitions.</p>}
    {review.discardedOverrideCount > 0 && <p>{review.discardedOverrideCount} overrides belong to removed or ambiguous layers and cannot carry over to this revision.</p>}
    {error && <p role="alert">{error}</p>}<button type="submit" disabled={busy || readOnly}>{busy ? "Updating…" : "Apply reviewed update"}</button>
  </form></div>;
}

function RoomPublishDialog({ room, state, draft, close, published }: { room: CanvasRoomSession; state: RoomUiState | null; draft: RoomLibraryDraft; close(): void; published(): void }) {
  const workspaceBusy = usePencilWorkspace(s => s.busy), readOnly = usePencilWorkspace(s => s.readOnly);
  const busy = workspaceBusy || ['loading', 'reading', 'publishing'].includes(state?.libraries?.phase ?? 'ready');
  const dialog = useDesignDialog<HTMLDivElement>(close, busy), [error, setError] = useState('');
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Publish library to shared room"><form onSubmit={event => {
    event.preventDefault(); setError(''); void room.publishLibrary(draft).then(published).catch(error => setError(String(error)));
  }}><header><strong>Publish {draft.packet.bundle.manifest.name}</strong><button type="button" disabled={busy} onClick={close}>Close</button></header>
    <p>Share this saved library with members of the current room. Its components, nested choices, variables and embedded images travel together.</p>
    <Changes changes={draft.changes}/>{!draft.changes.length && <p>No component changes. This publication records the reviewed library revision.</p>}
    <p>Existing instances keep their saved revision until an update is reviewed and applied.</p>
    {error && <p role="alert">{error}</p>}<button type="submit" disabled={busy || readOnly || state?.connection?.actor?.role === 'viewer' || state?.libraries?.actor?.role === 'viewer' || !!state?.libraries?.pending}>{busy ? 'Publishing…' : 'Publish to room'}</button>
  </form></div>;
}

export function AssetsPanel({ room = null, roomState = null }: { room?: CanvasRoomSession | null; roomState?: RoomUiState | null }) {
  const editor = usePencilWorkspace(s => s.editor); usePencilWorkspace(s => s.version);
  const busy = usePencilWorkspace(s => s.busy), readOnly = usePencilWorkspace(s => s.readOnly); const panel = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(""); const [summaries, setSummaries] = useState<PencilLibrarySummary[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<ComponentCatalogLibraryAsset[]>([]);
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [publish, setPublish] = useState(false); const [review, setReview] = useState<LibraryUpdateReview | null>(null);
  const [storage,setStorage]=useState("");
  const [roomDraft, setRoomDraft] = useState<RoomLibraryDraft | null>(null), [dismissRoom, setDismissRoom] = useState(false);
  const shared = roomState?.libraries, roomBusy = ['loading', 'reading', 'publishing'].includes(shared?.phase ?? 'ready');
  const roomConnected = !!room && !roomState?.opening && !roomState?.creation && !!roomState?.connection?.actor && ['online', 'readonly', 'syncing'].includes(roomState.connection.phase);
  const roomWritable = roomConnected && !readOnly && roomState?.connection?.actor?.role !== 'viewer' && shared?.actor?.role !== 'viewer' && !shared?.pending;
  useEffect(() => { if (readOnly) { setPublish(false); setReview(null); setRoomDraft(null); } }, [readOnly]);
  const sourceKey = JSON.stringify([roomState?.preference?.serverUrl, roomState?.preference?.documentId]);
  const currentPanel = useRef({ editor, room, sourceKey, readOnly, mounted: true }); currentPanel.current = { editor, room, sourceKey, readOnly, mounted: currentPanel.current.mounted };
  useEffect(() => { currentPanel.current.mounted = true; return () => { currentPanel.current.mounted = false; }; }, []);
  useEffect(() => { setPublish(false); setReview(null); setRoomDraft(null); setDismissRoom(false); }, [editor, room, sourceKey]);
  const bindingSignature = JSON.stringify([...editor?.graph.enabledLibraries.values() ?? []]);
  const publicationId = editor ? readSourceLibraryPublication(editor.graph)?.revisionId : null;
  useEffect(() => {
    if (!editor) return; let cancelled = false; setLoading(true);
    const session = pencilLibraries(editor);
    Promise.all([session.listLibraries(), session.listComponents()]).then(([libraries, assets]) => {
      if (!cancelled) { setSummaries(libraries); setLibraryAssets(assets); setError(""); }
    }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editor, bindingSignature, publicationId, refresh, shared?.cacheVersion, roomState?.preference?.serverUrl, room]);
  const localAssets = [...editor?.graph.nodes.values() ?? []].filter(n => n.type === "COMPONENT" && !n.librarySource?.readOnly && !editor?.graph.getNode(n.parentId ?? "")?.librarySource?.readOnly && (n.name.toLowerCase().includes(search.toLowerCase()) || editor?.graph.getNode(n.parentId ?? "")?.name.toLowerCase().includes(search.toLowerCase())));
  const act = async (work: () => Promise<unknown>) => { setError(""); try { await work(); setRefresh(n => n + 1); } catch (e) { setError(String(e)); } };
  const closeDialog = () => { setPublish(false); setReview(null); setRefresh(n => n + 1); };
  const reviewRevision = async (libraryId: string, revisionId?: string) => {
    const owner = currentPanel.current;
    const result = await runPencilLibraryAction(session => session.reviewUpdate(libraryId, revisionId));
    const current = currentPanel.current;
    if (!current.mounted || current.editor !== owner.editor || current.room !== owner.room || current.sourceKey !== owner.sourceKey || current.readOnly) throw new Error('The library source changed. Review this revision again.');
    setReview(result);
  };
  const portal = panel.current?.closest(".xd-pencil");
  return <div ref={panel} className="xd-pencil-assets">
    <input className="xd-pencil-asset-search" aria-label="Search components" placeholder="Search components…" value={search} onChange={e => setSearch(e.target.value)}/>
    <div className="xd-pencil-section-title"><h3>Local components</h3><button disabled={!editor || busy || readOnly} onClick={() => setPublish(true)}>Publish</button></div>
    {localAssets.map(node => {
      const parent = editor!.graph.getNode(node.parentId ?? "");
      return <button key={node.id} title="Insert an instance" disabled={busy || readOnly} onClick={() => {
        const id = editor!.createInstanceFromComponent(node.id, 100, 100, editor!.state.currentPageId); if (id) { editor!.select([id]); editor!.zoomToSelection(); }
      }}><span>{parent?.type === "COMPONENT_SET" ? `${parent.name} / ${node.name}` : node.name}</span><small>Insert</small></button>;
    })}
    {!localAssets.length && <p className="xd-pencil-empty">Create a component or import a design containing components.</p>}
    <details><summary>Shared libraries</summary>
      <p>Downloaded libraries are available in Saved libraries. Refresh reads the current room; opening this project does not publish or download.</p>
      {!roomConnected && <p>Connect this design to a room from Share to refresh or publish libraries.</p>}
      <button disabled={!roomConnected || busy || roomBusy} onClick={() => void act(() => room!.refreshLibraries())}>{shared?.phase === 'reading' ? 'Reading…' : 'Refresh room libraries'}</button>
      {shared?.libraries.map(library => <section className="xd-library" key={library.libraryId} aria-label={`${library.name} shared library`}><strong>{library.name}</strong><p>{library.assetCount} components · revision {library.step}</p><button disabled={!roomConnected || busy || roomBusy} onClick={() => void act(() => room!.downloadLibrary(library.libraryId))}>Download revision</button></section>)}
      {shared?.pending && <section className="xd-library" aria-label="Pending library publication"><strong>{shared.pending.name}</strong><p>A publication needs recovery. Reconnect as its original room member to confirm the result.</p><button disabled={!roomConnected || busy || roomBusy} onClick={() => void act(() => room!.recoverLibraryPublication())}>Recover publication</button><button disabled={!room || busy || roomBusy} onClick={() => setDismissRoom(true)}>Dismiss saved request</button>
        {dismissRoom && <><p>Dismiss only this device's saved request. A library already published to the room remains there.</p><button disabled={busy || roomBusy} onClick={() => void act(async () => { await room!.dismissLibraryPublication(); setDismissRoom(false); })}>Confirm dismissal</button><button disabled={busy || roomBusy} onClick={() => setDismissRoom(false)}>Keep request</button></>}
      </section>}
      {shared?.error && <p role="alert">{shared.error}</p>}
    </details>
    <div className="xd-pencil-section-title"><h3>Saved libraries</h3><button disabled={busy || loading} onClick={() => setRefresh(n => n + 1)}>Refresh</button></div>
    {loading && <p className="xd-pencil-empty" role="status">Loading libraries…</p>}
    {summaries.map(summary => {
      const binding = editor?.graph.enabledLibraries.get(summary.libraryId);
      const assets = libraryAssets.filter(a => a.libraryId === summary.libraryId && `${a.asset.name} ${a.asset.description}`.toLowerCase().includes(search.toLowerCase()));
      return <section className="xd-library" key={summary.libraryId} aria-label={`${summary.name} library`}>
        <label className="xd-library-checkbox"><input type="checkbox" checked={binding?.enabled ?? false} disabled={busy || loading || readOnly} onChange={e => { const enabled = e.currentTarget.checked; void act(() => runPencilLibraryAction(session => session.setEnabled(summary.libraryId, enabled))); }}/><strong>{summary.name}</strong></label>
        <p>{summary.origin === 'room' ? 'Downloaded from this room' : 'On this device'} · {binding?.enabled ? `${assets.length} components · revision ${binding.revisionId.slice(0, 7)}` : `${summary.assetCount} components · enable to insert`}</p>
        {summary.origin !== 'room' && room && <button disabled={!roomWritable || busy || roomBusy || loading} onClick={() => void act(async () => { const revision = await orionLibraryCatalog.getRevision(summary.libraryId); setRoomDraft(await room.prepareLibraryPublication(revision)); })}>Publish to room</button>}
        {binding?.enabled && binding.revisionId !== summary.latestRevisionId && <button className="xd-library-update" disabled={busy || readOnly} onClick={() => void act(async () => {
          await reviewRevision(summary.libraryId);
        })}>Review update</button>}
        {editor && <LibraryRevisionPicker editor={editor} library={summary} revisionId={binding?.revisionId} enabled={!!binding?.enabled} busy={busy || loading || roomBusy} readOnly={readOnly} sourceKey={sourceKey} refreshKey={JSON.stringify([refresh, shared?.cacheVersion])} review={revisionId => reviewRevision(summary.libraryId, revisionId)}/>}
        {binding?.enabled && assets.map(({ asset, revisionId }) => <button key={asset.key} title={asset.description || "Insert library instance"} disabled={busy || loading || readOnly} onClick={() => void act(async () => {
          await executeDesignToolAsync("insert_library_component", { library_id: summary.libraryId, revision_id: revisionId, asset_key: asset.key, x: 100, y: 100 }); editor?.zoomToSelection();
        })}><span>{asset.name}</span><small>{asset.type === "COMPONENT_SET" ? "Variants" : "Insert"}</small></button>)}
      </section>;
    })}
    {!loading && !summaries.length && <p className="xd-pencil-empty">Publish local components to reuse them across projects.</p>}
    {!!summaries.length&&<details><summary>Library storage</summary><p>Compact saved revisions while retaining every revision and component link.</p><button disabled={busy||loading||readOnly} onClick={()=>void act(()=>runPencilLibraryAction(async()=>{const result=await orionLibraryCatalog.compactRevisions();setStorage(`${result.revisions} revisions compacted · ${(result.beforeBytes/1048576).toFixed(1)} → ${(result.afterBytes/1048576).toFixed(1)} MB`);} ))}>Compact saved revisions</button>{storage&&<p role="status">{storage}</p>}</details>}
    {error && <p className="xd-pencil-empty" role="alert">{error}</p>}
    {portal && publish && createPortal(<PublishDialog close={closeDialog} published={closeDialog}/>, portal)}
    {portal && review && createPortal(<UpdateDialog review={review} close={closeDialog} updated={closeDialog}/>, portal)}
    {portal && room && roomDraft && createPortal(<RoomPublishDialog room={room} state={roomState} draft={roomDraft} close={() => setRoomDraft(null)} published={() => { setRoomDraft(null); setRefresh(n => n + 1); }}/>, portal)}
  </div>;
}
