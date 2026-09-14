import { useEffect } from "react";
import { useShell, fullscreenWindow } from "@/shell/store/useShell";
import { useAppDescriptors } from "@/plugins/appRegistry";

/** Floating app-switcher shown only while a window is in true fullscreen.
 * Tab between open apps without leaving fullscreen; Esc exits. */
export function FullscreenNav() {
  const windows = useShell((s) => s.windows);
  const fs = useShell(fullscreenWindow);
  const enterFullscreen = useShell((s) => s.enterFullscreen);
  const exitFullscreen = useShell((s) => s.exitFullscreen);
  const cycleFullscreen = useShell((s) => s.cycleFullscreen);
  const apps = useAppDescriptors();
  const appById = new Map(apps.map((app) => [app.id, app]));

  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useShell.getState().spotlightOpen ||
          document.querySelector('dialog[open], [aria-modal="true"], [role="menu"]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exitFullscreen();
      } else if (e.key === "Tab" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        cycleFullscreen(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fs, exitFullscreen, cycleFullscreen]);

  if (!fs) return null;

  const open = windows
    .filter((w) => !w.minimized)
    .sort((a, b) => a.z - b.z);

  return (
    <div className="ot-fsnav" role="tablist" aria-label="Open apps">
      {open.map((w) => {
        const active = w.id === fs.id;
        const descriptor = appById.get(w.app);
        if (!descriptor) return null;
        return (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ot-fsnav-tab${active ? " active" : ""}`}
            style={{ ["--tab-accent" as string]: descriptor.accent }}
            onClick={() => enterFullscreen(w.id)}
          >
            <span className="ot-fsnav-dot" />
            {descriptor.name}
          </button>
        );
      })}
      <div className="ot-fsnav-sep" />
      <button
        type="button"
        className="ot-fsnav-exit"
        title="Exit Full Screen (Esc)"
        onClick={() => exitFullscreen()}
      >
        ⤬ Exit
      </button>
    </div>
  );
}
