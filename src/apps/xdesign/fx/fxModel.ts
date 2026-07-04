/**
 * FX scene model — the data layer of XDesign's shader compositor (the
 * Unicorn Studio remake). A scene is an ordered stack of layers rendered
 * bottom→top; every layer is one fullscreen shader pass that reads the
 * accumulated result below it (`uTex`). Generators ignore `uTex`; effects
 * transform it. Pure module: no WebGL, no DOM — fully unit-testable.
 */

export type FxParamSpec =
  | {
      key: string;
      label: string;
      type: "number";
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | { key: string; label: string; type: "color"; default: string }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: number; label: string }[];
      default: number;
    };

export type FxEffectSpec = {
  id: string;
  label: string;
  category: "generator" | "effect";
  description: string;
  params: FxParamSpec[];
  /** GLSL ES 3.00 body that defines `vec4 fxMain(vec2 uv)`. Has access to
   * the shared uniforms, the lib helpers, and one float/vec3 uniform per
   * param (see `uniformName`). */
  frag: string;
};

export type FxParamValue = number | string;

export type FxLayer = {
  id: string;
  effectId: string;
  name: string;
  hidden?: boolean;
  /** 0..1 — mixes the pass result over the untouched below-texture. */
  opacity: number;
  params: Record<string, FxParamValue>;
};

export type FxDpi = "auto" | 0.5 | 1 | 2;
/** 0 = uncapped (display refresh rate). */
export type FxFps = 0 | 30 | 60;

export type FxScene = {
  width: number;
  height: number;
  /** Hex background the stack composites over. */
  background: string;
  dpi: FxDpi;
  fps: FxFps;
  /** Render order: index 0 is the bottom of the stack. */
  layers: FxLayer[];
};

export type FxDoc = { scene: FxScene };

// ── Uniform / shader assembly ─────────────────────────────────────────────

export function uniformName(key: string): string {
  return `u_${key}`;
}

/** Parse `#rgb` / `#rrggbb` into linear-ish 0..1 RGB (sRGB values used as-is
 * — the compositor works in display space like Unicorn). Falls back to
 * black on malformed input so a bad stored value can't break a frame. */
export function hexToVec3(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function defaultParams(spec: FxEffectSpec): Record<string, FxParamValue> {
  const out: Record<string, FxParamValue> = {};
  for (const p of spec.params) out[p.key] = p.default;
  return out;
}

export const FX_VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** Shared GLSL helpers available to every effect body. Kept intentionally
 * small — grows with the library (slices 3/4). */
export const FX_GLSL_LIB = `
float fxHash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float fxNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fxHash21(i);
  float b = fxHash21(i + vec2(1.0, 0.0));
  float c = fxHash21(i + vec2(0.0, 1.0));
  float d = fxHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fxFbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * fxNoise2(p);
    p = p * 2.03 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}
mat2 fxRotate2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
`;

/** Assemble the complete fragment shader for an effect spec: shared header
 * (uTex/uResolution/uTime/uMouse/uOpacity), one uniform per param, the lib,
 * the effect body, and a main() that opacity-mixes the pass over the
 * below-texture. */
export function buildFragment(spec: FxEffectSpec): string {
  const decls = spec.params
    .map((p) =>
      p.type === "color"
        ? `uniform vec3 ${uniformName(p.key)};`
        : `uniform float ${uniformName(p.key)};`,
    )
    .join("\n");
  return `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uOpacity;
${decls}
in vec2 vUv;
out vec4 fragColor;
${FX_GLSL_LIB}
${spec.frag}
void main() {
  vec4 below = texture(uTex, vUv);
  vec4 res = fxMain(vUv);
  fragColor = mix(below, res, uOpacity);
}
`;
}

// ── Scene defaults ────────────────────────────────────────────────────────

export function resolveDpi(dpi: FxDpi): number {
  if (dpi === "auto") {
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    return Math.min(Math.max(dpr, 0.5), 2);
  }
  return dpi;
}

export function emptyScene(): FxScene {
  return {
    width: 1280,
    height: 720,
    background: "#0a0a12",
    dpi: "auto",
    fps: 0,
    layers: [],
  };
}
