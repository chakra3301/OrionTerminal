import type { ComponentType } from "react";

/** One row of a menu bar menu, submenu, context menu or panel flyout. */
export type MenuItem = {
  label: string;
  /** Tool flyouts show the tool icon before the label. */
  icon?: ComponentType<{ size?: number }>;
  /** "Mod+Shift+Z" style: modifiers Ctrl, Alt, Shift, Mod (⌘), then one key. Shown as glyphs and matched by findShortcut. */
  shortcut?: string;
  disabled?: boolean;
  /** Present (true or false) for rows that show a check: a checkbox, or a radio when `radio` is set. */
  checked?: boolean;
  radio?: boolean;
  run?: () => void;
  items?: MenuEntry[];
  /** Edit › Menus highlight colour, shown as the row background. */
  color?: string;
};
export type MenuEntry = MenuItem | "-";
export type MenuSpec = { label: string; items: MenuEntry[] };

type Parsed = { ctrl: boolean; alt: boolean; shift: boolean; mod: boolean; key: string };
const PUNCTUATION_CODES: Record<string, string> = { "[": "BracketLeft", "]": "BracketRight", ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote", "\\": "Backslash", "-": "Minus", "=": "Equal", "`": "Backquote" };
const KEY_GLYPHS: Record<string, string> = { "=": "+", "-": "−", Backspace: "⌫", Delete: "⌦", Escape: "⎋", Enter: "↩", Tab: "⇥", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };

function parse(shortcut: string): Parsed {
  const parts = shortcut.split("+");
  const key = parts.pop()!;
  return { ctrl: parts.includes("Ctrl"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), mod: parts.includes("Mod"), key: key.length === 1 ? key.toLowerCase() : key };
}

/** Photoshop's macOS order: ⌃⌥⇧⌘ then the key. */
export function shortcutGlyphs(shortcut: string): string {
  const { ctrl, alt, shift, mod, key } = parse(shortcut);
  return `${ctrl ? "⌃" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key)}`;
}

export function ariaShortcut(shortcut: string): string {
  const { ctrl, alt, shift, mod, key } = parse(shortcut);
  return [ctrl && "Control", alt && "Alt", shift && "Shift", mod && "Meta", key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join("+");
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;
const CODE_KEYS = Object.fromEntries(Object.entries(PUNCTUATION_CODES).map(([key, code]) => [code, key]));
/** The shortcut a key press spells, by key position like matchesShortcut, or null while only modifiers are down. */
export function shortcutFromEvent(event: KeyLike): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "Dead", "Unidentified", " "].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : CODE_KEYS[event.code] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Mod", key].filter(Boolean).join("+");
}
export function matchesShortcut(event: KeyLike, shortcut: string): boolean {
  const { ctrl, alt, shift, mod, key } = parse(shortcut);
  const modifiers = mod && ctrl ? event.metaKey && event.ctrlKey : mod ? event.metaKey !== event.ctrlKey : ctrl ? event.ctrlKey && !event.metaKey : !event.metaKey && !event.ctrlKey;
  if (!modifiers || event.altKey !== alt || event.shiftKey !== shift) return false;
  // Option and Shift change the typed character on macOS (⌥⌘I types "ˆ", ⇧[ types "{"), so those keys match by position.
  if (/^[a-z]$/.test(key)) return event.altKey && event.code ? event.code === `Key${key.toUpperCase()}` : event.key.toLowerCase() === key;
  const code = /^[0-9]$/.test(key) ? `Digit${key}` : PUNCTUATION_CODES[key];
  if (code && event.code) return event.code === code;
  return event.key === key;
}

/** The first enabled item bound to this key, else the first disabled one so the caller can still swallow the key. */
export function findShortcut(entries: readonly MenuEntry[], event: KeyLike): MenuItem | undefined {
  let blocked: MenuItem | undefined;
  const visit = (list: readonly MenuEntry[], disabled: boolean): MenuItem | undefined => {
    for (const entry of list) {
      if (entry === "-") continue;
      if (entry.items) { const found = visit(entry.items, disabled || !!entry.disabled); if (found) return found; continue; }
      if (!entry.shortcut || !matchesShortcut(event, entry.shortcut)) continue;
      if (disabled || entry.disabled || !entry.run) blocked ??= entry;
      else return entry;
    }
    return undefined;
  };
  return visit(entries, false) ?? blocked;
}
