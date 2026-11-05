import { useState, type PointerEvent } from "react";
import { channelColor, histogramPath, useHistogram, type HistogramSource } from "./toneControls";
import type { PhotoDocument } from "./types";
import "./histogramPanel.css";

type Channel = { id: string; label: string; space: string; index: number | "colors" };
const GRAY_MODES = ["grayscale", "gray", "duotone", "bitmap"];
const LUMINOSITY: Channel = { id: "luminosity", label: "Luminosity", space: "luminosity", index: 0 };
const INKS = ["cyan", "magenta", "yellow", "black"];

/** The Channel menu follows the document mode, as Photoshop's does. */
export function histogramChannels(mode: string): Channel[] {
  const lower = mode.toLowerCase();
  if (GRAY_MODES.includes(lower)) return [{ ...LUMINOSITY, id: "gray", label: "Gray" }];
  if (lower === "lab") return [{ id: "lightness", label: "Lightness", space: "lab", index: 0 }, { id: "a", label: "a", space: "lab", index: 1 }, { id: "b", label: "b", space: "lab", index: 2 }];
  if (lower === "cmyk") return [{ id: "colors", label: "Colors", space: "cmyk", index: "colors" }, { id: "composite", label: "CMYK", space: "cmyk", index: 0 }, ...INKS.map((ink, i) => ({ id: ink, label: ink[0]!.toUpperCase() + ink.slice(1), space: "cmyk", index: i + 1 })), LUMINOSITY];
  return [{ id: "colors", label: "Colors", space: "rgb", index: "colors" }, { id: "composite", label: "RGB", space: "rgb", index: 0 }, ...["red", "green", "blue"].map((name, i) => ({ id: name, label: name[0]!.toUpperCase() + name.slice(1), space: "rgb", index: i + 1 })), LUMINOSITY];
}

export type HistogramStats = { mean: number; stdDev: number; median: number; pixels: number };
/** `perPixel` is how many counts each pixel adds: the RGB composite counts all three channel values. */
export function histogramStats(bins: number[], perPixel = 1): HistogramStats | null {
  const total = bins.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const mean = bins.reduce((sum, count, level) => sum + count * level, 0) / total;
  const variance = bins.reduce((sum, count, level) => sum + count * (level - mean) ** 2, 0) / total;
  let acc = 0, median = 0;
  while (median < 255 && acc + bins[median]! < total / 2) acc += bins[median++]!;
  return { mean, stdDev: Math.sqrt(variance), median, pixels: Math.round(total / perPixel) };
}
export const histogramPercentile = (bins: number[], level: number) => {
  const total = bins.reduce((sum, count) => sum + count, 0);
  return total ? bins.slice(0, level + 1).reduce((sum, count) => sum + count, 0) / total * 100 : 0;
};

const expectedSets = (space: string) => space === "cmyk" ? 5 : space === "lab" ? 3 : space === "luminosity" ? 1 : 4;

export function HistogramPanel({ document, mode, activeLayer }: { document: PhotoDocument; mode: string; activeLayer: number | null }) {
  const channels = histogramChannels(mode), [channelId, setChannelId] = useState("colors"), [expanded, setExpanded] = useState(false);
  const [sourceId, setSourceId] = useState<"image" | "layer">("image"), [level, setLevel] = useState<number | null>(null);
  const channel = channels.find(item => item.id === channelId) ?? channels[0]!, useLayer = sourceId === "layer" && activeLayer !== null;
  // Only a mounted panel reads, so a closed panel costs nothing; the hook waits for edits to settle.
  const source: HistogramSource = { document, layer: useLayer ? activeLayer : undefined, below: false };
  const sets = useHistogram(source, channel.space), usable = sets?.length === expectedSets(channel.space) ? sets : null;
  // Ink histograms are stored as 1 - ink (the Curves orientation); the panel shows ink amount from none to full.
  const pick = (index: number) => usable?.[index] && (channel.space === "cmyk" ? [...usable[index]!].reverse() : usable[index]);
  const colors = channel.index === "colors" ? (channel.space === "cmyk" ? [1, 2, 3, 4] : [1, 2, 3]) : [];
  const bins = pick(channel.index === "colors" ? 0 : channel.index), perPixel = channel.space === "rgb" && channel.index === 0 ? 3 : channel.index === "colors" && channel.space === "rgb" ? 3 : 1;
  const stats = bins ? histogramStats(bins, perPixel) : null;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setLevel(box.width ? Math.max(0, Math.min(255, Math.floor((event.clientX - box.left) / box.width * 256))) : null);
  };
  const names = channel.space === "cmyk" ? INKS : ["red", "green", "blue"];
  return <div className="xd-hist-panel" role="group" aria-label="Histogram">
    <div className="xd-hist-bar">
      <label>Channel<select aria-label="Histogram channel" value={channel.id} onChange={event => setChannelId(event.target.value)}>{channels.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="xd-hist-expand"><input type="checkbox" aria-label="Histogram expanded view" checked={expanded} onChange={event => setExpanded(event.target.checked)}/>Expanded View</label>
    </div>
    <div className="xd-hist-graph" aria-label="Histogram graph" onPointerMove={move} onPointerLeave={() => setLevel(null)}>
      <svg viewBox="0 0 256 100" preserveAspectRatio="none" aria-hidden="true">
        {colors.length ? colors.map(index => { const data = pick(index); return data && <path key={index} className="xd-hist-colors" d={histogramPath(data)} fill={channelColor(names[index - 1]!) ?? "currentColor"}/>; }) : bins && <path d={histogramPath(bins)} fill={channelColor(channel.id) ?? "currentColor"}/>}
        {level !== null && <path className="xd-hist-cursor" d={`M${level + .5} 0V100`} vectorEffect="non-scaling-stroke"/>}
      </svg>
    </div>
    {expanded && <>
      <label className="xd-hist-source">Source<select aria-label="Histogram source" value={useLayer ? "layer" : "image"} onChange={event => setSourceId(event.target.value as "image" | "layer")}>
        <option value="image">Entire Image</option><option value="layer" disabled={activeLayer === null}>Selected Layer</option></select></label>
      <div className="xd-hist-stats" aria-label="Histogram statistics">
        <Stat label="Mean" value={stats && stats.mean.toFixed(2)}/><Stat label="Std Dev" value={stats && stats.stdDev.toFixed(2)}/>
        <Stat label="Median" value={stats && String(stats.median)}/><Stat label="Pixels" value={stats && stats.pixels.toLocaleString()}/>
        <Stat label="Level" value={level !== null && bins ? String(level) : null}/><Stat label="Count" value={level !== null && bins ? bins[level]!.toLocaleString() : null}/>
        <Stat label="Percentile" value={level !== null && bins ? `${histogramPercentile(bins, level).toFixed(2)}%` : null}/>
      </div>
      <p className="xd-hist-note">Read from a reduced-size preview, so counts are approximate.</p>
    </>}
  </div>;
}

const Stat = ({ label, value }: { label: string; value: string | null }) => <div className="xd-hist-stat" aria-label={`Histogram ${label}`}><span>{label}:</span><output>{value ?? ""}</output></div>;
