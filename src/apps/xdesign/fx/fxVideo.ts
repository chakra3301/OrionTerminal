/**
 * Video source layers — a live <video> whose current frame is drawn into a
 * scene-sized canvas each frame (same placement/scale/rotation as image
 * sources) and uploaded as `uSrc`, so the whole effect stack can distort,
 * mask, blend, and grade it. Unlike static sources this can't be cached by
 * key — the frame changes every tick — so it has its own per-frame path.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { FxLayer } from "./fxModel";
import { setSourceAspect } from "./fxSourceInfo";
import { log } from "@/lib/log";

type Entry = {
  video: HTMLVideoElement;
  src: string;
  canvas: HTMLCanvasElement;
};

const entries = new Map<string, Entry>();

function resolveUrl(p: string): string {
  return p.startsWith("http") || p.startsWith("data:") ? p : convertFileSrc(p);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Create / re-point the <video> for a layer when its file changes. Muted +
 * looped so autoplay is allowed without a gesture. */
export function ensureVideo(layer: FxLayer): void {
  const file = typeof layer.params.file === "string" ? layer.params.file : "";
  const existing = entries.get(layer.id);
  if (!file) {
    if (existing) dropVideo(layer.id);
    return;
  }
  if (existing && existing.src === file) return;

  const video = existing?.video ?? document.createElement("video");
  // Flags BEFORE src so muted-autoplay is allowed. No crossOrigin: the
  // asset:// protocol sends no CORS headers, so requesting CORS would fail
  // the load outright (same-origin images already draw untainted).
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  // WKWebView (and others) often won't decode/advance a <video> that isn't
  // in the document. Park it off-screen, hidden, 1px.
  if (!video.isConnected) {
    video.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
  }
  if (!existing) {
    video.addEventListener("error", () =>
      log.error("fx video: failed to load", video.error?.message ?? "", file),
    );
  }
  video.src = resolveUrl(file);
  video.load();
  void video.play().catch((e) => log.warn("fx video: autoplay blocked", e));
  entries.set(layer.id, {
    video,
    src: file,
    canvas: existing?.canvas ?? document.createElement("canvas"),
  });
}

/** Draw the current frame into a scene-sized canvas with placement; returns
 * it when a frame is decodable, else null (still loading). */
export function drawVideoFrame(
  layer: FxLayer,
  pw: number,
  ph: number,
): HTMLCanvasElement | null {
  const e = entries.get(layer.id);
  if (!e) return null;
  const v = e.video;
  if (v.readyState < 2 || v.videoWidth === 0) return null;
  setSourceAspect(layer.id, v.videoWidth / v.videoHeight);

  const canvas = e.canvas;
  canvas.width = Math.max(1, Math.round(pw));
  canvas.height = Math.max(1, Math.round(ph));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = num(layer.params.x, 0.5) * canvas.width;
  const cy = num(layer.params.y, 0.5) * canvas.height;
  const rot = (num(layer.params.rotation, 0) * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const fit = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
  const s = fit * num(layer.params.scale, 1);
  const w = v.videoWidth * s;
  const h = v.videoHeight * s;
  ctx.drawImage(v, -w / 2, -h / 2, w, h);
  ctx.restore();
  return canvas;
}

export function dropVideo(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  e.video.pause();
  e.video.removeAttribute("src");
  e.video.load();
  e.video.remove();
  entries.delete(id);
}

export function dropAllVideos(): void {
  for (const id of [...entries.keys()]) dropVideo(id);
}
