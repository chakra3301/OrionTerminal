import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDesignDialog } from "../useDesignDialog";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";
import type { PhotoDocument } from "./types";
import { PhotoDialog } from "./photoDialog";

export type ColorProfileWorkflow = "assign" | "convert" | "info" | "proof" | "hdr";
const TITLES = { assign: "Assign Profile", convert: "Convert to Profile", info: "Color Profile Information", proof: "Proof Setup", hdr: "32-bit Preview Options" };
const COMMANDS = { assign: "edit.assignProfile", convert: "edit.convertToProfile", info: "edit.profileInfo", proof: "view.proofSetup", hdr: "view.thirtyTwoBitPreviewOptions" };
export const PROFILES = [
  ["srgb", "sRGB IEC61966-2.1", "Rgb"], ["display-p3", "Display P3", "Rgb"],
  ["adobe-rgb-compat", "Adobe RGB (1998)-compatible (Photocraft)", "Rgb"], ["prophoto-compat", "ProPhoto RGB-compatible (ROMM primaries, Photocraft)", "Rgb"],
  ["linear-srgb", "Linear sRGB (Photocraft)", "Rgb"], ["rec2020", "Rec. ITU-R BT.2020 (Photocraft)", "Rgb"],
  ["gray-gamma-2.2", "Gray Gamma 2.2 (Photocraft)", "Gray"], ["sgray", "sGray (sRGB tone curve, Photocraft)", "Gray"],
  ["lab-d50", "Lab D50 identity (Photocraft)", "Lab"], ["coated-cmyk", "Photocraft Coated CMYK (synthetic, 300% TAC, medium GCR)", "Cmyk"],
];
export const INTENTS = [["perceptual", "Perceptual"], ["saturation", "Saturation"], ["relative", "Relative Colorimetric"], ["absolute", "Absolute Colorimetric"]];
type ProfileInfo = { description: string; colorSpace: string; embedded?: boolean; bytes?: number; version?: string; class?: string; lut?: boolean; intents?: string[] };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const profileInfo = (value: unknown): ProfileInfo | null => {
  const info = object(value);
  if (typeof info.description !== "string" || info.description.length > 4096 || typeof info.colorSpace !== "string" || info.colorSpace.length > 64) return null;
  if (info.embedded !== undefined && typeof info.embedded !== "boolean" || info.lut !== undefined && typeof info.lut !== "boolean") return null;
  if (info.bytes !== undefined && (typeof info.bytes !== "number" || !Number.isSafeInteger(info.bytes) || info.bytes < 0 || info.bytes > 16_777_216)) return null;
  if ([info.version, info.class].some(value => value !== undefined && (typeof value !== "string" || value.length > 64))) return null;
  if (info.intents !== undefined && (!Array.isArray(info.intents) || info.intents.length > 4 || !info.intents.every(value => typeof value === "string" && INTENTS.some(([id]) => id === value)))) return null;
  return info as ProfileInfo;
};
const modeSpace = (mode: string) => ["grayscale", "bitmap", "duotone"].includes(mode.toLowerCase()) ? "Gray" : mode.toLowerCase() === "cmyk" ? "Cmyk" : mode.toLowerCase() === "lab" ? "Lab" : "Rgb";

export function ColorProfileDialog({ kind, document, canvas = null, close }: { kind: ColorProfileWorkflow; document: PhotoDocument; canvas?: HTMLElement | null; close: () => void }) {
  const state = usePhotoWorkspace(value => value.state), projectId = usePhotoWorkspace(value => value.projectId), busy = usePhotoWorkspace(value => value.busy), version = usePhotoWorkspace(value => value.stateVersion), documentId = usePhotoWorkspace(value => value.documentId), workspaceError = usePhotoWorkspace(value => value.error);
  const context = useRef({ projectId, id: document.id, version: document.version, viewKey: state?.viewKey });
  const mounted = useRef(true), pending = useRef(false);
  const currentContext = () => { const current = usePhotoWorkspace.getState(); return mounted.current && projectId === context.current.projectId && document.id === context.current.id && document.version === context.current.version && version === context.current.version && documentId === context.current.id && state?.viewKey === context.current.viewKey && current.projectId === context.current.projectId && current.documentId === context.current.id && current.stateVersion === context.current.version && current.state?.viewKey === context.current.viewKey; };
  const sameContext = currentContext();
  const initialView = state?.colorView;
  const [profile, setProfile] = useState(kind === "info" ? "document" : kind === "proof" ? PROFILES.some(([id]) => id === initialView?.profile) ? initialView!.profile : "current" : "working"), [intent, setIntent] = useState(kind === "proof" ? initialView?.intent ?? "relative" : state?.colorSettings?.settings.intent ?? "relative"), [bpc, setBpc] = useState(kind === "proof" ? initialView?.bpc ?? true : state?.colorSettings?.settings.bpc ?? true);
  const [dither, setDither] = useState(state?.colorSettings?.settings.dither ?? true);
  const [simulation, setSimulation] = useState(initialView?.kind ?? "profile"), [proofOn, setProofOn] = useState(initialView?.on ?? true), [paper, setPaper] = useState(initialView?.simulatePaper ?? false), [gamut, setGamut] = useState(initialView?.gamutWarning ?? false), [threshold, setThreshold] = useState(initialView?.threshold ?? 0);
  const [method, setMethod] = useState(initialView?.hdr.highlightCompression ? "highlightCompression" : "exposureGamma"), [exposure, setExposure] = useState(initialView?.hdr.exposure ?? 0), [gamma, setGamma] = useState(initialView?.hdr.gamma ?? 1);
  const [custom, setCustom] = useState<{ path: string; data: string; info: ProfileInfo } | null>(null), [details, setDetails] = useState<ProfileInfo | null>(null);
  const [processing, setProcessing] = useState(false), [error, setError] = useState(""), [live, setLive] = useState(isTauri() && document.width * document.height <= 16_777_216);
  const [opening] = useState(() => ({ profile, intent, bpc, dither, simulation, proofOn, paper, gamut, threshold, method, exposure, gamma }));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!sameContext && !busy) close(); }, [sameContext, busy, close]);
  const space = modeSpace(state?.mode ?? "RGB"), blocked = busy || processing;
  const problem = kind === "hdr" && state?.depth !== 32 ? "32-bit preview options need a 32-bit image." : kind === "hdr" && (!Number.isFinite(exposure) || exposure < -20 || exposure > 20 || !Number.isFinite(gamma) || gamma < 0.1 || gamma > 9.99) ? "Use exposure from −20 to 20 and gamma from 0.1 to 9.99." : kind === "proof" && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) ? "Use a gamut threshold from 0 to 100." : profile === "custom" && !custom ? "Choose an ICC profile." : kind === "assign" && profile === "custom" && custom?.info.colorSpace !== space ? `This image needs a ${space} profile.` : "";
  const params: Record<string, unknown> = profile === "custom" && custom ? { profile: custom.path, profileData: custom.data } : kind === "info" && profile === "document" ? {} : { profile };
  if (kind === "convert" || kind === "proof") { params.intent = intent; params.bpc = bpc; }
  if (kind === "convert") params.dither = state?.depth === 8 && dither;
  if (kind === "proof") Object.assign(params, { kind: simulation, on: proofOn, simulatePaper: paper, gamutWarning: gamut, threshold });
  if (kind === "hdr") { delete params.profile; Object.assign(params, { method, exposure, gamma }); }
  const previewAllowed = document.width * document.height <= 16_777_216, valid = !problem && sameContext;
  const preview = usePhotoCommandPreview(document, projectId, COMMANDS[kind], params, { automatic: live, enabled: kind !== "info" && valid && !blocked && previewAllowed, viewKey: state?.viewKey });
  const dialog = useDesignDialog<HTMLFormElement>(close, blocked);
  const operation = async (work: () => Promise<void>) => {
    if (pending.current || busy || !currentContext()) return;
    pending.current = true; setProcessing(true); setError("");
    try { await work(); } catch (error) { if (currentContext()) setError(String(error)); }
    finally { pending.current = false; if (mounted.current) setProcessing(false); }
  };
  const choose = () => operation(async () => {
    const path = await open({ multiple: false, filters: [{ name: "ICC color profile", extensions: ["icc", "icm"] }] });
    if (typeof path !== "string" || !currentContext()) return;
    const result = object(await runPhotoCommand("edit.profileInfo", { profile: path, includeData: true }));
    if (!currentContext()) return;
    const info = profileInfo(result.profile);
    if (!info || result.profileSource !== path || typeof result.profileData !== "string" || !result.profileData.length || result.profileData.length > 22_369_624) throw new Error("The native profile import returned invalid data.");
    setCustom({ path, data: result.profileData, info }); setProfile("custom"); setDetails(info);
  });
  const inspect = () => operation(async () => {
    const result = object(await runPhotoCommand("edit.profileInfo", params));
    if (!currentContext()) return;
    const info = profileInfo(result.profile); if (!info) throw new Error("The native profile information is unavailable."); setDetails(info);
  });
  const source = state?.colorProfile;
  const reset = () => { setProfile(opening.profile); setIntent(opening.intent); setBpc(opening.bpc); setDither(opening.dither); setSimulation(opening.simulation); setProofOn(opening.proofOn); setPaper(opening.paper); setGamut(opening.gamut); setThreshold(opening.threshold); setMethod(opening.method); setExposure(opening.exposure); setGamma(opening.gamma); setDetails(null); setError(""); };
  const check = (label: string, name: string, checked: boolean, disabled: boolean, change: (value: boolean) => void) => <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={name} checked={checked} disabled={disabled} onChange={event => change(event.target.checked)}/>{label}</label></div>;
  const profileRow = <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>{kind === "proof" ? "Device to Simulate" : "Profile"}:</span><select aria-label="Color profile" value={profile} disabled={blocked} onChange={event => { setProfile(event.target.value); setDetails(null); setError(""); }}>
    {kind === "info" ? <option value="document">Document profile</option> : kind === "proof" ? <option value="current">Current proof profile{initialView?.description ? ` · ${initialView.description}` : ""}</option> : <option value="working">Working profile for this image mode</option>}{kind === "assign" && <option value="none">Remove embedded profile</option>}
    {PROFILES.filter(([, , target]) => kind !== "assign" || target === space).map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value="custom">Custom ICC profile</option>
  </select></label></div>;
  return <PhotoDialog dialog={dialog} title={TITLES[kind]} noValidate busy={blocked} okDisabled={kind !== "info" && !valid} cancel={kind !== "info"} className="xd-photo-profile-dialog" beside={kind !== "info"} close={close} reset={kind === "info" ? undefined : reset} preview={kind === "info" ? undefined : { checked: live, disabled: !previewAllowed, busy: live && preview.loading, change: checked => { setLive(checked); if (checked) void preview.preview(); } }} onSubmit={event => {
    event.preventDefault(); if (kind === "info") { close(); return; } if (!valid || blocked) return;
    void operation(async () => { await runPhotoCommand(COMMANDS[kind], params); if (mounted.current) close(); });
  }}>
    <p className="xd-ps-dialog-readout">Current image: {source ? `${source.description} · ${source.embedded ? "Embedded" : "Assumed"} · ${source.colorSpace}` : "Read profile details to inspect the image."}</p>
      {kind === "info" ? <div className="xd-ps-dialog-grid">{profileRow}</div> : kind !== "hdr" && <fieldset className="xd-ps-dialog-group"><legend>{kind === "assign" ? "Assign Profile" : kind === "convert" ? "Destination Space" : "Proof Conditions"}</legend><div className="xd-ps-dialog-grid">
        {profileRow}
        {kind === "proof" && <><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Simulation:</span><select aria-label="Proof simulation" value={simulation} disabled={blocked} onChange={event => setSimulation(event.target.value)}>{[["profile", "Profile"], ["workingCyanPlate", "Working cyan plate"], ["workingMagentaPlate", "Working magenta plate"], ["workingYellowPlate", "Working yellow plate"], ["workingBlackPlate", "Working black plate"], ["workingCmyPlate", "Working CMY plates"], ["legacyMacintoshRgb", "Legacy Macintosh RGB"], ["colorBlindnessProtanopia", "Color blindness · protanopia"], ["colorBlindnessDeuteranopia", "Color blindness · deuteranopia"]].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Rendering Intent:</span><select aria-label="Profile rendering intent" value={intent} disabled={blocked} onChange={event => setIntent(event.target.value)}>{INTENTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>{check("Black Point Compensation", "Profile black point compensation", bpc, blocked, setBpc)}</>}
      </div></fieldset>}
      {kind === "convert" && <fieldset className="xd-ps-dialog-group"><legend>Conversion Options</legend><div className="xd-ps-dialog-grid"><div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Intent:</span><select aria-label="Profile rendering intent" value={intent} disabled={blocked} onChange={event => setIntent(event.target.value)}>{INTENTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>{check("Use Black Point Compensation", "Profile black point compensation", bpc, blocked, setBpc)}{check("Use Dither (8-bit/channel images)", "Dither profile conversion", state?.depth === 8 && dither, blocked || state?.depth !== 8, setDither)}</div></fieldset>}
      {kind === "proof" && <fieldset className="xd-ps-dialog-group"><legend>Display Options (On-Screen)</legend><div className="xd-ps-dialog-grid">
        {check("Proof Colors", "Proof Colors", proofOn, blocked, setProofOn)}{check("Simulate Paper Color", "Simulate paper color", paper, blocked, setPaper)}{check("Gamut Warning", "Gamut Warning", gamut, blocked, setGamut)}
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Threshold:</span><input aria-label="Gamut threshold" type="number" min="0" max="100" step="any" value={Number.isFinite(threshold) ? threshold : ""} disabled={blocked} onChange={event => setThreshold(event.target.valueAsNumber)}/></label></div>
      </div></fieldset>}
      {kind === "hdr" && <div className="xd-ps-dialog-grid">
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Method:</span><select aria-label="32-bit preview method" value={method} disabled={blocked} onChange={event => setMethod(event.target.value)}><option value="exposureGamma">Exposure and gamma</option><option value="highlightCompression">Highlight compression</option></select></label></div>
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Exposure:</span><input aria-label="Preview exposure" type="number" min="-20" max="20" step="any" value={Number.isFinite(exposure) ? exposure : ""} disabled={blocked || method === "highlightCompression"} onChange={event => setExposure(event.target.valueAsNumber)}/></label></div>
        <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Gamma:</span><input aria-label="Preview gamma" type="number" min="0.1" max="9.99" step="any" value={Number.isFinite(gamma) ? gamma : ""} disabled={blocked || method === "highlightCompression"} onChange={event => setGamma(event.target.valueAsNumber)}/></label></div>
      </div>}
      {kind !== "hdr" && <button type="button" disabled={blocked} onClick={() => void choose()}>Choose ICC profile…</button>}{kind !== "hdr" && profile === "custom" && custom && <p className="xd-ps-dialog-readout">{custom.path.split(/[\\/]/).at(-1)} · {custom.info.description}</p>}
      {kind === "proof" && simulation.includes("Plate") && <p className="xd-photo-section-help">Plate simulations use the working CMYK profile.</p>}{kind === "hdr" && method === "highlightCompression" && <p className="xd-photo-section-help">The native highlight-compression preview displays the stored 0–1 range.</p>}
      {kind !== "hdr" && <button type="button" disabled={blocked || !valid || profile === "none" || profile === "current"} onClick={() => void inspect()}>Read profile details</button>}
      {details && <dl aria-label="ICC profile information"><dt>Profile</dt><dd>{details.description}</dd><dt>Color space</dt><dd>{details.colorSpace}</dd>{details.embedded !== undefined && <><dt>Embedded</dt><dd>{details.embedded ? "Yes" : "No"}</dd></>}{details.version && <><dt>ICC version</dt><dd>{details.version}</dd></>}{details.class && <><dt>Profile class</dt><dd>{details.class}</dd></>}{details.bytes !== undefined && <><dt>Profile size</dt><dd>{details.bytes.toLocaleString()} bytes</dd></>}{details.lut !== undefined && <><dt>Lookup table</dt><dd>{details.lut ? "Yes" : "No"}</dd></>}{details.intents && <><dt>Supported intents</dt><dd>{details.intents.join(", ")}</dd></>}</dl>}
    {kind !== "info" && <>{!previewAllowed && <p role="status">Temporary profile previews support images up to 16 megapixels.</p>}{preview.error && <p role="alert">{preview.error}</p>}</>}
    {(problem || error || workspaceError) && <p role="alert">{error || problem || workspaceError}</p>}
    {kind !== "info" && canvas && live && preview.url && createPortal(<img className="xd-photo-canvas-preview" src={preview.url} alt="" draggable={false}/>, canvas)}
  </PhotoDialog>;
}
