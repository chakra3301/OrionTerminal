import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDesignDialogOpen, useDesignDialog } from "./useDesignDialog";

let roots: Root[] = [];
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { act(() => roots.forEach(root => root.unmount())); roots = []; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function Example({ close, busy = false }: { close: () => void; busy?: boolean }) {
  const ref = useDesignDialog<HTMLDivElement>(close, busy);
  return <div ref={ref} role="dialog"><input aria-label="First"/><details><summary>Advanced</summary><input aria-label="Hidden"/></details><button>Last</button></div>;
}
function mount(close: () => void, busy = false) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  act(() => root.render(<Example close={close} busy={busy}/>)); return { root, container };
}
const key = (value: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));

describe("editor dialog keyboard isolation", () => {
  it("wraps focus, includes disclosure controls and restores the originating control", () => {
    const origin = document.createElement("button"); document.body.append(origin); origin.focus();
    const { root, container } = mount(vi.fn());
    expect(isDesignDialogOpen()).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("input"));
    container.querySelector("button")!.focus(); key("Tab"); expect(document.activeElement).toBe(container.querySelector("input"));
    key("Tab", true); expect(document.activeElement).toBe(container.querySelector("button"));
    container.querySelector("summary")!.focus(); expect(document.activeElement).toBe(container.querySelector("summary"));
    act(() => root.unmount()); roots = roots.filter(item => item !== root);
    expect(document.activeElement).toBe(origin); expect(isDesignDialogOpen()).toBe(false);
  });
  it("blocks Escape during a native edit, then closes only the dialog and stops workspace handlers", () => {
    const close = vi.fn(), workspace = vi.fn(), { root } = mount(close, true);
    window.addEventListener("keydown", workspace);
    key("Escape"); expect(close).not.toHaveBeenCalled(); expect(workspace).not.toHaveBeenCalled();
    act(() => root.render(<Example close={close}/>)); key("Escape");
    expect(close).toHaveBeenCalledTimes(1); expect(workspace).not.toHaveBeenCalled();
    window.removeEventListener("keydown", workspace);
  });
  it("routes Escape to the most recently opened dialog", () => {
    const first = vi.fn(), second = vi.fn(); mount(first); const { root } = mount(second);
    key("Escape"); expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
    act(() => root.unmount()); roots = roots.filter(item => item !== root);
    key("Escape"); expect(first).toHaveBeenCalledTimes(1);
  });
});
