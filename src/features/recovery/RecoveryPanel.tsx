import { useEffect, useRef, useState } from "react";
import "./recovery.css";
import { invoke } from "@tauri-apps/api/core";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { ulid } from "ulid";
import { insertNote } from "@/lib/db";
import { useNotesStore } from "@/store/notesStore";
import { useRecovery } from "./recoveryStore";
import type { RecoveryItem, RecoverySession } from "./draftJournal";

export async function restoreNoteCopy(item: RecoveryItem): Promise<string> {
  if (item.kind !== "note") throw new Error("This is not a note recovery copy");
  const id = ulid(), now = Date.now();
  await insertNote({ id, title: `Recovered · ${item.title || "Untitled"}`, blocks_json: item.blocksJson, plaintext: item.plaintext, kind: item.noteKind, parent_id: null, location: "", collection_id: null, created_at: now, updated_at: now });
  return id;
}

export function RecoveryPanel() {
  const { open, sessions, error, listError, pending, retry, refresh } = useRecovery();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const active = useRef(false);
  const [selected, setSelected] = useState<{ session: RecoverySession; index: number; item: RecoveryItem } | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    setFeedback(null); dialog.current?.showModal(); void refresh();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [open, refresh]);
  const action = async (work: () => Promise<string | void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setFeedback(null);
    try {
      const text = await work();
      if (text) setFeedback({ error: false, text });
    } catch {
      setFeedback({ error: true, text: "Recovery action could not be confirmed. Reload the list and check your destination before retrying. File exports require an unused filename." });
    } finally { active.current = false; setBusy(false); }
  };
  if (!open) return null;
  return <dialog ref={dialog} className="recovery-panel" aria-labelledby="recovery-heading" onCancel={(event) => { event.preventDefault(); if (!busy) useRecovery.setState({ open: false }); }}>
    <header><h2 id="recovery-heading">Local draft recovery</h2><button disabled={busy} onClick={() => useRecovery.setState({ open: false })}>Close</button></header>
    <p>Copies can be incomplete or already saved. Restore creates a new note or file—never an automatic overwrite. Copies stay here until you discard them.</p>
    <p role="status">{error ?? (pending ? "Writing the latest note/file recovery copy…" : "Note/file recovery writer is idle. This is not a backup of every app.")}</p>
    {error && <button onClick={() => retry?.()}>Retry recovery write</button>}
    {listError && <p role="alert">{listError}</p>}
    <button disabled={busy} onClick={() => { setSelected(null); void refresh(); }}>Reload list</button>
    {!sessions.length && !listError && <p>No retained drafts from previous sessions.</p>}
    <div className="recovery-list">{sessions.map((session) => <section key={session.session}>
      <h3>{session.updated ? new Date(session.updated).toLocaleString() : "Unreadable recovery session"}</h3>
      {session.error ? <p role="alert">{session.error}</p> : <>
        {session.items.map((label, index) => <button key={index} disabled={busy} onClick={() => void action(async () => {
          const item = await invoke<RecoveryItem>("drafts_read", { session: session.session, revision: session.revision, index });
          setSelected({ session, index, item });
        })}>{label}</button>)}
        <button disabled={busy} onClick={() => void action(async () => {
          if (!await confirm(`Permanently discard all ${session.items.length} recovery copies in this session? This does not delete saved notes or files.`, { title: "Discard recovery copies", kind: "warning" })) return;
          await invoke("drafts_discard", { session: session.session, revision: session.revision }); setSelected(null); await refresh();
          return "Selected session discarded. Saved notes and files were not deleted.";
        })}>Discard this session’s copies</button>
      </>}
    </section>)}</div>
    {selected && <section aria-label="Selected recovery copy">
      <h3>{selected.item.kind === "file" ? selected.item.path : selected.item.title}</h3>
      <pre>{(selected.item.kind === "file" ? selected.item.contents : selected.item.plaintext).slice(0, 4000)}</pre>
      <button disabled={busy} onClick={() => void action(async () => {
        const destination = await save({ title: "Save recovery to a NEW file", defaultPath: selected.item.kind === "file" ? "recovered-copy.txt" : "recovered-note.json" });
        if (!destination) return;
        await invoke("drafts_export", { session: selected.session.session, revision: selected.session.revision, index: selected.index, destination });
        return "Recovery copy exported to a new file. The retained source is unchanged.";
      })}>Save a new file copy</button>
      {selected.item.kind === "note" && <button disabled={busy} onClick={() => void action(async () => {
        if (!await confirm("Create a new recovered note? The original note and recovery copy will stay unchanged.", { title: "Restore as new note" })) return;
        const item = await invoke<RecoveryItem>("drafts_read", { session: selected.session.session, revision: selected.session.revision, index: selected.index });
        await restoreNoteCopy(item);
        await useNotesStore.getState().load();
        return "Recovered note created. Open Archives to review it. The retained source is unchanged.";
      })}>Restore as new note</button>}
    </section>}
    {feedback && <p className="recovery-feedback" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
  </dialog>;
}
