/**
 * FX scene model — the data layer of XDesign's shader compositor (the
 * Unicorn Studio remake). A scene is an ordered stack of layers rendered
 * bottom→top; every layer is one fullscreen shader pass that reads the
 * accumulated result below it (`uTex`). Generators ignore `uTex`; effects
 * transform it. Pure module: no WebGL, no DOM — fully unit-testable.
 */

export type FxParamSpec = (
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
    }
  /** Free text — drives rasterization (source layers), not a uniform. */
  | { key: string; label: string; type: "text"; default: string }
  /** Image file path — drives rasterization, not a uniform. "" = none. */
  | { key: string; label: string; type: "image"; default: string }
) & {
  /** Hidden from the generic inspector (e.g. custom-shader code, which has
   * its own Monaco modal). */
  hidden?: boolean;
};

/** Params that become shader uniforms (text/image drive rasterization). */
export function isUniformParam(p: FxParamSpec): boolean {
  return p.type === "number" || p.type === "color" || p.type === "select";
}

export type FxEffectSpec = {
  id: string;
  label: string;
  category: "generator" | "effect" | "source";
  description: string;
  /** Source layers rasterize CPU-side into a texture the pass samples as
   * `uSrc` (declared in the wrapper only when this is true). */
  source?: boolean;
  params: FxParamSpec[];
  /** GLSL ES 3.00 body that defines `vec4 fxMain(vec2 uv)`. Has access to
   * the shared uniforms, the lib helpers, and one float/vec3 uniform per
   * param (see `uniformName`). */
  frag: string;
};

export type FxParamValue = number | string;

/** Blend modes applied between a pass result and the stack below it.
 * Order matters — the index is the uBlend uniform value. */
export const FX_BLEND_MODES = [
  "normal",
  "add",
  "screen",
  "multiply",
  "overlay",
  "softlight",
  "difference",
  "lighten",
  "darken",
] as const;
export type FxBlendMode = (typeof FX_BLEND_MODES)[number];

export function blendIndex(mode: FxBlendMode | undefined): number {
  const i = FX_BLEND_MODES.indexOf(mode ?? "normal");
  return i < 0 ? 0 : i;
}

export const FX_BIND_SOURCES = [
  "mouseX",
  "mouseY",
  "mouseSpeed",
  "hover",
  "appear",
] as const;
export type FxBindSource = (typeof FX_BIND_SOURCES)[number];

/** Binds one numeric param to an input source. The bound value is
 * `clamp(base + amount × (max−min) × source, min, max)` — base stays the
 * stored param, so removing the binding restores the original look. */
export type FxBinding = {
  source: FxBindSource;
  /** -1..1 — fraction of the param's range the source sweeps. */
  amount: number;
  /** 0..1 — exponential smoothing (0 ≈ instant, 1 ≈ lazy drift). */
  smooth?: number;
};

/** One timeline key for a numeric param. `t` is normalized 0..1 across the
 * scene duration so re-timing the scene keeps the choreography. */
export type FxKeyframe = {
  t: number;
  v: number;
  ease?: "linear" | "inOut" | "hold";
};

export type FxLayer = {
  id: string;
  effectId: string;
  name: string;
  hidden?: boolean;
  /** 0..1 — mixes the pass result over the untouched below-texture. */
  opacity: number;
  /** Blend mode vs the stack below. Default "normal". */
  blend?: FxBlendMode;
  params: Record<string, FxParamValue>;
  /** Interactivity: param key → input binding. */
  bindings?: Record<string, FxBinding>;
  /** Timeline: param key → sorted keyframes. */
  keyframes?: Record<string, FxKeyframe[]>;
  /** Mask this layer's contribution by a SOURCE layer's alpha. */
  maskLayerId?: string;
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
  /** Timeline loop length in seconds. */
  duration: number;
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

export const FX_BLEND_GLSL = `
vec3 fxBlend(vec3 b, vec3 s, float mode) {
  if (mode < 0.5) return s;
  if (mode < 1.5) return min(b + s, 1.0);
  if (mode < 2.5) return 1.0 - (1.0 - b) * (1.0 - s);
  if (mode < 3.5) return b * s;
  if (mode < 4.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (mode < 5.5) return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (sqrt(b) - b), step(0.5, s));
  if (mode < 6.5) return abs(b - s);
  if (mode < 7.5) return max(b, s);
  return min(b, s);
}
`;

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
vec3 fxPermute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
/** 2D simplex noise (Ashima), -1..1 — organic, no grid artifacts. */
float fxSimplex(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = fxPermute(fxPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
/** Simplex fbm, 0..1, octaves rotated to kill axis alignment. */
float fxFbmS(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * fxSimplex(p);
    p = R * p * 2.02 + 11.5;
    a *= 0.5;
  }
  return clamp(v * 0.5 + 0.5, 0.0, 1.0);
}
/** Ridged fbm, 0..1 — filaments, lightning, nebula tendrils. */
float fxRidge(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * (1.0 - abs(fxSimplex(p)));
    p = R * p * 2.15 + 7.7;
    a *= 0.5;
  }
  return clamp(v, 0.0, 1.0);
}
`;

/** Assemble the complete fragment shader for an effect spec: shared header
 * (uTex/uResolution/uTime/uMouse/uOpacity), one uniform per param, the lib,
 * the effect body, and a main() that opacity-mixes the pass over the
 * below-texture. */
/** FNV-1a — stable tiny hash for custom-shader program cache keys. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The effect id whose GLSL body is user-authored per layer. */
export const FX_CUSTOM_ID = "custom";

export function customCodeOf(layer: FxLayer): string {
  const v = layer.params.code;
  return typeof v === "string" ? v : "";
}

export function buildFragment(spec: FxEffectSpec, bodyOverride?: string): string {
  const decls = spec.params
    .filter(isUniformParam)
    .map((p) =>
      p.type === "color"
        ? `uniform vec3 ${uniformName(p.key)};`
        : `uniform float ${uniformName(p.key)};`,
    )
    .join("\n");
  return `#version 300 es
precision highp float;
uniform sampler2D uTex;
${spec.source ? "uniform sampler2D uSrc;" : ""}
uniform sampler2D uMask;
uniform float uHasMask;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uOpacity;
uniform float uBlend;
${decls}
in vec2 vUv;
out vec4 fragColor;
${FX_GLSL_LIB}
${FX_BLEND_GLSL}
${bodyOverride?.includes("fxMain") ? bodyOverride : spec.frag}
void main() {
  vec4 below = texture(uTex, vUv);
  vec4 res = fxMain(vUv);
  vec3 blended = fxBlend(below.rgb, clamp(res.rgb, 0.0, 1.0), uBlend);
  float maskA = mix(1.0, texture(uMask, vUv).a, uHasMask);
  fragColor = vec4(mix(below.rgb, blended, clamp(res.a, 0.0, 1.0) * uOpacity * maskA), 1.0);
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
    duration: 6,
    layers: [],
  };
}
