import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, AudioLines, Check, ChevronRight, Clock3, Film, FolderOpen, Link2, Play, RefreshCw, Scissors, Search, Settings2, ShieldCheck, SlidersHorizontal, Tag, Trash2 } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirmAction } from "@/components/ConfirmModal";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { useArchives } from "../useArchives";
import { useBackgroundAi } from "@/store/backgroundAiStore";
import { useDownloads } from "./downloadStore";
import { AUDIO_PRESETS, VIDEO_PRESETS, defaultDownloadOptions, downloadDefaults, downloadLimitsError, parseClipTime, timeLabel, bytesLabel, downloadPercent, isDownloadActive, type DownloadOptions, type DownloadJob, type DownloadPreset, type DownloadCookieChoice } from "./downloadTypes";
import { CookieControls } from "./CookieControls";
import { DownloadDefaults, TransferControls, LimitsControls } from "./DownloadSettings";
import { EmbeddingControls, embeddingForPreset } from "./EmbeddingControls";
import { SidecarTools } from "./SidecarTools";
import { LibraryDetails } from "./LibraryDetails";
import { SponsorControls, sponsorError } from "./SponsorControls";
import { BatchLinks, PlaylistSource, QueueBar, QueueJobControls } from "./QueueTools";
import "./downloads.css";

const LABELS: Record<DownloadJob["state"], string> = { inspecting: "Inspecting", inspected: "Ready", downloading: "Downloading", ready: "Import ready", completed: "In Media", stopped: "Stopped", failed: "Failed", interrupted: "Interrupted", queued: "Queued", paused: "Paused", skipped: "Already archived" };
function status(job: DownloadJob) { if (job.progress.phase === "pausing") return "Pausing"; if (job.progress.phase === "poster" && isDownloadActive(job)) return "Making preview"; return job.progress.phase === "converting" && isDownloadActive(job) ? "Converting" : job.progress.processing && job.state === "downloading" ? "Processing" : LABELS[job.state]; }

export function ArchivesDownloads() {
  const s = useDownloads();
  const assets = useAssetsStore((state) => state.assets);
  const [url, setUrl] = useState("");
  const [sourceMode, setSourceMode] = useState<"single" | "batch" | "playlist">(() => s.scanId || s.playlist || s.playlistDraft ? "playlist" : s.batchDraft ? "batch" : "single");
  const [selectedId, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"downloads" | "completed">("downloads");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [setup, setSetup] = useState(false);
  const [cookies,setCookies] = useState<DownloadCookieChoice | null>(null);
  const inputId = useId();
  const busy = !!s.pending || s.uncertain || s.queue.running || s.jobs.some(isDownloadActive);
  const detected = !!s.engines && Object.values(s.engines).every(Boolean);
  const shown = s.jobs.filter((j) => {
    const asset = j.assetId ? assets.get(j.assetId) : undefined;
    const audio = j.preset.startsWith("audio");
    return (tab === "downloads" || j.state === "completed") && (kind === "all" || (kind === "favorites" ? asset?.favorite : kind === "audio" ? audio : !audio)) &&
      [asset?.title, asset?.originalName, asset?.tags.join(" "), j.metadata?.title, j.metadata?.creator, j.url].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase());
  }).sort((a,b) => {
    const rank = (j: DownloadJob) => isDownloadActive(j) ? 0 : j.queue && ["queued","paused"].includes(j.state) ? 1 : 2;
    return rank(a) - rank(b) || (rank(a) === 1 ? a.queue!.position - b.queue!.position : b.createdAt - a.createdAt);
  });
  const selected = shown.find((j) => j.id === selectedId) ?? shown[0];
  useEffect(() => { void useDownloads.getState().checkEngines(); void useDownloads.getState().refresh(); void useDownloads.getState().loadPreferences(); }, []);
  return <section className="ar-downloads" aria-label="Media downloads">
    <header className="dl-header">
      <div className="dl-heading"><ArrowDownToLine size={17} /><h1>Downloads</h1><span>Video & audio</span></div>
      <div className="dl-header-actions"><button type="button" aria-label="Download settings" aria-expanded={setup} onClick={() => setSetup(!setup)}><Settings2 size={15} /></button>
        <button type="button" onClick={() => useArchives.getState().setView("media")}><FolderOpen size={14} />Media</button></div>
    </header>
    <nav className="dl-source-modes" aria-label="Source input"><button type="button" aria-pressed={sourceMode === "single"} onClick={() => setSourceMode("single")}>Single link</button><button type="button" aria-pressed={sourceMode === "batch"} onClick={() => setSourceMode("batch")}>Batch links</button><button type="button" aria-pressed={sourceMode === "playlist"} onClick={() => setSourceMode("playlist")}>Playlist</button></nav>
    {sourceMode === "single" && <><form className="dl-linkbar" onSubmit={(event) => {
      event.preventDefault(); const submitted = url;
      if (!busy && detected && submitted.trim()) {
        const request=cookies ? s.inspect(submitted,cookies) : s.inspect(submitted);
        void request.then((ok) => { if (ok) { setUrl((current) => current === submitted ? "" : current); setCookies(null); setSelected(null); setTab("downloads"); } });
      }
    }}>
      <label className="dl-sr-only" htmlFor={inputId}>Video or audio link</label><Link2 size={17} aria-hidden />
      <input id={inputId} type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={4096} placeholder="Paste a video or audio link" required autoComplete="off" spellCheck={false} />
      <button className="primary" type="submit" disabled={busy || !detected || !url.trim()}><Search size={14} />Inspect link</button>
    </form>
    <CookieControls inspection value={cookies} disabled={busy} onChange={setCookies} /></>}
    {sourceMode === "batch" && <BatchLinks detected={detected} />}
    {sourceMode === "playlist" && <PlaylistSource detected={detected} />}
    <QueueBar />
    {setup && <DownloadDefaults busy={busy} />}
    {(setup || (s.engines !== null && !detected)) && <div className="dl-setup">
      <h2>External engines</h2><p>Installed locally. Never automatically updated. Browser cookies are off by default and require separate one-operation approval.</p>
      <dl>{([['ytDlp','yt-dlp + EJS'],['ffmpeg','FFmpeg'],['ffprobe','ffprobe'],['node','Node.js']] as const).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{s.engines?.[key] ?? "Not found"}</dd></div>)}</dl>
      <p>Detection checks executable paths; site compatibility is checked during inspection. Setup: <code>docs/setup-media-downloads.md</code>.</p><button type="button" onClick={() => void s.checkEngines()}>Check engines</button>
    </div>}
    {s.error && <div className="dl-error" role="alert"><span>{s.error}</span><button type="button" onClick={() => useDownloads.setState({ error: null })}>Dismiss</button></div>}
    <nav className="dl-tabs" aria-label="Download views">
      <button type="button" aria-pressed={tab === "downloads"} onClick={() => setTab("downloads")}>Downloads <span>{s.jobs.length}</span></button>
      <button type="button" aria-pressed={tab === "completed"} onClick={() => setTab("completed")}>Completed <span>{s.jobs.filter((j) => j.state === "completed").length}</span></button>
      <select className="dl-kind-filter" aria-label="Filter media type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All media</option><option value="video">Video</option><option value="audio">Audio</option><option value="favorites">Favorites</option></select>
      <label className="dl-filter"><Search size={13} /><input aria-label="Search downloads" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter" /></label>
      <button type="button" aria-label="Refresh downloads" disabled={!!s.pending || s.loading} onClick={() => void s.refresh()}><RefreshCw size={14} /></button>
    </nav>
    {s.pending && <div className="dl-operation" role="status">{s.pending}…{s.scanId && sourceMode !== "playlist" && <button type="button" onClick={() => void s.stopScan()}>Stop scan</button>}</div>}
    <div className="dl-workspace">
      <div className="dl-queue scroll">
        {shown.length ? <ol className="dl-items">{shown.map((job) => <DownloadRow key={job.id} job={job} asset={job.assetId ? assets.get(job.assetId) : undefined} selected={selected?.id === job.id} onSelect={() => setSelected(job.id)} />)}</ol> : <div className="dl-empty">
          <div className="dl-empty-symbol"><ArrowDownToLine size={28} /></div><h2>{s.loading ? "Reading downloads…" : search || kind !== "all" || tab === "completed" ? "No matching downloads" : "Your next find belongs here"}</h2>
          <p>{search || kind !== "all" || tab === "completed" ? "Try another filter or open all downloads." : "Paste a link above. Inspect the source, choose a format, then save it to your library."}</p>
          {!s.jobs.length && <div className="dl-empty-features"><span><Film size={14} />4K to 144p</span><span><AudioLines size={14} />Eight audio formats</span><span><Scissors size={14} />Clip a section</span></div>}
        </div>}
      </div>
      {selected ? <DownloadInspector key={selected.id} job={selected} asset={selected.assetId ? assets.get(selected.assetId) : undefined} busy={busy} onInspected={() => setSelected(null)} /> : <aside className="dl-inspector dl-inspector-empty"><SlidersHorizontal size={20} /><h2>Your source, your settings</h2><p>Available formats, playback compatibility and clip controls appear here after inspection.</p><div><ShieldCheck size={15} /><span>Local processing. No automatic AI upload or browser access.</span></div></aside>}
    </div>
    <footer className="dl-footer"><span><Tag size={12} />Automatic source/type tags · topic tags follow Background AI</span><span>Save only content you’re permitted to download</span></footer>
  </section>;
}
function DownloadRow({ job, asset, selected, onSelect }: { job: DownloadJob; asset?: Asset; selected: boolean; onSelect: () => void }) {
  const percent = downloadPercent(job);
  const converting = job.progress.phase === "converting";
  const mediaDuration = job.metadata?.playback?.duration ?? job.metadata?.duration;
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => { setFrameReady(false); }, [asset?.filePath,asset?.posterPath,job.thumbnailPreview]);
  const preview = asset?.posterPath ? convertFileSrc(asset.posterPath) : /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(job.thumbnailPreview ?? "") ? job.thumbnailPreview : null;
  return <li><button className={`dl-item${selected ? " selected" : ""}`} type="button" onClick={onSelect} aria-pressed={selected}>
    <div className="dl-thumb">{job.preset.startsWith("audio") ? <AudioLines size={23} /> : <Film size={23} />}{preview ? <img src={preview} alt="" loading="lazy" data-frame-ready={frameReady} onLoad={() => setFrameReady(true)} onError={() => setFrameReady(false)} /> : asset?.kind === "video" && asset.playback?.compatible && <video src={convertFileSrc(asset.filePath)} muted playsInline preload="metadata" aria-hidden data-frame-ready={frameReady} onLoadedMetadata={(e) => { const v = e.currentTarget; if (Number.isFinite(v.duration) && v.duration > 0) { try { v.currentTime = Math.min(0.1,v.duration * 0.05); } catch { setFrameReady(false); } } }} onLoadedData={() => setFrameReady(true)} onError={() => setFrameReady(false)} />}
      {mediaDuration !== null && mediaDuration !== undefined && <span>{timeLabel(mediaDuration)}</span>}
    </div>
    <div className="dl-item-text"><div><h3>{asset?.title ?? job.metadata?.title ?? (job.state === "inspecting" ? "Inspecting source…" : "Queued link")}</h3><span className={`dl-state state-${job.state}`}>{job.state === "completed" && <Check size={11} />}{status(job)}</span></div>
      <p>{job.metadata ? [job.metadata.creator,job.metadata.site].filter(Boolean).join(" · ") : job.url}</p>
      {job.state === "downloading" ? <div className="dl-transfer"><progress aria-label={`Download progress for ${job.metadata?.title ?? "media"}`} max={100} value={percent} /><span>{percent !== undefined ? `${Math.floor(percent)}%` : "Working"}{!converting && job.progress.speed !== null ? ` · ${bytesLabel(job.progress.speed)}/s` : ""}</span></div> : <div className="dl-item-meta"><span>{job.sourceAssetId ? "Playable copy · original kept" : [...VIDEO_PRESETS,...AUDIO_PRESETS].find(([value]) => value === job.preset)?.[1]}</span>{asset && <span>{bytesLabel(asset.sizeBytes)}</span>}</div>}
      {job.error && <p className="dl-item-error">{job.error}</p>}
    </div><ChevronRight className="dl-item-arrow" size={14} />
  </button></li>;
}
function DownloadInspector({ job, asset, busy, onInspected }: { job: DownloadJob; asset?: Asset; busy: boolean; onInspected: () => void }) {
  const s = useDownloads();
  const ai = useBackgroundAi((state) => state.permissions.assets);
  const [preset, setPreset] = useState<DownloadPreset>(job.preset);
  const [options, setOptions] = useState<DownloadOptions>(() => job.options ?? defaultDownloadOptions());
  const [clipped, setClipped] = useState(!!(job.options?.startSeconds || job.options?.endSeconds));
  const [start, setStart] = useState(job.options?.startSeconds?.toString() ?? "");
  const [end, setEnd] = useState(job.options?.endSeconds?.toString() ?? "");
  const [localError, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cookies,setCookies] = useState<DownloadCookieChoice | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const audio = preset.startsWith("audio");
  const sponsorSubmissionError = sponsorError({ ...options, startSeconds: clipped ? 0 : null, endSeconds: null }, preset, job.metadata);
  const enabled = !!job.metadata && ["inspected","failed","stopped","interrupted"].includes(job.state) && !job.sourceAssetId && !job.queue;
  const id = useId();
  const change = <K extends keyof DownloadOptions>(key: K, value: DownloadOptions[K]) => setOptions((current) => ({ ...current,[key]: value }));
  const download = () => {
    setError(null);
    try {
      const startSeconds = clipped ? parseClipTime(start) : null, endSeconds = clipped ? parseClipTime(end) : null;
      if (endSeconds !== null && endSeconds <= (startSeconds ?? 0)) throw new Error("Clip end must follow its start.");
      if (job.metadata?.duration !== null && job.metadata?.duration !== undefined && ((endSeconds ?? 0) > job.metadata.duration || (startSeconds ?? 0) >= job.metadata.duration)) throw new Error("The clip must stay within the source duration.");
      const configured={ ...options, playable: audio ? false : options.playable, startSeconds,endSeconds };
      if (cookies) void s.start(job.id,preset,configured,cookies);
      else void s.start(job.id,preset,configured);
    } catch (e) { setError(String(e)); }
  };
  const remove = async () => {
    if (await confirmAction({ title:"Remove download entry?",body:"This removes the history entry and partial working files. Saved Media assets and the independent duplicate archive are kept.",confirmLabel:"Remove entry",danger:true }) && alive.current) await s.remove(job.id);
  };
  const saveDefaults = async () => {
    setNotice(null);
    if (await s.savePreferences(downloadDefaults(preset,options)) && alive.current) setNotice("Defaults saved for new links. This source’s clip and exact format were not saved.");
  };
  const forget = async () => {
    if (await confirmAction({title:"Forget this source’s download archive?",body:"Forget all saved format/range variants for this source. Media files and history are kept; future copies will no longer be skipped.",confirmLabel:"Forget source"}) && alive.current) await s.forget(job.id);
  };
  const exportCopy = async () => {
    if (!asset) return;
    setNotice(null);
    const path = await s.export(asset.id);
    if (path && alive.current) setNotice(`Exported a copy to ${path}. Library original kept.`);
  };
  const inspectAgain = async () => {
    const ok = cookies ? await s.inspect(job.url,cookies) : await s.inspect(job.url);
    if (ok && alive.current) onInspected();
  };
  const fileAction = (action: () => Promise<void>) => { void action().catch((e) => setError(String(e))); };
  return <aside className="dl-inspector scroll" aria-label="Selected download">
    <div className="dl-inspector-heading"><h2>{asset ? "In your library" : job.sourceAssetId ? "Playable copy" : "Download settings"}</h2><span>{status(job)}</span></div>
    <h3 className="dl-source-title">{asset?.title ?? job.metadata?.title ?? (job.state === "inspecting" ? "Reading the source" : "Queued source")}</h3>
    <p className="dl-source-sub">{[job.metadata?.creator,job.metadata?.site].filter(Boolean).join(" · ")}</p>
    {job.metadata?.duration !== null && job.metadata?.duration !== undefined && <p className="dl-source-duration" title="Original source duration"><Clock3 size={12} />{timeLabel(job.metadata.duration)}</p>}
    {enabled && <>
      <button type="button" className="primary dl-download-button" disabled={busy || !!downloadLimitsError(options) || !!sponsorSubmissionError} onClick={download}><ArrowDownToLine size={15} />{job.state === "inspected" ? "Download" : "Retry download"}</button>
      <button type="button" className="dl-download-button" disabled={busy || !!cookies || !!downloadLimitsError(options) || !!sponsorSubmissionError} onClick={() => { try { const configured = { ...options, startSeconds: clipped ? parseClipTime(start) : null, endSeconds: clipped ? parseClipTime(end) : null }; void s.addToQueue(job.id, preset, configured); } catch (error) { setError(String(error)); } }}>Add to queue</button>
      {cookies && <p className="dl-item-error">Queues do not reuse browser permission. Use Download for this cookie-approved source.</p>}
      <div className="dl-section"><label>Download</label><div className="dl-mode" role="group" aria-label="Download mode"><button type="button" disabled={busy} aria-pressed={!audio} onClick={() => { setPreset("video-1080"); setOptions((o) => embeddingForPreset({ ...o, formatId: null }, "video-1080")); }}><Film size={14} />Video</button><button type="button" disabled={busy} aria-pressed={audio} onClick={() => { setPreset("audio-mp3"); setOptions((o) => embeddingForPreset({ ...o, formatId: null }, "audio-mp3")); }}><AudioLines size={14} />Audio only</button></div></div>
      <div className="dl-section"><label htmlFor={`${id}-preset`}>Format</label><select id={`${id}-preset`} value={preset} disabled={busy} onChange={(e) => { const p = e.target.value as DownloadPreset; setPreset(p); setOptions((o) => embeddingForPreset({ ...o, formatId: null }, p)); }}>{(audio ? AUDIO_PRESETS : VIDEO_PRESETS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        {job.metadata?.heights.length ? <p>Source resolutions: {job.metadata.heights.join(" · ")}p</p> : <p>Resolution availability depends on the source.</p>}
      </div>
      {audio ? <div className="dl-section">{!["audio-original","audio-wav","audio-flac"].includes(preset) && <><label htmlFor={`${id}-quality`}>Conversion quality</label><select id={`${id}-quality`} disabled={busy} value={options.audioQuality} onChange={(e) => change("audioQuality",Number(e.target.value))}>{Array.from({length:11},(_,i) => <option key={i} value={i}>{i}{i === 0 ? " · highest" : i === 10 ? " · lowest" : ""}</option>)}</select></>}<p>Lossless output cannot restore detail missing from the source. Original format avoids intentional re-encoding unless you clip a section.</p></div> : <div className="dl-section"><label className="dl-switch"><span><Play size={14} />Play in Media</span><input type="checkbox" checked={options.playable} disabled={busy} onChange={(e) => change("playable",e.target.checked)} /></label><p>{options.playable ? "Checks the real codecs. Converts to H.264/AAC MP4 when needed; conversion can reduce source fidelity." : "Keep the source codecs. The built-in player may not support the resulting file."}</p></div>}
      <div className="dl-section"><label className="dl-switch"><span><Scissors size={14} />Clip a section</span><input type="checkbox" checked={clipped} disabled={busy} onChange={(e) => setClipped(e.target.checked)} /></label>
        {clipped && <><div className="dl-clip-times"><label htmlFor={`${id}-start`}>Start<input id={`${id}-start`} value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" disabled={busy} /></label><label htmlFor={`${id}-end`}>End<input id={`${id}-end`} value={end} onChange={(e) => setEnd(e.target.value)} placeholder={timeLabel(job.metadata?.duration)} disabled={busy} /></label></div><p>{audio ? "Accurate local trimming after transfer. Audio keeps the selected output format and is re-encoded." : "Accurate local trimming after transfer. Video is encoded to MP4; no fake keyframe precision."}</p></>}
      </div>
      <div className="dl-section"><label className="dl-switch"><span><ShieldCheck size={14} />Skip duplicates</span><input type="checkbox" checked={options.skipDuplicates} disabled={busy} onChange={(e) => change("skipDuplicates",e.target.checked)} /></label><p>Checks an independent archive for the same source, format and clip. Removing history or Media files does not forget it.</p></div>
      {!!job.metadata?.formats?.length && <details className="dl-advanced"><summary><SlidersHorizontal size={13} />Exact source format</summary><label htmlFor={`${id}-format`}>Available streams</label><select id={`${id}-format`} value={options.formatId ?? ""} disabled={busy} onChange={(e) => change("formatId",e.target.value || null)}><option value="">Automatic selection</option>{job.metadata.formats.filter((f) => audio ? f.audioCodec !== "none" : f.videoCodec !== "none").map((f) => <option key={f.id} value={f.id}>{f.id} · {f.height ? `${f.height}p` : "audio"}{f.fps ? ` · ${f.fps} fps` : ""} · {f.extension} · {f.videoCodec !== "none" ? f.videoCodec : f.audioCodec}{f.videoCodec !== "none" && f.audioCodec !== "none" ? ` + ${f.audioCodec}` : ""}{f.audioCodec === "none" ? " · no audio" : ""}{f.size ? ` · ${bytesLabel(f.size)}` : ""}</option>)}</select><p>Downloads the selected stream as-is before optional conversion; a video-only stream does not gain audio.</p></details>}
      <EmbeddingControls options={options} preset={preset} metadata={job.metadata} disabled={busy} onChange={setOptions} />
      <SponsorControls options={options} preset={preset} metadata={job.metadata} clipped={clipped} disabled={busy} onChange={setOptions} />
      <CookieControls value={cookies} disabled={busy} onChange={setCookies} />
      <details className="dl-advanced"><summary><SlidersHorizontal size={13} />Transfer controls</summary><TransferControls options={options} disabled={busy} onChange={setOptions} /></details>
      <details className="dl-advanced"><summary><SlidersHorizontal size={13} />Storage & time limits</summary><LimitsControls options={options} disabled={busy} onChange={setOptions} /></details>
      <button type="button" disabled={busy || !!downloadLimitsError(options) || !!sponsorError({ ...options, startSeconds: null, endSeconds: null }, preset) || !s.preferences || !!s.preferencesError} onClick={() => void saveDefaults()}>Save these defaults</button>
    </>}
    {job.queue && <QueueJobControls job={job} />}
    {job.state === "completed" && job.assetId && !asset && <button type="button" disabled={!!s.pending} onClick={() => void s.save(job.id)}>Refresh Media entry</button>}
    {isDownloadActive(job) && <button type="button" className="dl-download-button" disabled={!!s.pending} onClick={() => void s.stop(job.id)}>Stop {status(job).toLowerCase()}</button>}
    {job.state === "ready" && <button type="button" className="primary dl-download-button" disabled={!!s.pending || s.uncertain} onClick={() => void s.save(job.id)}>Save to Media</button>}
    {asset && <div className="dl-library-actions"><button className="primary" type="button" onClick={() => useArchives.getState().setPreviewingAssetId(asset.id)}><Play size={14} />Play in Media</button><button type="button" disabled={busy} onClick={() => void exportCopy()}><ArrowDownToLine size={14} />Export a copy…</button><button type="button" onClick={() => fileAction(() => revealItemInDir(asset.filePath))}>Show in Finder</button><button type="button" onClick={() => fileAction(() => openPath(asset.filePath))}>Open in another app</button></div>}
    {job.metadata?.playback && <div className="dl-section"><label>Saved codecs</label><p>{job.metadata.playback.container.toUpperCase()} · {job.metadata.playback.videoCodec} · {job.metadata.playback.audioCodec}</p><p>{job.metadata.playback.compatible ? "Compatible codecs verified locally" : "Source format · may need a playable copy"}</p></div>}
    {job.metadata?.playback?.embedded && <div className="dl-section"><label>Verified file extras</label><p>{job.metadata.playback.embedded.title ? "Title tag" : "No title tag"} · {job.metadata.playback.embedded.chapters} chapters · {job.metadata.playback.embedded.subtitles} subtitle tracks{job.metadata.playback.embedded.subtitleLanguages?.length ? ` (${job.metadata.playback.embedded.subtitleLanguages.join(", ")})` : ""} · {job.metadata.playback.embedded.artwork ? "cover art" : "no cover art"}</p><p>File contents verified with ffprobe, not inferred from selected controls. Selectable captions depend on the player; use another app if needed.</p></div>}
    {job.metadata?.playback?.sponsorblock && <div className="dl-section"><label>SponsorBlock lookup</label><p>{job.metadata.playback.sponsorblock.segments} matching community segments · requested {job.metadata.playback.sponsorblock.mode} · {job.metadata.playback.sponsorblock.categories.join(", ")}</p><p>Source {timeLabel(job.metadata.playback.sponsorblock.sourceDuration)} · after SponsorBlock {timeLabel(job.metadata.playback.sponsorblock.processedDuration)} · final file {timeLabel(job.metadata.playback.duration)}. Community data can be missing or inaccurate; removal can land near keyframes.</p></div>}
    {asset && <LibraryDetails key={`details-${asset.id}`} asset={asset} />}
    {asset && <SidecarTools key={asset.id} assetId={asset.id} />}
    {asset && <div className="dl-source-tags">{asset.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
    <div className="dl-inspector-note"><Tag size={13} /><p>Video/Audio classification and source tags are local. {ai ? "AI topic tags use title/description only." : "AI topic tags follow your Background AI setting, currently off."}</p></div>
    {notice && <p className="dl-notice" role="status">{notice}</p>}
    {localError && <p className="dl-item-error" role="alert">{localError}</p>}
    {!job.metadata && !isDownloadActive(job) && !job.sourceAssetId && !job.queue && <><CookieControls inspection value={cookies} disabled={busy} onChange={setCookies} /><button type="button" disabled={busy} onClick={() => void inspectAgain()}>Retry inspection</button></>}
    {job.metadata && !job.sourceAssetId && ["failed","stopped","interrupted","completed"].includes(job.state) && <button type="button" disabled={busy} onClick={() => void inspectAgain()}>Inspect source again</button>}
    <div className="dl-footer-actions">
      {job.metadata && !job.sourceAssetId && !isDownloadActive(job) && <button type="button" className="dl-remove" disabled={busy} onClick={() => void forget()}>Forget source archive</button>}
      {!isDownloadActive(job) && job.state !== "ready" && <button type="button" className="dl-remove" disabled={busy} onClick={() => void remove()}><Trash2 size={12} />Remove entry</button>}
    </div>
  </aside>;
}
