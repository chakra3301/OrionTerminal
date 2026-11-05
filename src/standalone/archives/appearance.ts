/**
 * Archives 47's look, set the EMP way: one highlight colour and one background
 * colour, picked on colour wheels, and Glass (panes frosted over the desktop) or
 * Solid. Both use EMP's flat, near-square layout; only the material differs. Every
 * surface, ink tier and line is derived from those two colours, so there is no
 * theme list. Stored in app_state "archives.appearance".
 */
import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAppState, setAppState } from "@/lib/db";
import { log } from "@/lib/log";
import { useThemeStore } from "@/store/themeStore";
import { isDark, isHex, luminance } from "./color";

/** Archives' neon green and the existing `--bg-2` token. */
export const DEFAULT_ACCENT = "#39ff88";
export const DEFAULT_BACKGROUND = "#0a1015";

export type Appearance = {
  accent: string;
  background: string;
  /** Glass: see-through panes with the macOS blur behind them. Off = Solid. */
  frosted: boolean;
  /** Glass only: how strongly the background colour tints the glass, 0..1. */
  tint: number;
};

export const DEFAULT_TINT = 0.22;

export const DEFAULT_APPEARANCE: Appearance = {
  accent: DEFAULT_ACCENT,
  background: DEFAULT_BACKGROUND,
  frosted: true,
  tint: DEFAULT_TINT,
};

/** Accepts whatever app_state returned and fills in defaults. */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hex = (v: unknown, d: string) => (typeof v === "string" && isHex(v) ? v.toLowerCase() : d);
  return {
    accent: hex(r.accent, DEFAULT_ACCENT),
    background: hex(r.background, DEFAULT_BACKGROUND),
    frosted: typeof r.frosted === "boolean" ? r.frosted : true,
    tint: typeof r.tint === "number" && Number.isFinite(r.tint) ? Math.min(1, Math.max(0, r.tint)) : DEFAULT_TINT,
  };
}

function rgbList(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * Glass alphas over the macOS blur, from the tint. The background colour only
 * tints the glass: the macOS material does the blur and the frosting, so the
 * desktop reads through as soft colour fields. The sidebar is a little clearer
 * than the main pane, and cards sit one small step up.
 */
export function glassAlphas(tint: number) {
  return { sidebar: tint * 0.75, surface: tint, raised: Math.min(1, tint + 0.1) };
}

/**
 * CSS variables for <html>. Ink tiers follow EMP (94/74/54/36%); surfaces are
 * the background mixed a little toward the ink, then made translucent when
 * frosted. `--bg-*` stay opaque so menus and popovers always read.
 */
export function appearanceVariables(a: Appearance): Record<string, string> {
  const dark = isDark(a.background);
  const f = glassAlphas(a.tint);
  const ink = dark ? "#f2f5f3" : "#1f2328";
  const inkRgb = rgbList(ink);
  const accentRgb = rgbList(a.accent);
  const mix = (inkPct: number) => `color-mix(in srgb, ${a.background} ${100 - inkPct}%, ${ink})`;
  const frost = (inkPct: number, alpha: number) =>
    a.frosted ? `color-mix(in srgb, ${mix(inkPct)} ${Math.round(alpha * 1000) / 10}%, transparent)` : mix(inkPct);
  const onAccent = luminance(a.accent) > 0.4 ? "#06090c" : "#ffffff";
  const vars: Record<string, string> = {
    "--a47-surface": frost(0, f.surface),
    "--a47-sidebar": frost(dark ? 3 : 3.5, f.sidebar),
    "--a47-raised": frost(dark ? 6 : 1.5, f.raised),
    "--a47-line": `rgba(${inkRgb}, ${dark ? 0.1 : 0.08})`,
    "--a47-line-strong": `rgba(${inkRgb}, ${dark ? 0.18 : 0.15})`,
    "--a47-hover": `rgba(${accentRgb}, 0.06)`,
    "--a47-selected": `rgba(${accentRgb}, ${dark ? 0.12 : 0.08})`,
    "--a47-accent": a.accent,
    "--t-primary": `rgba(${inkRgb}, 0.94)`,
    "--t-secondary": `rgba(${inkRgb}, 0.74)`,
    "--t-tertiary": `rgba(${inkRgb}, 0.54)`,
    "--t-faint": `rgba(${inkRgb}, 0.36)`,
    "--t-on-accent": onAccent,
    "--glass-bg": frost(dark ? 6 : 1.5, f.raised),
    "--glass-bg-strong": frost(dark ? 6 : 1.5, f.raised),
    "--glass-bg-deep": mix(0),
    "--glass-border": `rgba(${inkRgb}, ${dark ? 0.1 : 0.08})`,
    "--glass-border-bright": `rgba(${inkRgb}, ${dark ? 0.18 : 0.15})`,
    "--glass-highlight": `rgba(${inkRgb}, 0.04)`,
    // Glass edges: a thin light rim and a faint top highlight on cards (as in the reference).
    "--a47-rim": a.frosted ? `rgba(255, 255, 255, ${dark ? 0.12 : 0.45})` : `rgba(${inkRgb}, ${dark ? 0.1 : 0.08})`,
    "--a47-sheen": a.frosted ? `inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.08 : 0.5})` : "none",
    "--shadow-glow-green": "0 0 0 transparent",
    "--shadow-glow-cyan": "0 0 0 transparent",
    "--shadow-glow-magenta": "0 0 0 transparent",
  };
  // EMP's shapes and type in both Glass and Solid.
  Object.assign(vars, {
    "--r-sm": "2px",
    "--r-md": "3px",
    "--r-lg": "5px",
    "--r-xl": "5px",
    "--f-display": "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
  });
  [0, 3, 6, 10].forEach((pct, i) => {
    vars[`--bg-${i}`] = mix(pct);
    vars[`--bg-${i}-solid`] = mix(pct);
  });
  // One accent, as in EMP: every app-identity hue Archives uses becomes the highlight.
  for (const key of ["green", "cyan", "violet"]) {
    vars[`--neon-${key}`] = a.accent;
    vars[`--neon-${key}-rgb`] = accentRgb;
  }
  for (const key of ["--light-accent", "--xd-accent", "--repolens-green"]) vars[key] = a.accent;
  for (const key of ["--light-accent-rgb", "--xd-accent-rgb", "--repolens-green-rgb"]) vars[key] = accentRgb;
  return vars;
}

let applied: string[] = [];

/** Writes the variables to <html>, picks the light or dark base, and matches the native window. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  const dark = isDark(a.background);
  // Shared components (the note editor, effects) read light/dark from the theme
  // store, so the base theme follows the background's tone.
  useThemeStore.getState().hydrate(dark ? "minimal" : "ivory-keep");
  for (const key of applied) root.style.removeProperty(key);
  const vars = appearanceVariables(a);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  applied = Object.keys(vars);
  root.dataset.a47Frosted = a.frosted ? "on" : "off";
  void getCurrentWindow()
    .setTheme(dark ? "dark" : "light")
    .catch((e) => log.warn("window theme failed", e));
}

type AppearanceState = Appearance & {
  hydrate: (raw: unknown) => void;
  /** `persist: false` while a wheel is being dragged (preview only). */
  update: (patch: Partial<Appearance>, opts?: { persist?: boolean }) => void;
  reset: (key: "accent" | "background") => void;
};

export const useAppearance = create<AppearanceState>((set, get) => {
  const commit = (next: Appearance, persist: boolean) => {
    set(next);
    applyAppearance(next);
    if (persist) {
      void setAppState("archives.appearance", next).catch((e) => log.warn("appearance save failed", e));
    }
  };
  const current = (): Appearance => ({
    accent: get().accent,
    background: get().background,
    frosted: get().frosted,
    tint: get().tint,
  });
  return {
    ...DEFAULT_APPEARANCE,
    hydrate: (raw) => commit(normalizeAppearance(raw), false),
    update: (patch, opts) => commit(normalizeAppearance({ ...current(), ...patch }), opts?.persist !== false),
    reset: (key) => commit({ ...current(), [key]: DEFAULT_APPEARANCE[key] }, true),
  };
});

export async function loadAppearance(): Promise<void> {
  const raw = await getAppState<unknown>("archives.appearance").catch(() => null);
  useAppearance.getState().hydrate(raw);
}
