import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { channelLayers } from "./channelSources";
import { matchSourceLayer, type MatchSourceLayer } from "./imageCommands";
import type { PhotoState } from "./types";

/** Match Color's Layer menu: Merged, then every layer of the chosen source image, read from its saved version. */
export function MatchColorLayer({ projectId, source, value, disabled, change, fail }: { projectId: string | null; source: { id: string; version: string } | undefined; value: unknown; disabled: boolean; change: (value: MatchSourceLayer | undefined) => void; fail: (message: string) => void }) {
  const key = source ? `${source.id}/${source.version}` : "", [loaded, setLoaded] = useState<{ key: string; state: PhotoState } | null>(null);
  useEffect(() => {
    // Another source starts at Merged, as in Photoshop, rather than restoring a layer picked from it earlier.
    if (value !== undefined && matchSourceLayer(value, source?.id) === undefined) change(undefined);
    if (!source || !projectId || !isTauri()) return;
    let alive = true;
    invoke<PhotoState>("xdesign_photo_source_inspect", { projectId, source: { photoId: source.id, version: source.version } }).then(state => { if (alive) setLoaded({ key, state }); }).catch(error => { if (alive) fail(String(error)); });
    return () => { alive = false; };
  }, [key, projectId]);
  const layers = source && loaded?.key === key ? channelLayers(loaded.state.layers) : [];
  return <label className="xd-ps-dialog-field"><span>Layer:</span><select aria-label="Layer" disabled={disabled || !layers.length} value={matchSourceLayer(value, source?.id) ?? "merged"} onChange={event => change(source && event.target.value !== "merged" ? { photo: source.id, layer: Number(event.target.value) } : undefined)}>
    <option value="merged">Merged</option>{layers.map(({ layer, label }) => <option key={layer.id} value={layer.id}>{label}</option>)}
  </select></label>;
}
