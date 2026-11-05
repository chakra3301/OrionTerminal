import { describe, expect, it } from "vitest";
import { installPanelDragGuard } from "./panelDragGuard";

function pe(type: string, buttons: number, button = 0) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, buttons, button }) as MouseEvent & { pointerId?: number };
  return e;
}

describe("installPanelDragGuard", () => {
  it("hides WebKit's buttons=0 boundary events from body listeners only while a divider drag is held", () => {
    installPanelDragGuard();
    const handle = document.createElement("div");
    document.body.appendChild(handle);
    const seen: string[] = [];
    const listen = (t: string) => document.body.addEventListener(t, () => seen.push(t), { capture: true });
    listen("pointerleave"); listen("pointerout"); listen("pointermove");

    handle.setAttribute("data-resize-handle-state", "drag");
    window.dispatchEvent(pe("pointerdown", 1));
    document.body.dispatchEvent(pe("pointerleave", 0));
    document.body.dispatchEvent(pe("pointerout", 0));
    expect(seen).toEqual([]);

    // A real move with no button (released outside the window) still reaches the library.
    document.body.dispatchEvent(pe("pointermove", 0));
    expect(seen).toEqual(["pointermove"]);

    window.dispatchEvent(pe("pointerup", 0));
    document.body.dispatchEvent(pe("pointerleave", 0));
    expect(seen).toEqual(["pointermove", "pointerleave"]);

    handle.removeAttribute("data-resize-handle-state");
    window.dispatchEvent(pe("pointerdown", 1));
    document.body.dispatchEvent(pe("pointerout", 0));
    expect(seen).toEqual(["pointermove", "pointerleave", "pointerout"]);
    handle.remove();
  });
});
