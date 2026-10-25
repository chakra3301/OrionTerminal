import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "lucide-react";
import { ContextMenu, MenuBar, MenuButton, positionPopup } from "./EditorMenus";
import type { MenuEntry, MenuSpec } from "./menuModel";

let root: Root, container: HTMLDivElement;
const run = vi.fn();
const fileItems = (): MenuEntry[] => [
  { label: "New", shortcut: "Mod+N", run },
  { label: "Open", disabled: true, run },
  "-",
  { label: "Recent", items: [{ label: "Alpha", run }, { label: "Beta", run }] },
  { label: "Save", shortcut: "Alt+Shift+S", run },
  { label: "Grid", checked: true, run },
  { label: "Mode", checked: false, radio: true, run },
];
const specs = (): MenuSpec[] => [{ label: "File", items: fileItems() }, { label: "Edit", items: [{ label: "Undo", run }, { label: "Redo", run }] }];

const title = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("[role=menubar] > button")].find(button => button.textContent === name)!;
const rows = () => [...container.querySelectorAll<HTMLButtonElement>("[role=menu] > button")];
const row = (name: string) => rows().find(button => button.textContent === name)!;
const popups = () => container.querySelectorAll("[role=menu]");
const focused = () => document.activeElement?.textContent;
const press = (element: Element, key: string, init: KeyboardEventInit = {}) => {
  const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { element.dispatchEvent(keydown); });
  return keydown;
};
const hover = (element: Element) => act(() => { element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
const click = (element: HTMLElement) => act(() => element.click());
const openFile = () => { act(() => title("File").focus()); press(title("File"), "ArrowDown"); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("MenuBar", () => {
  beforeEach(() => { act(() => root.render(<MenuBar label="Photo menus" menus={specs()}/>)); });

  it("exposes menubar, menu and row roles with ARIA state", () => {
    expect(container.querySelector("[role=menubar]")?.getAttribute("aria-label")).toBe("Photo menus");
    expect(title("File").getAttribute("aria-haspopup")).toBe("menu");
    expect(title("File").getAttribute("aria-expanded")).toBe("false");
    expect([...container.querySelectorAll<HTMLElement>("[role=menubar] > button")].filter(button => button.tabIndex === 0)).toHaveLength(1);
    click(title("File"));
    expect(title("File").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("File");
    expect(container.querySelectorAll("[role=separator]")).toHaveLength(1);
    expect(row("New").getAttribute("role")).toBe("menuitem");
    expect(row("Open").disabled).toBe(true);
    expect(row("Grid").getAttribute("role")).toBe("menuitemcheckbox");
    expect(row("Grid").getAttribute("aria-checked")).toBe("true");
    expect(row("Mode").getAttribute("role")).toBe("menuitemradio");
    expect(row("Mode").getAttribute("aria-checked")).toBe("false");
    expect(row("Recent").getAttribute("aria-haspopup")).toBe("menu");
    expect(row("Recent").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps row text to the label and carries shortcuts in attributes", () => {
    click(title("File"));
    expect(rows().map(button => button.textContent)).toEqual(["New", "Open", "Recent", "Save", "Grid", "Mode"]);
    expect(row("New").dataset.shortcut).toBe("⌘N");
    expect(row("New").getAttribute("aria-keyshortcuts")).toBe("Meta+N");
    expect(row("Save").dataset.shortcut).toBe("⌥⇧S");
    expect(row("Grid").hasAttribute("data-shortcut")).toBe(false);
  });

  it("toggles on click and switches menus on hover while one is open", () => {
    click(title("File")); expect(popups()).toHaveLength(1);
    hover(title("Edit"));
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Edit");
    click(title("Edit")); expect(popups()).toHaveLength(0);
    hover(title("File")); expect(popups()).toHaveLength(0);
  });

  it("moves focus between closed titles with arrows", () => {
    act(() => title("File").focus());
    press(title("File"), "ArrowRight"); expect(focused()).toBe("Edit");
    press(title("Edit"), "ArrowRight"); expect(focused()).toBe("File");
    press(title("File"), "ArrowLeft"); expect(focused()).toBe("Edit");
    expect(popups()).toHaveLength(0);
  });

  it("opens with the first enabled item focused and wraps over disabled rows and separators", () => {
    openFile(); expect(focused()).toBe("New");
    press(document.activeElement!, "ArrowDown"); expect(focused()).toBe("Recent");
    press(document.activeElement!, "ArrowUp"); expect(focused()).toBe("New");
    press(document.activeElement!, "ArrowUp"); expect(focused()).toBe("Mode");
    press(document.activeElement!, "ArrowDown"); expect(focused()).toBe("New");
    press(document.activeElement!, "End"); expect(focused()).toBe("Mode");
    press(document.activeElement!, "Home"); expect(focused()).toBe("New");
  });

  it("switches to the neighbouring menu with left and right, wrapping", () => {
    openFile();
    press(document.activeElement!, "ArrowRight");
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Edit");
    expect(focused()).toBe("Undo");
    press(document.activeElement!, "ArrowRight");
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("File");
    press(document.activeElement!, "ArrowLeft");
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Edit");
  });

  it("opens submenus with right arrow or click and closes them with left arrow", () => {
    openFile(); press(document.activeElement!, "ArrowDown");
    press(document.activeElement!, "ArrowRight");
    expect(popups()).toHaveLength(2);
    expect(row("Recent").getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("Alpha");
    press(document.activeElement!, "ArrowLeft");
    expect(popups()).toHaveLength(1);
    expect(focused()).toBe("Recent");
    click(row("Recent")); expect(popups()).toHaveLength(2);
  });

  it("opens a hovered submenu after a delay and closes it when another row is hovered", () => {
    vi.useFakeTimers();
    click(title("File"));
    hover(row("Recent")); expect(popups()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(250); }); expect(popups()).toHaveLength(2);
    hover(row("Save")); act(() => { vi.advanceTimersByTime(250); }); expect(popups()).toHaveLength(1);
  });

  it("closes one level per Escape and returns focus to the title", () => {
    openFile(); press(document.activeElement!, "ArrowDown"); press(document.activeElement!, "ArrowRight");
    press(document.activeElement!, "Escape");
    expect(popups()).toHaveLength(1); expect(focused()).toBe("Recent");
    press(document.activeElement!, "Escape");
    expect(popups()).toHaveLength(0); expect(document.activeElement).toBe(title("File"));
  });

  it("restores trigger focus before running the chosen item", () => {
    let activeWhenRun: Element | null = null;
    run.mockImplementation(() => { activeWhenRun = document.activeElement; });
    openFile(); press(document.activeElement!, "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(activeWhenRun).toBe(title("File"));
    expect(popups()).toHaveLength(0);
  });

  it("does not run disabled rows", () => {
    click(title("File")); click(row("Open"));
    expect(run).not.toHaveBeenCalled(); expect(popups()).toHaveLength(1);
  });

  it("focuses the next row matching typed characters and resets the buffer", () => {
    vi.useFakeTimers();
    openFile();
    press(document.activeElement!, "s"); expect(focused()).toBe("Save");
    press(document.activeElement!, "a"); expect(focused()).toBe("Save");
    act(() => { vi.advanceTimersByTime(600); });
    press(document.activeElement!, "r"); expect(focused()).toBe("Recent");
    press(document.activeElement!, "e"); expect(focused()).toBe("Recent");
  });

  it("closes on an outside pointerdown", () => {
    click(title("File"));
    act(() => { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(popups()).toHaveLength(0);
  });

  it("stops plain keys but lets Meta shortcuts reach the app", () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    openFile();
    press(document.activeElement!, "v"); press(document.activeElement!, "ArrowDown");
    expect(seen).not.toHaveBeenCalled();
    press(document.activeElement!, "v", { metaKey: true });
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", seen);
  });
});

describe("MenuButton", () => {
  it("renders icon-only triggers with a label attribute and opens a right-aligned popup", () => {
    act(() => root.render(<MenuButton label="Layers options" icon={Menu} iconOnly align="end" items={[{ label: "Flatten", run }]}/>));
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.textContent).toBe("");
    expect(trigger.getAttribute("aria-label")).toBe("Layers options");
    expect(trigger.title).toBe("Layers options");
    click(trigger);
    expect(container.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Layers options");
    press(document.activeElement!, "Escape");
    expect(popups()).toHaveLength(0); expect(document.activeElement).toBe(trigger);
  });

  it("uses the shared trigger class with the label as text", () => {
    act(() => root.render(<MenuButton label="Export" icon={Menu} items={[{ label: "PNG", run }]}/>));
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.classList.contains("xd-editor-menu-trigger")).toBe(true);
    expect(trigger.textContent).toBe("Export");
  });
});

describe("ContextMenu", () => {
  it("opens at a point with the first item focused and closes after a choice", () => {
    const close = vi.fn();
    act(() => root.render(<ContextMenu x={40} y={50} label="Layer" close={close} items={[{ label: "Open", disabled: true }, { label: "Duplicate", run }, { label: "Delete", run }]}/>));
    expect(focused()).toBe("Duplicate");
    expect(popups()[0]!.getAttribute("aria-label")).toBe("Layer");
    expect(popups()[0]!.parentElement?.className).toContain("xd-menu-root");
    press(document.activeElement!, "ArrowDown"); expect(focused()).toBe("Delete");
    press(document.activeElement!, "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and restores the previously focused element", () => {
    const close = vi.fn();
    const before = document.createElement("button"); document.body.append(before); before.focus();
    act(() => root.render(<ContextMenu x={0} y={0} label="Layer" close={close} items={[{ label: "Delete", run }]}/>));
    expect(focused()).toBe("Delete");
    press(document.activeElement!, "Escape");
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});

describe("positionPopup", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const placeBelow = (anchorTop: number, menuHeight: number) => {
    const host = document.createElement("div"), anchor = document.createElement("button"), menu = document.createElement("div");
    host.className = "xd-root"; host.append(anchor, menu); container.append(host);
    host.getBoundingClientRect = () => rect(0, 0, 800, 600);
    anchor.getBoundingClientRect = () => rect(100, anchorTop, 60, 26);
    menu.getBoundingClientRect = () => rect(parseFloat(menu.style.left), parseFloat(menu.style.top), 200, Math.min(menuHeight, parseFloat(menu.style.maxHeight) || Infinity));
    positionPopup(menu, { kind: "below", el: anchor, align: "start" });
    return menu.style;
  };

  it("keeps a pull-down taller than the space below under its title and lets it scroll", () => {
    const style = placeBelow(20, 900);
    expect(style.top).toBe("46px");
    expect(style.maxHeight).toBe("554px");
  });

  it("opens a pull-down above a title near the bottom instead of covering the title", () => {
    const style = placeBelow(500, 300);
    expect(style.top).toBe("200px");
    expect(style.maxHeight).toBe("");
  });
});
