import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CharacterModelBoundary } from "./CharacterModelBoundary";
import { toast } from "@/store/toastStore";

vi.mock("@/store/toastStore", () => ({ toast: { warning: vi.fn() } }));

it("surfaces a failed model and recovers when a different character is selected", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  function BrokenModel(): never { throw new Error("Model asset could not load"); }
  try {
    act(() => root.render(
      <CharacterModelBoundary key="broken" fallback={<span>core</span>}>
        <BrokenModel />
      </CharacterModelBoundary>,
    ));
    expect(container.textContent).toBe("core");
    expect(toast.warning).toHaveBeenCalledWith(
      "Companion model unavailable · showing the core instead",
      { body: "Model asset could not load" },
    );
    act(() => root.render(
      <CharacterModelBoundary key="replacement" fallback={<span>core</span>}>
        <span>character loaded</span>
      </CharacterModelBoundary>,
    ));
    expect(container.textContent).toBe("character loaded");
  } finally {
    act(() => root.unmount());
    errors.mockRestore();
  }
});
