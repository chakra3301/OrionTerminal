import { useState } from "react";
import { PresetPreview } from "./PresetPreview";
import type { PhotoState } from "./types";

type Run = (command: string, params?: Record<string, unknown>) => Promise<unknown>;
type Brush = NonNullable<PhotoState["brush"]>;

/** Photoshop's tip grid in Brush Tip Shape and Dual Brush: a click gives that tip, and its size, to the current brush only. */
export function BrushTipGrid({ label, target, brush, disabled, run }: { label: string; target: "tip" | "dualBrush"; brush: Brush; disabled: boolean; run: Run }) {
  const [picked, setPicked] = useState<string | null>(null), current = target === "tip" ? brush.tip : brush.dualTip;
  // A round tip names no preset, since every round preset shares it, so the cell picked for it stays marked.
  const marked = current?.preset ?? (current?.id === "round" ? picked : null);
  const pick = async (name: string, size: number) => {
    const patch = { tipPreset: name, ...(Number.isFinite(size) && size > 0 ? { size } : {}) };
    await run("tools.setBrush", target === "tip" ? patch : { dualBrush: patch });
    setPicked(name);
  };
  return <div className="xd-photo-property"><span>{label}</span><div role="group" aria-label={label} className="xd-ps-brush-presets">
    {brush.presets.map(preset => <button key={preset.name} type="button" aria-label={`${label}: ${preset.name}`} aria-pressed={preset.name === marked} title={`${preset.name} · ${Math.round(preset.size)} px`} disabled={disabled} onClick={() => { void pick(preset.name, preset.size).catch(() => {}); }}>
      <PresetPreview kind="brush" preset={preset.name} revision={brush.revision} /><small>{Math.round(preset.size)}</small>
    </button>)}
  </div></div>;
}

/** Brush Settings › Texture's pattern picker, fed by the pattern library. */
export function BrushTexturePattern({ state, disabled, run }: { state: PhotoState; disabled: boolean; run: Run }) {
  const groups = state.presets?.patterns ?? [], patterns = groups.flatMap(group => group.presets.map(preset => ({ ...preset, group: group.name })));
  const id = (state.brush?.settings.texture as { patternId?: unknown } | undefined)?.patternId, selected = patterns.some(pattern => pattern.id === id) ? id as string : "";
  return <label className="xd-photo-property">Texture pattern<select aria-label="Texture pattern" disabled={disabled || !patterns.length} value={selected} onChange={event => { if (event.target.value) void run("brush.texturePattern", { pattern: event.target.value }).catch(() => {}); }}>
    <option value="">{state.brush?.sampledTexture ? "Library pattern" : "Procedural texture"}</option>
    {patterns.map(pattern => <option key={pattern.id} value={pattern.id}>{pattern.name} · {pattern.group}</option>)}
  </select></label>;
}
