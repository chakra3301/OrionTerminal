import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FullscreenNav } from "./FullscreenNav";
import { useShell } from "./store/useShell";

vi.mock("@/plugins/appRegistry", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/plugins/appRegistry")>(),
  useAppDescriptors: () => [],
}));
const initial = useShell.getState();
afterEach(() => { useShell.setState(initial, true); vi.unstubAllGlobals(); });

it("gives modal dialogs, menus and Spotlight Escape priority without exiting fullscreen", () => {
  const exitFullscreen = vi.fn();
  const cycleFullscreen = vi.fn();
  useShell.setState({ windows: [{ id: "window", app: "archives", x: 0, y: 0, w: 1000, h: 700, z: 1, minimized: false, maximized: false, fullscreen: true }], focusedWindowId: "window", exitFullscreen, cycleFullscreen });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const modal = document.createElement("dialog");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const key = (key: string, ctrlKey = false) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true });
    act(() => document.dispatchEvent(event)); return event;
  };
  try {
    act(() => root.render(<FullscreenNav />));
    modal.setAttribute("open", ""); document.body.append(modal);
    expect(key("Escape").defaultPrevented).toBe(false);
    key("Tab", true);
    expect(exitFullscreen).not.toHaveBeenCalled(); expect(cycleFullscreen).not.toHaveBeenCalled();
    modal.remove();
    act(() => useShell.setState({ spotlightOpen: true }));
    expect(key("Escape").defaultPrevented).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
    act(() => useShell.setState({ spotlightOpen: false }));
    modal.setAttribute("aria-modal", "true"); modal.removeAttribute("open"); document.body.append(modal);
    key("Escape"); expect(exitFullscreen).not.toHaveBeenCalled(); modal.remove();
    modal.removeAttribute("aria-modal"); modal.setAttribute("role", "menu"); document.body.append(modal);
    key("Escape"); expect(exitFullscreen).not.toHaveBeenCalled(); modal.remove();
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    key("Tab", true); expect(cycleFullscreen).toHaveBeenCalledWith(1);
  } finally { act(() => root.unmount()); modal.remove(); host.remove(); }
});
