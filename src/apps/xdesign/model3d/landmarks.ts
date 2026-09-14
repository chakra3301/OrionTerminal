/**
 * Port of img2threejs `forge/stage1_intake/extract_landmarks.py` +
 * `grimoire/character/reconstruction.md`. Draws a head-bounding-box overlay
 * grid on a reference image crop so the agent annotates real measured
 * landmarks (normalized to the head box, not the full image — survives
 * scale changes) instead of assuming a generic face chart.
 */

import type { PreSpecAssessment } from "./sculptSpec";

export type HeadBox = { x: number; y: number; w: number; h: number }; // normalized to full image

/** Draws horizontal guide lines at the canonical landmark bands
 * (hairline/eyeLine/noseBase/mouthLine) inside the head box, for the agent
 * to visually compare against and correct. Returns a new canvas. */
export function drawLandmarkOverlay(source: HTMLCanvasElement | HTMLImageElement, headBox: HeadBox): HTMLCanvasElement {
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);

  const bx = headBox.x * w, by = headBox.y * h, bw = headBox.w * w, bh = headBox.h * h;
  ctx.strokeStyle = "rgba(0, 224, 255, 0.85)";
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.strokeRect(bx, by, bw, bh);

  const bands: Array<[string, number]> = [
    ["hairline", 0.08], ["eyeLine", 0.5], ["noseBase", 0.65], ["mouthLine", 0.8],
  ];
  ctx.font = `${Math.max(10, w / 60)}px monospace`;
  for (const [label, frac] of bands) {
    const y = by + bh * frac;
    ctx.strokeStyle = "rgba(255, 62, 165, 0.7)";
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx + bw, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 62, 165, 0.9)";
    ctx.fillText(label, bx + bw + 4, y + 4);
  }
  // vertical eye-spacing guide at head center.
  ctx.strokeStyle = "rgba(230, 255, 58, 0.6)";
  ctx.beginPath();
  ctx.moveTo(bx + bw / 2, by);
  ctx.lineTo(bx + bw / 2, by + bh);
  ctx.stroke();

  return canvas;
}

/** Style-heads reference table — pick from the image, don't assume realistic. */
export const STYLE_HEADS: Record<string, number> = {
  realistic: 7.5,
  stylized: 5.5,
  chibi: 2.5,
};

export function anatomyFromMeasurements(
  styleHeads: number,
  proportions: PreSpecAssessment["anatomy"]["proportions"],
  faceLandmarks: PreSpecAssessment["anatomy"]["faceLandmarks"],
  poseType: string,
  jointAngles: Record<string, number>,
  confidence: number,
): PreSpecAssessment["anatomy"] {
  return {
    applies: true,
    styleHeads,
    proportions,
    pose: { type: poseType, jointAngles },
    faceLandmarks,
    features: [],
    confidence,
  };
}
