import { useEffect, useId, useState } from "react";
import { ArrowDownToLine, ArrowUp, ArrowDown, ListVideo, Pause, Play } from "lucide-react";
import { useDownloads } from "./downloadStore";
import { AUDIO_PRESETS, VIDEO_PRESETS, timeLabel, type DownloadJob, type DownloadPlaylist } from "./downloadTypes";

export function BatchLinks({ detected }: { detected: boolean }) {
  const s = useDownloads();
  const draft = s.batchDraft;
  const id = useId();
  const format = [...VIDEO_PRESETS, ...AUDIO_PRESETS].find(([value]) => value === s.preferences?.preset)?.[1] ?? "Saved defaults";
  return <form className="dl-batch" onSubmit={(e) => {
    e.preventDefault(); const submitted = draft;
    void s.batch(submitted).then((ok) => { if (ok && useDownloads.getState().batchDraft === submitted) useDownloads.setState({ batchDraft: "" }); });
  }}>
    <label htmlFor={id}>One link per line</label>
    <textarea id={id} value={draft} onChange={(e) => useDownloads.setState({ batchDraft: e.target.value })} maxLength={204800} rows={4} placeholder={"https://example.com/first\nhttps://example.com/second"} spellCheck={false} />
    <div><p>Up to 50 links · {format}. Adding links does not start a transfer. Queues never use browser cookies.</p><button className="primary" type="submit" disabled={!!s.pending || !detected || !draft.trim() || !!s.preferencesError}><ArrowDownToLine size={14} />Queue links</button></div>
  </form>;
}
export function PlaylistSource({ detected }: { detected: boolean }) {
  const s = useDownloads();
  const draft = s.playlistDraft;
  const id = useId();
  return <div className="dl-playlist-source">
    <form className="dl-linkbar" onSubmit={(e) => {
      e.preventDefault(); const submitted = draft;
      void s.scanPlaylist(submitted).then((ok) => { if (ok && useDownloads.getState().playlistDraft === submitted) useDownloads.setState({ playlistDraft: "" }); });
    }}>
      <label htmlFor={id} className="dl-sr-only">Playlist link</label><ListVideo size={17} aria-hidden />
      <input id={id} type="url" value={draft} onChange={(e) => useDownloads.setState({ playlistDraft: e.target.value })} maxLength={4096} placeholder="Paste a playlist or collection link" required autoComplete="off" spellCheck={false} />
      <button className="primary" type="submit" disabled={!!s.pending || !detected || !draft.trim() || s.jobs.filter((j) => j.state === "inspecting" || j.state === "downloading").length >= 3}>Review playlist</button>
    </form>
    {s.scanId && <div className="dl-playlist-hint"><span>Reading public entries. Nothing is being downloaded.</span><button type="button" onClick={() => void s.stopScan()}>Stop scan</button></div>}
    {s.playlist ? <PlaylistSelection key={s.playlist.id} review={s.playlist} /> : <p className="dl-playlist-hint">Review up to 100 public entries, then explicitly choose up to 50. Restricted sources need a separate single-link, cookie-approved workflow.</p>}
  </div>;
}
function PlaylistSelection({ review }: { review: DownloadPlaylist }) {
  const s = useDownloads();
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  return <section className="dl-playlist-review" aria-label="Playlist selection">
    <header><div><h2>{review.title}</h2><p>{review.entries.length} entries{review.truncated ? " · first 100 only" : ""} · {selection.size} selected</p></div><div className="dl-header-actions"><button type="button" disabled={!!s.pending} onClick={() => useDownloads.setState({ playlist: null, playlistDraft: review.sourceUrl })}>Inspect again</button><button type="button" disabled={!!s.pending} onClick={() => useDownloads.setState({ playlist: null })}>Close review</button></div></header>
    <ol>{review.entries.map((entry) => <li key={entry.index}><label>
      <input type="checkbox" aria-label={`Select ${entry.title}`} checked={selection.has(entry.index)} disabled={!!s.pending || !entry.url || (selection.size >= 50 && !selection.has(entry.index))} onChange={(e) => { const checked = e.target.checked; setSelection((old) => { const next = new Set(old); if (checked) next.add(entry.index); else next.delete(entry.index); return next; }); }} />
      <span className="dl-playlist-index">{entry.index}</span><span className="dl-playlist-title">{entry.title}{entry.unavailable && <small>{entry.unavailable}</small>}</span><span className="dl-playlist-duration">{timeLabel(entry.duration)}</span>
    </label></li>)}</ol>
    <footer><p>Uses your saved format and playback defaults. Queued links stay held until Run queue. Review expires after 10 minutes.</p><button type="button" className="primary" disabled={!!s.pending || !selection.size || !!s.preferencesError} onClick={() => void s.queuePlaylist(review.id, [...selection].sort((a, b) => a - b))}>Queue {selection.size} selected</button></footer>
  </section>;
}
export function QueueBar() {
  const s = useDownloads();
  const [concurrency, setConcurrency] = useState(s.queue.concurrency);
  useEffect(() => { setConcurrency(s.queue.concurrency); }, [s.queue.concurrency]);
  const waiting = s.jobs.filter((j) => j.queue && j.state === "queued").length;
  const paused = s.jobs.filter((j) => j.queue && j.state === "paused").length;
  const ready = s.jobs.some((j) => j.queue && j.state === "ready");
  const exists = s.jobs.some((j) => j.queue);
  const id = useId();
  if (!exists) return null;
  return <section className="dl-queue-bar" aria-label="Queue controls">
    <div><strong>{s.queue.running ? "Queue running" : "Queue held"}</strong><span>{waiting} waiting{paused ? ` · ${paused} paused` : ""} · stays held after restart</span>{s.queue.note && <p role="status">{s.queue.note}</p>}{s.queue.error && <p role="alert">{s.queue.error}</p>}</div>
    <label htmlFor={id}>Concurrent<select id={id} value={concurrency} disabled={!!s.pending} onChange={(e) => setConcurrency(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} {n === 1 ? "download" : "downloads"}</option>)}</select></label>
    {s.queue.running && <button type="button" disabled={!!s.pending} onClick={() => void s.holdQueue()} title="Stop launching new items; active items finish and save"><Pause size={13} />Hold queue</button>}
    <button type="button" className="primary" disabled={!!s.pending || (!waiting && !ready)} onClick={() => void s.runQueue(concurrency)}><Play size={13} />{s.queue.running ? "Run waiting / apply" : "Run queue"}</button>
  </section>;
}
export function QueueJobControls({ job }: { job: DownloadJob }) {
  const s = useDownloads();
  const pending = s.jobs.filter((j) => j.queue && ["queued", "paused"].includes(j.state)).sort((a, b) => a.queue!.position - b.queue!.position || a.id.localeCompare(b.id));
  const index = pending.findIndex((j) => j.id === job.id);
  const move = (offset: number) => {
    const ids = pending.map((j) => j.id);
    const current = ids[index], target = ids[index + offset];
    if (!current || !target) return;
    ids[index] = target; ids[index + offset] = current;
    void s.reorder(ids);
  };
  return <div className="dl-queued-actions">
    <p>Native queue · settings frozen for this item · no browser cookies. Paused transfers retain partial files; servers may restart them. Retry after failure restarts cleanly.</p>
    {(job.state === "queued" || (job.state === "downloading" && !job.progress.processing)) && <button type="button" disabled={!!s.pending} onClick={() => void s.pause(job.id)}><Pause size={13} />Pause {job.state === "queued" ? "item" : "transfer"}</button>}
    {job.state === "queued" && <button type="button" disabled={!!s.pending} onClick={() => void s.stop(job.id)}>Cancel item</button>}
    {["paused", "failed", "stopped", "interrupted"].includes(job.state) && <button type="button" disabled={!!s.pending} onClick={() => void s.resume(job.id)}><Play size={13} />{job.state === "paused" ? "Return to queue" : "Retry in queue"}</button>}
    {index >= 0 && <div className="dl-queue-order"><button type="button" aria-label="Move queued item earlier" disabled={!!s.pending || s.queue.running || index === 0} onClick={() => move(-1)}><ArrowUp size={13} />Earlier</button><button type="button" aria-label="Move queued item later" disabled={!!s.pending || s.queue.running || index === pending.length - 1} onClick={() => move(1)}><ArrowDown size={13} />Later</button></div>}
  </div>;
}
