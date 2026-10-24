import { useEffect, useId, useState } from "react";
import type { DownloadMetadata, DownloadOptions, DownloadPreset } from "./downloadTypes";

export function embeddingForPreset(options: DownloadOptions, preset: DownloadPreset): DownloadOptions {
  return {
    ...options,
    sponsorblock: options.sponsorblock?.mode === "mark" && preset.startsWith("audio") && preset !== "audio-m4a" ? { ...options.sponsorblock, mode: "off" } : options.sponsorblock,
    embedSubtitles: preset.startsWith("audio") ? false : options.embedSubtitles,
    embedChapters: preset.startsWith("audio") && preset !== "audio-m4a" ? false : options.embedChapters,
    embedThumbnail: ["audio-mp3", "audio-m4a", "audio-flac"].includes(preset) ? options.embedThumbnail : false,
  };
}

export function EmbeddingControls({ options, preset, metadata, disabled, onChange }: { options: DownloadOptions; preset: DownloadPreset; metadata?: DownloadMetadata | null; disabled: boolean; onChange: (options: DownloadOptions) => void }) {
  const id = useId();
  const languages = (options.subtitleLangs ?? []).join(", ");
  const [draft, setDraft] = useState(languages);
  useEffect(() => setDraft(languages), [languages]);
  const audio = preset.startsWith("audio");
  const artwork = ["audio-mp3", "audio-m4a", "audio-flac"].includes(preset);
  const chapters = !audio || preset === "audio-m4a";
  const set = (patch: Partial<DownloadOptions>) => onChange({ ...options, ...patch });
  return <details className="dl-advanced dl-embedding"><summary>Metadata, chapters & captions</summary>
    <label className="dl-switch"><span>Embed source metadata</span><input type="checkbox" checked={options.embedMetadata ?? false} disabled={disabled} onChange={(e) => set({ embedMetadata: e.target.checked })} /></label>
    <p>Adds source title, creator and supported tags inside the file. Existing source tags are not stripped. No AI request.</p>
    <label className="dl-switch"><span>Embed chapters</span><input type="checkbox" checked={options.embedChapters ?? false} disabled={disabled || !chapters} onChange={(e) => set({ embedChapters: e.target.checked })} /></label>
    <p>{!chapters ? "Chapters need video or M4A." : metadata ? `${metadata.chapters ?? 0} chapters reported by this source. Clips retain only overlapping chapters, shifted to the clip timeline.` : "Source chapters, when available. Video and M4A only."}</p>
    <label className="dl-switch"><span>Embed audio cover art</span><input type="checkbox" checked={options.embedThumbnail ?? false} disabled={disabled || !artwork} onChange={(e) => set({ embedThumbnail: e.target.checked })} /></label>
    <p>{!artwork ? "Cover art supports MP3, M4A and FLAC. Video preview stills are generated locally." : metadata && !metadata.thumbnail ? "No source artwork reported. Turn this on only if a fresh inspection finds artwork." : "Fetches source artwork into private working storage and embeds it into the audio file."}</p>
    <label className="dl-switch"><span>Embed subtitles</span><input type="checkbox" checked={options.embedSubtitles ?? false} disabled={disabled || audio} onChange={(e) => set({ embedSubtitles: e.target.checked })} /></label>
    {audio ? <p>Subtitles are video-only.</p> : <>
      <p>Full video only; turn off clipping to embed captions. Text captions are selectable tracks, not burned-in. MP4 can lose source styling. Captions stage in Matroska; compatible playback then produces MP4.</p>
      {options.embedSubtitles && <>
        <label htmlFor={`${id}-langs`}>Subtitle languages<input id={`${id}-langs`} value={draft} disabled={disabled} maxLength={64} placeholder="en, fr, pt-BR" onChange={(e) => { setDraft(e.target.value); set({ subtitleLangs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }); }} /></label>
        <p>Up to five exact language codes, separated by commas. No wildcards.</p>
        <label className="dl-switch"><span>Allow automatic captions</span><input type="checkbox" checked={options.automaticSubtitles ?? false} disabled={disabled} onChange={(e) => set({ automaticSubtitles: e.target.checked })} /></label>
        <p>Manual captions take priority; automatic captions fill missing languages and may contain errors.</p>
        {metadata && <><p>Manual: {metadata.subtitles?.join(" · ") || "none reported"}</p><p>Automatic: {metadata.automaticSubtitles?.join(" · ") || "none reported"}</p></>}
      </>}
    </>}
    <p>Only the media file enters Media. Temporary artwork and caption files stay private; standalone sidecar export is not included.</p>
  </details>;
}
