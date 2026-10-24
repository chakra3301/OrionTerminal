import { create } from "zustand";

/** Per-user canvas view options (Figma's zoom menu): off by default, like Figma. */
type CanvasView = { rulers: boolean; grid: boolean; toggle: (key: "rulers" | "grid") => void };
const STORAGE_KEY = "xd-canvas-view-v1";

function load(): Pick<CanvasView, "rulers" | "grid"> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return { rulers: value?.rulers === true, grid: value?.grid === true };
  } catch { return { rulers: false, grid: false }; }
}

export const useCanvasView = create<CanvasView>((set, get) => ({
  ...load(),
  toggle: key => {
    const next = { rulers: get().rulers, grid: get().grid, [key]: !get()[key] };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* View still toggles without storage. */ }
    set(next);
  },
}));
