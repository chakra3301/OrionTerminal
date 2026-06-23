// Image slots for HTML artifacts.
//
// When an image-capable provider is configured, the webpage generator is told
// to emit a placeholder token — `{{IMG: a concise vivid description}}` — as the
// src of any photographic/hero <img> (or in a background-image url()). We then
// generate a real raster image per unique description and inline it as a data:
// URL (sandboxed srcdoc iframes can't load asset:// — data URLs always work,
// and they make the exported single-file page truly self-contained).
//
// No key → the generator keeps using CSS gradients / inline SVG, so there are
// no tokens to resolve and this module is a no-op.

const SLOT_G = /\{\{\s*IMG:\s*([^{}]+?)\s*\}\}/g;

/** Max real images to generate per page — caps latency + cost. Extra tokens
 * fall back to a gradient placeholder. */
export const MAX_IMAGE_SLOTS = 4;

/** Does the document contain any image-slot tokens? */
export function hasImageSlots(html: string): boolean {
  SLOT_G.lastIndex = 0;
  return SLOT_G.test(html);
}

/** Unique slot descriptions in document order, capped at MAX_IMAGE_SLOTS. */
export function extractImageRequests(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SLOT_G.lastIndex = 0;
  while ((m = SLOT_G.exec(html)) !== null) {
    const desc = m[1]?.trim();
    if (!desc || seen.has(desc)) continue;
    seen.add(desc);
    out.push(desc);
    if (out.length >= MAX_IMAGE_SLOTS) break;
  }
  return out;
}

/** A neutral CSS gradient data URL used when a slot can't be generated (no
 * key, over the cap, or an API error) so the page still renders. */
export function fallbackSlotUrl(): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='%23222'/><stop offset='1' stop-color='%23444'/>` +
    `</linearGradient></defs><rect width='1200' height='800' fill='url(%23g)'/></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

/** Replace every `{{IMG: desc}}` with its resolved URL from `replacements`;
 * any token without a mapping (over the cap, or a failed generation) gets the
 * gradient fallback so the layout never breaks. */
export function inlineGeneratedImages(
  html: string,
  replacements: Map<string, string>,
): string {
  return html.replace(SLOT_G, (_full, rawDesc: string) => {
    const desc = rawDesc.trim();
    return replacements.get(desc) ?? fallbackSlotUrl();
  });
}
