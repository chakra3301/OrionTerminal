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
    { key: "strength", label: "Strength", type: "number", min: 0, max: 0.5, step: 0.005, default: 0.06 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.3 },
    { key: "mouse", label: "Mouse pull", type: "number", min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 n = vec2(
    fxFbm(uv * u_scale + vec2(0.0, uTime * u_speed)),
    fxFbm(uv * u_scale + vec2(7.3, uTime * u_speed + 3.1))
  ) - 0.5;
  vec2 m = (uMouse - 0.5) * u_mouse;
  return texture(uTex, uv + n * u_strength + m * 0.05);
}
`,
};

export const FX_EFFECTS: FxEffectSpec[] = [gradient, noiseDistort];

const byId = new Map(FX_EFFECTS.map((s) => [s.id, s]));

export function fxEffect(id: string): FxEffectSpec | undefined {
  return byId.get(id);
}
