// Deterministic design-token engine (Lever 1).
//
// A brand collapses to a tiny Seed (primary, neutral, mode, semantic colors,
// a radius/spacing/type base). `deriveTokens` then algorithmically generates a
// whole coherent system: 10-step ramps (primary/neutral/success/warning/error/
// info), semantic role tokens (bg layers, text levels, borders, primary states)
// chosen per light/dark mode, plus modular type/spacing/radii scales. Nothing
// is hand-typed downstream — every value traces back to the seed through math,
// which is why the output stays internally consistent (open-design's #1 quality
// lever). `seedFromDesignSystem` recovers a seed from an existing brand so all
// the built-in systems gain coherent ramps without re-authoring.

import type { DesignSystem } from "./designSystem";
import { generateRamp, luminance, readableInk } from "./colorRamp";

export type TokenMode = "light" | "dark";
export type Ramp = string[];

export type Seed = {
  primary: string;
  neutral: string;
  mode: TokenMode;
  bg: string;
  ink: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Base corner radius px (0 = sharp). */
  radius: number;
  /** Base spacing grid px. */
  spacingUnit: number;
  /** Body font size px. */
  fontBase: number;
  /** Modular type-scale ratio. */
  scaleRatio: number;
};

export type DerivedTokens = {
  mode: TokenMode;
  ramps: {
    primary: Ramp;
    neutral: Ramp;
    success: Ramp;
    warning: Ramp;
    error: Ramp;
    info: Ramp;
  };
  semantic: {
    bgBase: string;
    bgElevated: string;
    bgRaised: string;
    text: string;
    textMuted: string;
    textFaint: string;
    border: string;
    borderStrong: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    onPrimary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  radii: number[];
  spacing: number[];
  type: { role: string; size: number; weight: number; lineHeight: number }[];
};

const DEFAULTS = {
  success: "#52c41a",
  warning: "#faad14",
  error: "#f5222d",
  info: "#1677ff",
  primary: "#4096ff",
  neutral: "#8c8c8c",
};

function isHex(v: string | undefined): v is string {
  return !!v && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());
}

/** Derive the full token system from a seed. Pure. */
export function deriveTokens(seed: Seed): DerivedTokens {
  const mode = seed.mode;
  const opts = { mode, backgroundColor: seed.bg } as const;
  const primary = generateRamp(seed.primary, opts);
  const neutral = generateRamp(seed.neutral, opts);
  const success = generateRamp(seed.success, opts);
  const warning = generateRamp(seed.warning, opts);
  const error = generateRamp(seed.error, opts);
  const info = generateRamp(seed.info, opts);

  // In a light ramp higher index = darker; in a dark ramp higher index =
  // brighter (darkColorMap). So the elevation + state mappings flip by mode.
  const dark = mode === "dark";
  const primaryBase = primary[5]!;
  const semantic = {
    bgBase: seed.bg,
    bgElevated: dark ? neutral[0]! : neutral[0]!,
    bgRaised: dark ? neutral[1]! : neutral[1]!,
    text: seed.ink,
    textMuted: neutral[6]!,
    textFaint: neutral[4]!,
    border: neutral[2]!,
    borderStrong: neutral[3]!,
    primary: primaryBase,
    primaryHover: dark ? primary[6]! : primary[4]!,
    primaryActive: dark ? primary[4]! : primary[6]!,
    onPrimary: readableInk(primaryBase),
    success: success[5]!,
    warning: warning[5]!,
    error: error[5]!,
    info: info[5]!,
  };

  const u = seed.spacingUnit;
  const spacing = [
    Math.round(u / 2),
    u,
    Math.round(u * 1.5),
    u * 2,
    u * 3,
    u * 4,
    u * 6,
    u * 8,
  ];

  const r = seed.radius;
  const radii =
    r <= 0
      ? [0]
      : [Math.max(2, Math.round(r / 2)), r, Math.round(r * 1.5), r * 2];

  const f = seed.fontBase;
  const k = seed.scaleRatio;
  const sz = (p: number) => Math.round(f * k ** p);
  const type = [
    { role: "display", size: sz(4), weight: 600, lineHeight: 1.05 },
    { role: "h1", size: sz(3), weight: 600, lineHeight: 1.12 },
    { role: "h2", size: sz(2), weight: 600, lineHeight: 1.2 },
    { role: "h3", size: sz(1), weight: 600, lineHeight: 1.3 },
    { role: "body", size: f, weight: 400, lineHeight: 1.6 },
    { role: "caption", size: sz(-1), weight: 500, lineHeight: 1.4 },
  ];

  return {
    mode,
    ramps: { primary, neutral, success, warning, error, info },
    semantic,
    radii,
    spacing,
    type,
  };
}

function find(ds: DesignSystem, re: RegExp): string | undefined {
  const hit = ds.colors.find(
    (c) => re.test(c.name) || (c.role ? re.test(c.role) : false),
  );
  return hit && isHex(hit.value) ? hit.value : undefined;
}

/** Most-saturated, non-near-grey color as a primary fallback. */
function mostSaturated(ds: DesignSystem): string | undefined {
  let best: { hex: string; sat: number } | null = null;
  for (const c of ds.colors) {
    if (!isHex(c.value)) continue;
    const l = luminance(c.value);
    if (l > 0.92 || l < 0.04) continue; // skip near-white / near-black
    // crude saturation proxy: spread of channels
    const hex = c.value.replace(/^#/, "");
    const n = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
    const v = parseInt(n, 16);
    const rr = (v >> 16) & 255;
    const gg = (v >> 8) & 255;
    const bb = v & 255;
    const sat = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
    if (!best || sat > best.sat) best = { hex: c.value, sat };
  }
  return best?.hex;
}

/** Recover a Seed from an existing design system using name/role heuristics +
 * luminance. Always returns a usable seed (sane defaults fill any gap). */
export function seedFromDesignSystem(ds: DesignSystem): Seed {
  const primary =
    find(ds, /accent|primary|brand|action/i) ?? mostSaturated(ds) ?? DEFAULTS.primary;
  const bgCand = find(ds, /\bbg\b|surface|background|canvas/i);
  const inkCand = find(ds, /\bink\b|text|foreground|heading/i);
  // Mode: dark when the background reads dark (or, lacking a bg, when the ink
  // is light).
  const bg = bgCand ?? (inkCand && luminance(inkCand) > 0.6 ? "#0a0a0a" : "#ffffff");
  const mode: TokenMode = luminance(bg) < 0.4 ? "dark" : "light";
  const ink = inkCand ?? readableInk(bg);
  const neutral = DEFAULTS.neutral;

  const fontBase =
    ds.typography.find((t) => /body/i.test(t.role))?.size ?? 16;
  // Ratio inferred from h1/body when both exist, clamped to a tasteful band.
  const h1 = ds.typography.find((t) => /^h1$/i.test(t.role))?.size;
  const ratio =
    h1 && fontBase > 0
      ? Math.min(1.6, Math.max(1.125, (h1 / fontBase) ** (1 / 3)))
      : 1.25;
  const radius = ds.radii?.length
    ? ds.radii[Math.min(1, ds.radii.length - 1)]!
    : 8;
  const spacingUnit = ds.spacing?.includes(8)
    ? 8
    : ds.spacing?.find((s) => s >= 4) ?? 8;

  return {
    primary,
    neutral,
    mode,
    bg,
    ink,
    success: find(ds, /success|online|positive/i) ?? DEFAULTS.success,
    warning: find(ds, /warn|caution/i) ?? DEFAULTS.warning,
    error: find(ds, /error|danger|negative/i) ?? DEFAULTS.error,
    info: find(ds, /info/i) ?? primary,
    radius,
    spacingUnit,
    fontBase,
    scaleRatio: ratio,
  };
}

/** `:root{}` CSS custom properties for the derived system. */
export function tokensToCssVars(t: DerivedTokens): string {
  const lines: string[] = [":root {"];
  const ramp = (name: string, r: Ramp) =>
    r.forEach((hex, i) => lines.push(`  --${name}-${i + 1}: ${hex};`));
  ramp("primary", t.ramps.primary);
  ramp("neutral", t.ramps.neutral);
  ramp("success", t.ramps.success);
  ramp("warning", t.ramps.warning);
  ramp("error", t.ramps.error);
  ramp("info", t.ramps.info);
  for (const [k, v] of Object.entries(t.semantic)) {
    lines.push(`  --${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v};`);
  }
  t.spacing.forEach((s, i) => lines.push(`  --space-${i + 1}: ${s}px;`));
  t.radii.forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r}px;`));
  t.type.forEach((ty) => lines.push(`  --font-${ty.role}: ${ty.size}px;`));
  lines.push("}");
  return lines.join("\n");
}

/** Compact prompt block describing the derived system — appended to the brand
 * contract so the model designs from coherent ramps + semantic roles instead
 * of inventing shades. */
export function derivedTokensToPrompt(t: DerivedTokens): string {
  const s = t.semantic;
  const line = (label: string, r: Ramp) => `- ${label}: ${r.join(" ")}`;
  return [
    `## Derived token system (${t.mode} mode) — USE THESE EXACT VALUES`,
    `Color ramps (1 = lightest tint … 10 = deepest shade; step 6 is the base):`,
    line("primary", t.ramps.primary),
    line("neutral", t.ramps.neutral),
    line("success", t.ramps.success),
    line("warning", t.ramps.warning),
    line("error", t.ramps.error),
    `Semantic roles (map UI parts to these, don't free-pick from the ramps):`,
    `- backgrounds: base ${s.bgBase} · elevated ${s.bgElevated} · raised ${s.bgRaised}`,
    `- text: primary ${s.text} · muted ${s.textMuted} · faint ${s.textFaint}`,
    `- borders: hairline ${s.border} · strong ${s.borderStrong}`,
    `- primary action: ${s.primary} · hover ${s.primaryHover} · active ${s.primaryActive} · text-on-primary ${s.onPrimary}`,
    `- status: success ${s.success} · warning ${s.warning} · error ${s.error} · info ${s.info}`,
    `Spacing scale (px, use these steps only): ${t.spacing.join(", ")}`,
    `Corner radii (px): ${t.radii.join(", ")}`,
    `Type scale (px): ${t.type.map((ty) => `${ty.role} ${ty.size}/${ty.weight}`).join(" · ")}`,
  ].join("\n");
}

/** One-call convenience: derive a system from a brand and describe it. */
export function brandTokensPrompt(ds: DesignSystem): string {
  return derivedTokensToPrompt(deriveTokens(seedFromDesignSystem(ds)));
}
