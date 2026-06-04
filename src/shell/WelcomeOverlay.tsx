import { useEffect, useState } from "react";
import { Sparkles, Folder } from "lucide-react";
import { useShell } from "@/shell/store/useShell";
import { countNotes, countAssets, listAllChats } from "@/lib/db";
import { useProjectStore } from "@/store/projectStore";
import { log } from "@/lib/log";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Late night.";
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  if (h < 22) return "Good evening.";
  return "Late night.";
}

function formatTime(now = new Date()): string {
  return now
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/ /g, " ");
}

type Stats = { notes: number; chats: number; assets: number };

export function WelcomeOverlay() {
  const windows = useShell((s) => s.windows);
  const spotlightOpen = useShell((s) => s.spotlightOpen);
  const openApp = useShell((s) => s.openApp);
  const project = useProjectStore((s) => s.active);
  const recents = useProjectStore((s) => s.recents);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const switchToProject = useProjectStore((s) => s.switchToProject);
  const [now, setNow] = useState(() => new Date());
  const [stats, setStats] = useState<Stats | null>(null);

  const hasVisibleWindows = windows.some((w) => !w.minimized);

  // Tick the clock every minute so the greeting + time stay live.
  useEffect(() => {
    if (hasVisibleWindows) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [hasVisibleWindows]);

  // Read aggregate counts whenever we're about to surface.
  useEffect(() => {
    if (hasVisibleWindows) return;
    let cancelled = false;
    Promise.all([countNotes(), countAssets(), listAllChats(1)])
      .then(([notes, assets, chats]) => {
        if (cancelled) return;
        setStats({ notes, assets, chats: chats.length });
      })
      .catch((e) => log.warn("welcome stats failed", e));
    return () => {
      cancelled = true;
    };
  }, [hasVisibleWindows]);

  // Pull recent projects so the switch chips below have data.
  useEffect(() => {
    if (hasVisibleWindows) return;
    void loadRecents();
  }, [hasVisibleWindows, loadRecents]);

  if (hasVisibleWindows) return null;

  const isFirstLaunch =
    stats !== null && stats.notes === 0 && stats.chats === 0 && stats.assets === 0;

  return (
    <div
      className={`ot-welcome${spotlightOpen ? " dim" : ""}`}
      aria-hidden={spotlightOpen}
    >
      <div className="ot-welcome-card">
        <div className="ot-welcome-time">{formatTime(now)}</div>
        <div className="ot-welcome-greet">{greeting(now)}</div>
        <div className="ot-welcome-tag">Ready when you are.</div>
        <div className="ot-welcome-hint">
          <kbd>⌘K</kbd>
          <span>to begin</span>
        </div>
        {isFirstLaunch ? (
          <div className="ot-welcome-firstrun">
            <div className="ot-welcome-firstrun-title">Welcome to Orion Terminal.</div>
            <div className="ot-welcome-firstrun-body">
              Three apps live here. Open one to start: Archives for thinking,
              Orion for code, XDesign for visuals. Claude shows up inside
              each, contextual to where you are.
            </div>
            <div className="ot-welcome-firstrun-actions">
              <button type="button" onClick={() => openApp("archives")}>
                <Sparkles size={11} color="var(--neon-green)" />
                <span>Archives 47</span>
              </button>
              <button type="button" onClick={() => openApp("orion")}>
                <Sparkles size={11} color="var(--neon-cyan)" />
                <span>Orion</span>
              </button>
              <button type="button" onClick={() => openApp("xdesign")}>
                <Sparkles size={11} color="var(--neon-magenta)" />
                <span>XDesign</span>
              </button>
            </div>
          </div>
        ) : stats ? (
          <>
            <div className="ot-welcome-stats">
              {project ? (
                <span className="ot-welcome-stat">
                  <span className="dot cyan" />
                  {project.name}
                </span>
              ) : null}
              <span className="ot-welcome-stat">
                {stats.notes.toLocaleString()} {stats.notes === 1 ? "note" : "notes"}
              </span>
              <span className="ot-welcome-sep" />
              <span className="ot-welcome-stat">
                {stats.chats.toLocaleString()} {stats.chats === 1 ? "chat" : "chats"}
              </span>
              <span className="ot-welcome-sep" />
              <span className="ot-welcome-stat">
                {stats.assets.toLocaleString()} {stats.assets === 1 ? "asset" : "assets"}
              </span>
            </div>
            {recents.filter((p) => p.id !== project?.id).length > 0 && (
              <div className="ot-welcome-recents">
                {recents
                  .filter((p) => p.id !== project?.id)
                  .slice(0, 4)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ot-welcome-recent"
                      title={p.root_path}
                      onClick={() => {
                        void switchToProject(p);
                        openApp("orion");
                      }}
                    >
                      <Folder size={10} color="var(--neon-cyan)" />
                      <span>{p.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
