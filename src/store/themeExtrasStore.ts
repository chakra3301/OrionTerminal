import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { log } from "@/lib/log";
import { allThemes, type ThemeName } from "./themeStore";

export const BORDER_STYLES = ["default", "beam", "metal"] as const;
export const BEAM_SIZES = ["md", "sm", "line", "pulse-inner", "pulse-outside"] as const;
export const BEAM_PALETTES = ["colorful", "mono", "ocean", "sunset"] as const;
export const METAL_PRESETS = ["chromatic", "silver", "gold"] as const;

export type ThemeExtras = {
  border: typeof BORDER_STYLES[number];
  beamSize: typeof BEAM_SIZES[number];
  beamPalette: typeof BEAM_PALETTES[number];
  metalPreset: typeof METAL_PRESETS[number];
  strength: number;
  animate: boolean;
};
export const DEFAULT_THEME_EXTRAS: Readonly<ThemeExtras> = {
  border: "default", beamSize: "md", beamPalette: "colorful", metalPreset: "chromatic", strength: 0.7, animate: true,
};
type SavedExtras = { version: 1; themes: Partial<Record<ThemeName, ThemeExtras>> };
const inOrder = serialQueue();
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fallback;
}
function normalize(value: unknown): ThemeExtras {
  const v = object(value) ? value : {};
  return {
    border: choice(v.border, BORDER_STYLES, "default"),
    beamSize: choice(v.beamSize, BEAM_SIZES, "md"),
    beamPalette: choice(v.beamPalette, BEAM_PALETTES, "colorful"),
    metalPreset: choice(v.metalPreset, METAL_PRESETS, "chromatic"),
    strength: typeof v.strength === "number" && Number.isFinite(v.strength) ? Math.max(0, Math.min(1, v.strength)) : 0.7,
    animate: typeof v.animate === "boolean" ? v.animate : true,
  };
}

export const useThemeExtras = create<{
  themes: SavedExtras["themes"];
  saveError: string | null;
  update: (theme: ThemeName, patch: Partial<ThemeExtras>) => void;
  reset: (theme: ThemeName) => void;
  hydrate: (value: unknown) => void;
}>((set, get) => {
  let revision = 0;
  let metadata: Record<string, unknown> = {};
  let storedThemes: Record<string, unknown> = {};
  let blocked = true;
  const loadError = "Saved finishes couldn't be loaded. Changes are temporary; reload before saving. Your saved preferences have not been overwritten.";
  const persist = () => {
    if (blocked) { set({ saveError: loadError }); return; }
    const current = ++revision;
    const snapshot = { ...metadata, version: 1, themes: { ...storedThemes } };
    void inOrder(() => setAppState("theme_extras", snapshot)).then(() => {
      if (current === revision) set({ saveError: null });
    }).catch((error) => {
      log.warn("theme extras save failed", error);
      if (current === revision) set({ saveError: "These extras are visible now but weren't saved. Change a setting to retry." });
    });
  };
  return {
    themes: {}, saveError: null,
    update: (theme, patch) => {
      if (!allThemes().some(t => t.id === theme)) { set({ saveError: "Save this theme before customizing its finish." }); return; }
      const settings = normalize({ ...DEFAULT_THEME_EXTRAS, ...get().themes[theme], ...patch });
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(DEFAULT_THEME_EXTRAS) as (keyof ThemeExtras)[]) {
        if (Object.hasOwn(patch, key)) changed[key] = settings[key];
      }
      storedThemes = { ...storedThemes, [theme]: { ...(object(storedThemes[theme]) ? storedThemes[theme] : {}), ...changed } };
      set({ themes: { ...get().themes, [theme]: settings } }); persist();
    },
    reset: (theme) => {
      if (!allThemes().some(t => t.id === theme)) { set({ saveError: "Save this theme before customizing its finish." }); return; }
      const themes = { ...get().themes }; delete themes[theme];
      const retained = { ...(object(storedThemes[theme]) ? storedThemes[theme] : {}) };
      for (const key of Object.keys(DEFAULT_THEME_EXTRAS)) delete retained[key];
      storedThemes = { ...storedThemes };
      if (Object.keys(retained).length) storedThemes[theme] = retained;
      else delete storedThemes[theme];
      set({ themes }); persist();
    },
    hydrate: (value) => {
      ++revision;
      if (value === null) {
        metadata = {}; storedThemes = {}; blocked = false;
        set({ themes: {}, saveError: null }); return;
      }
      if (!object(value) || value.version !== 1 || !object(value.themes)) {
        blocked = true; set({ saveError: loadError }); return;
      }
      const rawThemes = value.themes;
      if (allThemes().some(({ id }) => Object.hasOwn(rawThemes, id) && !object(rawThemes[id]))) {
        blocked = true; set({ saveError: loadError }); return;
      }
      blocked = false; metadata = { ...value }; storedThemes = { ...rawThemes };
      const themes: SavedExtras["themes"] = {};
      for (const { id } of allThemes()) if (object(value.themes[id])) themes[id] = normalize(value.themes[id]);
      set({ themes, saveError: null });
    },
  };
});
