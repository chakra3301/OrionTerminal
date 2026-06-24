// Design Systems — persistent "brand contracts" that shape every AI output.
//
// Inspired by Open Design's DESIGN.md: instead of the composer inventing throw-
// away tokens each run, the user keeps named, reusable design systems (colors,
// type scale, fonts, spacing, radii, voice, aesthetic direction, principles).
// The ACTIVE system is compiled to a compact brand-contract block and injected
// into both the ✦ Generate composer and the canvas-edit system prompt, so the
// AI adheres to one coherent brand across every generation and restyle.
//
// Pure + framework-free: parsing/serialization/prompt-compilation are cheap to
// unit-test. Id generation, DB, and store mutation live elsewhere.

import { brandTokensPrompt } from "./tokenEngine";

export type DSColor = {
  /** Token name referenced as color/<name> in plans, e.g. "brand". */
  name: string;
  /** Hex / rgba / css value. */
  value: string;
  /** Optional human role, e.g. "Primary action". */
  role?: string;
  /** Optional usage note. */
  usage?: string;
};

export type DSType = {
  /** Scale role: display | h1 | h2 | body | caption | … */
  role: string;
  size?: number;
  weight?: number;
  lineHeight?: number;
  tracking?: number;
};

export type DesignSystem = {
  id: string;
  name: string;
  description?: string;
  /** Aesthetic direction, e.g. "bold / editorial", "brutalist". */
  aesthetic?: string;
  colors: DSColor[];
  typography: DSType[];
  fonts?: { display?: string; body?: string; mono?: string };
  /** Corner radii used in the system, smallest → largest. */
  radii?: number[];
  /** Spacing scale. */
  spacing?: number[];
  /** Copy voice / tone guidance. */
  voice?: string;
  /** Layout / usage principles the AI must honor. */
  principles?: string[];
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function numArr(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return out.length ? out : undefined;
}
function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((s) => str(s)).filter((s): s is string => !!s);
  return out.length ? out : undefined;
}

/** Fail-soft parse of a stored/AI-produced design system. Returns null only
 * when there is no usable name; everything else degrades to sane defaults so a
 * partial blob from the model still yields a working brand. */
export function parseDesignSystem(raw: unknown, fallbackId?: string): DesignSystem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;

  const colors: DSColor[] = Array.isArray(o.colors)
    ? (o.colors as unknown[])
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const co = c as Record<string, unknown>;
          const n = str(co.name);
          const value = str(co.value);
          if (!n || !value) return null;
          const col: DSColor = { name: n, value };
          const role = str(co.role);
          const usage = str(co.usage);
          if (role) col.role = role;
          if (usage) col.usage = usage;
          return col;
        })
        .filter((c): c is DSColor => !!c)
    : [];

  const typography: DSType[] = Array.isArray(o.typography)
    ? (o.typography as unknown[])
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const to = t as Record<string, unknown>;
          const role = str(to.role);
          if (!role) return null;
          const ty: DSType = { role };
          const size = num(to.size);
          const weight = num(to.weight);
          const lh = num(to.lineHeight);
          const tr = num(to.tracking);
          if (size != null) ty.size = size;
          if (weight != null) ty.weight = weight;
          if (lh != null) ty.lineHeight = lh;
          if (tr != null) ty.tracking = tr;
          return ty;
        })
        .filter((t): t is DSType => !!t)
    : [];

  const fontsRaw = o.fonts as Record<string, unknown> | undefined;
  const fonts =
    fontsRaw && typeof fontsRaw === "object"
      ? {
          ...(str(fontsRaw.display) ? { display: str(fontsRaw.display) } : {}),
          ...(str(fontsRaw.body) ? { body: str(fontsRaw.body) } : {}),
          ...(str(fontsRaw.mono) ? { mono: str(fontsRaw.mono) } : {}),
        }
      : undefined;

  const ds: DesignSystem = {
    id: str(o.id) ?? fallbackId ?? "",
    name,
    builtin: o.builtin === true,
    colors,
    typography,
    createdAt: num(o.createdAt) ?? Date.now(),
    updatedAt: num(o.updatedAt) ?? Date.now(),
  };
  const description = str(o.description);
  const aesthetic = str(o.aesthetic);
  const voice = str(o.voice);
  const radii = numArr(o.radii);
  const spacing = numArr(o.spacing);
  const principles = strArr(o.principles);
  if (description) ds.description = description;
  if (aesthetic) ds.aesthetic = aesthetic;
  if (voice) ds.voice = voice;
  if (fonts && Object.keys(fonts).length) ds.fonts = fonts;
  if (radii) ds.radii = radii;
  if (spacing) ds.spacing = spacing;
  if (principles) ds.principles = principles;
  return ds;
}

/** Compile a design system into a compact brand-contract block the AI must
 * adhere to. Kept terse — it's prepended to generation prompts every turn.
 * With `withRamps`, the deterministic token engine appends coherent 10-step
 * color ramps + semantic role tokens + scales (Lever 1) so the model designs
 * from a derived system instead of inventing shades. */
export function designSystemToPrompt(
  ds: DesignSystem,
  opts: { withRamps?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`# BRAND CONTRACT — "${ds.name}"`);
  lines.push(
    `You MUST design within this brand system. Do not invent off-brand colors, fonts, or tone. Reference colors by their token name (color/<name>); never paste raw hex that isn't in the palette.`,
  );
  if (ds.aesthetic) lines.push(`\nAesthetic direction: ${ds.aesthetic}. Commit to it fully.`);
  if (ds.description) lines.push(ds.description);

  if (ds.colors.length) {
    lines.push(`\n## Color tokens`);
    for (const c of ds.colors) {
      const meta = [c.role, c.usage].filter(Boolean).join(" — ");
      lines.push(`- color/${c.name} = ${c.value}${meta ? `  (${meta})` : ""}`);
    }
  }

  if (ds.fonts && (ds.fonts.display || ds.fonts.body || ds.fonts.mono)) {
    const f = ds.fonts;
    const parts = [
      f.display ? `display "${f.display}"` : "",
      f.body ? `body "${f.body}"` : "",
      f.mono ? `mono "${f.mono}"` : "",
    ].filter(Boolean);
    lines.push(`\n## Fonts\n${parts.join(", ")}`);
  }

  if (ds.typography.length) {
    lines.push(`\n## Type scale`);
    for (const t of ds.typography) {
      const bits = [
        t.size != null ? `${t.size}px` : "",
        t.weight != null ? `w${t.weight}` : "",
        t.lineHeight != null ? `lh ${t.lineHeight}` : "",
        t.tracking != null ? `tracking ${t.tracking}` : "",
      ].filter(Boolean);
      lines.push(`- ${t.role}: ${bits.join(" / ") || "—"}`);
    }
  }

  if (ds.spacing?.length) lines.push(`\n## Spacing scale\n${ds.spacing.join(", ")}px — use these step values for padding and gaps.`);
  if (ds.radii?.length) lines.push(`\n## Corner radii\n${ds.radii.join(", ")}px`);
  if (ds.voice) lines.push(`\n## Voice & tone\n${ds.voice}`);
  if (ds.principles?.length) {
    lines.push(`\n## Principles`);
    for (const p of ds.principles) lines.push(`- ${p}`);
  }
  if (opts.withRamps) {
    lines.push(`\n${brandTokensPrompt(ds)}`);
  }
  return lines.join("\n");
}

const DS_FENCE = /```xd-designsystem\s*\n([\s\S]*?)```/;

/** Extract a design system from an AI reply that returns a fenced
 * ```xd-designsystem JSON block (used by "Extract brand from canvas"). */
export function parseDesignSystemReply(text: string, fallbackId?: string): DesignSystem | null {
  const m = text.match(DS_FENCE);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!.trim());
  } catch {
    return null;
  }
  return parseDesignSystem(raw, fallbackId);
}

/** Strip the fenced design-system block from a reply for the visible
 * transcript. */
export function stripDesignSystemReply(text: string): string {
  return text.replace(/```xd-designsystem\s*\n[\s\S]*?```/g, "").trim();
}

/** Prompt asking the model to distill the current canvas into a reusable
 * design system, returning exactly one fenced xd-designsystem block. */
export const EXTRACT_SYSTEM_PROMPT = `Study the attached render of the current canvas and the layer list, then distill the design into a REUSABLE design system (a brand contract). Identify the real palette (group near-duplicates into named tokens), the type scale, fonts, spacing rhythm, corner radii, the voice/tone of the copy, and the core aesthetic direction and principles that make it cohesive.

Return EXACTLY one fenced code block tagged xd-designsystem containing valid JSON (no comments, no trailing commas):

\`\`\`xd-designsystem
{ "name": "…", "aesthetic": "…", "description": "one or two sentences",
  "colors": [ { "name": "brand", "value": "#0d99ff", "role": "Primary action", "usage": "CTAs, links" } ],
  "fonts": { "display": "…", "body": "…", "mono": "…" },
  "typography": [ { "role": "display", "size": 64, "weight": 700, "lineHeight": 1.05, "tracking": -1 } ],
  "spacing": [4,8,12,16,24,32,48,64], "radii": [4,8,16,24],
  "voice": "…", "principles": ["…","…"] }
\`\`\`

Write one short sentence before the block and nothing after it.`;

/** Self-critique & refine: look at the current render, critique it against the
 * active brand + craft principles, then make targeted edits. Open Design's
 * "critique" stage as a one-click loop. The active brand (if any) is folded in
 * so the critique is brand-aware. */
export function buildCritiquePrompt(brand: DesignSystem | null): string {
  const brandPart = brand
    ? `\n\n${designSystemToPrompt(brand, { withRamps: true })}\n\nCritique against this brand contract: flag any off-brand color, font, spacing, or tone, and fix it to the tokens above.`
    : "";
  return `Act as a brutally honest senior design critic. Study the attached render of the CURRENT canvas as ground truth and critique it like an Awwwards juror would — hierarchy, spacing rhythm, alignment, contrast, balance, typographic scale, color harmony, and overall polish.

List the 3–5 most impactful problems you SEE (be specific and reference what's wrong), then FIX them with targeted edits via the apply tool — don't rebuild from scratch, surgically improve. Prioritize the changes that most raise the quality bar.${brandPart}

Keep your written critique to a few tight bullets, then make the edits.`;
}

/** Restyle the existing canvas to conform to the active brand without changing
 * the layout/structure. */
export function buildApplyBrandPrompt(brand: DesignSystem): string {
  return `${designSystemToPrompt(brand, { withRamps: true })}\n\nRestyle the EXISTING canvas to fully conform to this brand contract WITHOUT changing the layout or structure: remap fills/strokes/text colors to the nearest brand color token, align font sizes/weights to the type scale, normalize corner radii and spacing to the brand's steps, and adjust any off-brand element. Use the apply tool with update ops on the existing shapes (read their ids from the canvas summary / get_canvas). Do not add or delete shapes unless an element is fundamentally off-brand. Briefly say what you changed, then apply.`;
}

/** Built-in starter design systems. Stable ids so re-seed is idempotent.
 * createdAt/updatedAt are filled at seed time (0 here keeps them pure). */
export const BUILTIN_DESIGN_SYSTEMS: DesignSystem[] = [
  {
    id: "ds-builtin-neo-tokyo",
    name: "Neo-Tokyo",
    builtin: true,
    aesthetic: "high-contrast / technical — neon on near-black, confident and engineered",
    description:
      "Orion Terminal's native language: deep space backgrounds, a single neon accent per surface, sharp mono labels, generous negative space.",
    colors: [
      { name: "bg", value: "#03060a", role: "Deepest background" },
      { name: "surface", value: "#060a0f", role: "Card / section" },
      { name: "surface-2", value: "#0a1015", role: "Raised surface" },
      { name: "accent", value: "#00e0ff", role: "Primary accent", usage: "CTAs, focus, info" },
      { name: "accent-2", value: "#ff3ea5", role: "Secondary accent", usage: "errors, highlights" },
      { name: "success", value: "#39ff88", role: "Success / online" },
      { name: "ink", value: "#e6f4ec", role: "Primary text" },
      { name: "ink-muted", value: "#9ab0a8", role: "Secondary text" },
      { name: "line", value: "rgba(255,255,255,0.10)", role: "Hairline borders" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 64, weight: 600, lineHeight: 1.05, tracking: -1.5 },
      { role: "h1", size: 40, weight: 600, lineHeight: 1.1, tracking: -0.5 },
      { role: "h2", size: 28, weight: 600, lineHeight: 1.2 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.4 },
    ],
    spacing: [4, 8, 12, 16, 24, 32, 48, 64],
    radii: [6, 10, 16, 22],
    voice: "Precise, confident, a little futuristic. Short declaratives. No marketing fluff.",
    principles: [
      "One dominant neon accent per screen; never compete two neons at equal weight.",
      "Generous negative space; let the dark canvas breathe.",
      "Mono for labels, codes, and metadata; sans for prose and headlines.",
      "Hairline borders over heavy fills; depth from glow and shadow, not chrome.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-editorial",
    name: "Editorial Light",
    builtin: true,
    aesthetic: "refined / editorial — calm neutrals, big confident type, lots of air",
    description:
      "A premium publication feel: near-white canvas, ink-black type, one restrained accent, wide margins, magazine-grade hierarchy.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Main canvas" },
      { name: "surface-2", value: "#f5f5f3", role: "Alt section" },
      { name: "ink", value: "#111111", role: "Headlines & body" },
      { name: "ink-muted", value: "#6b6b6b", role: "Secondary copy" },
      { name: "accent", value: "#c8442b", role: "Accent", usage: "links, highlights, CTAs" },
      { name: "line", value: "#e4e4e0", role: "Dividers" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 80, weight: 600, lineHeight: 1.0, tracking: -2 },
      { role: "h1", size: 44, weight: 600, lineHeight: 1.08, tracking: -0.5 },
      { role: "h2", size: 24, weight: 600, lineHeight: 1.2 },
      { role: "body", size: 18, weight: 400, lineHeight: 1.7 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.4, tracking: 0.5 },
    ],
    spacing: [8, 16, 24, 40, 64, 96, 128],
    radii: [0, 2, 8],
    voice: "Literary and assured. Long-form rhythm, strong verbs, no exclamation marks.",
    principles: [
      "Type does the work — large display, restrained accent, mostly black on white.",
      "Wide margins and tall whitespace; never crowd a column.",
      "One accent color, used sparingly for emphasis only.",
      "Sharp or barely-rounded corners; avoid soft pill shapes.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-brutalist",
    name: "Brutalist",
    builtin: true,
    aesthetic: "brutalist — raw, loud, high-contrast, grid-broken, unapologetic",
    description:
      "Stark black/white with one screaming accent, heavy borders, oversized type, intentional asymmetry and overlap.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Canvas" },
      { name: "ink", value: "#000000", role: "Everything structural" },
      { name: "accent", value: "#ff5c00", role: "Accent", usage: "shock color, blocks, CTAs" },
      { name: "accent-2", value: "#0000ff", role: "Secondary shock" },
    ],
    fonts: { display: "JetBrains Mono", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 96, weight: 700, lineHeight: 0.95, tracking: -3 },
      { role: "h1", size: 48, weight: 700, lineHeight: 1.0 },
      { role: "body", size: 16, weight: 500, lineHeight: 1.4 },
      { role: "caption", size: 12, weight: 700, lineHeight: 1.2, tracking: 1 },
    ],
    spacing: [0, 4, 8, 16, 32],
    radii: [0],
    voice: "Blunt, ALL-CAPS where it counts, declarative, anti-corporate.",
    principles: [
      "Hard edges only — zero border radius.",
      "Thick black borders (2–6px) on blocks; flat fills, no shadows or gradients.",
      "Oversized type that overflows and overlaps on purpose.",
      "One loud accent against black and white; break the grid deliberately.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-linear",
    name: "Linear Dark",
    builtin: true,
    aesthetic: "refined product / SaaS — dark, precise, restrained, premium",
    description:
      "The modern dev-tool look: near-black surfaces, subtle elevation, a single indigo accent, tight type, hairline borders, calm depth.",
    colors: [
      { name: "surface", value: "#08090a", role: "App background" },
      { name: "surface-2", value: "#0f1011", role: "Card" },
      { name: "surface-3", value: "#1a1b1e", role: "Raised / hover" },
      { name: "accent", value: "#5e6ad2", role: "Primary action", usage: "CTAs, focus" },
      { name: "ink", value: "#f7f8f8", role: "Primary text" },
      { name: "ink-muted", value: "#8a8f98", role: "Secondary text" },
      { name: "line", value: "rgba(255,255,255,0.08)", role: "Borders" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 56, weight: 600, lineHeight: 1.1, tracking: -1.5 },
      { role: "h1", size: 32, weight: 600, lineHeight: 1.2, tracking: -0.5 },
      { role: "h2", size: 21, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 15, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.4 },
    ],
    spacing: [4, 8, 12, 16, 24, 32, 48, 64, 96],
    radii: [6, 8, 12, 16],
    voice: "Crisp, product-led, confident. Short benefit-driven lines, zero hype.",
    principles: [
      "Near-black canvas with barely-there elevation steps; depth via subtle borders, not heavy shadows.",
      "One indigo accent; everything else is neutral.",
      "Tight, slightly negative tracking on headings; generous body line-height.",
      "Dense but breathable — 8px-grid spacing, aligned columns.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-vercel",
    name: "Mono Tech",
    builtin: true,
    aesthetic: "high-contrast technical — pure black & white, geometric, developer-grade",
    description:
      "Vercel/Geist-style: stark black-on-white (or inverted), one accent used sparingly, mono accents, sharp geometric clarity.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Canvas" },
      { name: "surface-2", value: "#fafafa", role: "Alt surface" },
      { name: "ink", value: "#000000", role: "Text & structure" },
      { name: "ink-muted", value: "#666666", role: "Secondary" },
      { name: "accent", value: "#0070f3", role: "Accent", usage: "links, primary CTA" },
      { name: "line", value: "#eaeaea", role: "Borders" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 64, weight: 700, lineHeight: 1.05, tracking: -2 },
      { role: "h1", size: 40, weight: 600, lineHeight: 1.1, tracking: -1 },
      { role: "h2", size: 24, weight: 600, lineHeight: 1.25 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.4, tracking: 0.2 },
    ],
    spacing: [4, 8, 16, 24, 32, 48, 64, 96],
    radii: [4, 6, 8],
    voice: "Technical, exact, understated. Lets the product speak.",
    principles: [
      "Pure black and white; the accent appears rarely and deliberately.",
      "Geometric, evenly-gridded layouts with crisp 1px borders.",
      "Mono for code, metrics, and labels; clean sans for everything else.",
      "High contrast, generous whitespace, no decorative gradients.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-glass",
    name: "Glassmorphic",
    builtin: true,
    aesthetic: "soft / futuristic — translucent frosted panels over a vivid gradient field",
    description:
      "Apple-Vision-style glass: layered translucent cards, soft inner highlights, blurred gradient backdrops, gentle depth.",
    colors: [
      { name: "bg-grad-a", value: "#5b2be0", role: "Backdrop gradient start" },
      { name: "bg-grad-b", value: "#1e8fff", role: "Backdrop gradient end" },
      { name: "glass", value: "rgba(255,255,255,0.10)", role: "Panel fill" },
      { name: "glass-line", value: "rgba(255,255,255,0.25)", role: "Panel border" },
      { name: "ink", value: "#ffffff", role: "Text" },
      { name: "ink-muted", value: "rgba(255,255,255,0.7)", role: "Secondary text" },
      { name: "accent", value: "#7dffea", role: "Accent" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 60, weight: 600, lineHeight: 1.05, tracking: -1 },
      { role: "h1", size: 34, weight: 600, lineHeight: 1.15 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.4 },
    ],
    spacing: [8, 12, 16, 24, 32, 48, 72],
    radii: [16, 22, 28],
    voice: "Light, optimistic, a little futuristic.",
    principles: [
      "Vivid blurred gradient backdrop; content lives on translucent frosted panels.",
      "Soft inner highlight (top) + soft drop shadow (bottom) on every glass card.",
      "Large rounded radii; nothing sharp.",
      "White text with muted-white secondary; one bright accent.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-synthwave",
    name: "Synthwave",
    builtin: true,
    aesthetic: "retro-futuristic — 80s neon, sunset gradients, grid horizon, chrome type",
    description:
      "Outrun aesthetic: deep purple-to-magenta sunsets, cyan/magenta neon, glowing grids, chrome-styled headlines.",
    colors: [
      { name: "bg", value: "#1a0b2e", role: "Deep background" },
      { name: "sunset-a", value: "#ff2e97", role: "Sunset top" },
      { name: "sunset-b", value: "#ff9a3c", role: "Sunset bottom" },
      { name: "neon-cyan", value: "#05d9e8", role: "Neon accent" },
      { name: "neon-magenta", value: "#ff2e97", role: "Neon accent 2" },
      { name: "ink", value: "#f6e7ff", role: "Text" },
      { name: "ink-muted", value: "#a98fd0", role: "Secondary" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 72, weight: 700, lineHeight: 1.0, tracking: -1 },
      { role: "h1", size: 40, weight: 600, lineHeight: 1.1 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 12, weight: 600, lineHeight: 1.3, tracking: 1.5 },
    ],
    spacing: [8, 12, 16, 24, 40, 64],
    radii: [4, 8, 12],
    voice: "Bold, energetic, a touch nostalgic. Big claims, neon confidence.",
    principles: [
      "Sunset gradient backdrops; neon glow (outer bloom) on accents and headlines.",
      "Cyan + magenta as the dual neon pair against deep purple.",
      "Glowing horizon grids and scanline texture as atmosphere.",
      "Chrome/metallic headline treatment for hero type.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-warm-organic",
    name: "Warm Organic",
    builtin: true,
    aesthetic: "warm / organic — earthy neutrals, soft serifs, cozy and human",
    description:
      "Boutique/wellness feel: cream and clay tones, a serif display, rounded soft shapes, generous calm spacing.",
    colors: [
      { name: "surface", value: "#f6f1e9", role: "Cream canvas" },
      { name: "surface-2", value: "#ece3d6", role: "Alt section" },
      { name: "ink", value: "#2e2a25", role: "Text" },
      { name: "ink-muted", value: "#7a7166", role: "Secondary" },
      { name: "accent", value: "#c2683f", role: "Terracotta accent" },
      { name: "accent-2", value: "#6b7d5a", role: "Sage secondary" },
      { name: "line", value: "#ddd2c2", role: "Borders" },
    ],
    fonts: { display: "Space Grotesk", body: "Space Grotesk", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 68, weight: 500, lineHeight: 1.05, tracking: -1 },
      { role: "h1", size: 38, weight: 500, lineHeight: 1.15 },
      { role: "body", size: 17, weight: 400, lineHeight: 1.75 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.5 },
    ],
    spacing: [8, 16, 24, 40, 64, 96],
    radii: [8, 16, 28, 999],
    voice: "Warm, human, unhurried. Inviting and sincere, never salesy.",
    principles: [
      "Cream and clay neutrals; terracotta + sage as the warm accent pair.",
      "Soft rounded shapes and pill buttons; nothing harsh.",
      "Generous airy spacing and long line-height for a calm read.",
      "Organic asymmetry and natural imagery placeholders.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-stripe",
    name: "Indigo SaaS",
    builtin: true,
    aesthetic: "polished product / SaaS — light, gradient-accented, trustworthy",
    description:
      "Stripe-style: white surfaces, an indigo→violet gradient accent, crisp cards with soft shadows, friendly-but-precise type.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Canvas" },
      { name: "surface-2", value: "#f6f9fc", role: "Alt section" },
      { name: "ink", value: "#0a2540", role: "Headlines & body" },
      { name: "ink-muted", value: "#425466", role: "Secondary" },
      { name: "accent", value: "#635bff", role: "Primary action", usage: "CTAs, links" },
      { name: "accent-2", value: "#00d4ff", role: "Gradient partner" },
      { name: "line", value: "#e6ebf1", role: "Borders" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 60, weight: 700, lineHeight: 1.08, tracking: -1.5 },
      { role: "h1", size: 38, weight: 600, lineHeight: 1.15, tracking: -0.5 },
      { role: "h2", size: 24, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 14, weight: 500, lineHeight: 1.4 },
    ],
    spacing: [4, 8, 12, 16, 24, 32, 48, 80],
    radii: [6, 10, 16, 24],
    voice: "Confident, clear, developer-friendly. Benefit-led, never hypey.",
    principles: [
      "White canvas with soft elevation; one indigo→violet gradient as the signature accent.",
      "Crisp cards, gentle shadows, generous section padding.",
      "Color the accent; keep everything else calm navy + grey.",
      "Diagonal gradient ribbons as atmosphere, used sparingly.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-notion",
    name: "Notion Minimal",
    builtin: true,
    aesthetic: "calm document / workspace — warm neutral, black ink, quietly humane",
    description:
      "A writing-tool calm: warm off-white paper, near-black ink, a single restrained blue, subtle dividers, lots of reading room.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Page" },
      { name: "surface-2", value: "#f7f6f3", role: "Sidebar / block" },
      { name: "ink", value: "#37352f", role: "Text" },
      { name: "ink-muted", value: "#9b9a97", role: "Secondary" },
      { name: "accent", value: "#2383e2", role: "Links & primary" },
      { name: "line", value: "#eceae6", role: "Dividers" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 48, weight: 700, lineHeight: 1.1, tracking: -1 },
      { role: "h1", size: 30, weight: 600, lineHeight: 1.2 },
      { role: "h2", size: 22, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.7 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.5 },
    ],
    spacing: [4, 8, 12, 16, 24, 40, 64],
    radii: [3, 6, 10],
    voice: "Plain, humane, unhurried. Clear sentences, zero jargon.",
    principles: [
      "Warm off-white paper with near-black ink; the accent is a single quiet blue.",
      "Thin dividers over heavy borders; whitespace organizes the page.",
      "Comfortable reading measure and tall line-height.",
      "Restraint everywhere — nothing competes with the content.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-ios",
    name: "iOS Clean",
    builtin: true,
    aesthetic: "native mobile — light, rounded, system-blue, airy",
    description:
      "Apple HIG feel: bright surfaces, grouped rounded cards, system blue, large bold titles, generous safe-area spacing.",
    colors: [
      { name: "surface", value: "#f2f2f7", role: "Grouped background" },
      { name: "surface-2", value: "#ffffff", role: "Card" },
      { name: "ink", value: "#1c1c1e", role: "Label" },
      { name: "ink-muted", value: "#8e8e93", role: "Secondary label" },
      { name: "accent", value: "#007aff", role: "Tint", usage: "buttons, links" },
      { name: "success", value: "#34c759", role: "Success" },
      { name: "line", value: "#d1d1d6", role: "Separator" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 40, weight: 700, lineHeight: 1.1, tracking: -1 },
      { role: "h1", size: 28, weight: 700, lineHeight: 1.2, tracking: -0.5 },
      { role: "h2", size: 20, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 17, weight: 400, lineHeight: 1.5 },
      { role: "caption", size: 13, weight: 400, lineHeight: 1.35 },
    ],
    spacing: [4, 8, 12, 16, 20, 32, 44],
    radii: [10, 14, 20, 999],
    voice: "Friendly, direct, plain-spoken. Verb-led button labels.",
    principles: [
      "Grouped rounded cards on a light grey background; white content tiles.",
      "System blue tint for every interactive element; ample touch spacing.",
      "Large bold titles, regular body; clear hierarchy through weight + size.",
      "Hairline separators; soft shadows only on floating elements.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-terminal",
    name: "Terminal Phosphor",
    builtin: true,
    aesthetic: "retro CRT — black screen, phosphor green, all-mono, scanline",
    description:
      "A green-screen terminal: pure black, phosphor green mono text, blocky cursors, subtle scanline glow, zero ornament.",
    colors: [
      { name: "bg", value: "#000000", role: "Screen" },
      { name: "surface", value: "#0a0f0a", role: "Panel" },
      { name: "accent", value: "#33ff66", role: "Phosphor green", usage: "text, cursor, accents" },
      { name: "accent-2", value: "#1aff8c", role: "Bright green" },
      { name: "ink", value: "#9dffb0", role: "Body text" },
      { name: "ink-muted", value: "#4a8a5a", role: "Dim text" },
      { name: "line", value: "rgba(51,255,102,0.20)", role: "Grid lines" },
    ],
    fonts: { display: "JetBrains Mono", body: "JetBrains Mono", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 56, weight: 700, lineHeight: 1.0, tracking: 0 },
      { role: "h1", size: 32, weight: 700, lineHeight: 1.1 },
      { role: "body", size: 15, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 12, weight: 500, lineHeight: 1.4, tracking: 1 },
    ],
    spacing: [4, 8, 16, 24, 32, 48],
    radii: [0, 2],
    voice: "Terse, technical, command-line. Lowercase, monospace, no fluff.",
    principles: [
      "Pure black screen; everything is phosphor green mono.",
      "Blocky cursors, ASCII rules, and bracketed labels as ornament.",
      "Subtle outer-glow on text + faint scanline texture for the CRT feel.",
      "Sharp corners; grids drawn with thin green lines.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-luxe",
    name: "Dark Luxe",
    builtin: true,
    aesthetic: "premium / editorial luxury — black + gold, serif display, restrained",
    description:
      "High-end fashion/spirits feel: near-black canvas, warm gold accent, a refined serif display, wide letter-spaced labels, lots of negative space.",
    colors: [
      { name: "bg", value: "#0c0b09", role: "Canvas" },
      { name: "surface", value: "#15130f", role: "Section" },
      { name: "accent", value: "#c9a14a", role: "Gold accent", usage: "rules, emphasis, CTAs" },
      { name: "ink", value: "#f3ede2", role: "Text" },
      { name: "ink-muted", value: "#9a8f7c", role: "Secondary" },
      { name: "line", value: "rgba(201,161,74,0.30)", role: "Gold hairline" },
    ],
    fonts: { display: "Playfair Display", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 84, weight: 600, lineHeight: 1.04, tracking: -1 },
      { role: "h1", size: 44, weight: 600, lineHeight: 1.12 },
      { role: "h2", size: 24, weight: 500, lineHeight: 1.3, tracking: 2 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.8 },
      { role: "caption", size: 12, weight: 500, lineHeight: 1.4, tracking: 3 },
    ],
    spacing: [8, 16, 24, 40, 64, 96, 140],
    radii: [0, 2, 4],
    voice: "Refined, sparse, confident. Few words, each one weighted.",
    principles: [
      "Near-black with a single warm gold; never more than one metal.",
      "Serif display against wide letter-spaced uppercase labels.",
      "Thin gold hairlines and rules; generous negative space.",
      "Slow, deliberate rhythm — luxury reads as restraint.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-swiss",
    name: "Swiss International",
    builtin: true,
    aesthetic: "Swiss / International Typographic — grid, Helvetica, red accent, white",
    description:
      "Mid-century Swiss style: rigorous grid, bold Helvetica-like sans, flat white, a single red accent, asymmetric balance, no decoration.",
    colors: [
      { name: "surface", value: "#ffffff", role: "Canvas" },
      { name: "surface-2", value: "#f0f0f0", role: "Block" },
      { name: "ink", value: "#111111", role: "Text & rules" },
      { name: "ink-muted", value: "#555555", role: "Secondary" },
      { name: "accent", value: "#e3000f", role: "Red accent", usage: "emphasis, markers" },
      { name: "line", value: "#111111", role: "Grid rules" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 72, weight: 700, lineHeight: 1.0, tracking: -2 },
      { role: "h1", size: 40, weight: 700, lineHeight: 1.05, tracking: -1 },
      { role: "h2", size: 22, weight: 700, lineHeight: 1.2 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.5 },
      { role: "caption", size: 12, weight: 600, lineHeight: 1.3, tracking: 0.5 },
    ],
    spacing: [8, 16, 24, 32, 48, 64],
    radii: [0],
    voice: "Objective, exact, declarative. Information over persuasion.",
    principles: [
      "Strict columnar grid; align everything, break it only on purpose.",
      "Flat white, black type, one red accent — no gradients or shadows.",
      "Bold sans in a few decisive sizes; strong size contrast.",
      "Asymmetric balance and generous margins.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-bauhaus",
    name: "Bauhaus",
    builtin: true,
    aesthetic: "Bauhaus — primary colors, geometric, playful-rigorous",
    description:
      "Primary red/blue/yellow on warm cream, bold geometric shapes (circles, triangles, bars), heavy sans, confident blocks of color.",
    colors: [
      { name: "surface", value: "#f4f1e8", role: "Cream canvas" },
      { name: "ink", value: "#1a1a1a", role: "Text & structure" },
      { name: "accent", value: "#e63946", role: "Bauhaus red" },
      { name: "accent-2", value: "#1d4ed8", role: "Bauhaus blue" },
      { name: "accent-3", value: "#f4b400", role: "Bauhaus yellow" },
      { name: "line", value: "#1a1a1a", role: "Borders" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 88, weight: 800, lineHeight: 0.98, tracking: -2 },
      { role: "h1", size: 44, weight: 700, lineHeight: 1.05 },
      { role: "h2", size: 24, weight: 700, lineHeight: 1.2 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.5 },
      { role: "caption", size: 12, weight: 700, lineHeight: 1.3, tracking: 1 },
    ],
    spacing: [8, 16, 24, 40, 64],
    radii: [0, 999],
    voice: "Bold, principled, a little playful. Form follows function.",
    principles: [
      "Primary red/blue/yellow on cream; flat blocks of pure color.",
      "Geometric primitives — circles, triangles, bars — as the design language.",
      "Heavy sans, big size jumps; circles and hard rectangles, nothing in between.",
      "Composition on a visible grid; color does the talking.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-nordic",
    name: "Nordic Calm",
    builtin: true,
    aesthetic: "Scandinavian — muted, calm, functional, light",
    description:
      "Quiet Scandinavian design: soft blue-grey neutrals, a muted slate accent, pale surfaces, lots of air, understated and functional.",
    colors: [
      { name: "surface", value: "#fbfcfd", role: "Canvas" },
      { name: "surface-2", value: "#eef2f5", role: "Alt section" },
      { name: "ink", value: "#2b3440", role: "Text" },
      { name: "ink-muted", value: "#6b7785", role: "Secondary" },
      { name: "accent", value: "#5b7c99", role: "Slate accent" },
      { name: "accent-2", value: "#a7c4bc", role: "Sage support" },
      { name: "line", value: "#dde4ea", role: "Borders" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 58, weight: 500, lineHeight: 1.1, tracking: -1 },
      { role: "h1", size: 34, weight: 600, lineHeight: 1.2 },
      { role: "h2", size: 21, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.7 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.5 },
    ],
    spacing: [8, 12, 16, 24, 40, 64, 96],
    radii: [4, 8, 14],
    voice: "Understated, practical, calm. Says only what's needed.",
    principles: [
      "Pale blue-grey neutrals; a single muted slate accent.",
      "Functional layouts, generous air, soft hairline borders.",
      "Light weights and calm rhythm; nothing shouts.",
      "Natural light, restrained imagery, honest materials.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-pastel",
    name: "Pastel Soft",
    builtin: true,
    aesthetic: "soft / friendly — pastel lavender & mint, rounded, gentle",
    description:
      "A gentle, approachable look: pastel lavender and mint on near-white, soft shadows, big rounded shapes, friendly rounded sans.",
    colors: [
      { name: "surface", value: "#fdfcff", role: "Canvas" },
      { name: "surface-2", value: "#f3effc", role: "Lavender tint" },
      { name: "ink", value: "#3a3450", role: "Text" },
      { name: "ink-muted", value: "#8b85a0", role: "Secondary" },
      { name: "accent", value: "#a78bfa", role: "Lavender accent" },
      { name: "accent-2", value: "#6ee7b7", role: "Mint support" },
      { name: "line", value: "#eae4f7", role: "Borders" },
    ],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 60, weight: 700, lineHeight: 1.08, tracking: -1 },
      { role: "h1", size: 34, weight: 600, lineHeight: 1.2 },
      { role: "h2", size: 21, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.65 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.5 },
    ],
    spacing: [8, 12, 16, 24, 32, 48, 72],
    radii: [12, 20, 28, 999],
    voice: "Warm, friendly, encouraging. Soft and reassuring.",
    principles: [
      "Pastel lavender + mint on near-white; low-saturation, gentle contrast.",
      "Big rounded corners and pill buttons; soft diffuse shadows.",
      "Plenty of padding; nothing sharp or heavy.",
      "Playful rounded illustrations and blobby shapes as accents.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-forest",
    name: "Forest Earth",
    builtin: true,
    aesthetic: "deep nature — forest green + cream, organic, grounded",
    description:
      "A grounded, natural dark theme: deep forest greens, warm cream text, a soft moss accent, organic shapes and a calm, earthy mood.",
    colors: [
      { name: "bg", value: "#10241b", role: "Deep forest" },
      { name: "surface", value: "#163026", role: "Section" },
      { name: "surface-2", value: "#1d3d30", role: "Raised" },
      { name: "accent", value: "#8fc9a0", role: "Moss accent" },
      { name: "accent-2", value: "#d9a86c", role: "Amber support" },
      { name: "ink", value: "#f0ead9", role: "Cream text" },
      { name: "ink-muted", value: "#a9b8a8", role: "Secondary" },
      { name: "line", value: "rgba(240,234,217,0.12)", role: "Hairline" },
    ],
    fonts: { display: "Playfair Display", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 70, weight: 600, lineHeight: 1.05, tracking: -1 },
      { role: "h1", size: 38, weight: 600, lineHeight: 1.15 },
      { role: "h2", size: 22, weight: 600, lineHeight: 1.3 },
      { role: "body", size: 17, weight: 400, lineHeight: 1.75 },
      { role: "caption", size: 13, weight: 500, lineHeight: 1.5 },
    ],
    spacing: [8, 16, 24, 40, 64, 96],
    radii: [6, 12, 20, 999],
    voice: "Grounded, warm, sincere. Calm and a little poetic.",
    principles: [
      "Deep forest greens with warm cream type; a soft moss accent.",
      "Organic curves and natural imagery; nothing clinical.",
      "Serif display for warmth against a clean sans body.",
      "Lift surfaces with slightly lighter greens, not heavy shadow.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-vaporwave",
    name: "Vaporwave Pastel",
    builtin: true,
    aesthetic: "retro pastel — pink & cyan dream, soft glow, 90s nostalgia",
    description:
      "Soft vaporwave: pastel pink and cyan over a twilight purple, glossy gradients, italic display, gentle glow — nostalgic and dreamy.",
    colors: [
      { name: "bg", value: "#2a1b46", role: "Twilight" },
      { name: "surface", value: "#3a2560", role: "Panel" },
      { name: "accent", value: "#ff9ed8", role: "Pastel pink" },
      { name: "accent-2", value: "#8be9fd", role: "Pastel cyan" },
      { name: "ink", value: "#fdf0ff", role: "Text" },
      { name: "ink-muted", value: "#c3a9e0", role: "Secondary" },
      { name: "line", value: "rgba(255,158,216,0.30)", role: "Glow line" },
    ],
    fonts: { display: "Playfair Display", body: "Inter", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 76, weight: 600, lineHeight: 1.02, tracking: -1 },
      { role: "h1", size: 40, weight: 600, lineHeight: 1.1 },
      { role: "body", size: 16, weight: 400, lineHeight: 1.6 },
      { role: "caption", size: 12, weight: 600, lineHeight: 1.3, tracking: 2 },
    ],
    spacing: [8, 12, 16, 24, 40, 64],
    radii: [8, 16, 24, 999],
    voice: "Dreamy, nostalgic, playful. Soft and a little surreal.",
    principles: [
      "Pastel pink + cyan over twilight purple; glossy soft gradients.",
      "Gentle outer glow on text and shapes; chrome/iridescent touches.",
      "Italic serif display against a clean sans body.",
      "Grids, gradients, and retro motifs as dreamy atmosphere.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "ds-builtin-newsprint",
    name: "Newsprint",
    builtin: true,
    aesthetic: "newspaper / print — serif, dense, black on off-white, rules",
    description:
      "Classic newsprint: warm off-white stock, black serif body, multi-column density, hairline rules and kickers, a single ink-red for emphasis.",
    colors: [
      { name: "surface", value: "#f7f4ec", role: "Newsprint stock" },
      { name: "surface-2", value: "#efe9dc", role: "Box" },
      { name: "ink", value: "#1a1714", role: "Body text" },
      { name: "ink-muted", value: "#5c554c", role: "Byline / caption" },
      { name: "accent", value: "#a4161a", role: "Ink red", usage: "kickers, emphasis" },
      { name: "line", value: "#2a251f", role: "Rules" },
    ],
    fonts: { display: "Playfair Display", body: "Georgia", mono: "JetBrains Mono" },
    typography: [
      { role: "display", size: 72, weight: 800, lineHeight: 1.02, tracking: -1 },
      { role: "h1", size: 40, weight: 700, lineHeight: 1.1 },
      { role: "h2", size: 22, weight: 700, lineHeight: 1.25 },
      { role: "body", size: 17, weight: 400, lineHeight: 1.55 },
      { role: "caption", size: 12, weight: 600, lineHeight: 1.3, tracking: 1 },
    ],
    spacing: [4, 8, 12, 16, 24, 40, 56],
    radii: [0],
    voice: "Authoritative, concise, factual. Headline-and-byline cadence.",
    principles: [
      "Warm off-white stock, black serif body, a single ink-red accent.",
      "Multi-column density with hairline rules and small-caps kickers.",
      "Big bold serif headlines over a tight body measure.",
      "Sharp corners; structure from rules and columns, not boxes.",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
];
