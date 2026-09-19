import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronUp, Pin, PinOff, Settings, X } from "lucide-react";
import { NOTCH, notchLayout, notchPath, springEasing } from "./notchGeometry";
import { NotchSettings } from "./NotchSettings";
import type { Metric, NotchPreferences } from "./notchPreferences";
import type { MonitorCell } from "./monitorCells";
import "../monitorNotch.css";

type Card = Metric | "settings";
const UNFOLD = springEasing(.42, .78, .6);
const CONTENTS = springEasing(.36, .82, .5);
const GLIDE = springEasing(.5, .86, .7);
const cssEase = (value: string) => typeof CSS !== "undefined" && CSS.supports("transition-timing-function", value) ? value : "cubic-bezier(.22,1,.36,1)";

export function MonitorNotch({ preferences, cells, onChange, onActiveChange }: {
  preferences: NotchPreferences;
  cells: MonitorCell[];
  onChange: (change: Partial<NotchPreferences>) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const wake = useRef<HTMLButtonElement>(null);
  const cardContent = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreFocus = useRef(false);
  const pointerFocus = useRef(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [card, setCard] = useState<{ shown: Card; visible: boolean }>({ shown: "cpu", visible: false });
  const [viewportHeight, setViewportHeight] = useState(() => typeof window === "undefined" ? 800 : window.innerHeight);
  const [cardHeight, setCardHeight] = useState(160);
  const detailId = useId();
  const isSettings = card.shown === "settings";
  const settingsOpen = isSettings && card.visible;
  const expanded = preferences.mode === "always" || hoverOpen || focusWithin || pinned || settingsOpen;
  const visibleCells = preferences.metrics.flatMap(id => cells.filter(c => (c.preferenceId ?? c.id) === id));
  const options = [...new Map(cells.map(c => [c.preferenceId ?? c.id, { id: c.preferenceId ?? c.id, title: c.title }])).values()];
  const base = notchLayout(Math.min(visibleCells.length, 3), 1, preferences.labels);
  const scale = Math.min(preferences.scale, Math.max(.4, (viewportHeight - 150) / base.height));
  const layout = notchLayout(visibleCells.length, scale, preferences.labels);
  const openHeight = Math.min(layout.height, Math.max(NOTCH.pillHeight * scale, viewportHeight - 128));
  const scrollable = layout.height > openHeight + 1;
  const center = 64 + openHeight / 2 + Math.max(0, viewportHeight - 128 - openHeight) * preferences.position;
  const width = expanded ? layout.width : NOTCH.pillWidth * scale;
  const height = expanded ? openHeight : NOTCH.pillHeight * scale;
  const current = cells.find(c => c.id === card.shown);
  const index = visibleCells.findIndex(c => c.id === card.shown);
  const detailVisible = expanded && card.visible && (isSettings || index >= 0);
  const desiredCardCenter = isSettings ? center : center - openHeight / 2 + layout.ringCenter(Math.max(0, index)) - scrollTop;
  const clampedCardCenter = Math.max(24 + cardHeight / 2, Math.min(viewportHeight - 24 - cardHeight / 2, desiredCardCenter));
  const cardTop = clampedCardCenter - center;
  const tailOffset = Math.max(25, Math.min(cardHeight - 25, desiredCardCenter - clampedCardCenter + cardHeight / 2));

  function clearFold() { if (foldTimer.current) clearTimeout(foldTimer.current); foldTimer.current = null; }
  function clearDetail() { if (detailTimer.current) clearTimeout(detailTimer.current); detailTimer.current = null; }
  function reveal() { clearFold(); setHoverOpen(true); }
  function hideDetailLater() {
    clearDetail();
    detailTimer.current = setTimeout(() => setCard(c => c.shown === "settings" ? c : { ...c, visible: false }), 250);
  }
  function leave() {
    clearFold(); hideDetailLater();
    foldTimer.current = setTimeout(() => {
      if (!root.current?.matches(":hover")) setHoverOpen(false);
    }, preferences.closeDelay);
  }
  function show(id: Card) {
    clearDetail(); reveal();
    setCard({ shown: id, visible: true });
  }
  function dismissCard(restoreFocus = false) {
    clearDetail();
    if (restoreFocus) {
      ignoreFocus.current = true;
      root.current?.querySelector<HTMLButtonElement>(card.shown === "settings" ? '[data-control="settings"]' : `[data-metric="${card.shown}"]`)?.focus();
      ignoreFocus.current = false;
    }
    setCard(c => ({ ...c, visible: false }));
  }
  function fold() {
    clearFold(); clearDetail();
    setPinned(false); setHoverOpen(false); setFocusWithin(false); setCard(c => ({ ...c, visible: false }));
    ignoreFocus.current = true;
    wake.current?.focus();
    ignoreFocus.current = false;
  }

  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); clearFold(); clearDetail(); };
  }, []);
  useEffect(() => { onActiveChange?.(expanded); }, [expanded, onActiveChange]);
  useEffect(() => {
    if (!isSettings && index < 0) {
      if (card.visible) setCard(c => ({ ...c, visible: false }));
      if (focusWithin && !root.current?.contains(document.activeElement)) setFocusWithin(false);
    }
  }, [index, isSettings, card.visible, focusWithin]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setCard(c => ({ ...c, visible: false })); setHoverOpen(false); setFocusWithin(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  useLayoutEffect(() => {
    const content = cardContent.current;
    if (!content) return;
    const measure = () => setCardHeight(Math.min(content.scrollHeight, viewportHeight - 48));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [card.shown, viewportHeight]);

  const colorFor = (cell: MonitorCell) => preferences.color === "mono" ? "#f5f5f5" : preferences.color === "app" ? cell.accent : cell.percent == null ? "#8a8a8a" : cell.percent >= 90 ? "#ff4d00" : cell.percent >= 70 ? "#e5f52b" : "#00ed8b";
  const style = {
    top: center, width, height,
    "--notch-scale": scale, "--notch-open-width": `${layout.width}px`,
    "--notch-unfold": cssEase(UNFOLD), "--notch-contents": cssEase(CONTENTS), "--notch-glide": cssEase(GLIDE),
    "--notch-shape": `path('${notchPath(width, height, scale)}')`,
    "--notch-orb-inset": `${NOTCH.curl * scale}px`,
  } as CSSProperties;

  return <aside ref={root} className="ot-monitor-notch" style={style} data-edge={preferences.edge} data-expanded={expanded} data-hover-open={hoverOpen} data-keyboard-focus={focusWithin} data-pinned={pinned} data-animate={preferences.animate} data-surface={preferences.surface} aria-label="System and usage notch"
    onPointerEnter={e => { if (e.pointerType !== "touch") { reveal(); clearDetail(); } }} onPointerLeave={leave}
    onPointerDown={() => { pointerFocus.current = true; setFocusWithin(false); }}
    onPointerUp={() => { pointerFocus.current = false; }} onPointerCancel={() => { pointerFocus.current = false; }}
    onFocus={e => {
      if (ignoreFocus.current) return;
      const keyboard = !pointerFocus.current && e.target.matches(":focus-visible");
      if (keyboard) clearFold();
      setFocusWithin(keyboard);
    }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setFocusWithin(false); leave(); } }}
    onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (card.visible) dismissCard(true); else fold(); }
    }}>
    <button ref={wake} type="button" className="ot-notch-wake" aria-label="Open system monitor" aria-expanded={expanded} tabIndex={expanded ? -1 : 0} onClick={() => { reveal(); setPinned(true); }} />
    <div className="ot-notch-frame">
      <div ref={scroller} className="ot-notch-scroll" data-scrollable={scrollable} style={{ top: NOTCH.curl * scale, bottom: NOTCH.curl * scale }} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="ot-notch-cells" style={{ height: layout.height - 2 * NOTCH.curl * scale }} inert={!expanded} aria-hidden={!expanded}>
        {visibleCells.map((cell, i) => <button type="button" key={cell.id} className="ot-notch-cell" data-metric={cell.id} data-active={cell.active || undefined}
          style={{ top: layout.cellTop(i) - NOTCH.curl * scale, width: layout.width, "--notch-tone": colorFor(cell), "--cell-delay": `${Math.min(i * 45, 180)}ms` } as CSSProperties}
          aria-label={`${cell.title}: ${cell.accessibleValue ?? cell.value}`} aria-expanded={card.visible && card.shown === cell.id} aria-controls={detailId}
          onPointerEnter={e => { if (e.pointerType !== "touch" && !settingsOpen) show(cell.id); }} onPointerLeave={hideDetailLater}
          onFocus={() => { if (!ignoreFocus.current) show(cell.id); }} onClick={() => show(cell.id)}>
          <span className="ot-notch-ring" aria-hidden="true"><svg viewBox="0 0 44 44" fill="none">
            <circle className="ot-notch-ring-track" cx="22" cy="22" r="19.085" />
            <circle className="ot-notch-ring-value" cx="22" cy="22" r="19.085" pathLength="100" strokeDasharray={`${cell.percent ?? 0} 100`} opacity={cell.percent == null || cell.percent === 0 ? 0 : 1} transform="rotate(-90 22 22)" />
            {cell.active && <circle className="ot-notch-ring-activity" cx="22" cy="22" r="13" pathLength="100" strokeDasharray="20 80" />}
          </svg><span>{cell.icon}</span></span>
          <strong>{cell.value}</strong>{preferences.labels && <span className="ot-notch-cell-label">{cell.label}</span>}
        </button>)}
      </div>
      </div>
      {expanded && scrollable && scrollTop > 4 && <button type="button" className="ot-notch-scroll-step" style={{ top: NOTCH.curl * scale + 2 }} aria-label="Scroll to earlier trackers" onClick={() => scroller.current?.scrollBy({ top: -openHeight / 2 })}><ChevronUp size={12} /></button>}
      {expanded && scrollable && scrollTop < layout.height - openHeight - 4 && <button type="button" className="ot-notch-scroll-step" style={{ bottom: NOTCH.curl * scale + 2 }} aria-label="Scroll to more trackers" onClick={() => scroller.current?.scrollBy({ top: openHeight / 2 })}><ChevronDown size={12} /></button>}
    </div>
    <div className="ot-notch-accessories" inert={!expanded} aria-hidden={!expanded}>
      <button type="button" className="ot-notch-orb ot-notch-pin" data-pinned={pinned} title={pinned ? "Unpin notch" : "Keep notch open"} aria-label={pinned ? "Unpin notch" : "Keep notch open"} aria-pressed={pinned}
        onClick={() => { setPinned(p => !p); if (pinned) leave(); }}><svg className="ot-notch-orb-arc" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 60 A28 28 0 0 0 60 32" /></svg><span>{pinned ? <PinOff size={19} /> : <Pin size={19} />}</span></button>
      <button type="button" className="ot-notch-orb ot-notch-gear" data-control="settings" data-selected={settingsOpen} title="Customize notch" aria-label="Customize notch" aria-expanded={settingsOpen} aria-controls={detailId}
        onClick={() => settingsOpen ? dismissCard(true) : show("settings")}><svg className="ot-notch-orb-arc" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 4 A28 28 0 0 1 60 32" /></svg><span><Settings size={20} /></span></button>
    </div>
    <div className="ot-notch-detail-anchor" data-visible={detailVisible} data-settings={isSettings} aria-hidden={!detailVisible} inert={!detailVisible}
      style={{ top: `calc(50% + ${cardTop}px)`, height: cardHeight, "--card-width": `${isSettings ? 312 : NOTCH.cardWidth}px`, "--tail-y": `${tailOffset}px`, "--notch-tone": current ? colorFor(current) : "#00ed8b" } as CSSProperties}
      onPointerEnter={clearDetail} onPointerLeave={hideDetailLater}>
      <svg className="ot-notch-card-tail" viewBox="0 0 29 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0 C0 9 3 11 11 14 L29 17 L11 20 C3 23 0 25 0 34 Z" /></svg>
      <section id={detailId} className="ot-notch-detail" aria-labelledby={`${detailId}-title`} style={{ height: cardHeight }}>
        <div ref={cardContent} className="ot-notch-card-content">
          <header><span className="ot-notch-detail-icon">{card.shown === "settings" ? <Settings /> : current?.icon}</span><h2 id={`${detailId}-title`}>{card.shown === "settings" ? "Customize notch" : current?.title}</h2><button type="button" aria-label="Close notch details" title="Close (Escape)" onClick={() => dismissCard(true)}><X size={12} /></button></header>
          <div key={card.shown} className="ot-notch-detail-body">{card.shown === "settings" ? <NotchSettings value={preferences} onChange={onChange} available={options} /> : current?.detail}</div>
        </div>
      </section>
    </div>
  </aside>;
}
