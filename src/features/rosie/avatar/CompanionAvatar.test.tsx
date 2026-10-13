import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CompanionAvatar } from "./CompanionAvatar";

const state = vi.hoisted(() => ({
  companionVisible: true,
  togglePanel: vi.fn(),
  openPanel: vi.fn(),
  dismissCompanion: vi.fn(),
  sceneRenders: 0,
}));
vi.mock("@/features/rosie/rosieStore", () => ({
  useRosie: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock("./CompanionScene", () => ({ CompanionScene: () => { state.sceneRenders++; return null; } }));

it("offers a keyboard-accessible hide action without starting a drag or opening chat", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<CompanionAvatar />));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Hide companion"]');
    expect(button).not.toBeNull();
    expect(button!.tabIndex).toBe(0);
    act(() => {
      button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      button!.click();
    });
    expect(state.dismissCompanion).toHaveBeenCalledOnce();
    expect(state.togglePanel).not.toHaveBeenCalled();
    expect(container.querySelector(".dragging")).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("releases a long stationary grab without opening chat", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const time = vi.spyOn(performance, "now").mockReturnValue(0);
  state.togglePanel.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<CompanionAvatar />));
    const companion = container.querySelector<HTMLDivElement>(".ot-companion")!;
    act(() => companion.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(companion.classList.contains("dragging")).toBe(true);
    time.mockReturnValue(400);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
      companion.click();
    });
    expect(state.togglePanel).not.toHaveBeenCalled();
    expect(companion.classList.contains("dragging")).toBe(false);
  } finally {
    act(() => root.unmount());
    time.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("moves the widget without rendering the scene on every mouse move, then keeps its release position", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const time = vi.spyOn(performance, "now").mockReturnValue(0);
  state.togglePanel.mockClear();
  state.dismissCompanion.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<CompanionAvatar />));
    const companion = container.querySelector<HTMLDivElement>(".ot-companion")!;
    const left = parseFloat(companion.style.left);
    const top = parseFloat(companion.style.top);
    act(() => companion.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 500, clientY: 400 })));
    const renders = state.sceneRenders;
    for (let step = 1; step <= 20; step++) {
      time.mockReturnValue(step * 20);
      act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 - step * 6, clientY: 400 - step * 4 })));
    }
    expect(state.sceneRenders).toBe(renders);
    expect(parseFloat(companion.style.left)).toBe(left - 120);
    expect(parseFloat(companion.style.top)).toBe(top - 80);
    time.mockReturnValue(600);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
      companion.click();
    });
    expect(parseFloat(companion.style.left)).toBe(left - 120);
    expect(parseFloat(companion.style.top)).toBe(top - 80);
    expect(companion.classList.contains("dragging")).toBe(false);
    expect(state.togglePanel).not.toHaveBeenCalled();
    expect(state.dismissCompanion).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    time.mockRestore();
    vi.unstubAllGlobals();
  }
});
