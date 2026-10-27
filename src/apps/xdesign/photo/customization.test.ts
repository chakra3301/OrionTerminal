import { describe, expect, it } from "vitest";
import { IMAGE_TOOL_GROUPS } from "../editorTools";
import { findShortcut, shortcutFromEvent, type MenuSpec } from "../menuModel";
import { customizeMenus, sanitizeCustomization, shortcutAllowed, shortcutConflict, toolbarGroups } from "./customization";

const ran: string[] = [];
const menus: MenuSpec[] = [
  { label: "Edit", items: [{ label: "Cut", shortcut: "Mod+X", run: () => ran.push("cut") }, { label: "Copy", shortcut: "Mod+C", run: () => ran.push("copy") }, "-", { label: "Fill…", shortcut: "Shift+F5", run: () => ran.push("fill") }] },
  { label: "Image", items: [{ label: "Adjustments", items: [{ label: "Levels…", shortcut: "Mod+L", run: () => ran.push("levels") }] }] },
];
const key = (init: KeyboardEventInit & { code?: string }) => new KeyboardEvent("keydown", init);
const items = (specs: MenuSpec[]) => specs.flatMap(spec => spec.items);

describe("customizeMenus", () => {
  it("changes what a menu shows and what the key does together", () => {
    const custom = customizeMenus(menus, { shortcuts: { "Edit › Copy": "Alt+Mod+C" }, menus: {}, toolbar: null });
    expect(custom[0]!.items[1]).toMatchObject({ label: "Copy", shortcut: "Alt+Mod+C" });
    expect(findShortcut(items(custom), key({ key: "c", code: "KeyC", metaKey: true }))).toBeUndefined();
    expect(findShortcut(items(custom), key({ key: "ç", code: "KeyC", metaKey: true, altKey: true }))?.label).toBe("Copy");
  });

  it("removes a deleted shortcut from the menu and from dispatch", () => {
    const custom = customizeMenus(menus, { shortcuts: { "Image › Adjustments › Levels…": null }, menus: {}, toolbar: null });
    expect(custom[1]!.items[0]).toMatchObject({ items: [{ label: "Levels…" }] });
    expect((custom[1]!.items[0] as { items: { shortcut?: string }[] }).items[0]!.shortcut).toBeUndefined();
    expect(findShortcut(items(custom), key({ key: "l", code: "KeyL", metaKey: true }))).toBeUndefined();
  });

  it("drops hidden items, their keys and the separators they leave behind", () => {
    const custom = customizeMenus(menus, { shortcuts: {}, menus: { "Edit › Fill…": { hidden: true }, "Edit › Cut": { color: "red" } }, toolbar: null });
    expect(custom[0]!.items.map(entry => entry === "-" ? "-" : entry.label)).toEqual(["Cut", "Copy"]);
    expect(custom[0]!.items[0]).toMatchObject({ color: "red" });
    expect(findShortcut(items(custom), key({ key: "F5", code: "F5", shiftKey: true }))).toBeUndefined();
  });

  it("returns the menus untouched when nothing is customised", () => {
    expect(customizeMenus(menus, { shortcuts: {}, menus: {}, toolbar: null })).toBe(menus);
  });
});

describe("shortcuts", () => {
  it("names the other command already using a shortcut", () => {
    expect(shortcutConflict(menus, "Edit › Copy", "Mod+X")).toBe("Edit › Cut");
    expect(shortcutConflict(menus, "Edit › Cut", "Mod+X")).toBeNull();
    expect(shortcutConflict(menus, "Edit › Copy", "Alt+Mod+C")).toBeNull();
  });

  it("follows Photoshop's rule that menu shortcuts need Command, Control or a function key", () => {
    expect(shortcutAllowed("Mod+K")).toBe(true);
    expect(shortcutAllowed("Ctrl+Alt+K")).toBe(true);
    expect(shortcutAllowed("Shift+F5")).toBe(true);
    expect(shortcutAllowed("Alt+K")).toBe(false);
    expect(shortcutAllowed("K")).toBe(false);
  });

  it("reads a shortcut from the physical key, ignoring bare modifiers", () => {
    expect(shortcutFromEvent(key({ key: "˚", code: "KeyK", metaKey: true, altKey: true, shiftKey: true }))).toBe("Alt+Shift+Mod+K");
    expect(shortcutFromEvent(key({ key: "[", code: "BracketLeft", ctrlKey: true }))).toBe("Ctrl+[");
    expect(shortcutFromEvent(key({ key: "F7", code: "F7" }))).toBe("F7");
    expect(shortcutFromEvent(key({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeNull();
  });

  it("keeps the valid entries of a damaged saved customisation", () => {
    expect(sanitizeCustomization({ shortcuts: { "Edit › Copy": "Mod+C", "Edit › Cut": 4, "Edit › Fill…": null }, menus: { "Edit › Cut": { hidden: true, color: "pink" } }, toolbar: { groups: "x" } }))
      .toEqual({ shortcuts: { "Edit › Copy": "Mod+C", "Edit › Fill…": null }, menus: { "Edit › Cut": { hidden: true } }, toolbar: null });
  });
});

describe("toolbarGroups", () => {
  const ids = (groups: { tools: { id: string }[] }[]) => groups.map(group => group.tools.map(tool => tool.id));
  const first = IMAGE_TOOL_GROUPS[0]!, second = IMAGE_TOOL_GROUPS[1]!;

  it("is the default toolbar without a saved layout", () => {
    expect(ids(toolbarGroups(IMAGE_TOOL_GROUPS, null).groups)).toEqual(ids(IMAGE_TOOL_GROUPS));
  });

  it("moves extra tools off the toolbar and returns tools a layout doesn't mention to their group", () => {
    const layout = { groups: [first.tools.map(tool => tool.id)], extra: [second.tools[0]!.id] };
    const { groups, extra } = toolbarGroups(IMAGE_TOOL_GROUPS, layout);
    expect(extra.map(tool => tool.id)).toEqual([second.tools[0]!.id]);
    expect(groups.flatMap(group => group.tools).some(tool => tool.id === second.tools[0]!.id)).toBe(false);
    expect(groups.flatMap(group => group.tools)).toHaveLength(IMAGE_TOOL_GROUPS.flatMap(group => group.tools).length - 1);
    expect(groups[0]!.label).toBe(first.label);
  });

  it("merges a split group and ignores unknown or repeated tools", () => {
    const [a, ...rest] = second.tools.map(tool => tool.id);
    expect(rest.length).toBeGreaterThan(0);
    const { groups } = toolbarGroups(IMAGE_TOOL_GROUPS, { groups: [[a!], ["no.such.tool", a!], rest], extra: [] });
    expect(groups.filter(group => group.label === second.label)).toHaveLength(1);
    expect(ids(groups)[0]).toEqual(second.tools.map(tool => tool.id));
  });
});
