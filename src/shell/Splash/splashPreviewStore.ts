import { create } from "zustand";

/** Dev-only harness for scrutinizing the boot splash without relaunching.
 * Toggled by the `dev.splashPreview` command (registered only when
 * import.meta.env.DEV); inert in the bundled .app. */
type SplashPreviewState = {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
};

export const useSplashPreview = create<SplashPreviewState>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
