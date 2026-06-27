import { create } from "zustand";
import { setAppState } from "@/lib/db";

/** Named visual themes. Each is a full set of design-token overrides applied
 * via `data-theme` on <html> (see styles/themes.css). All are dark-base for
 * now, so we keep the `.dark` class on too for any dark-scoped styling. */
export type ThemeName = "neon" | "liquid" | "minimal" | "modern" | "bmw-m";

export const THEMES: { id: ThemeName; label: string; blurb: string }[] = [
  { id: "neon", label: "Neon", blurb: "Neo-Tokyo glow — the original." },
  { id: "liquid", label: "Liquid", blurb: "Hyperliquid frosted glass — heavy blur, icy specular edges." },
  { id: "minimal", label: "Minimal", blurb: "Calm monochrome, no glow, flatter." },
  { id: "modern", label: "Modern", blurb: "Refined slate with soft accents." },
  { id: "bmw-m", label: "BMW M", blurb: "Motorsport black — M tricolor, zero radius." },
];

const KNOWN = new Set<ThemeName>(THEMES.map((t) => t.id));

/** Map any stored value (incl. legacy "dark"/"light") to a known theme. */
function normalize(v: string | null | undefined): ThemeName {
  return v && KNOWN.has(v as ThemeName) ? (v as ThemeName) : "neon";
}

function applyToDOM(theme: ThemeName) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.add("dark");
}

function applyGlassToDOM(reduce: boolean) {
  document.documentElement.classList.toggle("ot-reduce-glass", reduce);
}

type ThemeState = {
  theme: ThemeName;
  /** "Reduce transparency" — kills all backdrop blurs (the biggest idle GPU
   * cost). The OS-level accessibility preference applies independently via
   * a media query; this is the in-app override. */
  reduceGlass: boolean;
  set: (theme: ThemeName) => void;
  setReduceGlass: (reduce: boolean) => void;
  /** Cycle to the next theme — backs the "Cycle Theme" command. */
  toggle: () => void;
  hydrate: (value: string | null | undefined) => void;
  hydrateGlass: (value: boolean | null | undefined) => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "neon",
  reduceGlass: false,
  set: (theme) => {
    set({ theme });
    applyToDOM(theme);
    void setAppState("theme", theme);
  },
  setReduceGlass: (reduce) => {
    set({ reduceGlass: reduce });
    applyGlassToDOM(reduce);
    void setAppState("reduce_glass", reduce);
  },
  toggle: () => {
    const order = THEMES.map((t) => t.id);
    const next = order[(order.indexOf(get().theme) + 1) % order.length]!;
    get().set(next);
  },
  hydrate: (value) => {
    const theme = normalize(value);
    set({ theme });
    applyToDOM(theme);
  },
  hydrateGlass: (value) => {
    const reduce = value === true;
    set({ reduceGlass: reduce });
    applyGlassToDOM(reduce);
  },
}));
