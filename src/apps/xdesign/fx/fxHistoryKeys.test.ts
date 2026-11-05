import { describe, it, expect } from "vitest";
import { fxHistoryShortcut } from "./fxHistoryKeys";

function ev(init: Partial<KeyboardEvent> & { target?: Element }) {
  return {
    key: "z",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    target: document.createElement("div"),
    ...init,
  } as unknown as KeyboardEvent;
}

describe("fxHistoryShortcut", () => {
  it("maps cmd/ctrl+Z to undo and shift+cmd+Z to redo", () => {
    expect(fxHistoryShortcut(ev({}))).toBe("undo");
    expect(fxHistoryShortcut(ev({ metaKey: false, ctrlKey: true }))).toBe("undo");
    expect(fxHistoryShortcut(ev({ shiftKey: true, key: "Z" }))).toBe("redo");
  });

  it("ignores other keys, alt-modified and plain Z", () => {
    expect(fxHistoryShortcut(ev({ key: "y" }))).toBeNull();
    expect(fxHistoryShortcut(ev({ metaKey: false }))).toBeNull();
    expect(fxHistoryShortcut(ev({ altKey: true }))).toBeNull();
    expect(fxHistoryShortcut(ev({ isComposing: true }))).toBeNull();
  });

  it("leaves text-entry targets to the browser", () => {
    for (const html of [
      "<input type='text'>",
      "<input type='number'>",
      "<input>",
      "<textarea></textarea>",
      "<select></select>",
      "<div contenteditable='true'></div>",
    ]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(fxHistoryShortcut(ev({ target: host.firstElementChild! }))).toBeNull();
    }
  });

  it("leaves the Monaco shader editor alone", () => {
    const host = document.createElement("div");
    host.innerHTML = "<div class='monaco-editor'><div class='view-lines'></div></div>";
    const inner = host.querySelector(".view-lines")!;
    expect(fxHistoryShortcut(ev({ target: inner }))).toBeNull();
  });

  it("still fires from non-text controls that keep focus after a drag", () => {
    for (const html of ["<input type='range'>", "<input type='color'>", "<button></button>"]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(fxHistoryShortcut(ev({ target: host.firstElementChild! }))).toBe("undo");
    }
  });
});
