import { createShaderCanvas, NOISE } from "./gl.js";
import { motion } from "./motion.js";

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uSpeed;
${NOISE}
float stars(vec2 uv, float d) {
  vec2 g = floor(uv * d);
  vec2 f = fract(uv * d) - 0.5;
  float h = hash12(g);
  vec2 jitter = (hash22(g + 7.0)) * 0.35;
  float s = smoothstep(0.06, 0.0, length(f - jitter)) * step(0.92, h);
  return s * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0));
}
`;

const AURORA = HEAD + `
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 m = uMouse;
  vec3 col = mix(vec3(0.004, 0.01, 0.025), vec3(0.01, 0.03, 0.06), uv.y);
  col += stars(p, 90.0) * 0.8 * smoothstep(0.3, 0.9, uv.y);
  float t = uTime * 0.12;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = p.x * (0.9 + fi * 0.18) + fi * 1.7 + (m.x - 0.5) * 0.6;
    float wave = fbm(vec2(x * 0.9, t + fi * 3.3)) * 0.42 + sin(x * 1.3 + t * 2.0 + fi) * 0.06;
    float base = 0.48 + fi * 0.055 + wave + (m.y - 0.5) * 0.12;
    float d = uv.y - base;
    float curtain = smoothstep(0.0, 0.03, d + 0.02) * exp(-max(d, 0.0) * (5.0 - fi * 0.5));
    float rays = 0.55 + 0.45 * fbm(vec2(x * 12.0, t * 3.0 + fi));
    rays *= 0.6 + 0.4 * sin(x * 60.0 + t * 8.0) * 0.5 + 0.2;
    vec3 c = mix(vec3(0.22, 1.0, 0.53), vec3(0.0, 0.88, 1.0), fi / 4.0);
    c = mix(c, vec3(0.69, 0.3, 1.0), smoothstep(0.08, 0.3, d) * 0.8);
    col += c * curtain * rays * (0.42 - fi * 0.05) * (1.0 + uSpeed * 0.8);
  }
  float md = length((uv - m) * vec2(aspect, 1.0));
  col += vec3(0.1, 0.9, 0.6) * exp(-md * md * 18.0) * 0.08;
  float ground = smoothstep(0.16, 0.0, uv.y + fbm(vec2(p.x * 3.0, 1.0)) * 0.05);
  col = mix(col, vec3(0.0, 0.004, 0.008), ground);
  col = 1.0 - exp(-col * 1.6);
  col += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.02;
  o = vec4(col, 1.0);
}`;

const NEBULA = HEAD + `
float ridge(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * (1.0 - abs(gnoise(p))); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.4;
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0) * 2.4;
  float t = uTime * 0.04;
  vec2 pm = p - m * 0.25;
  float dm = length(p - m);
  pm += normalize(p - m + 0.0001) * exp(-dm * dm * 1.5) * (0.25 + uSpeed * 0.5);
  vec2 q = vec2(fbm(pm + t), fbm(pm + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(pm + 2.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(pm + 2.0 * q + vec2(8.3, 2.8)));
  float f = fbm(pm + 2.2 * r);
  float fil = pow(ridge(pm * 1.4 + r * 1.2), 3.0);
  vec3 col = vec3(0.005, 0.006, 0.02);
  col = mix(col, vec3(0.35, 0.08, 0.6), smoothstep(-0.2, 0.6, f));
  col = mix(col, vec3(1.0, 0.24, 0.65), smoothstep(0.2, 0.9, length(q)) * 0.6);
  col = mix(col, vec3(0.0, 0.85, 1.0), smoothstep(0.55, 1.1, r.x) * 0.55);
  col += vec3(0.6, 0.85, 1.0) * fil * 0.45;
  col *= smoothstep(1.9, 0.2, length(p * vec2(0.7, 1.0))) * 1.3 + 0.08;
  col += stars(uv * vec2(aspect, 1.0), 140.0) * 0.9;
  col += stars(uv * vec2(aspect, 1.0) + 3.0, 60.0) * 0.5;
  col = 1.0 - exp(-col * 1.5);
  o = vec4(col, 1.0);
}`;

const GLYPH = HEAD + `
uniform sampler2D uAtlas;
uniform float uCount;
uniform float uCell;
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cellId = floor(frag / uCell);
  vec2 cellUv = fract(frag / uCell);
  vec2 cuv = (cellId + 0.5) * uCell / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(cuv.x * aspect, cuv.y);
  vec2 m = vec2(uMouse.x * aspect, uMouse.y);
  float t = uTime * 0.18;
  float d = length(p - m);
  float ripple = sin(d * 26.0 - uTime * 3.5) * exp(-d * 3.2) * (0.35 + uSpeed);
  vec2 q = vec2(fbm(p * 2.2 + t), fbm(p * 2.2 - t + 4.0));
  float v = fbm(p * 1.8 + q * 1.8 + ripple * 0.4);
  v = clamp(v * 1.25 + 0.48 + ripple * 0.35 + exp(-d * d * 14.0) * 0.45, 0.0, 1.0);
  float idx = floor(v * (uCount - 0.001));
  vec2 auv = vec2((idx + cellUv.x) / uCount, cellUv.y);
  float g = texture(uAtlas, auv).r;
  vec3 tint = mix(vec3(0.0, 0.88, 1.0), vec3(0.22, 1.0, 0.53), smoothstep(0.2, 0.8, q.x + 0.5));
  tint = mix(tint, vec3(1.0, 0.24, 0.65), smoothstep(0.82, 1.0, v) * 0.85);
  vec3 col = tint * g * (0.25 + v * 1.1);
  col += tint * 0.02 * v;
  o = vec4(col, 1.0);
}`;

const SYNTH = HEAD + `
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 m = uMouse - 0.5;
  float horizon = 0.42 + m.y * 0.08;
  vec2 p = vec2((uv.x - 0.5) * aspect - m.x * 0.25, uv.y);
  vec3 col;
  if (uv.y > horizon) {
    float y = (uv.y - horizon) / (1.0 - horizon);
    col = mix(vec3(0.35, 0.02, 0.32), vec3(0.01, 0.0, 0.05), pow(y, 0.6));
    col += stars(uv * vec2(aspect, 1.0), 120.0) * smoothstep(0.3, 1.0, y);
    vec2 sc = vec2(aspect > 1.2 ? 0.34 * aspect - 0.1 : 0.0, horizon + 0.2);
    float r = length((vec2(p.x, uv.y) - sc) * vec2(1.0, 1.0));
    float sun = smoothstep(0.205, 0.2, r);
    float bands = step(0.0, sin((uv.y - horizon) * 120.0 - uTime * 1.8)) + step(sc.y + 0.02, uv.y);
    sun *= clamp(bands, 0.0, 1.0);
    vec3 sunCol = mix(vec3(1.0, 0.18, 0.55), vec3(0.95, 1.0, 0.25), smoothstep(sc.y - 0.2, sc.y + 0.2, uv.y));
    col = mix(col, sunCol, sun);
    col += sunCol * exp(-max(r - 0.2, 0.0) * 9.0) * 0.35;
    float mx = p.x * 3.0;
    float mtn = horizon + abs(fbm(vec2(mx, 2.0))) * 0.22 * smoothstep(0.1, 0.9, abs(p.x)) + 0.01;
    float mtn2 = horizon + abs(fbm(vec2(mx * 1.7 + 4.0, 7.0))) * 0.12 + 0.005;
    col = mix(col, vec3(0.04, 0.0, 0.08), step(uv.y, mtn));
    col = mix(col, vec3(0.08, 0.0, 0.12) + vec3(0.0, 0.4, 0.5) * smoothstep(mtn2 - 0.004, mtn2, uv.y) * 0.0, step(uv.y, mtn2));
    col += vec3(0.0, 0.88, 1.0) * smoothstep(0.004, 0.0, abs(uv.y - mtn)) * 0.6;
  } else {
    float y = horizon - uv.y;
    float z = 0.35 / max(y, 0.0008);
    float x = p.x * z;
    float zz = z + uTime * 1.6 * (1.0 + uSpeed);
    float gx = abs(fract(x) - 0.5);
    float gz = abs(fract(zz) - 0.5);
    float w = 0.012 * z;
    float line = smoothstep(w + 0.02, w, gx) + smoothstep(w + 0.02, w, gz);
    float fade = exp(-z * 0.08);
    col = vec3(0.02, 0.0, 0.05);
    vec3 gc = mix(vec3(1.0, 0.24, 0.65), vec3(0.0, 0.88, 1.0), smoothstep(0.0, 0.4, y));
    col += gc * clamp(line, 0.0, 1.0) * (0.25 + fade * 1.2) * (1.0 - smoothstep(0.18, 0.42, y) * 0.55);
    col += vec3(1.0, 0.2, 0.6) * exp(-y * 30.0) * 0.5;
  }
  col = 1.0 - exp(-col * 1.4);
  col += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.025;
  o = vec4(col, 1.0);
}`;

export const EFFECTS = [
  { key: "aurora", frag: AURORA },
  { key: "nebula", frag: NEBULA },
  { key: "glyph", frag: GLYPH },
  { key: "synth", frag: SYNTH },
];

function glyphAtlas(gl) {
  const ramp = " .,:;-=+*ox%#@";
  const cell = 48;
  const c = document.createElement("canvas");
  c.width = cell * ramp.length;
  c.height = cell;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.font = `500 ${cell * 0.78}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [...ramp].forEach((ch, i) => ctx.fillText(ch, i * cell + cell / 2, cell / 2 + 2));
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return ramp.length;
}

/** Mounts one effect renderer on a canvas; returns a setter for switching effects. */
export function mountEffect(canvas, { initial = 0, dprCap = 1.5, resolution = 1, interactive = true } = {}) {
  const mouse = { x: 0.5, y: 0.55, tx: 0.5, ty: 0.55, speed: 0 };
  let current = initial;
  let glyphCount = 0;
  let idle = 99;
  let sc;
  try {
    sc = createShaderCanvas(canvas, {
      dprCap,
      resolution,
      stillTime: 24,
      onFrame({ gl, u, t, dt, reduced }) {
        idle += dt;
        if (idle > 2 && !reduced) {
          mouse.tx = 0.5 + Math.sin(t * 0.27) * 0.25;
          mouse.ty = 0.55 + Math.cos(t * 0.35) * 0.18;
        }
        const k = 1 - Math.pow(0.002, dt || 0.016);
        const px = mouse.x, py = mouse.y;
        mouse.x += (mouse.tx - mouse.x) * k;
        mouse.y += (mouse.ty - mouse.y) * k;
        const sp = Math.min(1.2, Math.hypot(mouse.x - px, mouse.y - py) / Math.max(dt, 0.001));
        mouse.speed += (sp - mouse.speed) * Math.min(1, dt * 3);
        gl.uniform2f(u.uMouse, mouse.x, mouse.y);
        if (u.uSpeed) gl.uniform1f(u.uSpeed, reduced ? 0 : mouse.speed);
        if (u.uAtlas) {
          gl.uniform1i(u.uAtlas, 1);
          gl.uniform1f(u.uCount, glyphCount);
          gl.uniform1f(u.uCell, Math.max(8, Math.round(canvas.width / 120)));
        }
      },
    });
  } catch (err) {
    console.warn("fx unavailable", err);
    return null;
  }
  if (!sc) return null;

  function set(i) {
    current = i;
    const fx = EFFECTS[i];
    try {
      if (fx.key === "glyph" && !glyphCount) glyphCount = glyphAtlas(sc.gl);
      sc.use(fx.key, fx.frag);
      sc.draw();
    } catch (err) {
      console.warn("effect failed", fx.key, err);
    }
  }

  if (interactive) {
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left) / r.width;
      mouse.ty = 1 - (e.clientY - r.top) / r.height;
      idle = 0;
      if (motion.reduced) sc.draw();
    }, { passive: true });
  }

  const start = () => set(current);
  if (EFFECTS[initial].key === "glyph" && document.fonts) document.fonts.load('500 20px "JetBrains Mono"').finally(start);
  else start();
  return { set };
}

export function initFx() {
  const canvas = document.getElementById("fx-gl");
  if (canvas) {
    const fx = mountEffect(canvas, { dprCap: 1.25, resolution: 0.85 });
    const tabs = [...document.querySelectorAll(".fx-tabs [data-fx]")];
    if (document.fonts) document.fonts.load('500 20px "JetBrains Mono"');
    const select = (btn, focus) => {
      tabs.forEach((b) => {
        const on = b === btn;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) btn.focus();
      fx?.set(Number(btn.dataset.fx));
    };
    tabs.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => select(b));
      b.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        select(tabs[(i + d + tabs.length) % tabs.length], true);
      });
    });
    if (!fx) canvas.closest(".fx-stage")?.classList.add("no-gl");
  }
  const xd = document.getElementById("xd-gl");
  if (xd) mountEffect(xd, { initial: 0, dprCap: 1, resolution: 0.6, interactive: false });
}
