/**
 * Preset scenes — one click, full vibe. Each is a curated layer stack with
 * bindings already wired so it feels alive immediately. Applied by
 * replacing the current scene (they're starting points, not add-ons).
 */

import { ulid } from "ulid";
import {
  emptyScene,
  defaultParams,
  type FxBinding,
  type FxBlendMode,
  type FxLayer,
  type FxParamValue,
  type FxScene,
} from "./fxModel";
import { fxEffect } from "./fxRegistry";

type LayerSpec = {
  effect: string;
  name?: string;
  params?: Record<string, FxParamValue>;
  blend?: FxBlendMode;
  opacity?: number;
  bindings?: Record<string, FxBinding>;
};

export type FxPreset = {
  id: string;
  name: string;
  description: string;
  background: string;
  layers: LayerSpec[];
};

function build(preset: FxPreset): FxScene {
  const scene = emptyScene();
  scene.background = preset.background;
  for (const l of preset.layers) {
    const spec = fxEffect(l.effect);
    if (!spec) continue;
    const layer: FxLayer = {
      id: ulid(),
      effectId: l.effect,
      name: l.name ?? spec.label,
      opacity: l.opacity ?? 1,
      params: { ...defaultParams(spec), ...l.params },
    };
    if (l.blend) layer.blend = l.blend;
    if (l.bindings) layer.bindings = { ...l.bindings };
    scene.layers.push(layer);
  }
  return scene;
}

export function buildPreset(preset: FxPreset): FxScene {
  return build(preset);
}

export const FX_PRESETS: FxPreset[] = [
  {
    id: "synthwave",
    name: "Synthwave sunset",
    description: "Striped sun, laser grid, tape grain",
    background: "#0b0220",
    layers: [
      { effect: "sunGrid" },
      { effect: "bloom", params: { threshold: 0.45, intensity: 0.9 } },
      { effect: "grain", params: { amount: 0.08 } },
      { effect: "vignette", params: { amount: 0.5 } },
    ],
  },
  {
    id: "deepspace",
    name: "Deep space",
    description: "Nebula, parallax stars, quiet vignette",
    background: "#02010a",
    layers: [
      { effect: "nebula" },
      { effect: "starfield", blend: "screen", params: { density: 1.4, twinkle: 1 } },
      {
        effect: "depthParallax",
        params: { amount: 0.5 },
      },
      { effect: "vignette", params: { amount: 0.55, radius: 0.85 } },
    ],
  },
  {
    id: "rainwindow",
    name: "Rain window",
    description: "City-glow blur behind wet glass",
    background: "#050810",
    layers: [
      { effect: "nebula", name: "City glow", params: { colorA: "#050a18", colorB: "#274a7a", colorC: "#e0a050", scale: 3, speed: 0.15 } },
      { effect: "bokeh", blend: "screen", params: { density: 1.4, size: 1.3, speed: 0.15 } },
      { effect: "blur", params: { radius: 0.45 } },
      { effect: "rainGlass", params: { amount: 0.65 } },
      { effect: "vignette", params: { amount: 0.5 } },
    ],
  },
  {
    id: "cyberterminal",
    name: "Cyber terminal",
    description: "Glyph rain, scanlines, a cursor that burns",
    background: "#020604",
    layers: [
      { effect: "caustics", name: "Data flow", params: { colorA: "#0c3a24", colorB: "#020604", speed: 0.7 } },
      {
        effect: "mouseGlow",
        blend: "screen",
        params: { color: "#39ff88", size: 0.5, reactive: 0.9 },
      },
      { effect: "ascii", params: { color: "#39ff88", background: "#020604", cells: 120 } },
      { effect: "scanlines", params: { strength: 0.3 } },
      { effect: "vignette", params: { amount: 0.6 } },
    ],
  },
  {
    id: "liquidchrome",
    name: "Liquid chrome",
    description: "Molten metal that flees your cursor",
    background: "#0a0a0f",
    layers: [
      { effect: "gradient", name: "Steel", params: { colorA: "#1a1d26", colorB: "#c9d4e8", angle: 60, warp: 0.8, warpScale: 4, speed: 0.35 } },
      { effect: "noiseDistort", params: { scale: 6, strength: 0.2, speed: 0.5 } },
      {
        effect: "mouseLiquid",
        params: { strength: 0.8, reactive: 1 },
      },
      { effect: "adjust", params: { contrast: 1.5, saturation: 0.4 } },
      { effect: "bloom", params: { threshold: 0.7, intensity: 0.8 } },
    ],
  },
  {
    id: "storm",
    name: "Electric storm",
    description: "Bolts over a boiling sky — strikes chase the mouse",
    background: "#05060d",
    layers: [
      { effect: "nebula", name: "Storm clouds", params: { colorA: "#05060d", colorB: "#2a3350", colorC: "#4a5a8a", scale: 3.2, warp: 2.4, speed: 0.5 } },
      {
        effect: "lightning",
        blend: "screen",
        bindings: {
          x: { source: "mouseX", amount: 0.9, smooth: 0.5 },
          intensity: { source: "mouseSpeed", amount: 0.8, smooth: 0.2 },
        },
      },
      { effect: "grain", params: { amount: 0.1 } },
      { effect: "vignette", params: { amount: 0.6 } },
    ],
  },
  {
    id: "hypno",
    name: "Hypno tunnel",
    description: "Warp tube + kaleidoscope + chroma split",
    background: "#02020a",
    layers: [
      { effect: "tunnel" },
      { effect: "kaleido", params: { segments: 8, speed: 0.2 } },
      { effect: "chromab", params: { amount: 0.5, mouse: 0.5 } },
      { effect: "vignette", params: { amount: 0.45 } },
    ],
  },
  {
    id: "soundbloom",
    name: "Sound bloom",
    description: "Turn on the mic — nebula & glow breathe with the music",
    background: "#03010a",
    layers: [
      {
        effect: "nebula",
        name: "Reactive gas",
        params: { colorA: "#03010a", colorB: "#7a2fbf", colorC: "#00e0ff", scale: 2.6, speed: 0.3 },
        bindings: {
          density: { source: "audio", amount: 0.7, smooth: 0.15 },
          warp: { source: "audio", amount: 0.5, smooth: 0.2 },
        },
      },
      {
        effect: "mouseGlow",
        blend: "screen",
        params: { color: "#00e0ff", size: 0.3 },
        bindings: {
          size: { source: "audio", amount: 0.8, smooth: 0.1 },
          intensity: { source: "audio", amount: 0.9, smooth: 0.1 },
        },
      },
      { effect: "bloom", params: { threshold: 0.5, intensity: 1 } },
      { effect: "vignette", params: { amount: 0.55 } },
    ],
  },
  {
    id: "hearth",
    name: "Hearth",
    description: "Fire, embers, warm CRT glass",
    background: "#0a0402",
    layers: [
      { effect: "fire" },
      { effect: "bokeh", name: "Embers", blend: "screen", params: { color: "#ff9a3e", size: 0.5, density: 2, speed: 0.8 } },
      { effect: "crt", params: { curve: 0.5, grille: 0.2 } },
      { effect: "vignette", params: { amount: 0.55 } },
    ],
  },
];
