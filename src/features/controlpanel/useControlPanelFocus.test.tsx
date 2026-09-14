import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useControlPanelFocus } from "./useControlPanelFocus";
let host: HTMLDivElement; let root: Root; let before: HTMLButtonElement;
const hide = vi.fn();
function Dialog() { const ref = useControlPanelFocus(true, hide); return <div ref={ref}><button>First</button><button disabled>Disabled</button><button>Last</button></div>; }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  hide.mockClear(); before = document.createElement("button"); document.body.append(before); before.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); before.remove(); document.querySelector(".ot-prompt-overlay")?.remove(); });
it("traps Tab in both directions and restores prior focus", async () => {
  await act(async () => root.render(<Dialog />));
  const buttons = host.querySelectorAll("button");
  expect(document.activeElement).toBe(buttons[0]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
  expect(document.activeElement).toBe(buttons[2]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
  expect(document.activeElement).toBe(buttons[0]);
  await act(async () => root.render(null)); expect(document.activeElement).toBe(before);
});
it("leaves Escape to nested confirmation instead of closing settings too", async () => {
  await act(async () => root.render(<Dialog />));
  const confirmation = document.createElement("div"); confirmation.className = "ot-prompt-overlay"; document.body.append(confirmation);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(hide).not.toHaveBeenCalled();
  confirmation.remove();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); expect(hide).toHaveBeenCalledOnce();
});
it("keeps Spotlight content-sized and bounded rather than stretching to the bottom edge", () => {
  const css = readFileSync("src/styles/tokens.css", "utf8");
  expect(css.match(/\.ot-spotlight-overlay\s*\{([^}]+)\}/)?.[1]).toContain("align-items: flex-start");
  expect(css.match(/\.ot-spotlight\s*\{([^}]+)\}/)?.[1]).toContain("max-height: calc(84vh - 16px)");
  expect(css.match(/\.ot-spotlight-list\s*\{([^}]+)\}/)?.[1]).toContain("min-height: 0");
});
it("keeps settings above floating assistants with confirmations above settings", () => {
  const css = readFileSync("src/styles/tokens.css", "utf8");
  const settings = readFileSync("src/features/controlpanel/controlpanel.css", "utf8");
  const z = (source: string, selector: string) => Number(source.slice(source.indexOf(selector)).match(/z-index:\s*(\d+)/)?.[1]);
  expect(z(settings, ".cp-overlay")).toBeGreaterThan(z(css, ".xd-claude-rail.floating"));
  expect(z(css, ".ot-spotlight-overlay")).toBeGreaterThan(z(settings, ".cp-overlay"));
  expect(z(css, ".ot-prompt-overlay")).toBeGreaterThan(z(css, ".ot-spotlight-overlay"));
});
