// XDesign export — produces clean SVG (and PNG via rasterizing that SVG).
//
// The canvas SVG element holds both the document AND the editor overlays
// (selection bbox, resize handles, rotation handle, marquee, pen preview,
// HUD-ish bits). For export we clone the DOM SVG, strip everything outside
// the viewport `<g>` (the only thing whose transform starts with
// `translate(…)` and that wraps document shapes), drop the viewport
// transform, and reset the viewBox to the requested bounds in document
// coordinates.

import type { Shape } from "@/apps/xdesign/store";

let svgRef: SVGSVGElement | null = null;

export function setExportSvgRef(el: SVGSVGElement | null): void {
  svgRef = el;
}

export type ExportBounds = { x: number; y: number; w: number; h: number };

/** Compute a sensible export rect. Selection if non-empty, otherwise the
 * bounding box of every visible shape. A small margin is included so a
 * shape with stroke doesn't clip at the edge. */
export function computeExportBounds(
  shapes: Shape[],
  selectionIds: Set<string>,
  margin = 8,
): ExportBounds | null {
  const targets = selectionIds.size > 0
    ? shapes.filter((s) => selectionIds.has(s.id))
    : shapes.filter((s) => !s.hidden);
  if (targets.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of targets) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  if (!isFinite(minX)) return null;
  return {
    x: minX - margin,
    y: minY - margin,
    w: maxX - minX + margin * 2,
    h: maxY - minY + margin * 2,
  };
}

export function buildExportSVG(bounds: ExportBounds): string | null {
  if (!svgRef) return null;
  const clone = svgRef.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  clone.setAttribute("width", String(Math.max(1, Math.round(bounds.w))));
  clone.setAttribute("height", String(Math.max(1, Math.round(bounds.h))));

  // Locate the viewport <g> — the first <g> with a translate-prefixed transform.
  let viewportG: Element | null = null;
  for (const child of Array.from(clone.children)) {
    if (child.tagName.toLowerCase() !== "g") continue;
    const t = child.getAttribute("transform") ?? "";
    if (t.startsWith("translate(")) {
      viewportG = child;
      break;
    }
  }
  if (viewportG) viewportG.removeAttribute("transform");

  // Strip every child that isn't <defs> or the viewport <g>. That removes
  // the grid background rect, selection bbox, handles, marquee, etc.
  for (const child of Array.from(clone.children)) {
    if (child === viewportG) continue;
    if (child.tagName.toLowerCase() === "defs") continue;
    clone.removeChild(child);
  }

  return new XMLSerializer().serializeToString(clone);
}

export function downloadFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportSVG(bounds: ExportBounds, filename = "xdesign.svg"): void {
  const svg = buildExportSVG(bounds);
  if (!svg) return;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  downloadFile(filename, blob);
}

/** Rasterize the export SVG to a PNG Blob. `backdrop` paints behind the
 * (transparent) document so translucent glass/neon shapes read the way they
 * do in the editor rather than washing out on alpha. */
async function rasterizePNG(
  bounds: ExportBounds,
  scale: number,
  backdrop: string | null,
): Promise<Blob | null> {
  const svg = buildExportSVG(bounds);
  if (!svg) return null;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = url;
    });
    const w = Math.max(1, Math.round(bounds.w * scale));
    const h = Math.max(1, Math.round(bounds.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (backdrop) {
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPNG(
  bounds: ExportBounds,
  filename = "xdesign.png",
  scale = 2,
): Promise<void> {
  const blob = await rasterizePNG(bounds, scale, null);
  if (blob) downloadFile(filename, blob);
}

/** Render the current canvas to PNG bytes for the Claude vision loop. Painted
 * on the editor's dark backdrop and downscaled so a large document doesn't
 * produce a multi-megabyte attachment. Returns null when there's nothing to
 * render (svg ref missing or empty bounds). */
export async function renderPngBytes(
  bounds: ExportBounds,
  maxDim = 1600,
): Promise<number[] | null> {
  const longest = Math.max(bounds.w, bounds.h);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const blob = await rasterizePNG(bounds, scale, "#0a1015");
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}
