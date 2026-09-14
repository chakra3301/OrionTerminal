import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HotkeyHost } from "./hotkeys";

const { run, bindings } = vi.hoisted(() => ({
  run: vi.fn(async () => {}),
  bindings: [
    { id: "controlpanel.open", hotkey: "mod+," },
    { id: "palette.open", hotkey: "mod+k" },
    { id: "palette.openCommands", hotkey: "mod+shift+p" },
    { id: "file.save", hotkey: "mod+s" },
  ],
}));
vi.mock("@/commands/registry", () => ({ registry: {
  subscribe: () => () => {},
  hotkeys: () => bindings,
  get: (id: string) => ({ id }),
  run,
} }));

it("binds a literal comma as one chord while retaining ordinary hotkeys", () => {
  run.mockClear();
  const root = createRoot(document.createElement("div"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    act(() => root.render(<HotkeyHost />));
    for (const [key, code, id] of [[",", "Comma", "controlpanel.open"], ["k", "KeyK", "palette.open"]]) {
      const down = new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true });
      act(() => document.dispatchEvent(down));
      expect(run).toHaveBeenLastCalledWith(id);
      expect(down.defaultPrevented).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keyup", { key, code }));
    }
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("blocks shell overlays and background save shortcuts during native dialogs, then resumes", () => {
  run.mockClear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", ""); document.body.append(dialog);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    act(() => root.render(<HotkeyHost />));
    for (const [key, code] of [["k", "KeyK"], [",", "Comma"], ["s", "KeyS"]]) {
      act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true })));
      dialog.dispatchEvent(new KeyboardEvent("keyup", { key, code, bubbles: true }));
    }
    expect(run).not.toHaveBeenCalled();
    dialog.removeAttribute("open");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true, cancelable: true })));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "k", code: "KeyK", bubbles: true }));
    expect(run).toHaveBeenCalledExactlyOnceWith("palette.open");
  } finally {
    act(() => root.unmount()); dialog.remove(); host.remove(); vi.unstubAllGlobals();
  }
});

it("shell shortcuts run before an editor can consume them", () => {
  run.mockClear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  Object.defineProperty(editor, "isContentEditable", { value: true });
  document.body.append(editor);
  const consume = vi.fn((event: Event) => event.stopPropagation());
  editor.addEventListener("keydown", consume);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    act(() => root.render(<HotkeyHost />));
    for (const [key, code, shiftKey, id] of [["k", "KeyK", false, "palette.open"], ["P", "KeyP", true, "palette.openCommands"], [",", "Comma", false, "controlpanel.open"]] as const) {
      const down = new KeyboardEvent("keydown", { key, code, shiftKey, metaKey: true, bubbles: true, cancelable: true });
      act(() => editor.dispatchEvent(down));
      expect(run).toHaveBeenLastCalledWith(id);
      expect(down.defaultPrevented).toBe(true);
      editor.dispatchEvent(new KeyboardEvent("keyup", { key, code, bubbles: true }));
    }
    expect(consume).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    editor.remove(); host.remove(); vi.unstubAllGlobals();
  }
});
