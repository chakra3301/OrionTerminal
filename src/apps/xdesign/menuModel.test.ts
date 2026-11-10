import { describe, expect, it, vi } from "vitest";
import { findShortcut, matchesShortcut, shortcutGlyphs, type MenuEntry } from "./menuModel";

const event = (init: Partial<Parameters<typeof matchesShortcut>[0]>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init });

describe("shortcutGlyphs", () => {
  it("orders modifiers as ⌃⌥⇧⌘", () => {
    expect(shortcutGlyphs("Mod+Shift+Alt+Ctrl+z")).toBe("⌃⌥⇧⌘Z");
    expect(shortcutGlyphs("Mod+=")).toBe("⌘+");
    expect(shortcutGlyphs("Shift+F5")).toBe("⇧F5");
  });
});

describe("matchesShortcut", () => {
  it("matches letters by key regardless of case", () => {
    expect(matchesShortcut(event({ key: "z", metaKey: true }), "Mod+Z")).toBe(true);
    expect(matchesShortcut(event({ key: "Z", metaKey: true, shiftKey: true }), "Mod+Shift+Z")).toBe(true);
    expect(matchesShortcut(event({ key: "z", metaKey: true, shiftKey: true }), "Mod+Z")).toBe(false);
  });
  it("matches letters by code when Alt changes the typed character", () => {
    expect(matchesShortcut(event({ key: "ˆ", code: "KeyI", altKey: true, metaKey: true }), "Alt+Mod+I")).toBe(true);
    expect(matchesShortcut(event({ key: "ˆ", code: "KeyJ", altKey: true, metaKey: true }), "Alt+Mod+I")).toBe(false);
  });
  it("matches punctuation by code, falling back to key without one", () => {
    expect(matchesShortcut(event({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }), "Mod+Shift+[")).toBe(true);
    expect(matchesShortcut(event({ key: "[", code: "BracketLeft", metaKey: true }), "Mod+[")).toBe(true);
    expect(matchesShortcut(event({ key: "[", code: "KeyX", metaKey: true }), "Mod+[")).toBe(false);
    expect(matchesShortcut(event({ key: "[", code: "", metaKey: true }), "Mod+[")).toBe(true);
  });
  it("treats Mod as meta or ctrl but not both, and Ctrl+Mod as both", () => {
    expect(matchesShortcut(event({ key: "k", ctrlKey: true }), "Mod+K")).toBe(true);
    expect(matchesShortcut(event({ key: "k", metaKey: true }), "Mod+K")).toBe(true);
    expect(matchesShortcut(event({ key: "k", metaKey: true, ctrlKey: true }), "Mod+K")).toBe(false);
    expect(matchesShortcut(event({ key: "k", metaKey: true, ctrlKey: true }), "Ctrl+Mod+K")).toBe(true);
    expect(matchesShortcut(event({ key: "k", metaKey: true }), "Ctrl+Mod+K")).toBe(false);
  });
});

describe("findShortcut", () => {
  const press = event({ key: "k", metaKey: true });
  it("prefers an enabled item over an earlier disabled one", () => {
    const enabled = { label: "On", shortcut: "Mod+K", run: vi.fn() };
    const entries: MenuEntry[] = [{ label: "Off", shortcut: "Mod+K", disabled: true, run: vi.fn() }, "-", enabled];
    expect(findShortcut(entries, press)).toBe(enabled);
  });
  it("returns the disabled item when it is the only match", () => {
    const off = { label: "Off", shortcut: "Mod+K", disabled: true, run: vi.fn() };
    expect(findShortcut([off], press)).toBe(off);
  });
  it("blocks children of a disabled parent", () => {
    const child = { label: "Child", shortcut: "Mod+K", run: vi.fn() };
    expect(findShortcut([{ label: "Parent", disabled: true, items: [child] }], press)).toBe(child);
    const fallback = { label: "Other", shortcut: "Mod+K", run: vi.fn() };
    expect(findShortcut([{ label: "Parent", disabled: true, items: [child] }, fallback], press)).toBe(fallback);
  });
});
