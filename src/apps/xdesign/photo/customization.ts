import { create } from "zustand";
import type { EditorTool, EditorToolGroup } from "../EditorChrome";
import { ariaShortcut, type MenuEntry, type MenuItem, type MenuSpec } from "../menuModel";
import type { LayerColor } from "./types";

/** Photoshop's Edit › Menus colours are the layer label colours. */
export type MenuColor = Exclude<LayerColor, "none">;
export type Toolbar = { groups: string[][]; extra: string[] };
/** Edit › Keyboard Shortcuts, Menus and Toolbar, keyed by menu path ("Edit › Copy"). A null shortcut removes the default. */
export type Customization = {
  shortcuts: Record<string, string | null>;
  menus: Record<string, { hidden?: boolean; color?: MenuColor }>;
  toolbar: Toolbar | null;
};
export type MenuPath = { path: string; item: MenuItem; depth: number };

export const CUSTOMIZATION_KEY = "orion.xdesign.customization.v1";
export const PATH_SEPARATOR = " › ";
export const DEFAULT_CUSTOMIZATION: Customization = { shortcuts: {}, menus: {}, toolbar: null };
const COLORS: readonly MenuColor[] = ["red", "orange", "yellow", "green", "blue", "violet", "gray"];
const SHORTCUT = /^((Ctrl|Alt|Shift|Mod)\+){0,4}[^+]{1,12}$/;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Keeps every valid entry, so one bad value doesn't reset the rest. */
export function sanitizeCustomization(value: unknown): Customization {
  const saved = record(value) ? value : {};
  const shortcuts = Object.fromEntries(Object.entries(record(saved.shortcuts) ? saved.shortcuts : {}).filter(([, shortcut]) => shortcut === null || typeof shortcut === "string" && SHORTCUT.test(shortcut))) as Customization["shortcuts"];
  const menus: Customization["menus"] = {};
  for (const [path, menu] of Object.entries(record(saved.menus) ? saved.menus : {})) {
    if (!record(menu)) continue;
    const hidden = menu.hidden === true, color = COLORS.includes(menu.color as MenuColor) ? menu.color as MenuColor : undefined;
    if (hidden || color) menus[path] = { ...(hidden ? { hidden } : {}), ...(color ? { color } : {}) };
  }
  const toolbar = record(saved.toolbar) && Array.isArray(saved.toolbar.groups) ? { groups: saved.toolbar.groups.map(strings).filter(group => group.length), extra: strings(saved.toolbar.extra) } : null;
  return { shortcuts, menus, toolbar };
}

function read(): Customization {
  try {
    const raw = localStorage.getItem(CUSTOMIZATION_KEY), saved: unknown = raw === null ? null : JSON.parse(raw);
    return record(saved) && saved.schemaVersion === 1 ? sanitizeCustomization(saved.customization) : DEFAULT_CUSTOMIZATION;
  } catch {
    return DEFAULT_CUSTOMIZATION;
  }
}

export const useCustomization = create<Customization>(() => read());

/** Applies at once; a failed write keeps the change for the session and says so. */
export function saveCustomization(next: Customization): string | null {
  const customization = sanitizeCustomization(next);
  useCustomization.setState(customization, true);
  try {
    localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify({ schemaVersion: 1, customization }));
    return null;
  } catch {
    return "The customization could not be saved; it applies until XDesign closes.";
  }
}

/** Every menu row with its path, top-level menus included at depth 0. */
export function menuPaths(specs: readonly MenuSpec[]): MenuPath[] {
  const out: MenuPath[] = [];
  const visit = (entries: readonly MenuEntry[], prefix: string, depth: number) => {
    for (const entry of entries) {
      if (entry === "-") continue;
      const path = prefix + entry.label;
      out.push({ path, item: entry, depth });
      if (entry.items) visit(entry.items, path + PATH_SEPARATOR, depth + 1);
    }
  };
  for (const spec of specs) { out.push({ path: spec.label, item: { label: spec.label, items: spec.items }, depth: 0 }); visit(spec.items, spec.label + PATH_SEPARATOR, 1); }
  return out;
}

const tidy = (entries: MenuEntry[]) => {
  const out: MenuEntry[] = [];
  for (const entry of entries) if (entry !== "-" || out.length && out.at(-1) !== "-") out.push(entry);
  if (out.at(-1) === "-") out.pop();
  return out;
};

/** The menus as customised: what they show is also what findShortcut dispatches, so a removed or hidden item's key goes quiet. */
export function customizeMenus(specs: MenuSpec[], { shortcuts, menus }: Customization): MenuSpec[] {
  if (!Object.keys(shortcuts).length && !Object.keys(menus).length) return specs;
  const visit = (entries: readonly MenuEntry[], prefix: string): MenuEntry[] => tidy(entries.flatMap((entry): MenuEntry[] => {
    if (entry === "-") return [entry];
    const path = prefix + entry.label, menu = menus[path];
    if (menu?.hidden) return [];
    const next: MenuItem = { ...entry };
    if (path in shortcuts) { const shortcut = shortcuts[path]; if (shortcut) next.shortcut = shortcut; else delete next.shortcut; }
    if (menu?.color) next.color = menu.color;
    if (entry.items) next.items = visit(entry.items, path + PATH_SEPARATOR);
    return [next];
  }));
  return specs.map(spec => ({ ...spec, items: visit(spec.items, spec.label + PATH_SEPARATOR) }));
}

/** The other row already using this shortcut, if any. */
export function shortcutConflict(specs: readonly MenuSpec[], path: string, shortcut: string): string | null {
  const key = ariaShortcut(shortcut);
  return menuPaths(specs).find(entry => entry.path !== path && entry.item.shortcut && ariaShortcut(entry.item.shortcut) === key)?.path ?? null;
}

/** Photoshop's rule for menu shortcuts: they need ⌘ or ⌃, or a function key. */
export const shortcutAllowed = (shortcut: string) => /(^|\+)(Mod|Ctrl)\+/.test(shortcut) || /(^|\+)F\d{1,2}$/.test(shortcut);

/** The toolbar after Edit › Toolbar…; tools a saved layout doesn't mention (added since) join the group holding their default neighbours. */
export function toolbarGroups(defaults: readonly EditorToolGroup[], toolbar: Toolbar | null): { groups: EditorToolGroup[]; extra: EditorTool[] } {
  if (!toolbar) return { groups: [...defaults], extra: [] };
  const home = new Map(defaults.flatMap(group => group.tools.map(tool => [tool.id, { tool, group }] as const)));
  const seen = new Set<string>(), pick = (ids: string[]) => ids.flatMap(id => { const found = home.get(id); if (!found || seen.has(id)) return []; seen.add(id); return [found.tool]; });
  const groups: EditorToolGroup[] = [];
  for (const tools of toolbar.groups.map(pick).filter(tools => tools.length)) {
    const label = home.get(tools[0]!.id)!.group.label, same = groups.find(group => group.label === label);
    if (same) same.tools.push(...tools); else groups.push({ label, tools });
  }
  const extra = pick(toolbar.extra);
  for (const group of defaults) for (const tool of group.tools) {
    if (seen.has(tool.id)) continue;
    const target = groups.find(candidate => candidate.tools.some(other => home.get(other.id)!.group === group));
    if (target) target.tools.push(tool); else groups.push({ label: group.label, tools: [tool] });
    seen.add(tool.id);
  }
  return { groups, extra };
}
