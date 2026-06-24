// Deck HTML → editable .pptx.
//
// A generated deck is a single HTML file of <section class="slide"> blocks.
// PowerPoint/Keynote users want an EDITABLE deck, so we extract each slide's
// text (title + bullets) and rebuild it as native PPTX text on brand-colored
// master slides via pptxgenjs — not a pixel-perfect screenshot, but real,
// editable slides. The HTML parsing is pure + tested; the pptxgenjs assembly is
// a thin async wrapper.

import type { DesignSystem } from "./designSystem";
import { seedFromDesignSystem } from "./tokenEngine";
import { readableInk } from "./colorRamp";

export type DeckSlide = { title: string; bullets: string[] };

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Does this look like a slide deck (vs a webpage)? */
export function isDeckHtml(html: string): boolean {
  return /<section[^>]*class=["'][^"']*\bslide\b/i.test(html);
}

/** Extract per-slide title + bullets from a deck's HTML. Pure. */
export function parseDeckSlides(html: string): DeckSlide[] {
  const slides: DeckSlide[] = [];
  const sectionRe = /<section[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(html)) !== null) {
    const body = m[1]!;
    const heading = body.match(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/i);
    const title = heading ? stripTags(heading[2]!) : "";

    const bullets: string[] = [];
    const li = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    if (li.length) {
      for (const b of li) {
        const t = stripTags(b[1]!);
        if (t) bullets.push(t.slice(0, 200));
      }
    } else {
      // No list — fall back to paragraphs, skipping the title text.
      for (const p of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
        const t = stripTags(p[1]!);
        if (t && t !== title) bullets.push(t.slice(0, 240));
      }
    }
    slides.push({ title, bullets: bullets.slice(0, 8) });
  }
  return slides;
}

/** Brand colors for the PPTX master, as bare RRGGBB (pptxgenjs format). */
export function deckColors(brand: DesignSystem | null): { bg: string; ink: string; accent: string } {
  const hex = (h: string, fallback: string) => {
    const m = h.trim().match(/^#?([0-9a-fA-F]{6})$/);
    return m ? m[1]!.toUpperCase() : fallback;
  };
  if (!brand) return { bg: "0A0A0A", ink: "F2F2F2", accent: "00E0FF" };
  const s = seedFromDesignSystem(brand);
  return {
    bg: hex(s.bg, "0A0A0A"),
    ink: hex(s.ink || readableInk(s.bg), "F2F2F2"),
    accent: hex(s.primary, "00E0FF"),
  };
}

/** Build the .pptx and return it as base64. Lazy-imports pptxgenjs so it stays
 * out of the main chunk. */
export async function deckToPptxBase64(
  html: string,
  brand: DesignSystem | null,
  deckTitle: string,
): Promise<string> {
  const slides = parseDeckSlides(html);
  if (slides.length === 0) throw new Error("no slides found in this document");
  const { default: PptxGen } = await import("pptxgenjs");
  const { bg, ink, accent } = deckColors(brand);

  const pptx = new PptxGen();
  pptx.defineLayout({ name: "OD16x9", width: 13.333, height: 7.5 });
  pptx.layout = "OD16x9";
  if (deckTitle) pptx.title = deckTitle;

  for (const sl of slides) {
    const s = pptx.addSlide();
    s.background = { color: bg };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.16, fill: { color: accent } });
    s.addText(sl.title || "—", {
      x: 0.6, y: 0.5, w: 12.1, h: 1.4,
      fontSize: 34, bold: true, color: ink, fontFace: "Arial",
    });
    if (sl.bullets.length) {
      s.addText(
        sl.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 2.1, w: 12, h: 4.8, fontSize: 18, color: ink, lineSpacingMultiple: 1.2, fontFace: "Arial", valign: "top" },
      );
    }
  }
  return (await pptx.write({ outputType: "base64" })) as string;
}
