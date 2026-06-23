// SVG illustration generation — the zero-dependency "image generation" path.
//
// True raster image gen needs an image-model API. But Claude is excellent at
// authoring vector SVG (hero graphics, spot illustrations, icons, abstract
// art), so we have it return a self-contained <svg>, embed it as a data: URL,
// and place it as a real image layer on the canvas (the renderer passes data:
// URLs straight through). Pure layer: extract + data-url + aspect + prompt.

import type { DesignSystem } from "./designSystem";

const SVG_FENCE_G = /```(?:svg|xml|html)?\s*\n?(<svg[\s\S]*?<\/svg>)\s*```/gi;
const SVG_BARE = /<svg[\s\S]*?<\/svg>/i;

/** Pull the produced <svg> out of a reply. Prefers a fenced block, then a
 * bare <svg> element. Returns the last one (a refinement supersedes a draft).
 * Null when there's nothing usable. */
export function extractSvg(text: string): string | null {
  let last: string | null = null;
  let m: RegExpExecArray | null;
  SVG_FENCE_G.lastIndex = 0;
  while ((m = SVG_FENCE_G.exec(text)) !== null) {
    if (m[1]) last = m[1].trim();
  }
  if (last) return last;
  const bare = text.match(SVG_BARE);
  return bare ? bare[0].trim() : null;
}

/** Strip fenced/bare SVG from a reply for the visible transcript. */
export function stripSvg(text: string): string {
  return text
    .replace(SVG_FENCE_G, "")
    .replace(SVG_BARE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Encode an SVG string as a data: URL usable directly as an <image href>. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Read the SVG's intrinsic aspect ratio (w/h) from viewBox or width/height.
 * Defaults to 4:3 when unknown. */
export function svgAspect(svg: string): number {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)/i);
  if (vb) {
    const w = parseFloat(vb[1]!);
    const h = parseFloat(vb[2]!);
    if (w > 0 && h > 0) return w / h;
  }
  const w = svg.match(/\bwidth\s*=\s*["']?([\d.]+)/i);
  const h = svg.match(/\bheight\s*=\s*["']?([\d.]+)/i);
  if (w && h) {
    const wn = parseFloat(w[1]!);
    const hn = parseFloat(h[1]!);
    if (wn > 0 && hn > 0) return wn / hn;
  }
  return 4 / 3;
}

/** Box for placing an illustration at a target width, preserving aspect. */
export function illustrationBox(svg: string, targetW = 420): { w: number; h: number } {
  const ratio = svgAspect(svg);
  return { w: targetW, h: Math.round(targetW / ratio) };
}

/** Build the illustration-generation prompt: one self-contained SVG matching
 * a description, using the active brand's colors. */
export function buildIllustrationPrompt(
  description: string,
  brand: DesignSystem | null,
): string {
  const palette =
    brand && brand.colors.length
      ? `Use these brand colors: ${brand.colors.map((c) => `${c.name} ${c.value}`).join(", ")}.`
      : "Use a tasteful, cohesive palette.";
  return `Create ONE self-contained SVG illustration for: "${description}".

Requirements:
- A single <svg> element with a viewBox and NO external references (no <image href>, no external fonts/URLs — everything inline as vector shapes, gradients, and paths).
- Modern, intentional vector style with real depth and composition — not a flat clipart blob. Use gradients, layering, and negative space.
- ${palette}
- Keep it crisp and scalable; no rasterized data.

Reply with one short sentence, then exactly one fenced \`\`\`svg code block containing the SVG, and nothing after it.`;
}
