import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { toast } from "@/store/toastStore";
import { MAX_CUSTOM_THEMES, themeVariables, validateCustomTheme, type CustomTheme, type CustomThemeId } from "@/features/settings/themeDesign";

const saveInOrder = serialQueue();
function savePreference(key: "theme" | "reduce_glass", value: string | boolean) {
  void saveInOrder(() => setAppState(key, value)).catch(() => {
    toast.error("Appearance preference wasn't saved", { body: "Your preview is still active. Select it again to retry saving." });
  });
}
export type LightThemeName = "ivory-keep";
export type BuiltinThemeName = "liquid" | "minimal" | "bmw-m" | LightThemeName;
export type ThemeName = BuiltinThemeName | CustomThemeId;
export const LIGHT_THEMES: { id: LightThemeName; label: string; blurb: string }[] = [
  { id: "ivory-keep", label: "Ivory Keep", blurb: "Warm ivory with soft graphite and muted gold." },
];
export const THEMES: { id: BuiltinThemeName; label: string; blurb: string }[] = [
  { id: "liquid", label: "Liquid", blurb: "Hyperliquid frosted glass — heavy blur, icy specular edges." },
  { id: "minimal", label: "Minimal", blurb: "Calm monochrome, no glow, flatter." },
  { id: "bmw-m", label: "BMW M", blurb: "Motorsport black — M tricolor, zero radius." },
  ...LIGHT_THEMES,
];
const KNOWN = new Set<string>(THEMES.map(t => t.id));
export function customThemeFor(id: ThemeName): CustomTheme | undefined {
  const s = useThemeStore.getState();
  return s.previewTheme?.id === id ? s.previewTheme : s.customThemes.find(t => t.id === id);
}
export const isLightTheme = (theme: ThemeName): boolean => theme === "ivory-keep" || customThemeFor(theme)?.mode === "light";
export const allThemes = () => [...THEMES, ...useThemeStore.getState().customThemes.map(t => ({ id: t.id, label: t.name, blurb: t.description }))];
function normalize(v: string | null | undefined): ThemeName {
  if (v && ["light", "porcelain", "botanical", "rosewater", "glacier"].includes(v)) return "ivory-keep";
  return v && (KNOWN.has(v) || useThemeStore.getState().customThemes.some(t => t.id === v)) ? v as ThemeName : "liquid";
}
let appliedTokens: string[] = [];
function applyToDOM(theme: ThemeName, custom = customThemeFor(theme)) {
  const root = document.documentElement;
  for (const key of appliedTokens) root.style.removeProperty(key);
  appliedTokens = [];
  root.dataset.theme = theme;
  const light = custom ? custom.mode === "light" : theme === "ivory-keep";
  root.dataset.colorMode = light ? "light" : "dark";
  root.classList.toggle("dark", !light);
  root.style.colorScheme = light ? "light" : "dark";
  if (custom) {
    root.dataset.customSurface = custom.finish;
    const vars = themeVariables(custom);
    appliedTokens = Object.keys(vars);
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  } else delete root.dataset.customSurface;
}
function applyGlassToDOM(reduce: boolean) {
  document.documentElement.classList.toggle("ot-reduce-glass", reduce);
}
type ThemeState = {
  theme: ThemeName;
  selectionRevision: number;
  reduceGlass: boolean;
  customThemes: CustomTheme[];
  customLoadError: string | null;
  customSaving: boolean;
  previewTheme: CustomTheme | null;
  previewPrevious: ThemeName | null;
  set: (theme: ThemeName) => void;
  setReduceGlass: (reduce: boolean) => void;
  toggle: () => void;
  hydrate: (value: string | null | undefined) => void;
  hydrateGlass: (value: boolean | null | undefined) => void;
  hydrateCustom: (value: unknown) => void;
  saveCustom: (theme: CustomTheme) => Promise<void>;
  removeCustom: (id: CustomThemeId) => Promise<void>;
  preview: (theme: CustomTheme) => void;
  cancelPreview: (id: CustomThemeId) => void;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const useThemeStore = create<ThemeState>((set, get) => {
  let metadata: Record<string, unknown> = {};
  let rawThemes: Record<string, unknown>[] = [];
  let writable = false;
  const persistCustom = async (themes: CustomTheme[]) => {
    if (!writable) throw new Error("Custom themes couldn't be loaded. Reload before saving; stored themes have not been overwritten.");
    if (get().customSaving) throw new Error("A theme save is already in progress.");
    const raw = themes.map(t => ({ ...rawThemes.find(old => old.id === t.id), ...t }));
    set({ customSaving: true });
    try {
      await saveInOrder(() => setAppState("custom_themes", { ...metadata, version: 1, themes: raw }));
      rawThemes = raw;
      set({ customThemes: themes });
    } finally { set({ customSaving: false }); }
  };
  return {
    theme: "liquid", selectionRevision: 0, reduceGlass: false, customThemes: [], customLoadError: null, customSaving: false, previewTheme: null, previewPrevious: null,
    set: (value) => {
      const theme = normalize(value);
      applyToDOM(theme);
      set({ theme, previewTheme: null, previewPrevious: null, selectionRevision: get().selectionRevision + 1 });
      savePreference("theme", theme);
    },
    setReduceGlass: (reduce) => {
      set({ reduceGlass: reduce }); applyGlassToDOM(reduce); savePreference("reduce_glass", reduce);
    },
    toggle: () => {
      const order = allThemes().map(t => t.id);
      get().set(order[(order.indexOf(get().theme) + 1) % order.length]!);
    },
    hydrate: (value) => {
      const theme = normalize(value);
      applyToDOM(theme);
      set({ theme, previewTheme: null, previewPrevious: null, selectionRevision: get().selectionRevision + 1 });
    },
    hydrateGlass: (value) => {
      const reduce = value === true;
      set({ reduceGlass: reduce }); applyGlassToDOM(reduce);
    },
    hydrateCustom: (value) => {
      if (get().customSaving) return;
      try {
        if (value === null) { metadata = {}; rawThemes = []; writable = true; set({ customThemes: [], customLoadError: null }); return; }
        if (!object(value) || value.version !== 1 || !Array.isArray(value.themes) || value.themes.length > MAX_CUSTOM_THEMES || JSON.stringify(value).length > 524_288) throw new Error("Invalid custom theme collection.");
        const themes = value.themes.map(validateCustomTheme);
        if (new Set(themes.map(t => t.id)).size !== themes.length) throw new Error("Duplicate custom theme IDs.");
        metadata = { ...value }; rawThemes = value.themes; writable = true;
        set({ customThemes: themes, customLoadError: null });
      } catch {
        writable = false;
        set({ customLoadError: "Custom themes couldn't be loaded. Stored themes have not been overwritten. Reload or restore a backup before saving custom themes." });
      }
    },
    saveCustom: async (value) => {
      const theme = validateCustomTheme(value);
      if (get().customThemes.some(t => t.id === theme.id)) throw new Error("That theme is already saved.");
      if (get().customThemes.length >= MAX_CUSTOM_THEMES) throw new Error(`You can save up to ${MAX_CUSTOM_THEMES} custom themes. Remove one first.`);
      await persistCustom([...get().customThemes, theme]);
    },
    removeCustom: async (id) => {
      if (!get().customThemes.some(t => t.id === id)) return;
      await persistCustom(get().customThemes.filter(t => t.id !== id));
      if (get().theme === id) get().set("liquid");
      else if (get().previewPrevious === id) set({ previewPrevious: "liquid" });
    },
    preview: (value) => {
      const theme = validateCustomTheme(value);
      const previous = get().previewPrevious ?? get().theme;
      applyToDOM(theme.id, theme);
      set({ theme: theme.id, previewTheme: theme, previewPrevious: previous, selectionRevision: get().selectionRevision + 1 });
    },
    cancelPreview: (id) => {
      if (get().previewTheme?.id !== id) return;
      const theme = normalize(get().previewPrevious);
      applyToDOM(theme);
      set({ theme, previewTheme: null, previewPrevious: null, selectionRevision: get().selectionRevision + 1 });
    },
  };
});
