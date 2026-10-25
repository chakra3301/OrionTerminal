import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { ariaShortcut, shortcutGlyphs, type MenuEntry, type MenuItem, type MenuSpec } from "./menuModel";
import "./editorMenus.css";

export type PopupPlace = { kind: "below"; el: HTMLElement; align: "start" | "end" } | { kind: "side"; el: HTMLElement } | { kind: "point"; x: number; y: number };
type Focus = "first" | "self" | "none";
type Sub = { index: number; el: HTMLElement; focus: "first" | "none" };

// Fixed positioning is relative to .xd-root (container-type) or a transformed window, so measure the real offset and correct for it.
export function positionPopup(el: HTMLElement, place: PopupPlace) {
  el.style.maxHeight = ""; el.style.left = "0px"; el.style.top = "0px";
  const host = el.closest(".xd-root")?.getBoundingClientRect();
  const bounds = host ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const { width } = el.getBoundingClientRect();
  let { height } = el.getBoundingClientRect();
  let x: number, y: number, space = bounds.bottom - bounds.top;
  if (place.kind === "point") ({ x, y } = place);
  else {
    const anchor = place.el.getBoundingClientRect();
    if (place.kind === "below") {
      x = place.align === "end" ? anchor.right - width : anchor.left; y = anchor.bottom;
      const below = bounds.bottom - anchor.bottom, above = anchor.top - bounds.top;
      // Like macOS pull-downs, never cover the title: flip above only when that side has more room, otherwise scroll.
      if (height > below && above > below) { space = above; y = anchor.top - Math.min(height, above); }
      else space = below;
    }
    else { x = anchor.right; y = anchor.top - 5; if (x + width > bounds.right) x = anchor.left - width; }
  }
  x = Math.max(bounds.left, Math.min(x, bounds.right - width));
  if (height > space) { el.style.maxHeight = `${space}px`; height = space; }
  y = Math.max(bounds.top, Math.min(y, bounds.bottom - height));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  const actual = el.getBoundingClientRect();
  if (actual.width || actual.height) { el.style.left = `${x + (x - actual.left)}px`; el.style.top = `${y + (y - actual.top)}px`; }
}

type PopupProps = {
  items: MenuEntry[]; label: string; place: PopupPlace; focus: Focus;
  choose: (item: MenuItem) => void; dismiss: (refocus: boolean) => void;
  back?: () => void; step?: (direction: 1 | -1) => void; onEnter?: () => void;
};
function Popup({ items, label, place, focus, choose, dismiss, back, step, onEnter }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const hover = useRef(0);
  const typed = useRef({ text: "", timer: 0 });
  const [sub, setSub] = useState<Sub | null>(null);
  const enabled = (index: number) => { const entry = items[index]; return !!entry && entry !== "-" && !entry.disabled; };
  const focusRow = (index: number | undefined) => { if (index !== undefined) rows.current[index]?.focus({ preventScroll: true }); };
  const openSub = (index: number, focus: Sub["focus"]) => { const el = rows.current[index]; if (el) setSub({ index, el, focus }); };
  const activate = (index: number) => {
    const item = items[index];
    if (!item || item === "-" || item.disabled) return;
    if (item.items) openSub(index, "first"); else choose(item);
  };
  useLayoutEffect(() => {
    positionPopup(ref.current!, place);
    const first = items.findIndex((_, index) => enabled(index));
    if (focus === "first" && first >= 0) focusRow(first);
    else if (focus !== "none") ref.current!.focus({ preventScroll: true });
  }, []);
  useEffect(() => () => { clearTimeout(hover.current); clearTimeout(typed.current.timer); }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
    const list = items.flatMap((_, index) => enabled(index) ? [index] : []);
    const current = rows.current.indexOf(document.activeElement as HTMLButtonElement);
    const item = current >= 0 ? items[current] : undefined;
    const subItem = item && item !== "-" && item.items ? item : undefined;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    const text = typed.current;
    switch (event.key) {
      case "ArrowDown": case "ArrowUp": {
        handled();
        if (!list.length) return;
        const at = list.indexOf(current), delta = event.key === "ArrowDown" ? 1 : -1;
        focusRow(at < 0 ? list[delta > 0 ? 0 : list.length - 1] : list[(at + delta + list.length) % list.length]);
        return;
      }
      case "Home": handled(); focusRow(list[0]); return;
      case "End": handled(); focusRow(list[list.length - 1]); return;
      case "ArrowRight":
        if (subItem) { handled(); openSub(current, "first"); }
        else if (step) { handled(); step(1); }
        return;
      case "ArrowLeft":
        if (back) { handled(); back(); }
        else if (sub) { handled(); setSub(null); }
        else if (step) { handled(); step(-1); }
        return;
      case "Escape": handled(); if (back) back(); else dismiss(true); return;
      case "Tab": handled(); dismiss(true); return;
      case "Enter": handled(); if (current >= 0) activate(current); return;
    }
    if (event.key === " " && !text.text) { handled(); if (current >= 0) activate(current); return; }
    if (event.key.length !== 1 || event.altKey) return;
    handled();
    clearTimeout(text.timer);
    text.text += event.key.toLowerCase();
    text.timer = window.setTimeout(() => { text.text = ""; }, 500);
    const from = current < 0 ? 0 : text.text.length > 1 ? current : current + 1;
    for (let offset = 0; offset < items.length; offset++) {
      const index = (from + offset) % items.length, entry = items[index];
      if (enabled(index) && (entry as MenuItem).label.toLowerCase().startsWith(text.text)) { focusRow(index); return; }
    }
  };

  const parent = sub && items[sub.index] as MenuItem;
  return <>
    <div ref={ref} className="xd-menu" role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown} onPointerEnter={onEnter}>
      {items.map((entry, index) => {
        if (entry === "-") return <div key={index} role="separator"/>;
        const role = entry.checked === undefined ? "menuitem" : entry.radio ? "menuitemradio" : "menuitemcheckbox";
        const Icon = entry.icon;
        return <button key={index} ref={node => { rows.current[index] = node; }} type="button" tabIndex={-1} role={role} className={Icon ? "xd-menu-item with-icon" : "xd-menu-item"}
          disabled={entry.disabled} aria-checked={entry.checked} aria-haspopup={entry.items ? "menu" : undefined} aria-expanded={entry.items ? sub?.index === index : undefined}
          data-shortcut={entry.shortcut ? shortcutGlyphs(entry.shortcut) : undefined} aria-keyshortcuts={entry.shortcut ? ariaShortcut(entry.shortcut) : undefined}
          onPointerEnter={() => {
            clearTimeout(hover.current);
            if (!entry.disabled) focusRow(index);
            if (entry.items && !entry.disabled) { if (sub?.index !== index) hover.current = window.setTimeout(() => openSub(index, "none"), 200); }
            else if (sub) hover.current = window.setTimeout(() => setSub(null), 200);
          }}
          onClick={() => { if (entry.items) openSub(index, "none"); else choose(entry); }}>{Icon && <Icon size={16}/>}{entry.label}</button>;
      })}
    </div>
    {sub && parent && <Popup key={`${sub.index}${sub.focus}`} items={parent.items!} label={parent.label} place={{ kind: "side", el: sub.el }} focus={sub.focus}
      choose={choose} dismiss={dismiss} back={() => { setSub(null); focusRow(sub.index); }} step={step} onEnter={() => clearTimeout(hover.current)}/>}
  </>;
}

function useDismiss(root: RefObject<HTMLElement | null>, active: boolean, dismiss: (refocus: boolean) => void) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) latest.current(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active, root]);
}
const leaves = (root: RefObject<HTMLElement | null>, dismiss: (refocus: boolean) => void) => (event: FocusEvent) => {
  if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) dismiss(false);
};

export function MenuBar({ label, menus }: { label: string; menus: MenuSpec[] }) {
  const [open, setOpen] = useState<{ index: number; focus: Focus } | null>(null);
  const [stop, setStop] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  const dismiss = (refocus: boolean) => { setOpen(null); if (refocus && open) titles.current[open.index]?.focus(); };
  const choose = (item: MenuItem) => { dismiss(true); item.run?.(); };
  useDismiss(root, !!open, dismiss);
  useEffect(() => { if (open) setStop(open.index); }, [open?.index]);
  const active = open && menus[open.index];
  return <div ref={root} className="xd-menubar" role="menubar" aria-label={label} onBlur={leaves(root, dismiss)}>
    {menus.map((menu, index) => <button key={menu.label} ref={node => { titles.current[index] = node; }} type="button" role="menuitem" aria-haspopup="menu"
      aria-expanded={open?.index === index} tabIndex={index === stop ? 0 : -1} onFocus={() => setStop(index)}
      onClick={event => setOpen(previous => previous?.index === index ? null : { index, focus: event.detail === 0 ? "first" : "self" })}
      onPointerEnter={() => { if (open && open.index !== index) setOpen({ index, focus: "self" }); }}
      onKeyDown={event => {
        if (event.metaKey || event.ctrlKey) return;
        const handled = () => { event.preventDefault(); event.stopPropagation(); };
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          handled();
          titles.current[(index + (event.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length]?.focus();
        } else if (event.key === "ArrowDown") { handled(); setOpen({ index, focus: "first" }); }
      }}>{menu.label}</button>)}
    {open && active && <Popup key={open.index} items={active.items} label={active.label} place={{ kind: "below", el: titles.current[open.index]!, align: "start" }} focus={open.focus}
      choose={choose} dismiss={dismiss} step={direction => setOpen({ index: (open.index + direction + menus.length) % menus.length, focus: "first" })}/>}
  </div>;
}

export function MenuButton({ label, items, icon: Icon, iconOnly = false, align = "start", className, disabled }: {
  label: string; items: MenuEntry[]; icon?: LucideIcon; iconOnly?: boolean; align?: "start" | "end"; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState<Focus | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = (refocus: boolean) => { setOpen(null); if (refocus) trigger.current?.focus(); };
  const choose = (item: MenuItem) => { dismiss(true); item.run?.(); };
  useDismiss(root, open !== null, dismiss);
  const icon = iconOnly && Icon;
  const base = icon ? "xd-editor-icon-button" : "xd-editor-menu-trigger";
  return <div ref={root} className="xd-editor-menu" onBlur={leaves(root, dismiss)}>
    <button ref={trigger} type="button" className={className ? `${base} ${className}` : base} disabled={disabled} aria-haspopup="menu" aria-expanded={open !== null}
      aria-label={icon ? label : undefined} title={icon ? label : undefined}
      onClick={event => setOpen(previous => previous ? null : event.detail === 0 ? "first" : "self")}
      onKeyDown={event => { if (event.key === "ArrowDown" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); event.stopPropagation(); setOpen("first"); } }}>
      {icon ? <Icon size={16}/> : <>{Icon && <Icon size={14}/>}<span>{label}</span><ChevronDown size={11}/></>}
    </button>
    {open && <Popup items={items} label={label} place={{ kind: "below", el: trigger.current!, align }} focus={open} choose={choose} dismiss={dismiss}/>}
  </div>;
}

export function ContextMenu({ x, y, items, label, close }: { x: number; y: number; items: MenuEntry[]; label: string; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [previous] = useState(() => document.activeElement);
  const closed = useRef(false);
  const dismiss = (refocus: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (refocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    close();
  };
  const choose = (item: MenuItem) => { dismiss(true); item.run?.(); };
  useDismiss(root, true, dismiss);
  return <div ref={root} className="xd-menu-root" onBlur={leaves(root, dismiss)}>
    <Popup items={items} label={label} place={{ kind: "point", x, y }} focus="first" choose={choose} dismiss={dismiss}/>
  </div>;
}
