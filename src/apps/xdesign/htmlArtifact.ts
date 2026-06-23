// HTML-artifact mode — the "shippable frontend" lever.
//
// Open Design's core trick is generating a real, self-contained HTML/CSS page
// rendered in a sandboxed iframe (not a vector mockup). This module is the pure
// layer: extract the produced HTML from a model reply, strip it from the chat
// transcript, and build the generation/refinement prompts (brand- + craft-
// aware). Storage, the iframe preview, and export live elsewhere.

import type { DesignSystem } from "./designSystem";
import { designSystemToPrompt } from "./designSystem";

const HTML_FENCE = /```html\s*\n([\s\S]*?)```/i;
const HTML_FENCE_G = /```html\s*\n([\s\S]*?)```/gi;
// Fallback: a bare document with no fence.
const BARE_DOC = /(<!doctype html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i;

/** Pull the produced HTML document out of a reply. Prefers a fenced ```html
 * block (the last one, so a refinement supersedes an earlier draft), then a
 * bare <html> document. Returns null when there's nothing usable. */
export function extractHtmlArtifact(text: string): string | null {
  let last: string | null = null;
  let m: RegExpExecArray | null;
  HTML_FENCE_G.lastIndex = 0;
  while ((m = HTML_FENCE_G.exec(text)) !== null) {
    const body = m[1]?.trim();
    if (body) last = body;
  }
  if (last) return last;
  const bare = text.match(BARE_DOC);
  return bare ? bare[1]!.trim() : null;
}

/** Does a reply contain an HTML artifact? */
export function hasHtmlArtifact(text: string): boolean {
  return HTML_FENCE.test(text) || BARE_DOC.test(text);
}

/** Remove the fenced HTML block(s) from a reply for the visible transcript so
 * the chat doesn't dump a few hundred lines of markup. */
export function stripHtmlArtifact(text: string): string {
  return text
    .replace(HTML_FENCE_G, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const imageryRule = (imagesAvailable: boolean): string =>
  imagesAvailable
    ? `- Imagery: for HERO and FEATURE photography/illustration, set the src (or background-image url()) to a placeholder token of the exact form {{IMG: a concise vivid description}} — we replace each with a REAL generated image. Use at most 4 such tokens, only where a genuine image belongs. Use CSS gradients / solid brand blocks / inline SVG for decorative shapes and icons. Do NOT reference external image URLs.`
    : `- Imagery: use CSS gradients, solid brand-color blocks, or inline SVG as placeholders. Do NOT reference external image URLs (they 404 in the sandbox). Inline any icons as SVG.`;

const sharedRules = (imagesAvailable: boolean): string => `Hard requirements:
- Output a COMPLETE, self-contained single-file HTML document: <!doctype html>, <head> with a <title> and a <meta name="viewport">, and all CSS in ONE inline <style> block. No external CSS files.
- Fonts: use a Google Fonts <link> if you need a specific family, otherwise a clean system stack. Honor the brand's fonts.
- Production-quality, RESPONSIVE layout (CSS grid/flex) with at least one mobile breakpoint. Semantic HTML5 (header/nav/main/section/footer), real accessible markup, alt text, and AA contrast.
- Real, specific product copy with a genuine voice — NEVER lorem ipsum.
${imageryRule(imagesAvailable)}
- Any interactivity must be vanilla JS inside one <script> tag (optional). No build step, no npm.
- Make it genuinely polished — the kind of page that could ship. Strong hierarchy, generous spacing, considered details.`;

/** Build the webpage-generation prompt: a complete HTML page from a brief,
 * shaped by the active brand contract and craft brief. */
export function buildWebpagePrompt(
  brief: string,
  brand: DesignSystem | null,
  craftBrief: string,
  imagesAvailable = false,
): string {
  const brandPart = brand
    ? `\n\n${designSystemToPrompt(brand)}\n\nBuild the page strictly within this brand contract: use its color values, fonts, type scale, spacing, radii, voice, and principles.`
    : "";
  return `You are an elite front-end design engineer. Build a real, shippable web page for this brief as actual HTML & CSS (not a mockup).

${craftBrief}${brandPart}

${sharedRules(imagesAvailable)}

Write ONE short sentence describing the page, then return exactly one fenced \`\`\`html code block containing the full document, and nothing after it.

---

BRIEF: ${brief}`;
}

/** Build the refinement prompt: given the current document + an instruction,
 * return the COMPLETE updated document. */
export function buildRefinePrompt(
  currentHtml: string,
  instruction: string,
  brand: DesignSystem | null,
  imagesAvailable = false,
): string {
  const brandPart = brand
    ? `\n\nStay within the brand contract:\n${designSystemToPrompt(brand)}`
    : "";
  return `Here is the current web page. Apply the requested change and return the COMPLETE updated document (not a diff, not a fragment).

${sharedRules(imagesAvailable)}${brandPart}

CHANGE REQUESTED: ${instruction}

Return one short sentence, then exactly one fenced \`\`\`html block with the full updated document.

CURRENT DOCUMENT:
\`\`\`html
${currentHtml}
\`\`\``;
}
