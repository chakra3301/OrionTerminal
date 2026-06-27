import { useEffect } from "react";
import { useShell, fullscreenWindow, APP_NAMES, type AppId } from "@/shell/store/useShell";

const APP_ACCENT: Record<AppId, string> = {
  archives: "var(--neon-green)",
  orion: "var(--neon-cyan)",
  xdesign: "var(--neon-magenta)",
  hermes: "var(--neon-violet)",
  command: "var(--neon-yellow)",
};

/** Floating app-switcher shown only while a window is in true fullscreen.
 * Tab between open apps without leaving fullscreen; Esc exits. */
export function FullscreenNav() {
  const windows = useShell((s) => s.windows);
  const fs = useShell(fullscreenWindow);
  const enterFullscreen = useShell((s) => s.enterFullscreen);
  const exitFullscreen = useShell((s) => s.exitFullscreen);
  const cycleFullscreen = useShell((s) => s.cycleFullscreen);

  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
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
        return (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ot-fsnav-tab${active ? " active" : ""}`}
            style={{ ["--tab-accent" as string]: APP_ACCENT[w.app] }}
            onClick={() => enterFullscreen(w.id)}
          >
            <span className="ot-fsnav-dot" />
            {APP_NAMES[w.app]}
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
