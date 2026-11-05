import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Search, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { DOCK_REACH, useShell } from "@/shell/store/useShell";
import { useAppDescriptors, type AppId } from "@/plugins/appRegistry";
import { useRosie } from "@/features/rosie/rosieStore";
import { useControlPanel } from "@/store/controlPanelStore";
import { ThemeBorder } from "@/components/effects/ThemeBorder";
import { DockIcon } from "./dock/DockIcon";
import { RosieOrb } from "./dock/RosieOrb";
import { decodeName, dockApps, dockLabel, fixedDockAccent, magnifyScale, pickLifted } from "./dock/logic";
import archivesGlyph from "@/assets/dock/glyph-archives.png";
import orionGlyph from "@/assets/dock/glyph-orion.png";
import xdesignGlyph from "@/assets/dock/glyph-xdesign.png";
import incubatorGlyph from "@/assets/dock/glyph-rosie.png";

const GLYPHS: Record<string, string> = { archives: archivesGlyph, orion: orionGlyph, xdesign: xdesignGlyph, incubator: incubatorGlyph };
type Item = { id: string; name: string; color: string; Icon?: LucideIcon; glyph?: string; shortcut?: string; coachId?: string; utility?: boolean; orb?: boolean; active?: boolean; onClick: () => void };
const colorStyle = (color: string) => ({ "--dock-color": color }) as CSSProperties;

function placeName(dock: HTMLDivElement, label: HTMLDivElement, id: string) {
  const item = [...dock.querySelectorAll<HTMLButtonElement>("[data-dock-id]")].find((el) => el.dataset.dockId === id);
  if (!item) return;
  const r = item.getBoundingClientRect(), dk = dock.getBoundingClientRect(), wrap = dock.parentElement!.getBoundingClientRect(), width = label.offsetWidth;
  const top = id === "rosie" ? r.top + r.height / 2 + 15 * (r.width / 64) + 2 : r.bottom + 1;
  const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, dk.left + 10), dk.right - 10 - width);
  label.style.transform = `translate(${left - wrap.left}px, ${top - wrap.top}px)`;
}

function DockName({ item, visible, reduced, dockRef, labelRef }: { item: Item | undefined; visible: boolean; reduced: boolean; dockRef: RefObject<HTMLDivElement | null>; labelRef: RefObject<HTMLDivElement | null> }) {
  useLayoutEffect(() => {
    const label = labelRef.current, dock = dockRef.current;
    if (!item || !label || !dock || !visible) return;
    let frame = 0;
    const since = performance.now();
    const draw = (now: number) => {
      const elapsed = now - since;
      label.textContent = decodeName(item.name, elapsed, reduced);
      placeName(dock, label, item.id);
      if (!reduced && elapsed < 90 + (Array.from(item.name).length - 1) * 30) frame = requestAnimationFrame(draw);
    };
    draw(since);
    return () => cancelAnimationFrame(frame);
  }, [item?.id, item?.name, visible, reduced, dockRef, labelRef]);
  return <div ref={labelRef} className={`ot-dock-label${visible ? " on" : ""}`} style={colorStyle(item?.color ?? "var(--dock-utility)")} aria-hidden="true" />;
}

export function Dock() {
  const openApp = useShell((s) => s.openApp), minimizeWindow = useShell((s) => s.minimizeWindow), openSpotlight = useShell((s) => s.openSpotlight);
  const windows = useShell((s) => s.windows), focusedWindowId = useShell((s) => s.focusedWindowId);
  const descriptors = useAppDescriptors();
  const apps = useMemo(() => dockApps(descriptors), [descriptors]);
  const dockRef = useRef<HTMLDivElement>(null), labelRef = useRef<HTMLDivElement>(null), liftedRef = useRef<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null), [lastId, setLastId] = useState<string | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"), change = () => setReduced(media.matches);
    media.addEventListener("change", change); return () => media.removeEventListener("change", change);
  }, []);

  const handleDockClick = (app: AppId) => {
    const visible = windows.find((w) => w.app === app && !w.minimized);
    if (visible && visible.id === focusedWindowId) { minimizeWindow(visible.id); return; }
    openApp(app);
  };
  const activeIds = new Set(windows.filter((w) => !w.minimized).map((w) => w.app));
  const items: Item[] = [
    ...apps.map((app) => ({ id: app.id, name: app.name, color: fixedDockAccent(app.accent), Icon: app.dock.Icon, glyph: GLYPHS[app.id], coachId: `app-${app.id}`, active: activeIds.has(app.id), onClick: () => handleDockClick(app.id) })),
    { id: "rosie", name: "R.O.S.I.E", color: "var(--dock-cyan)", shortcut: "⌘L", coachId: "rosie", orb: true, onClick: () => useRosie.getState().togglePanel() },
    { id: "spotlight", name: "Spotlight", color: "var(--dock-utility)", shortcut: "⌘K", coachId: "spotlight", utility: true, Icon: Search, onClick: () => openSpotlight() },
    { id: "control", name: "Control Panel", color: "var(--dock-utility)", shortcut: "⌘,", utility: true, Icon: SlidersHorizontal, onClick: () => useControlPanel.getState().show() },
  ];

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    let pointerX: number | null = null, focusId: string | null = null;
    const apply = () => {
      const buttons = [...dock.querySelectorAll<HTMLButtonElement>("[data-dock-id]")];
      const metrics = buttons.map((button) => { const r = button.getBoundingClientRect(); return { id: button.dataset.dockId!, center: r.left + r.width / 2, width: r.width }; });
      const cursor = focusId ? metrics.find((m) => m.id === focusId)?.center ?? null : pointerX;
      for (const [i, button] of buttons.entries()) {
        const scale = cursor == null ? 1 : magnifyScale(Math.abs(cursor - metrics[i]!.center), button.dataset.dockId === "rosie" ? 1.2 : 1.55);
        const lift = scale > 1 ? 12 * (scale - 1) * 1.6 : 0;
        button.style.transition = cursor == null ? "transform .25s ease" : "none";
        button.style.transform = `translateY(${-lift}px) scale(${scale.toFixed(3)})`;
      }
      const next = focusId ?? pickLifted(metrics, cursor);
      if (next !== liftedRef.current) {
        liftedRef.current = next; setLiftedId(next); if (next) setLastId(next);
      }
      if (next && labelRef.current) placeName(dock, labelRef.current, next);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = dock.getBoundingClientRect();
      const inside = e.clientY >= r.top - DOCK_REACH && e.clientY <= r.bottom + DOCK_REACH && e.clientX >= r.left - DOCK_REACH && e.clientX <= r.right + DOCK_REACH;
      if (!inside && pointerX == null) return;
      pointerX = inside ? e.clientX : null; apply();
    };
    const leave = () => { pointerX = null; apply(); };
    const focus = (e: FocusEvent) => {
      const button = (e.target as Element).closest<HTMLButtonElement>("[data-dock-id]");
      if (button?.matches(":focus-visible")) { focusId = button.dataset.dockId!; apply(); }
    };
    const blur = () => { focusId = null; apply(); };
    window.addEventListener("pointermove", move); window.addEventListener("mouseleave", leave);
    window.addEventListener("resize", leave); dock.addEventListener("focusin", focus); dock.addEventListener("focusout", blur);
    apply();
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("mouseleave", leave); window.removeEventListener("resize", leave); dock.removeEventListener("focusin", focus); dock.removeEventListener("focusout", blur); };
  }, [apps]);

  return <div className="ot-dock-wrap">
    <div className="ot-dock" ref={dockRef}>
      <ThemeBorder />
      {items.map((item) => <DockEntry key={item.id} item={item} lifted={liftedId === item.id} reduced={reduced} />)}
    </div>
    <DockName item={items.find((item) => item.id === lastId)} visible={liftedId != null} reduced={reduced} dockRef={dockRef} labelRef={labelRef} />
  </div>;
}

function DockEntry({ item, lifted, reduced }: { item: Item; lifted: boolean; reduced: boolean }) {
  return <>
    {item.id === "spotlight" && <div className="ot-dock-divider" aria-hidden="true" />}
    <button type="button" className={`ot-dock-item${item.orb ? " ot-dock-orb-slot" : ""}${item.active ? " active" : ""}${lifted ? " labeled" : ""}`}
      aria-label={dockLabel(item.name, item.shortcut)} data-coach={item.coachId} data-dock-id={item.id} style={colorStyle(item.color)} onClick={item.onClick}>
      {item.orb ? <RosieOrb reduced={reduced} /> : <DockIcon glyph={item.glyph} Icon={item.Icon!} utility={item.utility} lifted={lifted} reduced={reduced} />}
    </button>
  </>;
}
