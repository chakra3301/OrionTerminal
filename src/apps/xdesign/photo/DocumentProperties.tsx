import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { InspectorSection } from "../EditorChrome";
import { Field } from "./LayerProperties";
import { runPhotoCommand } from "./runtime";
import type { PhotoState } from "./types";

type Display = "outline" | "overlay" | "both";
const attempt = (work: Promise<unknown>) => { void work.catch(() => {}); };
const MODES: Record<string, string> = { rgb: "RGB Color", cmyk: "CMYK Color", grayscale: "Grayscale", gray: "Grayscale", lab: "Lab Color", bitmap: "Bitmap", indexed: "Indexed Color", duotone: "Duotone", multichannel: "Multichannel" };

// Photoshop's Properties with nothing selected. W and H resize the canvas about its centre; Resolution changes ppi only.
export function DocumentProperties({ state, disabled, display, setDisplay, imageSize, addText, profileInfo, trim }: { state: PhotoState | null; disabled: boolean; display: Display; setDisplay: (display: Display) => void; imageSize: () => void; addText: () => void; profileInfo: () => void; trim?: () => void }) {
  const [linked, setLinked] = useState(true);
  const off = disabled || !state;
  const canvas = (width: number, height: number) => { if (width >= 1 && height >= 1) attempt(runPhotoCommand("image.canvasSize", { width: Math.round(width), height: Math.round(height), anchor: "center", extensionColor: "background" })); };
  const run = (id: string) => attempt(runPhotoCommand(id, {}));
  const LinkIcon = linked ? Link2 : Link2Off;
  const profile = state?.colorProfile;
  return <>
    <InspectorSection title="Canvas" defaultOpen><div className="xd-photo-transform">
      {state && <div><Field label="W" name="Canvas width" unit="px" value={state.width} disabled={off} commit={width => canvas(width, linked ? state.height * width / state.width : state.height)}/>
        <button type="button" aria-label="Link canvas width and height" title="Link canvas width and height" aria-pressed={linked} disabled={off} onClick={() => setLinked(!linked)}><LinkIcon size={13}/></button>
        <Field label="H" name="Canvas height" unit="px" value={state.height} disabled={off} commit={height => canvas(linked ? state.width * height / state.height : state.width, height)}/></div>}
      {state && <div><Field label="Resolution" name="Resolution" unit="ppi" value={state.resolution} disabled={off} commit={resolution => { if (resolution > 0) attempt(runPhotoCommand("image.imageSize", { width: state.width, height: state.height, resolution, resample: "none" })); }}/></div>}
      {state && <p className="xd-photo-section-help">Mode: {MODES[state.mode.toLowerCase()] ?? state.mode} · {state.depth}-bit{profile ? ` · ${profile.description} (${profile.embedded ? "Embedded" : "Assumed"})` : ""}</p>}
    </div></InspectorSection>
    <InspectorSection title="Quick Actions" defaultOpen><div className="xd-photo-action-list">
      <button type="button" disabled={off} onClick={imageSize}>Image Size…</button>
      <button type="button" disabled={disabled} onClick={trim ?? (() => run("image.trim"))}>{trim ? "Trim…" : "Trim"}</button>
      <button type="button" disabled={disabled} onClick={() => run("image.imageRotation.90cw")}>Rotate 90°</button>
      <button type="button" disabled={disabled} onClick={() => run("image.imageRotation.flipCanvasHorizontal")}>Flip horizontal</button>
      <button type="button" disabled={disabled} onClick={addText}>Add text</button>
      <button type="button" disabled={off} onClick={profileInfo}>Profile information…</button>
    </div></InspectorSection>
    <InspectorSection title="Selection" defaultOpen><label className="xd-photo-property">Display<select aria-label="Selection display" value={display} onChange={event => setDisplay(event.target.value as Display)}><option value="outline">Outline</option><option value="overlay">Soft overlay</option><option value="both">Outline &amp; overlay</option></select></label></InspectorSection>
  </>;
}
