import { motion } from "./motion.js";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1, 0)), f - vec2(1, 0));
  float c = dot(hash22(i + vec2(0, 1)), f - vec2(0, 1));
  float d = dot(hash22(i + vec2(1, 1)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * gnoise(p); p = r * p * 2.02; a *= 0.5; }
  return v;
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || "shader compile failed");
  }
  return s;
}

/**
 * Minimal fullscreen-fragment runner. Renders only while on screen; with reduced motion it draws
 * a single still frame (re-drawn on resize or explicit `draw()`), never an animation loop.
 */
export function createShaderCanvas(canvas, opts = {}) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
  if (!gl) return null;

  const { dprCap = 1.5, resolution = 1, stillTime = 12 } = opts;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const programs = new Map();
  let prog = null;
  let uniforms = {};
  let raf = 0;
  let visible = false;
  let t0 = performance.now();
  let lastFrame = 0;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);

  function use(key, frag) {
    if (!programs.has(key)) {
      const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      programs.set(key, { p, u });
    }
    const entry = programs.get(key);
    prog = entry.p;
    uniforms = entry.u;
    gl.useProgram(prog);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * resolution;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  function frame(now) {
    raf = 0;
    if (!prog) return;
    resize();
    const reduced = motion.reduced;
    const t = reduced ? stillTime : (now - t0) / 1000;
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    opts.onFrame?.({ gl, u: uniforms, t, dt, w: canvas.width, h: canvas.height, reduced });
    if (uniforms.uRes) gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
    if (uniforms.uTime) gl.uniform1f(uniforms.uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function draw() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    if (visible) draw();
  }, { rootMargin: "80px" }).observe(canvas);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible) draw(); });
  motion.subscribe(() => draw());
  new ResizeObserver(() => draw()).observe(canvas);

  return { gl, use, draw, get uniforms() { return uniforms; } };
}

export function textureFromImage(gl, img, unit = 0) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}
