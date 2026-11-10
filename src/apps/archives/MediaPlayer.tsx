import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Check, Film, Music, Play, RefreshCw } from "lucide-react";
import { confirmAction } from "@/components/ConfirmModal";
import type { Asset } from "@/store/assetsStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useDownloads } from "./downloads/downloadStore";
import { downloadPercent, isDownloadActive } from "./downloads/downloadTypes";
import { useArchives } from "./useArchives";
import { SidecarTools } from "./downloads/SidecarTools";
import { LibraryDetails } from "./downloads/LibraryDetails";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./mediaPlayer.css";

export function ArchivesMediaPlayer({ asset, src, onOpenExternal }: { asset: Asset; src: string; onOpenExternal: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  const [captions, setCaptions] = useState<Array<{ index: number; label: string }>>([]);
  const [caption, setCaption] = useState("off");
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => { setError(null); setLoaded(false); setArtFailed(false); setCaptions([]); setCaption("off"); }, [asset.id, src]);
  const mediaLoaded = (element: HTMLMediaElement) => {
    setLoaded(true);
    const tracks = Array.from(element.textTracks ?? []);
    setCaptions(tracks.map((t, index) => ({ index, label: t.label || t.language || `Track ${index + 1}` })));
    const showing = tracks.findIndex((t) => t.mode === "showing");
    setCaption(showing < 0 ? "off" : String(showing));
  };
  const seek = (seconds: number) => {
    const element = media.current;
    if (element && Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(seconds, element.duration);
  };
  const [confirming, setConfirming] = useState(false);
  const [requestedCopy, setRequestedCopy] = useState<string | null>(null);
  const alive = useRef(true);
  const downloads = useDownloads();
  const copy = useAssetsStore((s) => [...s.assets.values()].find((a) => a.derivedFrom === asset.id && a.kind === asset.kind && a.playback?.compatible));
  const job = downloads.jobs.find((j) => j.sourceAssetId === asset.id && j.state !== "completed");
  const active = !!job && isDownloadActive(job);
  const blocked = !!downloads.pending || downloads.uncertain || downloads.jobs.some(isDownloadActive);
  const unsupported = asset.playback?.compatible === false || (asset.kind === "video" && /\.mkv$/i.test(asset.filePath));
  useEffect(() => {
    alive.current = true;
    void useDownloads.getState().refresh();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (requestedCopy === asset.id && copy && alive.current && useArchives.getState().previewingAssetId === asset.id) {
      setRequestedCopy(null);
      useArchives.getState().setPreviewingAssetId(copy.id);
    }
  }, [requestedCopy, copy, asset.id]);
  useEffect(() => {
    if (requestedCopy === asset.id && !copy && !downloads.pending && !downloads.uncertain &&
      (downloads.error || (job && ["failed", "stopped", "interrupted"].includes(job.state)))) setRequestedCopy(null);
  }, [requestedCopy, copy, downloads.pending, downloads.uncertain, downloads.error, job, asset.id]);
  const failed = (element: HTMLMediaElement) => {
    const code = element.error?.code;
    setError(code === 4 ? "This file’s container or codecs are not supported by the built-in player." : code === 3 ? "The player could not decode this media." : "The player could not load this media file.");
  };
  const create = async () => {
    setConfirming(true);
    try {
      const yes = await confirmAction({ title: "Create a playable copy?", body: "Convert this video locally to H.264/AAC MP4, then open the copy here. Your original file and tags are kept. No download or AI upload; conversion can take a few minutes.", confirmLabel: "Create copy" });
      if (yes && alive.current && useArchives.getState().previewingAssetId === asset.id) {
        setRequestedCopy(asset.id);
        await useDownloads.getState().playableCopy(asset.id);
      }
    } finally { if (alive.current) setConfirming(false); }
  };
  const trouble = error || unsupported;
  return <div className={`ar-player${asset.kind === "audio" ? " is-audio" : ""}`}>
    <div className="ar-player-stage">
      {asset.kind === "audio" ? <div className="ar-player-audio-art">{asset.posterPath && !artFailed ? <img src={convertFileSrc(asset.posterPath)} alt="Cover art" onError={() => setArtFailed(true)} /> : <Music size={42} />}<h2>{asset.title}</h2><p>{asset.sourceCreator ?? "Audio in your Archives"}</p></div> : null}
      {!error && !unsupported && (asset.kind === "video" ? <video key={asset.id} ref={(element) => { media.current = element; }} src={src} poster={asset.posterPath ? convertFileSrc(asset.posterPath) : undefined} controls playsInline preload="metadata"
        onLoadedMetadata={(e) => mediaLoaded(e.currentTarget)} onCanPlay={(e) => mediaLoaded(e.currentTarget)} onError={(e) => failed(e.currentTarget)}
        className="ar-player-video" aria-label={asset.title} /> : <audio key={asset.id} ref={(element) => { media.current = element; }} src={src} controls preload="metadata" onLoadedMetadata={(e) => mediaLoaded(e.currentTarget)} onError={(e) => failed(e.currentTarget)} aria-label={asset.title} />)}
      {!loaded && !trouble && <span className="ar-player-loading" role="status">Loading media…</span>}
      {trouble && <div className="ar-player-recovery">
        <AlertCircle size={26} /><h2>This copy needs a compatible player</h2><p>{error ?? "This download uses a format the built-in player cannot open."}</p>
        {asset.playback && <code>{asset.playback.container.toUpperCase()} · {asset.playback.videoCodec} · {asset.playback.audioCodec}</code>}
        <div className="ar-player-recovery-actions">
          {copy ? <button type="button" className="primary" onClick={() => useArchives.getState().setPreviewingAssetId(copy.id)}><Play size={14} />Play compatible copy</button> : asset.kind === "video" && !active && job?.state !== "ready" ? <button type="button" className="primary" disabled={blocked || confirming} onClick={() => void create()}><Film size={14} />Create playable copy</button> : null}
          <button type="button" onClick={onOpenExternal}><ArrowUpRight size={14} />Open in another app</button>
          {error && !unsupported && <button type="button" onClick={() => { setError(null); setLoaded(false); }}><RefreshCw size={13} />Retry player</button>}
        </div>
      </div>}
    </div>
    {!!captions.length && <label className="ar-player-captions">Player captions<select aria-label="Player captions" value={caption} onChange={(e) => { const value = e.target.value; const tracks = media.current?.textTracks; if (!tracks) return; for (let i = 0; i < tracks.length; i++) tracks[i]!.mode = String(i) === value ? "showing" : "disabled"; setCaption(value); }}><option value="off">Off</option>{captions.map((track) => <option key={track.index} value={track.index}>{track.label}</option>)}</select></label>}
    {active && job && <div className="ar-player-conversion" role="status"><span>Creating playable copy · original kept</span><progress max={100} value={downloadPercent(job)} aria-label="Playable copy conversion" /><button type="button" disabled={!!downloads.pending} onClick={() => { setRequestedCopy(null); void downloads.stop(job.id); }}>Stop</button></div>}
    {job?.state === "ready" && <div className="ar-player-conversion"><span>Playable copy is ready</span><button type="button" disabled={blocked} onClick={() => void downloads.save(job.id)}>Save copy to Media</button></div>}
    {job?.error && !active && <p className="ar-player-error" role="alert">{job.error}</p>}
    {downloads.error && <p className="ar-player-error" role="alert">{downloads.error}</p>}
    <footer className="ar-player-caption"><span>{asset.kind === "audio" ? <Music size={13} /> : <Film size={13} />}{asset.originalName}</span>
      {asset.playback?.compatible && <span><Check size={13} />{asset.playback.converted ? "Compatible copy" : "Compatible codecs"}</span>}
      {asset.derivedFrom && <span>Original preserved</span>}
    </footer>
    <LibraryDetails key={`details-${asset.id}`} asset={asset} />
    <SidecarTools key={asset.id} assetId={asset.id} onSeek={!trouble ? seek : undefined} />
  </div>;
}
