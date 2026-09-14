/**
 * CPU-side rasterization for FX source layers (shape / text / image).
 * Each source layer renders into an offscreen 2D canvas at the scene's
 * pixel resolution; the compositor uploads it as `uSrc` and the shader
 * pass composites it with blend modes. Placement/rotation happen here in
 * canvas space, which sidesteps GLSL transform + aspect math entirely.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { FxLayer } from "./fxModel";
import { setSourceAspect } from "./fxSourceInfo";
import { imageMimeForPath } from "./fxFiles";
import { ipc } from "@/lib/ipc";

/** Cache key — re-rasterize only when something visual changed. */
export function sourceRasterKey(layer: FxLayer, pw: number, ph: number): string {
  return JSON.stringify([layer.effectId, layer.params, pw, ph]);
}

const FX_FONTS = ["Space Grotesk", "JetBrains Mono", "system-ui"] as const;

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();

async function imageSource(filePath: string): Promise<string> {
  if (filePath.startsWith("http") || filePath.startsWith("data:") || filePath.startsWith("blob:")) {
    return filePath;
  }
  try {
    const base64 = await ipc.readFileBase64(filePath);
    return `data:${imageMimeForPath(filePath)};base64,${base64}`;
  } catch (error) {
    if (String(error).includes("TOO_LARGE:")) return convertFileSrc(filePath);
    throw error;
  }
}

function loadImage(filePath: string): Promise<HTMLImageElement> {
  let p = imgCache.get(filePath);
  if (!p) {
    p = imageSource(filePath).then(
      (src) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`fx: image failed to decode: ${filePath}`));
          img.src = src;
        }),
    );
    p.catch(() => imgCache.delete(filePath));
    imgCache.set(filePath, p);
  }
  return p;
}

/** Glyph-atlas layout shared with the shader: 16 square slots in one row.
 * The luminance ramp is distributed across the slots so any ramp length
 * works without a count uniform. */
export const GLYPH_SLOTS = 16;
export const DEFAULT_GLYPH_RAMP = " .:-=+*?#@";

/** Real monospace glyphs, white on black — the shader samples .r as the
 * glyph mask. This is the Unicorn-style glyph dither done properly (canvas
 * atlas, proven in the NOKIADEMON loader), not a procedural bit pattern. */
export function buildGlyphAtlas(ramp: string, font: number): HTMLCanvasElement {
  const cell = 64;
  const canvas = document.createElement("canvas");
  canvas.width = cell * GLYPH_SLOTS;
  canvas.height = cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const chars = [...(ramp.length > 0 ? ramp : DEFAULT_GLYPH_RAMP)];
  const family =
    font >= 1.5 ? "ui-monospace, Menlo, monospace" : '"JetBrains Mono", monospace';
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${Math.round(cell * 0.82)}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GLYPH_SLOTS; i++) {
    const ch = chars[Math.min(chars.length - 1, Math.floor((i / GLYPH_SLOTS) * chars.length))]!;
    ctx.fillText(ch, i * cell + cell / 2, cell / 2 + cell * 0.03);
  }
  return canvas;
}

/** Rasterize a source layer at pixel size pw×ph. Returns null when there's
 * nothing to draw yet (e.g., image layer with no file picked). */
export async function rasterizeSource(
  layer: FxLayer,
  pw: number,
  ph: number,
): Promise<HTMLCanvasElement | null> {
  // Glyph dither's "source" is its glyph atlas, not a scene-sized raster.
  if (layer.effectId === "ascii") {
    return buildGlyphAtlas(
      str(layer.params.ramp, DEFAULT_GLYPH_RAMP),
      num(layer.params.font, 0),
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pw));
  canvas.height = Math.max(1, Math.round(ph));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const p = layer.params;
  const cx = num(p.x, 0.5) * canvas.width;
  const cy = num(p.y, 0.5) * canvas.height;
  const rot = (num(p.rotation, 0) * Math.PI) / 180;

  ctx.translate(cx, cy);
  ctx.rotate(rot);

  if (layer.effectId === "srcShape") {
    const w = num(p.width, 0.4) * canvas.width;
    const h = num(p.height, 0.4) * canvas.height;
    const r = num(p.radius, 0) * Math.min(w, h) * 0.5;
    ctx.fillStyle = str(p.color, "#ffffff");
    ctx.beginPath();
    if (num(p.shape, 0) >= 0.5) {
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
    }
    ctx.fill();
    return canvas;
  }

  if (layer.effectId === "srcText") {
    const content = str(p.content, "");
    if (!content.trim()) return canvas;
    const size = num(p.size, 0.12) * canvas.height;
    const weight = num(p.weight, 600);
    const font = FX_FONTS[Math.round(num(p.font, 0))] ?? FX_FONTS[0];
    ctx.fillStyle = str(p.color, "#ffffff");
    ctx.font = `${weight} ${size}px "${font}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Real newlines or a literal "\n" typed into the single-line input.
    const lines = content.split(/\n|\\n/);
    const lineH = size * 1.2;
    const y0 = -((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, y0 + i * lineH));
    return canvas;
  }

  if (layer.effectId === "srcImage") {
    const file = str(p.file, "");
    if (!file) return canvas;
    const img = await loadImage(file);
    if (img.naturalHeight > 0) {
      setSourceAspect(layer.id, img.naturalWidth / img.naturalHeight);
    }
    // scale 1 = contain-fit inside the scene, then user scale on top.
    const fit = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const s = fit * num(p.scale, 1);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return canvas;
  }

  return null;
}
