import { invoke } from "@tauri-apps/api/core";

export const VIDEO_PRESETS = [
  ["video-combined", "Best already combined"], ["video-best", "Highest quality video + audio"], ["video-mp4", "Best MP4"],
  ["video-only", "Highest quality · video only"], ["video-only-worst", "Lowest quality · video only"],
  ["video-4k", "4K · 2160p"], ["video-2k", "2K · 1440p"], ["video-1080", "1080p"], ["video-720", "720p"],
  ["video-480", "480p"], ["video-360", "360p"], ["video-240", "240p"], ["video-144", "144p"], ["video-worst", "Lowest quality"],
] as const;
export const AUDIO_PRESETS = [
  ["audio-original", "Original / best available"], ["audio-m4a", "M4A · AAC"], ["audio-mp3", "MP3"], ["audio-aac", "AAC"],
  ["audio-wav", "WAV"], ["audio-flac", "FLAC"], ["audio-opus", "Opus"], ["audio-vorbis", "Vorbis"],
] as const;
export type DownloadPreset = (typeof VIDEO_PRESETS)[number][0] | (typeof AUDIO_PRESETS)[number][0];
export type DownloadLimits = { fileMib: number; workMib: number; freeMib: number; minutes: number };
export const defaultDownloadLimits = (): DownloadLimits => ({ fileMib: 2048, workMib: 4096, freeMib: 512, minutes: 45 });
export function downloadLimitsError(options: DownloadOptions): string | null {
  const l = options.limits ?? defaultDownloadLimits();
  if (![l.fileMib,l.workMib,l.freeMib,l.minutes].every(Number.isInteger) || l.fileMib < 16 || l.fileMib > 65536 || l.workMib < 32 || l.workMib > 262144 || l.workMib < l.fileMib * 2 || l.freeMib < 512 || l.freeMib > 65536 || l.minutes < 1 || l.minutes > 1440) return "Use 16–65536 MiB per file, 32–262144 MiB combined work (at least twice the file limit), 512–65536 MiB free reserve and 1–1440 minutes per engine operation.";
  return null;
}
export type SponsorBlockChoice = { mode: "off" | "mark" | "remove"; categories: string[] };
export type DownloadOptions = {
  sponsorblock?: SponsorBlockChoice;
  limits?: DownloadLimits;
  playable: boolean; skipDuplicates: boolean; audioQuality: number;
  startSeconds: number | null; endSeconds: number | null; formatId: string | null;
  rateLimitKib?: number | null; retries?: number; fragments?: number;
  embedMetadata?: boolean; embedChapters?: boolean; embedThumbnail?: boolean;
  embedSubtitles?: boolean; automaticSubtitles?: boolean; subtitleLangs?: string[];
};
export const defaultDownloadOptions = (): DownloadOptions => ({ sponsorblock: { mode: "off", categories: ["sponsor"] }, limits: defaultDownloadLimits(), playable: true, skipDuplicates: true, audioQuality: 0, startSeconds: null, endSeconds: null, formatId: null, rateLimitKib: null, retries: 2, fragments: 1, embedMetadata: false, embedChapters: false, embedThumbnail: false, embedSubtitles: false, automaticSubtitles: false, subtitleLangs: [] });
export type DownloadPreferences = { version: 1; preset: DownloadPreset; options: DownloadOptions };
export const downloadDefaults = (preset: DownloadPreset, options: DownloadOptions): DownloadPreferences => ({ version: 1, preset, options: { ...defaultDownloadOptions(), ...options, startSeconds: null, endSeconds: null, formatId: null } });
export type PlaybackInfo = { compatible: boolean; container: string; videoCodec: string; audioCodec: string; converted: boolean; sponsorblock?: { mode: "mark" | "remove"; categories: string[]; segments: number; sourceDuration: number; processedDuration: number } | null; duration?: number | null; embedded?: { title: boolean; chapters: number; subtitles: number; subtitleLanguages?: string[]; artwork: boolean } | null };
export type SourceFormat = { id: string; extension: string; height: number | null; fps: number | null; videoCodec: string; audioCodec: string; size: number | null };
export type DownloadState = "inspecting" | "inspected" | "downloading" | "ready" | "completed" | "stopped" | "failed" | "interrupted" | "queued" | "paused" | "skipped";
export type DownloadMetadata = {
  title: string; creator: string; description: string; duration: number | null;
  site: string; tags: string[]; heights: number[];
  formats?: SourceFormat[]; sourceId?: string; playback?: PlaybackInfo | null;
  subtitles?: string[]; automaticSubtitles?: string[]; chapters?: number | null; thumbnail?: boolean;
};
export type DownloadJob = {
  id: string; url: string; state: DownloadState; preset: DownloadPreset;
  metadata: DownloadMetadata | null; error: string | null; assetId: string | null; createdAt: number;
  options?: DownloadOptions; sourceAssetId?: string | null;
  queue?: { position: number; resumeTransfer: boolean } | null;
  thumbnailPreview?: string | null;
  progress: { downloaded: number | null; total: number | null; speed: number | null; eta: number | null; processing: boolean; phase?: string | null; fraction?: number | null };
};
export type DownloadCookieChoice = { browser: "chrome" | "chromium" | "brave" | "edge" | "firefox" | "opera" | "vivaldi" | "safari"; profile: string | null };
export type DownloadEngines = { ytDlp: string | null; ffmpeg: string | null; ffprobe: string | null; node: string | null };
export type DownloadQueueStatus = { running: boolean; concurrency: number; error: string | null; note?: string | null };
export type DownloadPlaylist = { id: string; sourceUrl: string; title: string; truncated: boolean; entries: Array<{ index: number; title: string; url: string | null; duration: number | null; unavailable: string | null }> };
export function parseBatchLinks(input: string): string[] {
  if (input.length > 204800) throw new Error("This batch is too large. Queue up to 50 links at a time.");
  const links = input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!links.length || links.length > 50) throw new Error("Enter 1–50 links, one per line.");
  for (const link of links) {
    let url: URL; try { url = new URL(link); } catch { throw new Error("Each line must contain one complete HTTP or HTTPS link."); }
    if (link.length > 4096 || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use public HTTP or HTTPS links without embedded credentials.");
  }
  if (new Set(links).size !== links.length) throw new Error("Remove repeated links before queuing this batch.");
  return links;
}
export const downloadApi = {
  engines: () => invoke<DownloadEngines>("media_download_engines"),
  list: () => invoke<DownloadJob[]>("media_download_list"),
  inspect: (id: string, url: string, cookies?: DownloadCookieChoice) => invoke<void>("media_download_inspect", { id, url, cookies }),
  start: (id: string, preset: DownloadPreset, options?: DownloadOptions, cookies?: DownloadCookieChoice) => invoke<void>("media_download_start", { id, preset, options, cookies }),
  playableCopy: (id: string, assetId: string) => invoke<string>("media_download_playable_copy", { id, assetId }),
  stop: (id: string) => invoke<void>("media_download_stop", { id }),
  import: (id: string) => invoke<string>("media_download_import", { id }),
  remove: (id: string) => invoke<void>("media_download_remove", { id }),
  preferences: (settings?: DownloadPreferences) => invoke<DownloadPreferences>("media_download_preferences", { settings }),
  archiveCount: () => invoke<number>("media_download_archive_count"),
  forget: (id: string) => invoke<void>("media_download_archive_forget", { id }),
  export: (assetId: string) => invoke<string | null>("media_download_export", { assetId }),
  batch: (urls: string[]) => invoke<string[]>("media_download_batch", { urls }),
  queueStatus: () => invoke<DownloadQueueStatus>("media_download_queue_status"),
  queueRun: (concurrency: number) => invoke<{ ids: string[]; status: DownloadQueueStatus }>("media_download_queue_run", { concurrency }),
  queueHold: () => invoke<DownloadQueueStatus>("media_download_queue_hold"),
  queueAdd: (id: string, preset: DownloadPreset, options: DownloadOptions) => invoke<void>("media_download_queue_add", { id, preset, options }),
  queuePause: (id: string) => invoke<void>("media_download_queue_pause", { id }),
  queueResume: (id: string) => invoke<void>("media_download_queue_resume", { id }),
  queueReorder: (ids: string[]) => invoke<void>("media_download_queue_reorder", { ids }),
  playlist: (id: string, url: string) => invoke<DownloadPlaylist>("media_download_playlist", { id, url }),
  playlistQueue: (id: string, indices: number[]) => invoke<string[]>("media_download_playlist_queue", { id, indices }),
};
export const isDownloadActive = (job: DownloadJob) => job.state === "inspecting" || job.state === "downloading";
export function downloadPercent(job: DownloadJob): number | undefined {
  if (job.progress.phase === "converting") {
    const f = job.progress.fraction;
    return f !== null && f !== undefined && Number.isFinite(f) ? Math.min(100, Math.max(0, f * 100)) : undefined;
  }
  const { downloaded, total } = job.progress;
  if (downloaded === null || total === null || !Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.min(100, Math.max(0, downloaded / total * 100));
}
export function bytesLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
export function timeLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const n = Math.max(0, Math.floor(seconds));
  return n >= 3600 ? `${Math.floor(n/3600)}:${Math.floor(n/60)%60}`.replace(/:(\d)$/,":0$1")+`:${(n%60).toString().padStart(2,"0")}` : `${Math.floor(n/60)}:${(n%60).toString().padStart(2,"0")}`;
}
export function parseClipTime(input: string): number | null {
  if (!input.trim()) return null;
  if (!/^\d+(?::[0-5]\d){0,2}(?:\.\d{1,3})?$/.test(input.trim())) throw new Error("Use seconds, mm:ss or hh:mm:ss for clip times.");
  const seconds = input.trim().split(":").reduce((total, part) => total*60+Number(part),0);
  if (!Number.isFinite(seconds) || seconds > 86400) throw new Error("Clip times must be within 24 hours.");
  return seconds;
}
