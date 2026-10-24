import { useId } from "react";
import type { DownloadMetadata, DownloadOptions, DownloadPreset, SponsorBlockChoice } from "./downloadTypes";

export const SPONSOR_CATEGORIES = [["sponsor", "Sponsors"], ["selfpromo", "Self-promotion"], ["interaction", "Interaction reminders"], ["intro", "Intros"], ["outro", "Outros"], ["preview", "Previews / recaps"], ["music_offtopic", "Non-music sections"], ["filler", "Filler"], ["hook", "Hooks / teasers"], ["poi_highlight", "Highlight points · mark only"], ["chapter", "Community chapters · mark only"]] as const;
export const defaultSponsorBlock = (): SponsorBlockChoice => ({ mode: "off", categories: ["sponsor"] });
export function sponsorError(options: DownloadOptions, preset: DownloadPreset, metadata?: DownloadMetadata | null): string | null {
  const choice=options.sponsorblock ?? defaultSponsorBlock();
  if (choice.categories.length>SPONSOR_CATEGORIES.length || new Set(choice.categories).size!==choice.categories.length || choice.categories.some((c)=>!SPONSOR_CATEGORIES.some(([id])=>id===c))) return "Choose distinct supported SponsorBlock categories.";
  if (choice.mode==="off") return null;
  if (!choice.categories.length) return "Select at least one SponsorBlock category.";
  if (metadata && !/^youtube:[A-Za-z0-9_-]{11}$/i.test(metadata.sourceId ?? "")) return "SponsorBlock requires a YouTube video. Turn it off for this source.";
  if (choice.mode==="remove" && choice.categories.some((c)=>["poi_highlight","chapter"].includes(c))) return "Highlights and community chapters can be marked, not removed.";
  if (choice.mode==="mark" && preset.startsWith("audio") && preset!=="audio-m4a") return "SponsorBlock chapter marking needs video or M4A.";
  if (choice.mode==="remove" && (options.startSeconds!==null || options.endSeconds!==null || options.embedSubtitles)) return "Removal needs full-length media without embedded captions. Mark chapters instead to preserve the timeline.";
  return null;
}
export function SponsorControls({ options, preset, metadata, clipped, disabled, onChange }: { options: DownloadOptions; preset: DownloadPreset; metadata?: DownloadMetadata | null; clipped?: boolean; disabled: boolean; onChange: (options: DownloadOptions)=>void }) {
  const id=useId();
  const choice=options.sponsorblock ?? defaultSponsorBlock();
  const supported=!metadata || /^youtube:[A-Za-z0-9_-]{11}$/i.test(metadata.sourceId ?? "");
  const chapters=!preset.startsWith("audio") || preset==="audio-m4a";
  const set=(patch:Partial<SponsorBlockChoice>)=>onChange({...options,sponsorblock:{...choice,...patch}});
  const error=sponsorError(clipped === undefined ? options : { ...options, startSeconds: clipped ? 0 : null, endSeconds: null },preset,metadata);
  return <details className="dl-advanced dl-embedding dl-sponsor"><summary>SponsorBlock</summary>
    <p>Optional third-party lookup. When enabled, downloads contact sponsor.ajay.app using a YouTube video-ID hash prefix and the selected categories. Hashing is not anonymity. The service returns community-submitted segments. Inspection does not make this lookup. No AI request.</p>
    <label htmlFor={`${id}-mode`}>SponsorBlock action<select id={`${id}-mode`} value={choice.mode} disabled={disabled} onChange={(e)=>set({mode:e.target.value as SponsorBlockChoice["mode"]})}>
      <option value="off">Off · no lookup</option><option value="mark" disabled={!supported || !chapters}>Mark chapters · keep all media</option><option value="remove" disabled={!supported}>Remove selected segments</option>
    </select></label>
    {!supported && <p>This source is not a YouTube video. Turn SponsorBlock off.</p>}
    {choice.mode!=="off" && <>
      <p>{choice.mode==="mark" ? "Marks the selected categories as embedded chapters. Requires video or M4A; players vary in chapter support." : "Changes the downloaded copy’s timeline. Cannot be combined with clip ranges or embedded captions yet. Cuts can land near keyframes. The remote source and existing library files are untouched."}</p>
      <div role="group" aria-label="SponsorBlock categories">{SPONSOR_CATEGORIES.map(([category,label])=><label className="dl-switch" key={category}><span>{label}</span><input type="checkbox" checked={choice.categories.includes(category)} disabled={disabled} onChange={(e)=>set({categories:e.target.checked ? [...choice.categories,category] : choice.categories.filter((c)=>c!==category)})} /></label>)}</div>
      <p>Community data can be missing or inaccurate. A valid empty result keeps the whole file; an unavailable or unreadable lookup fails rather than claiming segments were handled.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
