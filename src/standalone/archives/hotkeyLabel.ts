/** "mod+shift+n" → "⌘⇧N" for menus and the palette. */
export function formatHotkey(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      const k = part.toLowerCase();
      if (k === "mod" || k === "meta" || k === "cmd") return "⌘";
      if (k === "shift") return "⇧";
      if (k === "alt" || k === "option") return "⌥";
      if (k === "ctrl") return "⌃";
      if (k === "comma") return ",";
      return part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1);
    })
    .join("");
}

/** "mod+shift+n" → "CmdOrCtrl+Shift+N" for native menu accelerators. */
export function toAccelerator(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      const k = part.toLowerCase();
      if (k === "mod") return "CmdOrCtrl";
      if (k === "shift") return "Shift";
      if (k === "alt") return "Alt";
      if (k === "ctrl") return "Ctrl";
      if (k === "comma") return ",";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}
