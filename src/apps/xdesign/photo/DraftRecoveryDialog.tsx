import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useXDesign } from "../store";
import { useDesignDialog } from "../useDesignDialog";
import { removePhotoDraft, resumeSmartContents, usePhotoWorkspace } from "./runtime";
import "../projectFiles.css";

export function DraftRecoveryDialog({ close }: { close: () => void }) {
  const drafts = useXDesign(state => state.photoDrafts), documents = useXDesign(state => state.photoDocuments);
  const busy = usePhotoWorkspace(state => state.busy);
  const [error, setError] = useState<string | null>(null), [removing, setRemoving] = useState<string | null>(null);
  const dialog = useDesignDialog<HTMLDivElement>(close, busy);
  return <div className="xd-project-dialog-scrim"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Recover image drafts" className="xd-project-dialog">
    <header><h3>Image drafts</h3><p>Resume unfinished smart-object edits, including nested contents and their undo history.</p></header>
    <div className="xd-project-list">{[...drafts].sort((a,b) => b.updatedAt-a.updatedAt).map(draft => {
      const child = documents[draft.trail.at(-1)!.childId], changed = draft.trail.some(frame => documents[frame.parent.id]?.version !== frame.parent.version);
      return <article key={draft.id} className="xd-project-list-item">
        {child && <img src={convertFileSrc(child.previewPath)} alt=""/>}<div><strong>{child?.name ?? "Image contents"}</strong><span>{draft.trail[0]!.parent.name} · {draft.trail.length} {draft.trail.length === 1 ? "level" : "levels"}</span><time dateTime={new Date(draft.updatedAt).toISOString()}>{new Date(draft.updatedAt).toLocaleString()}</time>{changed && <p>The parent has changed. Resume to inspect or export this draft; saving to the parent is blocked.</p>}</div>
        <button type="button" disabled={busy} onClick={() => { setError(null); void resumeSmartContents(draft.id).then(close).catch(error => setError(String(error))); }}>Resume</button>
        {removing === draft.id ? <><button type="button" disabled={busy} onClick={() => { try { removePhotoDraft(draft.id); setRemoving(null); } catch (error) { setError(String(error)); } }}>Confirm discard</button><button type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep</button></> : <button type="button" disabled={busy} onClick={() => setRemoving(draft.id)}>Discard…</button>}
      </article>;
    })}{!drafts.length && <p>No unfinished image drafts.</p>}</div>
    {error && <p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={close}>Close</button></footer>
  </div></div>;
}
