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

// Rules that keep generative / cursor-reactive hero visuals from rendering as a
// frozen, half-initialized, or hard-seam mess in the static preview.
const INTERACTIVE_VISUAL_RULES = `Interactive & animated visuals (read carefully — these prevent broken-looking heroes):
- Every visual effect MUST paint a complete, tasteful STATIC first frame immediately on load — before any mouse move, scroll, or animation tick. Never show a blank, half-initialized, or single-color frame waiting for interaction.
- Cursor-reactive effects must degrade gracefully when NO pointer is present (e.g. animate around the canvas center, or settle to the resting first frame). Never depend on a mousemove to look finished.
- Honor prefers-reduced-motion: when set, render the polished static frame and do not animate.
- Do NOT use a hard conic-gradient for organic / "tie-dye" / mesh looks: a conic-gradient whose first and last color stops differ creates an ugly seam at 0°/360°. If you must use conic-gradient, make the first and last stops IDENTICAL. Prefer layered radial-gradients, a blurred multi-stop mesh (several offset radial-gradients with blur), or an inline <svg> with gradient/turbulence filters for smooth organic color. A soft grain or blur overlay sells the effect.
- Keep the NATIVE cursor — never replace it with a custom div/element that follows the pointer inside the page (it reads as broken/stuck in preview).
- Any <canvas>/WebGL: guard for a failed context (if (!ctx) return after painting a solid brand fallback fill), size to devicePixelRatio, and draw a good first frame synchronously before starting requestAnimationFrame.`;

const sharedRules = (imagesAvailable: boolean): string => `Hard requirements:
- Output a COMPLETE, self-contained single-file HTML document: <!doctype html>, <head> with a <title> and a <meta name="viewport">, and all CSS in ONE inline <style> block. No external CSS files.
- Fonts: use a Google Fonts <link> if you need a specific family, otherwise a clean system stack. Honor the brand's fonts.
- Production-quality, RESPONSIVE layout (CSS grid/flex) with at least one mobile breakpoint. Semantic HTML5 (header/nav/main/section/footer), real accessible markup, alt text, and AA contrast.
- Real, specific product copy with a genuine voice — NEVER lorem ipsum.
${imageryRule(imagesAvailable)}
- Any interactivity must be vanilla JS inside one <script> tag (optional). No build step, no npm.
- Make it genuinely polished — the kind of page that could ship. Strong hierarchy, generous spacing, considered details.
${INTERACTIVE_VISUAL_RULES}`;

/** Build the webpage-generation prompt: a complete HTML page from a brief,
 * shaped by the active brand contract and craft brief. */
export function buildWebpagePrompt(
  brief: string,
  brand: DesignSystem | null,
  craftBrief: string,
  imagesAvailable = false,
  blueprint = "",
): string {
  const brandPart = brand
    ? `\n\n${designSystemToPrompt(brand, { withRamps: true })}\n\nBuild the page strictly within this brand contract: use its derived token values (ramps + semantic roles), fonts, type scale, spacing, radii, voice, and principles.`
    : "";
  const blueprintPart = blueprint ? `\n\n${blueprint}` : "";
  return `You are an elite front-end design engineer. Build a real, shippable web page for this brief as actual HTML & CSS (not a mockup).

${craftBrief}${brandPart}${blueprintPart}

${sharedRules(imagesAvailable)}

Write ONE short sentence describing the page, then return exactly one fenced \`\`\`html code block containing the full document, and nothing after it.

---

BRIEF: ${brief}`;
}

const deckRules = (imagesAvailable: boolean): string => `Hard requirements:
- Output a COMPLETE, self-contained single-file HTML document: <!doctype html>, <head> with a <title> and a <meta name="viewport">, all CSS in ONE inline <style> block.
- Build a SLIDE DECK: each slide is a <section class="slide"> sized to a 16:9 stage that fills the viewport. Show ONE slide at a time; hide the rest.
- Vanilla JS in ONE <script> for navigation: ArrowRight / Space / click → next, ArrowLeft → prev (no wrap); render a slide counter (e.g. "3 / 9") and clickable dot indicators; start on slide 1.
- Print CSS: @media print { reveal EVERY slide, each on its own page (break-after: page), hide the nav chrome } so the exported file prints one-slide-per-page to PDF.
- Presentation typography: large and confident, readable from across a room. ONE idea per slide — a headline plus a few short points, NEVER paragraphs. Real, specific copy, never lorem ipsum.
- ${imagesAvailable ? "Imagery: for a hero/feature visual use a {{IMG: a concise vivid description}} token (we replace it with a real image); inline icons as SVG; no external URLs." : "Imagery: CSS gradients, solid brand-color blocks, or inline SVG; no external image URLs; inline icons as SVG."}
- Consistent master layout: same margins + a footer slide number on every slide; honor the brand's derived tokens; accent budget (loudest accent on the title + closing slides).
- Genuinely polished — the kind of deck you would actually present.
${INTERACTIVE_VISUAL_RULES}`;

/** Build the deck-generation prompt: a presentable, self-contained HTML slide
 * deck from a brief, shaped by the brand + a deck blueprint. Flows through the
 * same artifact pipeline/preview as a webpage (its nav JS runs in the iframe;
 * print CSS makes the exported .html a clean PDF). */
export function buildDeckPrompt(
  brief: string,
  brand: DesignSystem | null,
  blueprint = "",
  imagesAvailable = false,
): string {
  const brandPart = brand
    ? `\n\n${designSystemToPrompt(brand, { withRamps: true })}\n\nDesign every slide strictly within this brand contract: use its derived tokens (ramps + semantic roles), fonts, type scale, spacing, radii, voice, and principles.`
    : "";
  const blueprintPart = blueprint ? `\n\n${blueprint}` : "";
  return `You are an elite presentation designer. Build a real, presentable slide deck for this brief as a single self-contained HTML file (not a mockup).${brandPart}${blueprintPart}

${deckRules(imagesAvailable)}

Write ONE short sentence describing the deck, then return exactly one fenced \`\`\`html code block containing the full document, and nothing after it.

---

BRIEF: ${brief}`;
}

/** Build the motion-generation prompt: a self-contained, canvas-based looping
 * motion graphic. Canvas-based on purpose so the preview can record it to video
 * via captureStream. Flows through the same artifact pipeline/preview. */
export function buildMotionPrompt(brief: string, brand: DesignSystem | null): string {
  const brandPart = brand
    ? `\n\n${designSystemToPrompt(brand, { withRamps: true })}\n\nUse the brand's derived tokens (ramps + semantic roles) as the motion's palette.`
    : "";
  return `You are a generative motion designer. Create a self-contained, looping motion graphic for this brief as a single HTML file.${brandPart}

Hard requirements:
- Output a COMPLETE self-contained single-file HTML document: <!doctype html>, <head> with a <title> and a <meta name="viewport">, all CSS in ONE inline <style> block.
- The motion is drawn entirely on ONE full-viewport <canvas id="scene"> that fills the window and resizes with it (devicePixelRatio-aware). ALL animation runs via requestAnimationFrame on that canvas so it can be recorded to video. No external libraries, fonts, or URLs.
- A smooth, SEAMLESS loop of ~6–10 seconds with on-brand colors and genuinely tasteful motion — a flowing gradient field, a particle/constellation system, kinetic typography, or generative waves. Commit to ONE strong idea.
- Honor prefers-reduced-motion: when set, paint a single static frame instead of animating.
- Gallery-quality: considered composition, easing, and color. Never lorem.

Write ONE short sentence describing the motion, then return exactly one fenced \`\`\`html code block containing the full document, and nothing after it.

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
    ? `\n\nStay within the brand contract:\n${designSystemToPrompt(brand, { withRamps: true })}`
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

/** Build an element-scoped refinement prompt: the user selected ONE element;
 * change only that element (and its descendants), leaving the rest of the
 * document untouched, and return the COMPLETE updated document so it flows back
 * through the same render/guard pipeline. */
export function buildElementRefinePrompt(
  currentHtml: string,
  elementHtml: string,
  instruction: string,
  brand: DesignSystem | null,
  imagesAvailable = false,
): string {
  const brandPart = brand
    ? `\n\nStay within the brand contract:\n${designSystemToPrompt(brand, { withRamps: true })}`
    : "";
  return `Here is the current web page. The user selected ONE element to change. Apply the requested change to ONLY that element (and its descendants) — leave the rest of the document essentially identical — and return the COMPLETE updated document.

${sharedRules(imagesAvailable)}${brandPart}

SELECTED ELEMENT (change only this one):
\`\`\`html
${elementHtml}
\`\`\`

CHANGE REQUESTED: ${instruction}

Return one short sentence, then exactly one fenced \`\`\`html block with the full updated document.

CURRENT DOCUMENT:
\`\`\`html
${currentHtml}
\`\`\``;
}
