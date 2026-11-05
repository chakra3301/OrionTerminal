import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { ChevronDown, PanelLeft, PanelRight, type LucideIcon } from "lucide-react";
import { ContextMenu } from "./EditorMenus";
import "./editorChrome.css";

type Side = "left" | "right";
type PanelPreferences = { left: boolean | null; right: boolean | null; leftWidth: number; rightWidth: number };
const STORAGE_KEY = "xd-editor-panels-v1";
const DEFAULTS: PanelPreferences = { left: null, right: null, leftWidth: 224, rightWidth: 272 };
const minimum = (side: Side) => side === "left" ? 180 : 220;
function loadPreferences(): PanelPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULTS;
    return {
      left: typeof value.left === "boolean" ? value.left : null,
      right: typeof value.right === "boolean" ? value.right : null,
      leftWidth: Number.isFinite(value.leftWidth) ? Math.max(180, Math.min(360, value.leftWidth)) : DEFAULTS.leftWidth,
      rightWidth: Number.isFinite(value.rightWidth) ? Math.max(220, Math.min(360, value.rightWidth)) : DEFAULTS.rightWidth,
    };
  } catch { return DEFAULTS; }
}
const usePanelPreferences = create<PanelPreferences & { change: (patch: Partial<PanelPreferences>) => void }>((set) => ({
  ...loadPreferences(),
  change: patch => set(previous => {
    const next = { left: previous.left, right: previous.right, leftWidth: previous.leftWidth, rightWidth: previous.rightWidth, ...patch };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Layout remains usable without storage. */ }
    return next;
  }),
}));

export function useEditorPanels() {
  const body = useRef<HTMLDivElement>(null);
  const id = useId();
  const preferences = usePanelPreferences();
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const left = preferences.left ?? width >= 940;
  const right = preferences.right ?? width >= 720;
  const overlay = width < 760;
  const maxWidth = (side: Side) => Math.max(minimum(side), Math.min(360, overlay ? width - 64 : width - 48 - 320 - (side === "left" && right ? preferences.rightWidth : side === "right" && left ? preferences.leftWidth : 0)));
  return {
    body, left, right, overlay,
    leftId: `${id}-layers`, rightId: `${id}-properties`,
    leftWidth: Math.min(preferences.leftWidth, maxWidth("left")),
    rightWidth: Math.min(preferences.rightWidth, maxWidth("right")),
    maxWidth,
    toggle: (side: Side) => preferences.change({ [side]: !(side === "left" ? left : right) }),
    resize: (side: Side, value: number) => preferences.change({ [`${side}Width`]: Math.max(minimum(side), Math.min(maxWidth(side), value)) }),
    reset: (side: Side) => preferences.change({ [`${side}Width`]: DEFAULTS[`${side}Width`] }),
  };
}
export type EditorPanels = ReturnType<typeof useEditorPanels>;

export function PanelToggles({ panels, disabled = false }: { panels: EditorPanels; disabled?: boolean }) {
  return <div className="xd-editor-panel-toggles">
    {(["left", "right"] as const).map(side => {
      const Icon = side === "left" ? PanelLeft : PanelRight;
      const label = side === "left" ? "Layers" : "Properties";
      return <button key={side} type="button" className="xd-editor-icon-button" disabled={disabled}
        aria-label={`${panels[side] ? "Hide" : "Show"} ${label.toLowerCase()} panel`} title={`${panels[side] ? "Hide" : "Show"} ${label}`}
        aria-expanded={panels[side]} aria-controls={side === "left" ? panels.leftId : panels.rightId}
        onClick={() => panels.toggle(side)}><Icon size={16}/></button>;
    })}
  </div>;
}

export function PanelResize({ side, panels }: { side: Side; panels: EditorPanels }) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null);
  const width = side === "left" ? panels.leftWidth : panels.rightWidth;
  const sign = side === "left" ? 1 : -1;
  return <div className={`xd-editor-panel-resize ${side}`} role="separator" tabIndex={0}
    aria-label={`Resize ${side === "left" ? "layers" : "properties"} panel`} aria-orientation="vertical"
    aria-controls={side === "left" ? panels.leftId : panels.rightId}
    aria-valuemin={minimum(side)} aria-valuemax={panels.maxWidth(side)} aria-valuenow={Math.round(width)}
    onDoubleClick={() => panels.reset(side)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width, pointer: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current?.pointer === event.pointerId) panels.resize(side, drag.current.width + sign * (event.clientX - drag.current.x)); }}
    onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      panels.resize(side, event.key === "Home" ? minimum(side) : event.key === "End" ? panels.maxWidth(side) : width + (event.key === "ArrowRight" ? 1 : -1) * sign * (event.shiftKey ? 40 : 10));
    }}/>;
}

export type EditorTool = { id: string; label: string; icon: LucideIcon; shortcut?: string };
export type EditorToolGroup = { label: string; tools: EditorTool[] };
function ToolGroup({ group, active, select, disabled }: { group: EditorToolGroup; active: string; select: (id: string) => void; disabled: boolean }) {
  const [remembered, setRemembered] = useState(group.tools[0]!.id);
  const [flyout, setFlyout] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const hold = useRef(0);
  const wasOpen = useRef(false);
  const activeTool = group.tools.find(tool => tool.id === active);
  useEffect(() => { if (activeTool) setRemembered(activeTool.id); }, [activeTool?.id]);
  useEffect(() => () => clearTimeout(hold.current), []);
  const tool = activeTool ?? group.tools.find(tool => tool.id === remembered) ?? group.tools[0]!;
  const Icon = tool.icon;
  const several = group.tools.length > 1;
  const open = () => { clearTimeout(hold.current); const rect = button.current?.getBoundingClientRect(); if (rect) setFlyout({ x: rect.right + 2, y: rect.top }); };
  const release = () => clearTimeout(hold.current);
  // As with Photoshop's flyout, a press-and-hold can be dragged onto a row and released to choose it. The release lands
  // on a different element than the press, so no click is fired there; touch keeps the press captured on the button.
  const openHeld = () => {
    open();
    document.addEventListener("pointerup", event => {
      const at = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
      const row = at instanceof Element ? at.closest<HTMLButtonElement>("[role^=menuitem]") : null;
      if (row && host.current?.contains(row)) row.click();
    }, { once: true });
  };
  return <div ref={host} className={`xd-editor-tool${activeTool ? " active" : ""}`}>
    <button ref={button} type="button" className="xd-editor-tool-button" aria-label={tool.label} title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}`}
      aria-pressed={!!activeTool} disabled={disabled} onClick={() => select(tool.id)}
      onContextMenu={several ? event => { event.preventDefault(); if (!disabled) open(); } : undefined}
      onPointerDown={several ? event => { if (event.button === 0) { release(); hold.current = window.setTimeout(openHeld, 400); } } : undefined}
      onPointerUp={release} onPointerLeave={release} onPointerCancel={release}><Icon size={18}/></button>
    {several && <button type="button" className="xd-editor-tool-flyout" aria-label={`Choose ${group.label.toLowerCase()}`} title={group.label} aria-haspopup="menu" aria-expanded={!!flyout} disabled={disabled}
      onPointerDown={() => { wasOpen.current = !!flyout; }} onClick={() => { if (wasOpen.current) wasOpen.current = false; else open(); }}/>}
    {flyout && <ContextMenu x={flyout.x} y={flyout.y} label={group.label} close={() => setFlyout(null)}
      items={group.tools.map(option => ({ label: option.label, icon: option.icon, shortcut: option.shortcut, checked: option.id === tool.id, radio: true, run: () => { setRemembered(option.id); select(option.id); } }))}/>}
  </div>;
}
export function EditorToolRail({ groups, active, select, disabled = false, label, children }: { groups: EditorToolGroup[]; active: string; select: (id: string) => void; disabled?: boolean; label: string; children?: ReactNode }) {
  return <div className="xd-editor-toolrail" role="toolbar" aria-label={label} aria-orientation="vertical">
    <div className="xd-editor-toolrail-primary">{groups.map(group => <ToolGroup key={group.label} group={group} active={active} select={select} disabled={disabled}/>)}</div>
    {children && <div className="xd-editor-toolrail-secondary">{children}</div>}
  </div>;
}

export function InspectorSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return <details className="xd-editor-section" open={defaultOpen}><summary>{title}<ChevronDown size={13}/></summary><div className="xd-editor-section-content">{children}</div></details>;
}
