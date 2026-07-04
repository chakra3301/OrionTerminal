/**
 * FX effect registry — every available layer type, as pure data + GLSL.
 * Slices 3/4 grow this file; the compositor and inspector are generic over
 * it, so adding an effect is (usually) just a new spec here.
 */

import type { FxEffectSpec } from "./fxModel";

const gradient: FxEffectSpec = {
  id: "gradient",
  label: "Gradient",
  category: "generator",
  description: "Flowing two-color gradient with optional noise warp",
  params: [
    { key: "colorA", label: "Color A", type: "color", default: "#1b1b3a" },
    { key: "colorB", label: "Color B", type: "color", default: "#00e0ff" },
    { key: "angle", label: "Angle", type: "number", min: 0, max: 360, step: 1, default: 45 },
    { key: "warp", label: "Warp", type: "number", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "warpScale", label: "Warp scale", type: "number", min: 0.5, max: 10, step: 0.1, default: 2.5 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.25 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv - 0.5;
  float ang = radians(u_angle);
  vec2 dir = vec2(cos(ang), sin(ang));
  float t = dot(p, dir) + 0.5;
  float w = fxFbm(uv * u_warpScale + uTime * u_speed) - 0.5;
  t += w * u_warp;
  vec3 col = mix(u_colorA, u_colorB, smoothstep(0.0, 1.0, t));
  return vec4(col, 1.0);
}
`,
};

const noiseDistort: FxEffectSpec = {
  id: "noiseDistort",
  label: "Noise distortion",
  category: "effect",
  description: "Organic noise displacement of everything below",
  params: [
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 20, step: 0.1, default: 4 },
    { key: "strength", label: "Strength", type: "number", min: 0, max: 0.5, step: 0.005, default: 0.12 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "mouse", label: "Mouse pull", type: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 n = vec2(
    fxFbm(uv * u_scale + vec2(0.0, uTime * u_speed)),
    fxFbm(uv * u_scale + vec2(7.3, uTime * u_speed + 3.1))
  ) - 0.5;
  vec2 m = (uMouse - 0.5) * u_mouse;
  return texture(uTex, uv + n * u_strength + m * 0.2);
}
`,
};

// ── Source layers — rasterized CPU-side (fxRaster.ts), sampled as uSrc ────

const SRC_FRAG = `
vec4 fxMain(vec2 uv) {
  return texture(uSrc, uv);
}
`;

const POSITION_PARAMS = [
  { key: "x", label: "X", type: "number", min: -0.5, max: 1.5, step: 0.005, default: 0.5 },
  { key: "y", label: "Y", type: "number", min: -0.5, max: 1.5, step: 0.005, default: 0.5 },
  { key: "rotation", label: "Rotation", type: "number", min: -180, max: 180, step: 1, default: 0 },
] satisfies FxEffectSpec["params"];

const srcShape: FxEffectSpec = {
  id: "srcShape",
  label: "Shape",
  category: "source",
  source: true,
  description: "Rect or ellipse — mask, backdrop, or design element",
  params: [
    { key: "shape", label: "Shape", type: "select", options: [{ value: 0, label: "Rectangle" }, { value: 1, label: "Ellipse" }], default: 0 },
    { key: "color", label: "Color", type: "color", default: "#ffffff" },
    { key: "width", label: "Width", type: "number", min: 0.01, max: 1.5, step: 0.005, default: 0.4 },
    { key: "height", label: "Height", type: "number", min: 0.01, max: 1.5, step: 0.005, default: 0.4 },
    { key: "radius", label: "Corner radius", type: "number", min: 0, max: 1, step: 0.01, default: 0.08 },
    ...POSITION_PARAMS,
  ],
  frag: SRC_FRAG,
};

const srcText: FxEffectSpec = {
  id: "srcText",
  label: "Text",
  category: "source",
  source: true,
  description: "A line of type — effects above distort it",
  params: [
    { key: "content", label: "Text", type: "text", default: "ORION FX" },
    { key: "color", label: "Color", type: "color", default: "#ffffff" },
    { key: "size", label: "Size", type: "number", min: 0.02, max: 0.6, step: 0.005, default: 0.14 },
    { key: "weight", label: "Weight", type: "select", options: [{ value: 400, label: "Regular" }, { value: 600, label: "Semibold" }, { value: 800, label: "Bold" }], default: 600 },
    { key: "font", label: "Font", type: "select", options: [{ value: 0, label: "Space Grotesk" }, { value: 1, label: "JetBrains Mono" }, { value: 2, label: "System" }], default: 0 },
    ...POSITION_PARAMS,
  ],
  frag: SRC_FRAG,
};

const srcImage: FxEffectSpec = {
  id: "srcImage",
  label: "Image",
  category: "source",
  source: true,
  description: "An image file — distort it, mask with it",
  params: [
    { key: "file", label: "File", type: "image", default: "" },
    { key: "scale", label: "Scale", type: "number", min: 0.05, max: 3, step: 0.01, default: 1 },
    ...POSITION_PARAMS,
  ],
  frag: SRC_FRAG,
};

export const FX_EFFECTS: FxEffectSpec[] = [
  gradient,
  srcShape,
  srcText,
  srcImage,
  noiseDistort,
];

const byId = new Map(FX_EFFECTS.map((s) => [s.id, s]));

export function fxEffect(id: string): FxEffectSpec | undefined {
  return byId.get(id);
}
