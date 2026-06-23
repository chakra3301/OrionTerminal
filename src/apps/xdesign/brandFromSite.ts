// URL → brand (no-LLM extraction).
//
// Given a fetched page's HTML, recover a brand seed (name, colors, fonts), then
// run the deterministic token engine (Lever 1) to produce a COHERENT design
// system — the site supplies the seed, the engine makes it consistent. Pure;
// the fetch is a thin Rust side-effect (xdesign_web.rs).

import type { DesignSystem, DSColor } from "./designSystem";
import { luminance, readableInk } from "./colorRamp";
import { deriveTokens, type Seed } from "./tokenEngine";

const GENERIC_FONTS = new Set([
  "sans-serif", "serif", "monospace", "system-ui", "-apple-system",
  "blinkmacsystemfont", "ui-sans-serif", "ui-serif", "ui-monospace",
  "inherit", "initial", "unset", "cursive", "fantasy", "emoji", "math",
]);

/** Normalize any CSS color we can to `#rrggbb`; null when unparseable or has
 * alpha < 0.5 (too faint to be a brand color). */
export function toHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const c = m[1]!;
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`;
  }
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return `#${m[1]}`;
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4];
    if (a != null) {
      const av = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
      if (Number.isFinite(av) && av < 0.5) return null;
    }
    const to = (v: string) => {
      const n = Math.round(parseFloat(v));
      return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    };
    return `#${to(m[1]!)}${to(m[2]!)}${to(m[3]!)}`;
  }
  return null;
}

/** Crude saturation proxy (channel spread, 0..255). */
function chroma(hex: string): number {
  const n = hex.replace(/^#/, "");
  const v = parseInt(n, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** All colors in the HTML/CSS, deduped, ranked by occurrence (desc). */
export function extractColorsRanked(html: string): string[] {
  const counts = new Map<string, number>();
  const re = /#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hex = toHex(m[0]);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

/** Background color from `background` / `background-color` declarations — a far
 * stronger bg signal than raw frequency (text colors are frequent too). Picks
 * the most-declared one. */
export function extractBackgroundColor(html: string): string | null {
  const counts = new Map<string, number>();
  const re = /background(?:-color)?\s*:\s*([^;"}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tok = m[1]!.match(/#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/);
    if (!tok) continue;
    const hex = toHex(tok[0]);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

export function extractThemeColor(html: string): string | null {
  const m = html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);
  return m ? toHex(m[1]!) : null;
}

export function extractSiteName(html: string, url: string): string {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]?.trim()) return clean(og[1]);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1]?.trim()) {
    // Drop trailing " | Tagline" / " - Tagline" / " — Tagline".
    return clean(title[1]!.split(/\s[|\u2013\u2014-]\s/)[0]!);
  }
  return hostOf(url);
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 60);
}

export function hostOf(url: string): string {
  const h = url
    .replace(/^https?:\/\//, "")
    .split("/")[0]!
    .replace(/^www\./, "");
  const base = h.split(".")[0] ?? h;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** First non-generic font family from Google Fonts links + font-family rules. */
export function extractFonts(html: string): { display?: string; body?: string } {
  const fams: string[] = [];
  const gf = /fonts\.googleapis\.com\/css2?\?([^"']+)/gi;
  let m: RegExpExecArray | null;
  while ((m = gf.exec(html)) !== null) {
    for (const fm of m[1]!.matchAll(/family=([^&:]+)/gi)) {
      fams.push(decodeURIComponent(fm[1]!.replace(/\+/g, " ")));
    }
  }
  const ff = /font-family\s*:\s*([^;"}]+)/gi;
  while ((m = ff.exec(html)) !== null) {
    const first = m[1]!.split(",")[0]!.replace(/["']/g, "").trim();
    if (first && !GENERIC_FONTS.has(first.toLowerCase())) fams.push(first);
  }
  const uniq = [...new Set(fams.map((f) => f.trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  return { display: uniq[0], body: uniq[1] ?? uniq[0] };
}

/** Pick a vivid primary: theme-color when it's colorful, else the most
 * saturated reasonably-frequent color (skipping near-white/black/grey). */
function pickPrimary(theme: string | null, ranked: string[]): string {
  if (theme && chroma(theme) > 24) return theme;
  const top = ranked.slice(0, 40);
  let best: { hex: string; c: number } | null = null;
  for (const hex of top) {
    const l = luminance(hex);
    if (l > 0.92 || l < 0.04) continue;
    const c = chroma(hex);
    if (c < 30) continue;
    if (!best || c > best.c) best = { hex, c };
  }
  return best?.hex ?? theme ?? "#4096ff";
}

/** Recover a seed from a fetched page. Always returns a usable seed. */
export function seedFromSite(html: string): Seed {
  const ranked = extractColorsRanked(html);
  const theme = extractThemeColor(html);
  const primary = pickPrimary(theme, ranked);

  // Background: an explicit background declaration is the strongest signal;
  // else the most frequent extreme (near-white/near-black); else white.
  const bg =
    extractBackgroundColor(html) ??
    ranked.find((h) => luminance(h) > 0.85 || luminance(h) < 0.12) ??
    "#ffffff";
  const mode = luminance(bg) < 0.4 ? "dark" : "light";
  const ink =
    ranked.find((h) => (mode === "dark" ? luminance(h) > 0.85 : luminance(h) < 0.2)) ??
    readableInk(bg);

  return {
    primary,
    neutral: "#8c8c8c",
    mode,
    bg,
    ink,
    success: "#52c41a",
    warning: "#faad14",
    error: "#f5222d",
    info: primary,
    radius: 10,
    spacingUnit: 8,
    fontBase: 16,
    scaleRatio: 1.25,
  };
}

/** Build a coherent design system from a fetched page: seed → token engine →
 * a clean named-token palette + type/spacing/radii. */
export function brandFromSite(html: string, url: string, id: string): DesignSystem {
  const seed = seedFromSite(html);
  const t = deriveTokens(seed);
  const fonts = extractFonts(html);
  const now = Date.now();

  const colors: DSColor[] = [
    { name: "bg", value: t.semantic.bgBase, role: "Background" },
    { name: "surface", value: t.semantic.bgElevated, role: "Card / section" },
    { name: "surface-2", value: t.semantic.bgRaised, role: "Raised surface" },
    { name: "ink", value: t.semantic.text, role: "Primary text" },
    { name: "ink-muted", value: t.semantic.textMuted, role: "Secondary text" },
    { name: "line", value: t.semantic.border, role: "Hairline borders" },
    { name: "accent", value: seed.primary, role: "Primary action", usage: "CTAs, links, focus" },
    { name: "accent-hover", value: t.semantic.primaryHover, role: "Primary hover" },
    { name: "success", value: t.semantic.success, role: "Success" },
    { name: "error", value: t.semantic.error, role: "Error" },
  ];

  return {
    id,
    name: extractSiteName(html, url),
    builtin: false,
    aesthetic: `Extracted from ${hostOf(url)} — ${seed.mode} surface, ${
      chroma(seed.primary) > 60 ? "vivid" : "restrained"
    } accent`,
    description: `Brand derived from ${hostOf(url)}: a ${seed.mode}-mode system built around its primary color and type, regularized through the token engine.`,
    colors,
    fonts: {
      display: fonts.display ?? "Space Grotesk",
      body: fonts.body ?? "Space Grotesk",
      mono: "JetBrains Mono",
    },
    typography: t.type.map((ty) => ({
      role: ty.role,
      size: ty.size,
      weight: ty.weight,
      lineHeight: ty.lineHeight,
    })),
    spacing: t.spacing,
    radii: t.radii,
    voice: "",
    principles: [],
    createdAt: now,
    updatedAt: now,
  };
}
