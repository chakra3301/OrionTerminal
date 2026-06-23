import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Code2, Palette, Search, SlidersHorizontal, Radar, Workflow } from "lucide-react";
import { useShell, type AppId, APP_NAMES } from "@/shell/store/useShell";
import { useRosie } from "@/features/rosie/rosieStore";
import { useControlPanel } from "@/store/controlPanelStore";

type DockApp = {
  id: AppId;
  title: string;
  bg: string;
  glow: string;
  fg: string;
  Icon: typeof Archive;
};

const DOCK_APPS: DockApp[] = [
  {
    id: "archives",
    title: APP_NAMES.archives,
    bg: "linear-gradient(135deg, rgba(57,255,136,0.4), rgba(57,255,136,0.05))",
    glow: "0 0 14px -2px rgba(57,255,136,0.4)",
    fg: "#001008",
    Icon: Archive,
  },
  {
    id: "orion",
    title: APP_NAMES.orion,
    bg: "linear-gradient(135deg, rgba(0,224,255,0.45), rgba(0,224,255,0.05))",
    glow: "0 0 14px -2px rgba(0,224,255,0.5)",
    fg: "#011018",
    Icon: Code2,
  },
  {
    id: "xdesign",
    title: APP_NAMES.xdesign,
    bg: "linear-gradient(135deg, rgba(255,62,165,0.4), rgba(255,62,165,0.05))",
    glow: "0 0 14px -2px rgba(255,62,165,0.4)",
    fg: "#1b0613",
    Icon: Palette,
  },
  {
    id: "command",
    title: APP_NAMES.command,
    bg: "linear-gradient(135deg, rgba(255,194,75,0.42), rgba(255,194,75,0.05))",
    glow: "0 0 14px -2px rgba(255,194,75,0.45)",
    fg: "#1c1303",
    Icon: Radar,
  },
  {
    id: "hermes",
    title: APP_NAMES.hermes,
    bg: "linear-gradient(135deg, rgba(255,138,61,0.42), rgba(255,138,61,0.05))",
    glow: "0 0 14px -2px rgba(255,138,61,0.45)",
    fg: "#1c0e03",
    Icon: Workflow,
  },
];

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
        {DOCK_APPS.map((a) => {
          const Icon = a.Icon;
          const active = activeIds.has(a.id);
          return (
            <DockTile
              key={a.id}
              cursorX={cursorX}
              active={active}
              title={a.title}
              onClick={() => handleDockClick(a.id)}
            >
              <div
                className="icon-bed"
                style={{ background: a.bg, boxShadow: a.glow }}
              >
                <Icon size={18} color={a.fg} strokeWidth={2} />
              </div>
            </DockTile>
          );
        })}
        <div className="ot-dock-divider" />
        <DockTile
          cursorX={cursorX}
          title="Spotlight (⌘K)"
          onClick={() => openSpotlight()}
        >
          <Search size={18} color="var(--t-primary)" />
        </DockTile>
        <DockTile
          cursorX={cursorX}
          title="Summon R.O.S.I.E (⌘L)"
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
  onClick,
  interactive = true,
}: {
  children: ReactNode;
  cursorX: number | null;
  active?: boolean;
  title: string;
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
