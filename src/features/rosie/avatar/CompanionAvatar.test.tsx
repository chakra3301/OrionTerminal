import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CompanionAvatar } from "./CompanionAvatar";

const state = vi.hoisted(() => ({
  companionVisible: true,
  togglePanel: vi.fn(),
  openPanel: vi.fn(),
  dismissCompanion: vi.fn(),
}));
vi.mock("@/features/rosie/rosieStore", () => ({
  useRosie: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock("./CompanionScene", () => ({ CompanionScene: () => null }));

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
