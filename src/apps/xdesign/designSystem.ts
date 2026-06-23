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
 * adhere to. Kept terse — it's prepended to generation prompts every turn. */
export function designSystemToPrompt(ds: DesignSystem): string {
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
];
