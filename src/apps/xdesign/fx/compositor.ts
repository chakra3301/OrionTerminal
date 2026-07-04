/**
 * WebGL2 ping-pong compositor — the FX render engine. Each visible layer is
 * one fullscreen pass: it reads the accumulated stack below (`uTex`), writes
 * into the other framebuffer, then the roles swap. The final texture is
 * blitted to the canvas. Programs are compiled once per effect id and
 * cached; a failed compile marks the effect broken (skipped) instead of
 * being retried every frame.
 *
 * Deliberately raw WebGL2, no three.js — keeps the future embed runtime
 * tiny (Unicorn's is ~29kb) and three quarantined to the Characters chunk.
 */

import {
  buildFragment,
  hexToVec3,
  uniformName,
  blendIndex,
  isUniformParam,
  FX_VERTEX_SRC,
  type FxScene,
} from "./fxModel";
import { fxEffect } from "./fxRegistry";
import { log } from "@/lib/log";

export type FxFrame = {
  /** Scene time in seconds (frozen while paused). */
  time: number;
  /** Smoothed pointer in uv space (0..1, y up). */
  mouse: [number, number];
};

type ProgramEntry = {
  program: WebGLProgram;
  locs: Map<string, WebGLUniformLocation | null>;
} | null; // null = compile failed, don't retry

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };

const COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uTex, vUv); }
`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    log.warn("fx shader compile failed", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(
  gl: WebGL2RenderingContext,
  frag: string,
): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, FX_VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    log.warn("fx program link failed", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

export type FxOverrideMap = Map<string, Record<string, number>>;

export type FxCompositor = {
  /** Render one frame at the given internal resolution (scene px × dpi).
   * `overrides` (layer id → param key → value) wins over stored params —
   * used by interactivity bindings and the timeline. */
  render: (
    scene: FxScene,
    frame: FxFrame,
    pixelW: number,
    pixelH: number,
    overrides?: FxOverrideMap,
  ) => void;
  /** Upload / refresh the rasterized texture for a source layer. */
  updateSource: (layerId: string, src: TexImageSource) => void;
  /** Free a source layer's texture (layer deleted). */
  dropSource: (layerId: string) => void;
  dispose: () => void;
};

export function createCompositor(
  canvas: HTMLCanvasElement,
): FxCompositor | null {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    log.warn("fx: WebGL2 unavailable");
    return null;
  }

  // Fullscreen triangle — covers the viewport with a single primitive.
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const programs = new Map<string, ProgramEntry>();
  let copyEntry: ProgramEntry = null;

  // Rasterized source-layer textures (uSrc), keyed by layer id. A 1×1
  // transparent placeholder keeps passes valid while rasterization is
  // in flight.
  const sourceTex = new Map<string, WebGLTexture>();
  const placeholderTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, placeholderTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  function updateSource(layerId: string, src: TexImageSource): void {
    let tex = sourceTex.get(layerId);
    if (!tex) {
      const t = gl!.createTexture();
      if (!t) return;
      tex = t;
      sourceTex.set(layerId, tex);
    }
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, src);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  }

  function dropSource(layerId: string): void {
    const tex = sourceTex.get(layerId);
    if (tex) {
      gl!.deleteTexture(tex);
      sourceTex.delete(layerId);
    }
  }

  function programFor(effectId: string): ProgramEntry {
    if (programs.has(effectId)) return programs.get(effectId)!;
    const spec = fxEffect(effectId);
    const prog = spec ? link(gl!, buildFragment(spec)) : null;
    const entry: ProgramEntry = prog
      ? { program: prog, locs: new Map() }
      : null;
    programs.set(effectId, entry);
    return entry;
  }

  function loc(
    entry: NonNullable<ProgramEntry>,
    name: string,
  ): WebGLUniformLocation | null {
    if (!entry.locs.has(name)) {
      entry.locs.set(name, gl!.getUniformLocation(entry.program, name));
    }
    return entry.locs.get(name)!;
  }

  // Ping-pong render targets, lazily (re)created when the internal
  // resolution changes.
  let targets: [Target, Target] | null = null;
  let targetW = 0;
  let targetH = 0;

  function makeTarget(w: number, h: number): Target | null {
    const tex = gl!.createTexture();
    const fbo = gl!.createFramebuffer();
    if (!tex || !fbo) return null;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  function ensureTargets(w: number, h: number): boolean {
    if (targets && targetW === w && targetH === h) return true;
    disposeTargets();
    const a = makeTarget(w, h);
    const b = makeTarget(w, h);
    if (!a || !b) return false;
    targets = [a, b];
    targetW = w;
    targetH = h;
    return true;
  }

  function disposeTargets(): void {
    if (!targets) return;
    for (const t of targets) {
      gl!.deleteTexture(t.tex);
      gl!.deleteFramebuffer(t.fbo);
    }
    targets = null;
  }

  function render(
    scene: FxScene,
    frame: FxFrame,
    pixelW: number,
    pixelH: number,
    overrides?: FxOverrideMap,
  ): void {
    const w = Math.max(1, Math.round(pixelW));
    const h = Math.max(1, Math.round(pixelH));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (!ensureTargets(w, h)) return;

    gl!.bindVertexArray(vao);
    gl!.viewport(0, 0, w, h);
    gl!.disable(gl!.BLEND);
    gl!.disable(gl!.DEPTH_TEST);

    // Seed the ping texture with the scene background.
    let ping: 0 | 1 = 0;
    const [bgR, bgG, bgB] = hexToVec3(scene.background);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, targets![ping].fbo);
    gl!.clearColor(bgR, bgG, bgB, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);

    for (const layer of scene.layers) {
      if (layer.hidden || layer.opacity <= 0) continue;
      const entry = programFor(layer.effectId);
      const spec = fxEffect(layer.effectId);
      if (!entry || !spec) continue;

      const pong = (1 - ping) as 0 | 1;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, targets![pong].fbo);
      gl!.useProgram(entry.program);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, targets![ping].tex);
      gl!.uniform1i(loc(entry, "uTex"), 0);
      if (spec.source) {
        gl!.activeTexture(gl!.TEXTURE1);
        gl!.bindTexture(gl!.TEXTURE_2D, sourceTex.get(layer.id) ?? placeholderTex);
        gl!.uniform1i(loc(entry, "uSrc"), 1);
        gl!.activeTexture(gl!.TEXTURE0);
      }
      gl!.uniform2f(loc(entry, "uResolution"), w, h);
      gl!.uniform1f(loc(entry, "uTime"), frame.time);
      gl!.uniform2f(loc(entry, "uMouse"), frame.mouse[0], frame.mouse[1]);
      gl!.uniform1f(loc(entry, "uOpacity"), Math.min(1, Math.max(0, layer.opacity)));
      gl!.uniform1f(loc(entry, "uBlend"), blendIndex(layer.blend));
      const over = overrides?.get(layer.id);
      for (const p of spec.params) {
        if (!isUniformParam(p)) continue;
        const u = loc(entry, uniformName(p.key));
        if (!u) continue;
        const v = over?.[p.key] ?? layer.params[p.key] ?? p.default;
        if (p.type === "color") {
          const [r, g, b] = hexToVec3(String(v));
          gl!.uniform3f(u, r, g, b);
        } else {
          gl!.uniform1f(u, typeof v === "number" ? v : Number(v) || 0);
        }
      }
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      ping = pong;
    }

    // Blit the final texture to the canvas.
    if (!copyEntry) {
      const prog = link(gl!, COPY_FRAG);
      copyEntry = prog ? { program: prog, locs: new Map() } : null;
      if (!copyEntry) return;
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, w, h);
    gl!.useProgram(copyEntry.program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, targets![ping].tex);
    gl!.uniform1i(loc(copyEntry, "uTex"), 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function dispose(): void {
    disposeTargets();
    for (const entry of programs.values()) {
      if (entry) gl!.deleteProgram(entry.program);
    }
    programs.clear();
    for (const tex of sourceTex.values()) gl!.deleteTexture(tex);
    sourceTex.clear();
    if (placeholderTex) gl!.deleteTexture(placeholderTex);
    if (copyEntry) gl!.deleteProgram(copyEntry.program);
    copyEntry = null;
    gl!.deleteBuffer(vbo);
    gl!.deleteVertexArray(vao);
  }

  return { render, updateSource, dropSource, dispose };
}
