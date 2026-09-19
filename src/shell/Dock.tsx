import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useShell } from "@/shell/store/useShell";
import { useAppDescriptors, type AppId } from "@/plugins/appRegistry";
import { useRosie } from "@/features/rosie/rosieStore";
import { useControlPanel } from "@/store/controlPanelStore";
import { ThemeBorder } from "@/components/effects/ThemeBorder";

// Magnify tuning. `INFLUENCE` is how far (in px) the cursor's effect on a
// dock item reaches; `MAX_SCALE` is the peak size of the closest item.
const INFLUENCE = 110;
const MAX_SCALE = 1.55;
const HOVER_LIFT = 12;

function magnifyScale(distance: number): number {
  if (distance >= INFLUENCE) return 1;
  // Cosine falloff — feels closer to macOS dock than a linear ramp.
  const t = 1 - distance / INFLUENCE;
  const eased = (1 - Math.cos(t * Math.PI)) / 2;
  return 1 + (MAX_SCALE - 1) * eased;
}

export function Dock() {
  const openApp = useShell((s) => s.openApp);
  const minimizeWindow = useShell((s) => s.minimizeWindow);
  const openSpotlight = useShell((s) => s.openSpotlight);
  const windows = useShell((s) => s.windows);
  const focusedWindowId = useShell((s) => s.focusedWindowId);
  const apps = useAppDescriptors();

  const activeIds = new Set(
    windows.filter((w) => !w.minimized).map((w) => w.app),
  );

  const handleDockClick = (app: AppId) => {
    const visible = windows.find((w) => w.app === app && !w.minimized);
    if (visible && visible.id === focusedWindowId) {
      minimizeWindow(visible.id);
      return;
    }
    openApp(app);
  };

  const dockRef = useRef<HTMLDivElement>(null);
  const [cursorX, setCursorX] = useState<number | null>(null);

  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientY >= rect.top - 24 &&
        e.clientY <= rect.bottom + 24 &&
        e.clientX >= rect.left - 24 &&
        e.clientX <= rect.right + 24;
      if (inside) setCursorX(e.clientX);
      else setCursorX(null);
    };
    const onLeave = () => setCursorX(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div className="ot-dock-wrap">
      <div className="ot-dock" ref={dockRef}>
        <ThemeBorder />
        {apps.map((a) => {
          const Icon = a.dock.Icon;
          const active = activeIds.has(a.id);
          return (
            <DockTile
              key={a.id}
              cursorX={cursorX}
              active={active}
              title={a.name}
              coachId={`app-${a.id}`}
              onClick={() => handleDockClick(a.id)}
            >
              <div
                className="icon-bed"
                style={{ background: a.dock.background, boxShadow: a.dock.glow }}
              >
                <Icon size={18} color={a.dock.foreground} strokeWidth={2} />
              </div>
            </DockTile>
          );
        })}
        <div className="ot-dock-divider" />
        <DockTile
          cursorX={cursorX}
          title="Spotlight (⌘K)"
          coachId="spotlight"
          onClick={() => openSpotlight()}
        >
          <Search size={18} color="var(--t-primary)" />
        </DockTile>
        <DockTile
          cursorX={cursorX}
          title="Summon R.O.S.I.E (⌘L)"
          coachId="rosie"
          onClick={() => useRosie.getState().togglePanel()}
        >
          <div
            className="ot-claude-orb"
            style={{ width: 24, height: 24 }}
            aria-hidden
          />
        </DockTile>
        <DockTile
          cursorX={cursorX}
          title="Control Panel (⌘,)"
          onClick={() => useControlPanel.getState().show()}
        >
          <SlidersHorizontal size={18} color="var(--t-primary)" />
        </DockTile>
      </div>
    </div>
  );
}

function DockTile({
  children,
  cursorX,
  active,
  title,
  coachId,
  onClick,
  interactive = true,
}: {
  children: ReactNode;
  cursorX: number | null;
  active?: boolean;
  title: string;
  coachId?: string;
  onClick?: () => void;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el || cursorX == null) {
      setScale(1);
      return;
    }
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const distance = Math.abs(cursorX - center);
    setScale(magnifyScale(distance));
  }, [cursorX]);

  const lift = scale > 1 ? HOVER_LIFT * (scale - 1) * 1.6 : 0;
  const transform = `translateY(${-lift}px) scale(${scale.toFixed(3)})`;
  return (
    <button
      ref={ref}
      type="button"
      className={`ot-dock-item${active ? " active" : ""}`}
      onClick={onClick}
      title={title}
      data-coach={coachId}
      style={{
        transform,
        transformOrigin: "50% 100%",
        transition: cursorX == null ? "transform 0.25s ease" : "none",
        cursor: interactive ? "pointer" : "default",
      }}
      tabIndex={interactive ? 0 : -1}
    >
      {children}
    </button>
  );
}
