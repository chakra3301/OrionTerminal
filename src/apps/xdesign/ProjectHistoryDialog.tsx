import { useEffect, useState } from "react";
import { useXDProjects } from "./projectsStore";
import { useDesignDialog } from "./useDesignDialog";
import { imageStorageReport, scheduleImageCompaction, type ImageStorageReport } from "./projectStorage";
import { createProjectCheckpoint, deleteProjectCheckpoint, listProjectCheckpoints, restoreProjectCheckpoint, type ProjectCheckpoint } from "./projectHistory";
import "./projectFiles.css";

export function ProjectHistoryDialog({ close }: { close: () => void }) {
  const [storage,setStorage]=useState<ImageStorageReport|null>(null),[storageError,setStorageError]=useState<string|null>(null);
  useEffect(()=>{let current=true;void imageStorageReport().then(report=>{if(current)setStorage(report);}).catch(error=>{if(current)setStorageError(String(error));});return()=>{current=false;};},[]);
  const projectId = useXDProjects(state => state.activeId);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [deleting, setDeleting] = useState<string | null>(null);
  const dialog = useDesignDialog<HTMLDivElement>(close, busy);
  const reload = async () => { if (projectId) setCheckpoints(await listProjectCheckpoints(projectId)); };
  useEffect(() => {
    let cancelled = false;
    if (projectId) void listProjectCheckpoints(projectId).then(items => { if (!cancelled) setCheckpoints(items); }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);
  const act = async (work: () => Promise<void>, finish = false) => {
    setBusy(true); setError(null);
    try { await work(); if (finish) close(); else await reload(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="xd-project-dialog-scrim"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Project history" className="xd-project-dialog">
    <header><h3>Project history</h3><p>Changed projects receive an automatic checkpoint every five minutes. Named checkpoints stay until you delete them. Restore opens a separate project with its layered images and drafts.</p></header>
    <form className="xd-project-checkpoint-form" onSubmit={event => { event.preventDefault(); void act(async () => { await createProjectCheckpoint(name); setName(""); }); }}><input aria-label="Checkpoint name" placeholder="Name this version" required maxLength={256} disabled={busy} value={name} onChange={event => setName(event.target.value)}/><button type="submit" disabled={busy || !name.trim()}>Save checkpoint</button></form>
    <div className="xd-project-list" aria-busy={loading || busy}>{loading ? <p role="status">Loading saved versions…</p> : checkpoints.map(checkpoint => <article key={checkpoint.id} className="xd-project-list-item"><div><strong>{checkpoint.label}</strong><time dateTime={new Date(checkpoint.createdAt).toISOString()}>{new Date(checkpoint.createdAt).toLocaleString()}</time><span>{checkpoint.automatic ? "Automatic" : "Saved"} · {(checkpoint.bytes / 1024 / 1024).toFixed(1)} MB</span></div><button type="button" disabled={busy} onClick={() => { void act(() => restoreProjectCheckpoint(checkpoint), true); }}>Restore as new project</button>{deleting === checkpoint.id ? <><button type="button" disabled={busy} onClick={() => { void act(async () => { await deleteProjectCheckpoint(checkpoint.id); setDeleting(null); }); }}>Confirm delete</button><button type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep</button></> : <button type="button" disabled={busy} onClick={() => setDeleting(checkpoint.id)}>Delete…</button>}</article>)}{!loading && !checkpoints.length && <p>No saved checkpoints yet. Save a named version to preserve your current work.</p>}</div>
    {storage&&<details><summary>Image storage · {((storage.physicalBytes??storage.bytes)/1024/1024).toFixed(1)} MB stored</summary><p>{storage.versions} image versions · {storage.protectedVersions} referenced by saved projects and checkpoints. Identical tiles, embedded resources, and previews share disk data.</p><p>Compact image history to share identical pixels and convert older image bundles. Every version, undo state and checkpoint is retained. Compaction runs the next time Orion Terminal launches, before images open.</p><button type="button" disabled={busy||loading} onClick={()=>void act(async()=>{const pending=await scheduleImageCompaction(!storage.compactionPending);setStorage(current=>current?{...current,compactionPending:pending}:current);})}>{storage.compactionPending?"Cancel scheduled compaction":"Compact image history on next launch"}</button>{storage.compactionPending&&<p role="status">Image history compaction is scheduled for the next Orion Terminal launch.</p>}{storage.compaction?.status==="completed"&&<p role="status">Last compaction retained {storage.compaction.versions} versions, converted {storage.compaction.converted} older bundles and shared {storage.compaction.relinked} objects · {(storage.compaction.beforeBytes/1048576).toFixed(1)} → {(storage.compaction.afterBytes/1048576).toFixed(1)} MB.</p>}{storage.compaction?.status==="failed"&&<p role="alert">Image history compaction could not finish: {storage.compaction.error}. Saved versions are retained; cancel scheduling or retry on the next launch.</p>}<p>Unused versions older than seven days are collected when XDesign starts, before image sessions open. Saved projects, checkpoints and draft history are retained.</p>{(storage.physicalBytes??storage.bytes)>2*1024*1024*1024&&<p role="status">Image storage exceeds 2 GB. Removing unneeded saved checkpoints allows their unused versions to be collected on a later start.</p>}</details>}
    {storageError&&<p role="status">Image storage could not be inspected: {storageError}</p>}
    {error && <p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={close}>Close</button></footer>
  </div></div>;
}
