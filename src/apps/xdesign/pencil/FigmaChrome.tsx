import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@open-pencil/core/editor";
import type { SceneNode } from "@open-pencil/scene-graph";
import { Check, ChevronDown, ChevronRight, Circle, CodeXml, Columns3, Component, Diamond, Eye, EyeOff, Hash, Image, Lock, LockOpen, MessageCircle, Minus, PanelTop, Plus, Rows3, Spline, Square, SquareDashed, Star, Triangle, Type, type LucideIcon } from "lucide-react";
import type { EditorToolGroup } from "../EditorChrome";
import { useContextMenu } from "@/components/ContextMenu";

export type MenuEntry = "separator" | { label: string; hint?: string; checked?: boolean; disabled?: boolean; onSelect: () => void };

/** Figma-style dropdown. Renders in-tree (not portaled) so it follows its panel. */
export function Popover({ label, title, icon, text, items, side = "bottom", align = "start", className = "", disabled = false, pressed }: {
  label: string; title?: string; icon?: ReactNode; text?: ReactNode; items: () => MenuEntry[];
  side?: "top" | "bottom" | "right"; align?: "start" | "end"; className?: string; disabled?: boolean; pressed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>(".xd-figma-menu button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className={`xd-figma-popover ${className}`} ref={root} onKeyDown={event => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>(".xd-figma-menu button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    event.preventDefault(); event.stopPropagation();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>
    <button ref={trigger} type="button" className="xd-figma-popover-trigger" aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open} aria-pressed={pressed} disabled={disabled} onClick={() => setOpen(previous => !previous)}>{icon}{text}</button>
    {open && <div className="xd-figma-menu" role="menu" aria-label={label} data-side={side} data-align={align}>
      {items().map((item, index) => item === "separator" ? <hr key={index}/> :
        <button key={item.label} type="button" role="menuitem" aria-label={item.label} disabled={item.disabled} onClick={() => { close(); item.onSelect(); }}>
          <span className="xd-figma-menu-check">{item.checked && <Check size={12}/>}</span><span className="xd-figma-menu-label">{item.label}</span>{item.hint && <kbd>{item.hint}</kbd>}
        </button>)}
    </div>}
  </div>;
}

/** Figma UI3's floating bottom toolbar: tool groups with flyouts, then comments, actions and the Dev Mode switch. */
export function FigmaToolbar({ groups, active, select, disabled, comments, extra, devMode }: {
  groups: EditorToolGroup[]; active: string; select: (id: string) => void; disabled: boolean;
  comments: { pressed: boolean; disabled: boolean; toggle: () => void }; extra: ReactNode;
  devMode: { pressed: boolean; toggle: () => void };
}) {
  return <div className="xd-figma-toolbar" role="toolbar" aria-label="Design tools">
    <div className="xd-figma-toolbar-tools">
      {groups.map(group => <ToolbarGroup key={group.label} group={group} active={active} select={select} disabled={disabled}/>)}
      <button type="button" className="xd-figma-tool" aria-label="Comments" title="Comment (C)" aria-pressed={comments.pressed} disabled={comments.disabled} onClick={comments.toggle}><MessageCircle size={18}/></button>
      {extra}
    </div>
    <div className="xd-figma-toolbar-mode">
      <button type="button" aria-label="Dev mode" title="Dev Mode — inspect code and lint" aria-pressed={devMode.pressed} onClick={devMode.toggle}><CodeXml size={15}/></button>
    </div>
  </div>;
}

function ToolbarGroup({ group, active, select, disabled }: { group: EditorToolGroup; active: string; select: (id: string) => void; disabled: boolean }) {
  const [remembered, setRemembered] = useState(group.tools[0]!.id);
  const current = group.tools.find(tool => tool.id === active);
  useEffect(() => { if (current) setRemembered(current.id); }, [current?.id]);
  const tool = current ?? group.tools.find(item => item.id === remembered) ?? group.tools[0]!;
  const Icon = tool.icon;
  return <div className={`xd-figma-tool-group${current ? " active" : ""}`}>
    <button type="button" className="xd-figma-tool" aria-label={tool.label} title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}`} aria-pressed={!!current} disabled={disabled} onClick={() => select(tool.id)}><Icon size={18}/></button>
    {group.tools.length > 1 && <Popover className="xd-figma-tool-flyout" label={`Choose ${group.label.toLowerCase()}`} title={group.label} disabled={disabled} side="top" icon={<ChevronDown size={11}/>}
      items={() => group.tools.map(option => ({ label: option.label, hint: option.shortcut, checked: option.id === tool.id, onSelect: () => { setRemembered(option.id); select(option.id); } }))}/>}
  </div>;
}

const ICONS: Partial<Record<SceneNode["type"], LucideIcon>> = {
  FRAME: Hash, SECTION: PanelTop, GROUP: SquareDashed, RECTANGLE: Square, ROUNDED_RECTANGLE: Square, SHAPE_WITH_TEXT: Square,
  ELLIPSE: Circle, LINE: Minus, STAR: Star, POLYGON: Triangle, VECTOR: Spline, BOOLEAN_OPERATION: Spline, CONNECTOR: Spline,
  TEXT: Type, COMPONENT: Component, COMPONENT_SET: Component, INSTANCE: Diamond,
};
function layerIcon(node: SceneNode): LucideIcon {
  if (node.type === "FRAME" && node.layoutMode === "VERTICAL") return Rows3;
  if (node.type === "FRAME" && node.layoutMode === "HORIZONTAL") return Columns3;
  if (node.type !== "FRAME" && node.fills.some(fill => fill.type === "IMAGE" || fill.type === "VIDEO")) return Image;
  return ICONS[node.type] ?? Square;
}
const COMPONENT_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);

/** Figma layer list: frontmost layer first, collapsible containers, hover eye/lock, double-click rename. */
export function LayerTree({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const expanded = new Set(open);
  for (const id of editor.state.selectedIds) {
    let parent = editor.graph.getNode(id)?.parentId;
    while (parent && parent !== editor.state.currentPageId) { expanded.add(parent); parent = editor.graph.getNode(parent)?.parentId; }
  }
  const rows: { node: SceneNode; depth: number; tinted: boolean }[] = [];
  const walk = (parentId: string, depth: number, tinted: boolean) => {
    const children = editor.graph.getChildren(parentId);
    for (let index = children.length - 1; index >= 0; index--) {
      const node = children[index]!;
      if (node.internalOnly) continue;
      rows.push({ node, depth, tinted });
      if (node.childIds.length && expanded.has(node.id)) walk(node.id, depth + 1, tinted || editor.state.selectedIds.has(node.id));
    }
  };
  walk(editor.state.currentPageId, 0, false);
  const toggle = (id: string) => setOpen(previous => { const next = new Set(previous); if (expanded.has(id)) next.delete(id); else next.add(id); return next; });
  const change = (node: SceneNode, patch: Partial<SceneNode>, label: string) => { if (!readOnly) editor.updateNodeWithUndo(node.id, patch, label); };
  return <div className="xd-figma-layers" role="tree" aria-label="Layers">
    {rows.map(({ node, depth, tinted }) => {
      const Icon = layerIcon(node), selected = editor.state.selectedIds.has(node.id);
      return <div key={node.id} role="treeitem" aria-selected={selected} aria-expanded={node.childIds.length ? expanded.has(node.id) : undefined}
        className={`xd-figma-layer${selected ? " selected" : tinted ? " tinted" : ""}${node.visible ? "" : " hidden-layer"}${node.locked ? " locked" : ""}${COMPONENT_TYPES.has(node.type) ? " component" : ""}`}
        style={{ paddingLeft: 4 + depth * 16 }}>
        {node.childIds.length ? <button type="button" className="xd-figma-layer-caret" aria-label={`${expanded.has(node.id) ? "Collapse" : "Expand"} ${node.name}`} onClick={() => toggle(node.id)}><ChevronRight size={11}/></button> : <span className="xd-figma-layer-caret"/>}
        {renaming === node.id ? <input className="xd-figma-rename" aria-label="Rename layer" autoFocus defaultValue={node.name}
          onBlur={event => { setRenaming(null); const name = event.target.value.trim(); if (name && name !== node.name) change(node, { name }, "Rename layer"); }}
          onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }}/> :
          <button type="button" className={`xd-pencil-layer-row${selected ? " selected" : ""}`} aria-pressed={selected} title={`${node.type} · ${node.id}`}
            onClick={event => editor.select([node.id], event.shiftKey || event.metaKey)} onDoubleClick={() => { if (!readOnly) setRenaming(node.id); }}>
            <Icon size={13}/><span>{node.name}</span>
          </button>}
        <span className="xd-figma-layer-actions">
          <button type="button" aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.name}`} disabled={readOnly} onClick={() => change(node, { locked: !node.locked }, node.locked ? "Unlock layer" : "Lock layer")}>{node.locked ? <Lock size={12}/> : <LockOpen size={12}/>}</button>
          <button type="button" aria-label={`${node.visible ? "Hide" : "Show"} ${node.name}`} disabled={readOnly} onClick={() => change(node, { visible: !node.visible }, node.visible ? "Hide layer" : "Show layer")}>{node.visible ? <Eye size={12}/> : <EyeOff size={12}/>}</button>
        </span>
      </div>;
    })}
  </div>;
}

/** Figma's Pages section: a collapsible list with add, double-click rename and a context menu. */
export function PageList({ editor, readOnly, report }: { editor: Editor; readOnly: boolean; report: (error: unknown) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menu = useContextMenu();
  const pages = editor.getPages();
  const rename = (id: string, value: string) => { const name = value.trim(); if (name && name !== editor.graph.getNode(id)?.name) editor.updateNodeWithUndo(id, { name }, "Rename page"); };
  return <section className="xd-figma-section xd-figma-pages">
    <header>
      <button type="button" className="xd-figma-section-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><ChevronDown size={11}/>Pages</button>
      <button type="button" className="xd-figma-icon" aria-label="Add page" title="Add page" disabled={readOnly} onClick={() => editor.addPage()}><Plus size={14}/></button>
    </header>
    {!collapsed && <div className="xd-figma-page-list" role="listbox" aria-label="Pages">
      {pages.map(page => renaming === page.id ? <input key={page.id} className="xd-figma-rename" aria-label="Page name" autoFocus defaultValue={page.name}
        onBlur={event => { setRenaming(null); rename(page.id, event.target.value); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }}/> :
        <button key={page.id} type="button" role="option" className="xd-figma-page" aria-selected={page.id === editor.state.currentPageId}
          onClick={() => { if (page.id !== editor.state.currentPageId) void editor.switchPage(page.id).catch(report); }}
          onDoubleClick={() => { if (!readOnly) setRenaming(page.id); }}
          onContextMenu={event => menu.openAt(event, [
            { label: "Rename page", disabled: readOnly, onClick: () => setRenaming(page.id) },
            { label: "Delete page", danger: true, disabled: readOnly || pages.length <= 1, onClick: () => editor.deletePage(page.id) },
          ])}>
          <span>{page.name}</span>{page.id === editor.state.currentPageId && <Check size={12}/>}
        </button>)}
    </div>}
    {menu.menu}
  </section>;
}
