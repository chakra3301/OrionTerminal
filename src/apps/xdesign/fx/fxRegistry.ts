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

// ── Filter effects — transform the accumulated stack below ─────────────

const ripple: FxEffectSpec = {
  id: "ripple",
  label: "Ripple",
  category: "effect",
  description: "Concentric waves radiating from a point",
  params: [
    { key: "x", label: "Center X", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "y", label: "Center Y", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "amplitude", label: "Amplitude", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "frequency", label: "Frequency", type: "number", min: 1, max: 60, step: 0.5, default: 18 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 3, step: 0.01, default: 0.8 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 c = vec2(u_x, u_y);
  vec2 p = uv - c;
  p.x *= uResolution.x / uResolution.y;
  float d = length(p);
  float w = sin(d * u_frequency * 6.2831853 - uTime * u_speed * 6.0);
  float fall = smoothstep(0.9, 0.0, d);
  vec2 dir = d > 0.0001 ? normalize(uv - c) : vec2(0.0);
  return texture(uTex, uv + dir * w * u_amplitude * 0.02 * fall);
}
`,
};

const wave: FxEffectSpec = {
  id: "wave",
  label: "Wave",
  category: "effect",
  description: "Sinusoidal displacement — flags, water, jelly",
  params: [
    { key: "amplitudeX", label: "Amount X", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "amplitudeY", label: "Amount Y", type: "number", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "frequency", label: "Frequency", type: "number", min: 0.5, max: 12, step: 0.1, default: 3 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 3, step: 0.01, default: 0.8 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  uv.x += sin(uv.y * u_frequency * 6.2831853 + uTime * u_speed * 2.0) * u_amplitudeX * 0.04;
  uv.y += sin(uv.x * u_frequency * 6.2831853 + uTime * u_speed * 1.7) * u_amplitudeY * 0.04;
  return texture(uTex, uv);
}
`,
};

const chromab: FxEffectSpec = {
  id: "chromab",
  label: "Dispersion",
  category: "effect",
  description: "Chromatic aberration — RGB channels split radially",
  params: [
    { key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.005, default: 0.25 },
    { key: "mouse", label: "Mouse pull", type: "number", min: 0, max: 1, step: 0.01, default: 0 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 dir = (uv - 0.5) * u_amount * 0.05 + (uMouse - 0.5) * u_mouse * 0.03;
  float r = texture(uTex, uv + dir).r;
  float g = texture(uTex, uv).g;
  float b = texture(uTex, uv - dir).b;
  return vec4(r, g, b, 1.0);
}
`,
};

const blur: FxEffectSpec = {
  id: "blur",
  label: "Blur",
  category: "effect",
  description: "Soft disc blur of everything below",
  params: [
    { key: "radius", label: "Radius", type: "number", min: 0, max: 1, step: 0.005, default: 0.3 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  float r = u_radius * 0.04;
  if (r < 0.0002) return texture(uTex, uv);
  vec4 acc = texture(uTex, uv) * 1.5;
  float total = 1.5;
  for (int i = 0; i < 12; i++) {
    float a = 6.2831853 * float(i) / 12.0;
    vec2 d = vec2(cos(a), sin(a));
    acc += texture(uTex, uv + d * r) * 1.0;
    acc += texture(uTex, uv + d * r * 0.5) * 1.3;
    total += 2.3;
  }
  return acc / total;
}
`,
};

const bloom: FxEffectSpec = {
  id: "bloom",
  label: "Bloom",
  category: "effect",
  description: "Bright areas glow and bleed outward",
  params: [
    { key: "threshold", label: "Threshold", type: "number", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 3, step: 0.01, default: 1.1 },
    { key: "radius", label: "Radius", type: "number", min: 0, max: 1, step: 0.005, default: 0.4 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec4 base = texture(uTex, uv);
  vec3 glow = vec3(0.0);
  float r = u_radius * 0.06;
  for (int i = 0; i < 16; i++) {
    float a = 6.2831853 * float(i) / 16.0;
    float m = fract(float(i) * 0.618) * 0.75 + 0.25;
    vec3 c = texture(uTex, uv + vec2(cos(a), sin(a)) * r * m).rgb;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    glow += c * smoothstep(u_threshold, 1.0, lum);
  }
  glow /= 16.0;
  return vec4(base.rgb + glow * u_intensity, 1.0);
}
`,
};

const vignette: FxEffectSpec = {
  id: "vignette",
  label: "Vignette",
  category: "effect",
  description: "Darkened edges pull focus to the center",
  params: [
    { key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "radius", label: "Radius", type: "number", min: 0.1, max: 1.2, step: 0.01, default: 0.75 },
    { key: "softness", label: "Softness", type: "number", min: 0.01, max: 1, step: 0.01, default: 0.45 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = texture(uTex, uv).rgb;
  vec2 p = uv - 0.5;
  p.x *= uResolution.x / uResolution.y;
  float v = smoothstep(u_radius - u_softness, u_radius, length(p));
  return vec4(col * (1.0 - v * u_amount), 1.0);
}
`,
};

const grain: FxEffectSpec = {
  id: "grain",
  label: "Film grain",
  category: "effect",
  description: "Animated photographic noise",
  params: [
    { key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.005, default: 0.12 },
    { key: "size", label: "Size", type: "number", min: 1, max: 8, step: 0.5, default: 1.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = texture(uTex, uv).rgb;
  vec2 gp = floor(uv * uResolution / max(u_size, 1.0));
  float g = fxHash21(gp + fract(uTime * 7.13) * vec2(17.0, 23.0)) - 0.5;
  return vec4(col + g * u_amount, 1.0);
}
`,
};

const pixelate: FxEffectSpec = {
  id: "pixelate",
  label: "Pixelate",
  category: "effect",
  description: "Chunky mosaic cells",
  params: [
    { key: "cells", label: "Cells", type: "number", min: 4, max: 300, step: 1, default: 64 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 g = uv * asp * u_cells;
  vec2 c = (floor(g) + 0.5) / u_cells / asp;
  return texture(uTex, c);
}
`,
};

const ascii: FxEffectSpec = {
  id: "ascii",
  label: "ASCII dither",
  category: "effect",
  description: "Terminal-style character shading",
  params: [
    { key: "cells", label: "Columns", type: "number", min: 20, max: 240, step: 1, default: 90 },
    { key: "color", label: "Ink", type: "color", default: "#39ff88" },
    { key: "background", label: "Paper", type: "color", default: "#03060a" },
  ],
  frag: `
float fxGlyph(float lum, vec2 p) {
  vec2 g = floor(p * 3.0);
  float idx = clamp(g.y * 3.0 + g.x, 0.0, 8.0);
  float t = floor(lum * 5.0);
  float mask = t < 0.5 ? 16.0 : t < 1.5 ? 273.0 : t < 2.5 ? 341.0 : t < 3.5 ? 495.0 : 511.0;
  return step(0.5, mod(floor(mask / exp2(idx)), 2.0)) * step(0.06, lum);
}
vec4 fxMain(vec2 uv) {
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 g = uv * asp * u_cells;
  vec2 cell = (floor(g) + 0.5) / u_cells / asp;
  float lum = dot(texture(uTex, cell).rgb, vec3(0.299, 0.587, 0.114));
  float on = fxGlyph(lum, fract(g));
  return vec4(mix(u_background, u_color, on), 1.0);
}
`,
};

const halftone: FxEffectSpec = {
  id: "halftone",
  label: "Halftone",
  category: "effect",
  description: "Print-style dot screening",
  params: [
    { key: "cells", label: "Dots", type: "number", min: 10, max: 200, step: 1, default: 60 },
    { key: "size", label: "Dot size", type: "number", min: 0.2, max: 2, step: 0.01, default: 1 },
    { key: "colorA", label: "Paper", type: "color", default: "#0a0a12" },
    { key: "colorB", label: "Ink", type: "color", default: "#e6f4ec" },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 g = uv * asp * u_cells;
  vec2 cell = (floor(g) + 0.5) / u_cells / asp;
  float lum = dot(texture(uTex, cell).rgb, vec3(0.299, 0.587, 0.114));
  float d = length(fract(g) - 0.5);
  float dotOn = 1.0 - smoothstep(sqrt(lum) * 0.5 * u_size - 0.05, sqrt(lum) * 0.5 * u_size, d);
  return vec4(mix(u_colorA, u_colorB, dotOn), 1.0);
}
`,
};

const scanlines: FxEffectSpec = {
  id: "scanlines",
  label: "Scanlines",
  category: "effect",
  description: "CRT monitor lines with subtle flicker",
  params: [
    { key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "density", label: "Density", type: "number", min: 0.2, max: 2, step: 0.01, default: 1 },
    { key: "flicker", label: "Flicker", type: "number", min: 0, max: 1, step: 0.01, default: 0.15 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = texture(uTex, uv).rgb;
  float l = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.1415926 * u_density);
  col *= 1.0 - u_strength * 0.6 * l;
  col *= 1.0 - u_flicker * 0.08 * (0.5 + 0.5 * sin(uTime * 47.0));
  return vec4(col, 1.0);
}
`,
};

const adjust: FxEffectSpec = {
  id: "adjust",
  label: "Adjust",
  category: "effect",
  description: "Hue · saturation · brightness · contrast",
  params: [
    { key: "hue", label: "Hue", type: "number", min: -180, max: 180, step: 1, default: 0 },
    { key: "saturation", label: "Saturation", type: "number", min: 0, max: 2, step: 0.01, default: 1 },
    { key: "brightness", label: "Brightness", type: "number", min: -1, max: 1, step: 0.01, default: 0 },
    { key: "contrast", label: "Contrast", type: "number", min: 0, max: 2, step: 0.01, default: 1 },
  ],
  frag: `
vec3 fxHueRotate(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.587, 0.114, 0.596, -0.274, -0.322, 0.211, -0.523, 0.312);
  const mat3 toRGB = mat3(1.0, 0.956, 0.621, 1.0, -0.272, -0.647, 1.0, -1.106, 1.703);
  vec3 yiq = c * toYIQ;
  float h = atan(yiq.z, yiq.y) + a;
  float chroma = length(yiq.yz);
  return vec3(yiq.x, chroma * cos(h), chroma * sin(h)) * toRGB;
}
vec4 fxMain(vec2 uv) {
  vec3 col = texture(uTex, uv).rgb;
  col = fxHueRotate(col, radians(u_hue));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, u_saturation);
  col = (col - 0.5) * u_contrast + 0.5 + u_brightness;
  return vec4(col, 1.0);
}
`,
};

const kaleido: FxEffectSpec = {
  id: "kaleido",
  label: "Kaleidoscope",
  category: "effect",
  description: "Angular mirror segments around the center",
  params: [
    { key: "segments", label: "Segments", type: "number", min: 2, max: 24, step: 1, default: 6 },
    { key: "angle", label: "Angle", type: "number", min: 0, max: 360, step: 1, default: 0 },
    { key: "speed", label: "Spin", type: "number", min: 0, max: 2, step: 0.01, default: 0.1 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv - 0.5;
  float asp = uResolution.x / uResolution.y;
  p.x *= asp;
  float a = atan(p.y, p.x) + radians(u_angle) + uTime * u_speed;
  float r = length(p);
  float seg = 6.2831853 / max(u_segments, 2.0);
  a = abs(mod(a, seg) - seg * 0.5);
  p = vec2(cos(a), sin(a)) * r;
  p.x /= asp;
  return texture(uTex, clamp(p + 0.5, 0.001, 0.999));
}
`,
};

const gradientMap: FxEffectSpec = {
  id: "gradientMap",
  label: "Gradient map",
  category: "effect",
  description: "Remap luminance to a three-stop ramp",
  params: [
    { key: "shadows", label: "Shadows", type: "color", default: "#03060a" },
    { key: "mids", label: "Midtones", type: "color", default: "#b14cff" },
    { key: "highlights", label: "Highlights", type: "color", default: "#39ff88" },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  float lum = dot(texture(uTex, uv).rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = lum < 0.5
    ? mix(u_shadows, u_mids, lum * 2.0)
    : mix(u_mids, u_highlights, lum * 2.0 - 1.0);
  return vec4(col, 1.0);
}
`,
};

const mirror: FxEffectSpec = {
  id: "mirror",
  label: "Mirror",
  category: "effect",
  description: "Reflect one half of the scene onto the other",
  params: [
    { key: "axis", label: "Axis", type: "select", options: [{ value: 0, label: "Vertical fold" }, { value: 1, label: "Horizontal fold" }], default: 0 },
    { key: "position", label: "Position", type: "number", min: 0.05, max: 0.95, step: 0.005, default: 0.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  if (u_axis < 0.5) {
    if (uv.x > u_position) uv.x = 2.0 * u_position - uv.x;
  } else {
    if (uv.y > u_position) uv.y = 2.0 * u_position - uv.y;
  }
  return texture(uTex, clamp(uv, 0.0, 1.0));
}
`,
};

const posterize: FxEffectSpec = {
  id: "posterize",
  label: "Posterize",
  category: "effect",
  description: "Quantized color bands with optional dither",
  params: [
    { key: "levels", label: "Levels", type: "number", min: 2, max: 16, step: 1, default: 5 },
    { key: "dither", label: "Dither", type: "number", min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = texture(uTex, uv).rgb;
  float d = (fxHash21(uv * uResolution) - 0.5) * u_dither / u_levels;
  col = floor((col + d) * u_levels + 0.5) / u_levels;
  return vec4(col, 1.0);
}
`,
};

// ── Centerpiece generators ───────────────────────────────────

const aurora: FxEffectSpec = {
  id: "aurora",
  label: "Aurora",
  category: "generator",
  description: "Northern-lights curtains drifting across the sky",
  params: [
    { key: "colorA", label: "Base", type: "color", default: "#39ff88" },
    { key: "colorB", label: "Tip", type: "color", default: "#b14cff" },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "spread", label: "Spread", type: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.4 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * (2.0 + fi * 0.8) + uTime * u_speed * (0.15 + fi * 0.07) + fi * 3.3;
    float band = fxFbm(vec2(x, fi * 7.7));
    float y = band * 0.5 + 0.22 + fi * 0.09;
    float d = uv.y - y;
    float glow = exp(-abs(d) * (22.0 - u_spread * 14.0)) * smoothstep(0.05, 0.35, band);
    vec3 c = mix(u_colorA, u_colorB, clamp(d * 4.0 + 0.5, 0.0, 1.0));
    col += c * glow * u_intensity * (1.0 - fi * 0.22);
  }
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return vec4(col, a);
}
`,
};

const nebula: FxEffectSpec = {
  id: "nebula",
  label: "Nebula",
  category: "generator",
  description: "Domain-warped flowing color clouds",
  params: [
    { key: "colorA", label: "Deep", type: "color", default: "#0a0a2e" },
    { key: "colorB", label: "Cloud", type: "color", default: "#ff3ea5" },
    { key: "colorC", label: "Accent", type: "color", default: "#00e0ff" },
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 8, step: 0.1, default: 2.2 },
    { key: "warp", label: "Warp", type: "number", min: 0, max: 4, step: 0.05, default: 1.6 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.3 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv * u_scale;
  vec2 q = vec2(fxFbm(p + uTime * u_speed * 0.10), fxFbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fxFbm(p + q * u_warp + vec2(1.7, 9.2) + uTime * u_speed * 0.15),
    fxFbm(p + q * u_warp + vec2(8.3, 2.8) - uTime * u_speed * 0.12)
  );
  float f = fxFbm(p + r * u_warp);
  vec3 col = mix(u_colorA, u_colorB, clamp(f * f * 2.4, 0.0, 1.0));
  col = mix(col, u_colorC, clamp(length(q) * 0.7, 0.0, 1.0) * 0.55);
  return vec4(col, 1.0);
}
`,
};

const plasma: FxEffectSpec = {
  id: "plasma",
  label: "Plasma",
  category: "generator",
  description: "Retro demo-scene interference waves",
  params: [
    { key: "colorA", label: "Color A", type: "color", default: "#ff3ea5" },
    { key: "colorB", label: "Color B", type: "color", default: "#00e0ff" },
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 6, step: 0.1, default: 1.6 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  float t = uTime * u_speed;
  float v = sin((uv.x + t * 0.30) * u_scale * 6.2831853);
  v += sin((uv.y + t * 0.24) * u_scale * 5.0);
  v += sin((uv.x + uv.y) * u_scale * 4.0 + t * 2.0);
  v += sin(length(uv - 0.5) * u_scale * 8.0 - t * 3.0);
  v *= 0.25;
  vec3 col = mix(u_colorA, u_colorB, 0.5 + 0.5 * sin(v * 3.1415926 + t * 0.4));
  return vec4(col, 1.0);
}
`,
};

const beam: FxEffectSpec = {
  id: "beam",
  label: "Beam",
  category: "generator",
  description: "A glowing light beam with pulse",
  params: [
    { key: "color", label: "Color", type: "color", default: "#00e0ff" },
    { key: "x", label: "X", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "y", label: "Y", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "angle", label: "Angle", type: "number", min: -180, max: 180, step: 1, default: 0 },
    { key: "width", label: "Width", type: "number", min: 0.05, max: 2, step: 0.01, default: 0.5 },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 3, step: 0.01, default: 1.2 },
    { key: "pulse", label: "Pulse", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 3, step: 0.01, default: 1 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv - vec2(u_x, u_y);
  p.x *= uResolution.x / uResolution.y;
  p = fxRotate2(radians(u_angle)) * p;
  float pulse = 1.0 + u_pulse * 0.5 * sin(uTime * u_speed * 3.0);
  float d = abs(p.y);
  float core = exp(-d * d / (u_width * u_width * 0.002));
  float halo = exp(-d / (u_width * 0.15));
  vec3 col = u_color * (core * 1.2 + halo * 0.45) * pulse * u_intensity;
  return vec4(col, clamp(core + halo * 0.6, 0.0, 1.0));
}
`,
};

const wisps: FxEffectSpec = {
  id: "wisps",
  label: "Wisps",
  category: "generator",
  description: "Drifting smoke tendrils",
  params: [
    { key: "color", label: "Color", type: "color", default: "#9ab0a8" },
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 4, step: 0.05, default: 1.4 },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 p = uv;
    p.y += sin(p.x * 3.0 + uTime * u_speed * (0.4 + fi * 0.13) + fi * 2.1) * 0.15;
    float n = fxFbm(p * vec2(2.0, 6.0) * u_scale + vec2(fi * 13.7, uTime * u_speed * 0.35));
    float band = exp(-abs(uv.y - (0.2 + fi * 0.2)) * 7.0);
    col += u_color * n * n * band * u_intensity * 0.7;
  }
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return vec4(col, a);
}
`,
};

const starfield: FxEffectSpec = {
  id: "starfield",
  label: "Starfield",
  category: "generator",
  description: "Parallax stars with twinkle",
  params: [
    { key: "color", label: "Color", type: "color", default: "#e6f4ec" },
    { key: "density", label: "Density", type: "number", min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: "twinkle", label: "Twinkle", type: "number", min: 0, max: 2, step: 0.01, default: 0.8 },
    { key: "speed", label: "Drift", type: "number", min: 0, max: 2, step: 0.01, default: 0.15 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i) + 1.0;
    vec2 p = uv * u_density * fi * 18.0 + vec2(uTime * u_speed * fi * 0.8, 0.0);
    vec2 id = floor(p);
    vec2 gv = fract(p) - 0.5;
    float h = fxHash21(id);
    if (h > 0.93) {
      vec2 off = vec2(fxHash21(id + 1.3), fxHash21(id + 2.7)) - 0.5;
      float d = length(gv - off * 0.8);
      float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 5.0) * u_twinkle * 4.0 + h * 40.0);
      col += u_color * exp(-d * d * 160.0) * tw / fi;
    }
  }
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return vec4(col, a);
}
`,
};

const recursiveGrid: FxEffectSpec = {
  id: "recursiveGrid",
  label: "Recursive grid",
  category: "generator",
  description: "Infinitely zooming nested grid lines",
  params: [
    { key: "color", label: "Lines", type: "color", default: "#00e0ff" },
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 6, step: 0.1, default: 1.5 },
    { key: "thickness", label: "Thickness", type: "number", min: 0.1, max: 1, step: 0.01, default: 0.35 },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 2, step: 0.01, default: 0.9 },
    { key: "speed", label: "Zoom", type: "number", min: -2, max: 2, step: 0.01, default: 0.4 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= uResolution.x / uResolution.y;
  float z = fract(uTime * u_speed * 0.3);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 6; i++) {
    float lv = float(i) - z;
    float s = exp2(lv) * u_scale;
    vec2 g = abs(fract(p * s + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, u_thickness * 0.06, min(g.x, g.y));
    float fade = sin(3.1415926 * clamp((lv + 1.0) / 6.0, 0.0, 1.0));
    col += u_color * line * fade * u_intensity * 0.6;
    alpha = max(alpha, line * fade);
  }
  return vec4(col, clamp(alpha * u_intensity, 0.0, 1.0));
}
`,
};

const metaballs: FxEffectSpec = {
  id: "metaballs",
  label: "Metaballs",
  category: "generator",
  description: "Gooey blobs — one follows the mouse",
  params: [
    { key: "colorA", label: "Core", type: "color", default: "#ff3ea5" },
    { key: "colorB", label: "Edge", type: "color", default: "#b14cff" },
    { key: "size", label: "Size", type: "number", min: 0.2, max: 3, step: 0.01, default: 1 },
    { key: "soft", label: "Softness", type: "number", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.6 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  float asp = uResolution.x / uResolution.y;
  float f = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = i == 5
      ? uMouse
      : 0.5 + 0.36 * vec2(
          sin(uTime * u_speed * (0.4 + fi * 0.11) + fi * 2.4),
          cos(uTime * u_speed * (0.5 + fi * 0.09) + fi * 1.7)
        );
    vec2 d = uv - c;
    d.x *= asp;
    f += u_size * 0.004 / max(dot(d, d), 0.0001);
  }
  float m = smoothstep(1.0, 1.0 + u_soft + 0.02, f);
  vec3 col = mix(u_colorB, u_colorA, clamp(f * 0.3, 0.0, 1.0));
  return vec4(col, m);
}
`,
};

const sdfShape: FxEffectSpec = {
  id: "sdfShape",
  label: "3D shape",
  category: "generator",
  description: "Raymarched sphere / box / torus with noisy surface",
  params: [
    { key: "shape", label: "Shape", type: "select", options: [{ value: 0, label: "Sphere" }, { value: 1, label: "Box" }, { value: 2, label: "Torus" }], default: 0 },
    { key: "colorA", label: "Surface", type: "color", default: "#00e0ff" },
    { key: "colorB", label: "Rim", type: "color", default: "#ff3ea5" },
    { key: "distort", label: "Distort", type: "number", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "zoom", label: "Size", type: "number", min: 0.4, max: 2.5, step: 0.01, default: 1 },
    { key: "speed", label: "Spin", type: "number", min: 0, max: 2, step: 0.01, default: 0.4 },
  ],
  frag: `
float fxSdMap(vec3 p) {
  float t = uTime * u_speed;
  float cy = cos(t), sy = sin(t);
  p.xz = mat2(cy, -sy, sy, cy) * p.xz;
  p.yz = mat2(0.9272, -0.3746, 0.3746, 0.9272) * p.yz;
  float d;
  if (u_shape < 0.5) {
    d = length(p) - 0.62;
  } else if (u_shape < 1.5) {
    vec3 q = abs(p) - vec3(0.46);
    d = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  } else {
    vec2 q = vec2(length(p.xz) - 0.5, p.y);
    d = length(q) - 0.2;
  }
  d += (fxFbm(p.xy * 3.0 + p.z * 2.0 + uTime * u_speed * 0.6) - 0.5) * u_distort * 0.35;
  return d;
}
vec4 fxMain(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;
  vec3 ro = vec3(0.0, 0.0, -2.2 / u_zoom);
  vec3 rd = normalize(vec3(p, 1.6));
  float t = 0.0;
  float d = 1e9;
  for (int i = 0; i < 48; i++) {
    d = fxSdMap(ro + rd * t);
    if (d < 0.002 || t > 6.0) break;
    t += d * 0.85;
  }
  if (d >= 0.002) return vec4(0.0);
  vec3 pos = ro + rd * t;
  vec2 e = vec2(0.004, 0.0);
  vec3 n = normalize(vec3(
    fxSdMap(pos + e.xyy) - fxSdMap(pos - e.xyy),
    fxSdMap(pos + e.yxy) - fxSdMap(pos - e.yxy),
    fxSdMap(pos + e.yyx) - fxSdMap(pos - e.yyx)
  ));
  float diff = clamp(dot(n, normalize(vec3(0.6, 0.8, -0.5))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
  vec3 col = u_colorA * (0.25 + diff * 0.85) + u_colorB * rim * 1.2;
  return vec4(col, 1.0);
}
`,
};

const caustics: FxEffectSpec = {
  id: "caustics",
  label: "Caustics",
  category: "generator",
  description: "Underwater light patterns",
  params: [
    { key: "colorA", label: "Light", type: "color", default: "#00e0ff" },
    { key: "colorB", label: "Water", type: "color", default: "#03202e" },
    { key: "scale", label: "Scale", type: "number", min: 0.5, max: 6, step: 0.1, default: 2 },
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 3, step: 0.01, default: 1.2 },
    { key: "speed", label: "Speed", type: "number", min: 0, max: 2, step: 0.01, default: 0.5 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  vec2 p = uv * u_scale * 4.0;
  p.x *= uResolution.x / uResolution.y;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = p + vec2(
      fxFbm(p * 0.8 + uTime * u_speed * 0.30 + fi * 3.1),
      fxFbm(p * 0.8 + vec2(3.1, 7.7) - uTime * u_speed * 0.24 + fi * 1.7)
    ) * 1.6;
    float n = fxNoise2(q);
    c += pow(n, 4.0);
  }
  vec3 col = u_colorB + u_colorA * c * u_intensity * 0.9;
  return vec4(col, 1.0);
}
`,
};

const depthParallax: FxEffectSpec = {
  id: "depthParallax",
  label: "Depth parallax",
  category: "effect",
  description: "Fake 3D — bright areas shift with the mouse",
  params: [
    { key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.005, default: 0.35 },
    { key: "bias", label: "Depth bias", type: "number", min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  frag: `
vec4 fxMain(vec2 uv) {
  float d = dot(texture(uTex, uv).rgb, vec3(0.299, 0.587, 0.114));
  vec2 off = (uMouse - 0.5) * u_amount * 0.05 * (d - 0.5 + u_bias);
  return texture(uTex, clamp(uv + off, 0.0, 1.0));
}
`,
};

export const FX_CUSTOM_STARTER = `vec4 fxMain(vec2 uv) {
  // Your shader. Available:
  //   uTex (stack below) · uTime · uMouse (0..1) · uResolution
  //   u_a u_b u_c u_d (sliders) · u_colorA u_colorB (colors)
  //   fxHash21(p) · fxNoise2(p) · fxFbm(p) · fxRotate2(a)
  vec4 below = texture(uTex, uv);
  float wave = sin(uv.y * 30.0 * u_a + uTime * 2.0) * 0.02 * u_b;
  vec3 col = texture(uTex, uv + vec2(wave, 0.0)).rgb;
  col = mix(col, u_colorA, u_c * 0.25);
  return vec4(col, 1.0);
}`;

const custom: FxEffectSpec = {
  id: "custom",
  label: "Custom shader",
  category: "effect",
  description: "Write your own GLSL — or ask Claude to",
  params: [
    { key: "code", label: "Code", type: "text", default: FX_CUSTOM_STARTER, hidden: true },
    { key: "a", label: "A", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "b", label: "B", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "c", label: "C", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "d", label: "D", type: "number", min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: "colorA", label: "Color A", type: "color", default: "#00e0ff" },
    { key: "colorB", label: "Color B", type: "color", default: "#ff3ea5" },
  ],
  frag: FX_CUSTOM_STARTER,
};

export const FX_EFFECTS: FxEffectSpec[] = [
  gradient,
  aurora,
  nebula,
  plasma,
  beam,
  wisps,
  starfield,
  recursiveGrid,
  metaballs,
  sdfShape,
  caustics,
  srcShape,
  srcText,
  srcImage,
  noiseDistort,
  ripple,
  wave,
  chromab,
  blur,
  bloom,
  vignette,
  grain,
  pixelate,
  ascii,
  halftone,
  scanlines,
  adjust,
  kaleido,
  gradientMap,
  mirror,
  posterize,
  depthParallax,
  custom,
];

const byId = new Map(FX_EFFECTS.map((s) => [s.id, s]));

export function fxEffect(id: string): FxEffectSpec | undefined {
  return byId.get(id);
}
