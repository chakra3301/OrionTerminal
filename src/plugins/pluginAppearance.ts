export type PluginStyleMode = "orion" | "original";
export type PluginSkin = "standard" | "2048";
export type PluginAppearance = {
  version: 1; revision: number; mode: PluginStyleMode; colorScheme: "light" | "dark"; material: "solid" | "glass";
  reduceMotion: boolean; reduceTransparency: boolean;
  colors: Record<"background" | "panel" | "raised" | "text" | "secondary" | "muted" | "line" | "hover" | "accent" | "onAccent" | "error", string>;
  radii: { small: number; medium: number; large: number };
};

// This validator is also serialized into the opaque client; keep it self-contained.
export function parsePluginAppearance(value: unknown): PluginAppearance | null {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const fields = (v: Record<string, unknown>, keys: string[]) => {
    const d = Object.getOwnPropertyDescriptors(v);
    return Reflect.ownKeys(d).length === keys.length && keys.every(k => d[k] && Object.hasOwn(d[k], "value"));
  };
  if (!object(value) || !fields(value, ["version", "revision", "mode", "colorScheme", "material", "reduceMotion", "reduceTransparency", "colors", "radii"])) return null;
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !["orion", "original"].includes(value.mode as string) || !["light", "dark"].includes(value.colorScheme as string)
    || !["solid", "glass"].includes(value.material as string) || typeof value.reduceMotion !== "boolean" || typeof value.reduceTransparency !== "boolean") return null;
  const keys = ["background", "panel", "raised", "text", "secondary", "muted", "line", "hover", "accent", "onAccent", "error"];
  if (!object(value.colors) || !fields(value.colors, keys) || !object(value.radii) || !fields(value.radii, ["small", "medium", "large"])) return null;
  const color = /^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|rgba?\([-+.\d%,\s/]+\)|(?:oklch|oklab|lab|lch)\([-+.\d%\s/]+\)|color\((?:srgb|srgb-linear|display-p3)\s[-+.\d%\s/]+\))$/i;
  if (!keys.every(k => { const entry = (value.colors as Record<string, unknown>)[k]; return typeof entry === "string" && entry.length <= 100 && color.test(entry); })) return null;
  if (!Object.values(value.radii).every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 28)) return null;
  return JSON.parse(JSON.stringify(value)) as PluginAppearance;
}

export function pluginSkin(content: string, kind: "ui" | "background"): PluginSkin | null {
  if (kind !== "ui") return null;
  const doc = new DOMParser().parseFromString(content, "text/html");
  if (doc.body.getAttribute("data-orion-appearance") !== "v1") return null;
  const skin = doc.body.getAttribute("data-orion-skin") ?? "standard";
  return skin === "standard" || skin === "2048" ? skin : null;
}

let revision = 0;
export function capturePluginAppearance(mode: PluginStyleMode = "orion"): PluginAppearance {
  const root = document.documentElement, styles = getComputedStyle(root);
  const light = root.dataset.colorMode === "light";
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
  root.append(probe);
  const resolve = (expression: string, fallback: string) => {
    probe.style.color = expression;
    const color = getComputedStyle(probe).color;
    return color || fallback;
  };
  const text = light ? "#212927" : "#e6f4ec", bg = light ? "#faf7f0" : "#03060a";
  const foreground = resolve(`var(--work-text, var(--t-primary, ${text}))`, text);
  const colors = {
    background: resolve(`var(--bg-0-solid, var(--bg-0, ${bg}))`, bg),
    panel: resolve(`var(--work-panel, var(--bg-1-solid, var(--bg-1, ${bg})))`, bg),
    raised: resolve(`var(--work-raised, var(--bg-2-solid, var(--bg-2, ${bg})))`, bg),
    text: foreground,
    secondary: resolve("var(--work-secondary, var(--t-secondary, #9ab0a8))", "#9ab0a8"),
    muted: resolve("var(--work-muted, var(--t-tertiary, #5a706a))", "#5a706a"),
    line: resolve(`var(--work-line, color-mix(in srgb, ${foreground} 10%, transparent))`, "#5a706a"),
    hover: resolve(`var(--work-hover, color-mix(in srgb, ${foreground} 6%, transparent))`, "#10171d"),
    accent: resolve("var(--neon-cyan, #00e0ff)", "#00e0ff"),
    onAccent: resolve("var(--t-on-accent, #03060a)", "#03060a"),
    error: resolve("var(--neon-magenta, #ff3ea5)", "#ff3ea5"),
  };
  probe.remove();
  const radius = (key: string, fallback: number) => {
    const n = parseFloat(styles.getPropertyValue(key)); return Number.isFinite(n) ? Math.min(28, Math.max(0, n)) : fallback;
  };
  const match = (query: string) => window.matchMedia?.(query).matches ?? false;
  const snapshot = { version: 1 as const, revision: ++revision, mode, colorScheme: light ? "light" as const : "dark" as const,
    material: root.dataset.customSurface === "glass" || ["liquid", "ivory-keep"].includes(root.dataset.theme ?? "") ? "glass" as const : "solid" as const,
    reduceMotion: match("(prefers-reduced-motion: reduce)"),
    reduceTransparency: root.classList.contains("ot-reduce-glass") || match("(prefers-reduced-transparency: reduce)"),
    colors, radii: { small: radius("--r-sm", 5.1), medium: radius("--r-md", 8.5), large: radius("--r-lg", 13.6) } };
  const validated = parsePluginAppearance(snapshot);
  if (validated) return validated;
  // Older CSS engines may not resolve variables/color-mix; never forward unresolved CSS.
  return { ...snapshot, colors: { background: bg, panel: bg, raised: bg, text, secondary: text, muted: text,
    line: text, hover: bg, accent: light ? "#006e80" : "#00e0ff", onAccent: light ? "#ffffff" : "#03060a",
    error: light ? "#952247" : "#ff3ea5" } };
}
