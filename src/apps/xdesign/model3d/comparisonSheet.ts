/**
 * Port of img2threejs `forge/stage4_review/make_comparison_sheet.py`.
 * Packages ONE side-by-side reference|render sheet — the single image
 * Claude's vision inspects each pass (upstream: "one image per review …
 * not a scattering of screenshots", the token-efficiency lever). This
 * script never scores anything; it just aligns + composites.
 */

export type ComparisonSheet = { canvas: HTMLCanvasElement; dataUrl: string };

export async function makeComparisonSheet(
  reference: string | HTMLCanvasElement,
  renderCanvas: HTMLCanvasElement,
  opts: { panelWidth?: number; panelHeight?: number; gutter?: number; label?: string } = {},
): Promise<ComparisonSheet> {
  const panelW = opts.panelWidth ?? 512;
  const panelH = opts.panelHeight ?? 512;
  const gutter = opts.gutter ?? 12;

  // Accept an already-decoded canvas (the caller likely decoded+capped the
  // reference already for pixel analysis) to avoid a second full image
  // decode on every render call — that redundant decode was a real chunk of
  // per-pass latency for a large source photo.
  const refImg = typeof reference === "string" ? await loadImage(reference) : reference;

  const canvas = document.createElement("canvas");
  canvas.width = panelW * 2 + gutter;
  canvas.height = panelH + 28;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a1015";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawContain(ctx, refImg, 0, 28, panelW, panelH);
  drawContain(ctx, renderCanvas, panelW + gutter, 28, panelW, panelH);

  ctx.fillStyle = "#9ab0a8";
  ctx.font = "12px monospace";
  ctx.fillText("REFERENCE", 6, 18);
  ctx.fillText(opts.label ?? "RENDER", panelW + gutter + 6, 18);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(panelW + gutter / 2, 24);
  ctx.lineTo(panelW + gutter / 2, canvas.height);
  ctx.stroke();

  return { canvas, dataUrl: canvas.toDataURL("image/png") };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawContain(
  ctx: CanvasRenderingContext2D, src: HTMLImageElement | HTMLCanvasElement, x: number, y: number, w: number, h: number,
): void {
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width;
  const sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  if (!sw || !sh) return;
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.fillStyle = "#03060a";
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(src, dx, dy, dw, dh);
}
