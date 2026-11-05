import { useId, useRef, useEffect, useState } from "react";
import { useDownloads } from "./downloadStore";
import { EmbeddingControls, embeddingForPreset } from "./EmbeddingControls";
import { SponsorControls, sponsorError } from "./SponsorControls";
import { AUDIO_PRESETS, VIDEO_PRESETS, defaultDownloadLimits, downloadLimitsError, downloadDefaults, type DownloadOptions, type DownloadPreferences, type DownloadPreset } from "./downloadTypes";

export function TransferControls({ options, disabled, onChange }: { options: DownloadOptions; disabled: boolean; onChange: (options: DownloadOptions) => void }) {
  const id = useId();
  return <div className="dl-transfer-controls">
    <label htmlFor={`${id}-rate`}>Rate limit · KiB/s<input id={`${id}-rate`} type="number" min={16} max={1048576} step={1} placeholder="Unlimited" value={options.rateLimitKib ?? ""} disabled={disabled} onChange={(e) => onChange({ ...options,rateLimitKib: e.target.value === "" ? null : Number(e.target.value) })} /></label>
    <label htmlFor={`${id}-retries`}>Retries<select id={`${id}-retries`} value={options.retries ?? 2} disabled={disabled} onChange={(e) => onChange({ ...options,retries: Number(e.target.value) })}>{Array.from({length:11},(_,n) => <option key={n} value={n}>{n}{n === 0 ? " · none" : ""}</option>)}</select></label>
    <label htmlFor={`${id}-fragments`}>Parallel fragments<select id={`${id}-fragments`} value={options.fragments ?? 1} disabled={disabled} onChange={(e) => onChange({ ...options,fragments: Number(e.target.value) })}>{Array.from({length:8},(_,n) => <option key={n+1} value={n+1}>{n+1}</option>)}</select></label>
    <p>Applies to supported segmented sources, not separate jobs. Each retry limit applies to transfer, fragments and extraction. Storage and time limits are configured separately below.</p>
  </div>;
}

export function LimitsControls({ options, disabled, onChange }: { options: DownloadOptions; disabled: boolean; onChange: (options: DownloadOptions) => void }) {
  const id = useId();
  const limits = options.limits ?? defaultDownloadLimits();
  const error = downloadLimitsError(options);
  return <div className="dl-transfer-controls">
    {([
      ["fileMib", "Maximum media file · MiB", 16, 65536],
      ["workMib", "Combined unfinished work · MiB", 32, 262144],
      ["freeMib", "Keep free on disk · MiB", 512, 65536],
      ["minutes", "Per engine operation · minutes", 1, 1440],
    ] as const).map(([key,label,min,max]) => <label key={key} htmlFor={`${id}-${key}`}>{label}<input id={`${id}-${key}`} type="number" min={min} max={max} step={1} disabled={disabled} value={limits[key]} onChange={(e) => onChange({ ...options, limits: { ...limits, [key]: Number(e.target.value) } })} /></label>)}
    <p>1024 MiB = 1 GiB. The work limit counts all unfinished jobs, including paused and failed files. Use at least twice the file limit for conversion; this is not a space reservation. Jobs with different work limits wait for active jobs to finish. Disk/work checks are sampled; partial files stay for Retry or Remove.</p>
    <p>Downloads, caption remuxing and conversion each get their own time limit. Inspection and small poster generation keep separate bounded timeouts. Saving to Media checks room for a full extra copy plus your free-space reserve.</p>
    {error && <p role="alert" className="dl-item-error">{error}</p>}
  </div>;
}

export function DownloadDefaults({ busy }: { busy: boolean }) {
  const s = useDownloads();
  return <section className="dl-setup dl-defaults" aria-label="Download defaults">
    <h2>New-link defaults</h2>
    <p>Saved locally. Changes affect future inspections, not existing downloads. Clip ranges and exact format IDs always stay source-specific.</p>
    {s.preferencesError ? <><p role="alert" className="dl-item-error">{s.preferencesError}</p><button type="button" disabled={busy} onClick={() => void s.loadPreferences()}>Retry reading defaults</button></> : s.preferences ? <DefaultsEditor initial={s.preferences} busy={busy} /> : <p role="status">Reading defaults…</p>}
    <p>{s.archiveCount !== null ? `${s.archiveCount} saved format/range variants in the independent duplicate archive. ` : ""}History cleanup keeps this archive. Use “Forget source archive” or turn off “Skip duplicates” for an intentional new copy.</p>
    <p>Media is the library destination. “Export a copy…” opens a native Save dialog for any local folder; your original and existing files are never replaced.</p>
  </section>;
}
function DefaultsEditor({ initial, busy }: { initial: DownloadPreferences; busy: boolean }) {
  const [preset,setPreset] = useState<DownloadPreset>(initial.preset);
  const [options,setOptions] = useState<DownloadOptions>(initial.options);
  const [notice,setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const id = useId();
  useEffect(() => { setPreset(initial.preset); setOptions(initial.options); }, [initial]);
  return <div className="dl-defaults-editor">
    <label htmlFor={`${id}-preset`}>Default format<select id={`${id}-preset`} value={preset} disabled={busy} onChange={(e) => { const p = e.target.value as DownloadPreset; setPreset(p); setOptions((o) => embeddingForPreset(o, p)); setNotice(""); }}><optgroup label="Video">{VIDEO_PRESETS.map(([v,label]) => <option key={v} value={v}>{label}</option>)}</optgroup><optgroup label="Audio">{AUDIO_PRESETS.map(([v,label]) => <option key={v} value={v}>{label}</option>)}</optgroup></select></label>
    <label className="dl-switch"><span>Play compatible video in Media</span><input type="checkbox" checked={options.playable} disabled={busy} onChange={(e) => setOptions({ ...options,playable:e.target.checked })} /></label>
    <label className="dl-switch"><span>Skip archived duplicates</span><input type="checkbox" checked={options.skipDuplicates} disabled={busy} onChange={(e) => setOptions({ ...options,skipDuplicates:e.target.checked })} /></label>
    <label htmlFor={`${id}-quality`}>Audio conversion quality<select id={`${id}-quality`} value={options.audioQuality} disabled={busy} onChange={(e) => setOptions({ ...options,audioQuality:Number(e.target.value) })}>{Array.from({length:11},(_,n) => <option key={n} value={n}>{n}{n === 0 ? " · highest" : n === 10 ? " · lowest" : ""}</option>)}</select></label>
    <EmbeddingControls options={options} preset={preset} disabled={busy} onChange={setOptions} />
    <SponsorControls options={options} preset={preset} disabled={busy} onChange={setOptions} />
    <details className="dl-advanced"><summary>Rate, retries & fragments</summary><TransferControls options={options} disabled={busy} onChange={setOptions} /></details>
    <details className="dl-advanced"><summary>Storage & time limits</summary><LimitsControls options={options} disabled={busy} onChange={setOptions} /></details>
    <button type="button" disabled={busy || !!downloadLimitsError(options) || !!sponsorError(options, preset)} onClick={() => { setNotice(""); void useDownloads.getState().savePreferences(downloadDefaults(preset,options)).then((ok) => { if (ok && alive.current) setNotice("Defaults saved."); }); }}>Save defaults</button>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
