import { Fragment, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import type { EditorToolGroup } from "../EditorChrome";
import { shortcutFromEvent, shortcutGlyphs, type MenuSpec } from "../menuModel";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { LAYER_COLORS } from "./NewLayerDialog";
import { customizeMenus, menuPaths, PATH_SEPARATOR, saveCustomization, shortcutAllowed, shortcutConflict, toolbarGroups, useCustomization, type Customization, type MenuColor, type Toolbar } from "./customization";
import "./customizeDialogs.css";

export type ShortcutsTab = "shortcuts" | "menus";
// Hiding these would leave no way back to this dialog, so Photoshop keeps them visible too.
const ALWAYS_VISIBLE = new Set([`Edit${PATH_SEPARATOR}Keyboard Shortcuts…`, `Edit${PATH_SEPARATOR}Menus…`]);
const shown = (path: string) => path.split(PATH_SEPARATOR).join(" > ");

/** Edit › Keyboard Shortcuts… and Menus…: Photoshop's one dialog with a tab for each. `menus` are the uncustomised menus. */
export function ShortcutsMenusDialog({ tab: initial, menus, close }: { tab: ShortcutsTab; menus: MenuSpec[]; close: () => void }) {
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const [tab, setTab] = useState(initial), [draft, setDraft] = useState<Customization>(() => useCustomization.getState());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null), [pending, setPending] = useState<{ path: string; shortcut: string; conflict: string } | null>(null), [problem, setProblem] = useState<string | null>(null);
  const defaults = new Map(menuPaths(menus).map(entry => [entry.path, entry.item.shortcut ?? null]));
  const current = customizeMenus(menus, draft), rows = menuPaths(menus), now = new Map(menuPaths(current).map(entry => [entry.path, entry.item]));
  const assign = (base: Customization, path: string, shortcut: string | null): Customization => {
    const shortcuts = { ...base.shortcuts };
    if (shortcut === (defaults.get(path) ?? null)) delete shortcuts[path]; else shortcuts[path] = shortcut;
    return { ...base, shortcuts };
  };
  const propose = (path: string, shortcut: string) => {
    setProblem(null); setPending(null);
    if (!shortcutAllowed(shortcut)) { setProblem("Shortcuts must include Command or Control and/or a function key."); return; }
    const conflict = shortcutConflict(current, path, shortcut);
    if (conflict) setPending({ path, shortcut, conflict }); else { setDraft(base => assign(base, path, shortcut)); setEditing(null); }
  };
  const capture = (path: string) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" || event.key === "Tab") return;
    event.preventDefault(); event.stopPropagation();
    const shortcut = shortcutFromEvent(event.nativeEvent);
    if (shortcut) propose(path, shortcut);
  };
  const acceptConflict = () => {
    if (!pending) return;
    setDraft(base => assign(assign(base, pending.conflict, null), pending.path, pending.shortcut));
    const top = pending.conflict.split(PATH_SEPARATOR)[0]!;
    setExpanded(open => new Set(open).add(top)); setSelected(pending.conflict); setEditing(null); setPending(null);
  };
  const setMenu = (path: string, patch: { hidden?: boolean; color?: MenuColor | null }) => setDraft(base => {
    const next = { ...base.menus[path], ...patch };
    const menu = { ...(next.hidden ? { hidden: true } : {}), ...(next.color ? { color: next.color } : {}) };
    const menus = { ...base.menus };
    if (Object.keys(menu).length) menus[path] = menu; else delete menus[path];
    return { ...base, menus };
  });
  const modified = tab === "shortcuts" ? Object.keys(draft.shortcuts).length > 0 : Object.keys(draft.menus).length > 0;
  const selectedItem = selected ? rows.find(row => row.path === selected)?.item : undefined, leaf = !!selectedItem && !selectedItem.items && tab === "shortcuts";
  const visible = rows.filter(row => row.depth === 0 || expanded.has(row.path.split(PATH_SEPARATOR)[0]!));
  return <PhotoDialog dialog={dialog} title="Keyboard Shortcuts and Menus" className="xd-customize-dialog" close={close} onSubmit={event => { event.preventDefault(); const failed = saveCustomization(draft); if (failed) setProblem(failed); else close(); }}>
    <div className="xd-customize-tabs" role="tablist">{([["shortcuts", "Keyboard Shortcuts"], ["menus", "Menus"]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setEditing(null); setPending(null); setProblem(null); }}>{label}</button>)}</div>
    <div className="xd-customize-head">
      <label>Set:<select aria-label="Set" value={modified ? "modified" : "defaults"} onChange={event => { if (event.target.value === "defaults") { setDraft(base => tab === "shortcuts" ? { ...base, shortcuts: {} } : { ...base, menus: {} }); setPending(null); setEditing(null); } }}><option value="defaults">Photoshop Defaults</option>{modified && <option value="modified">Photoshop Defaults (modified)</option>}</select></label>
      <label>{tab === "shortcuts" ? "Shortcuts For:" : "Menu For:"}<select aria-label={tab === "shortcuts" ? "Shortcuts For" : "Menu For"} value="application"><option value="application">Application Menus</option></select></label>
    </div>
    <div className={tab === "menus" ? "xd-customize-table is-menus" : "xd-customize-table"} role="table" aria-label={tab === "shortcuts" ? "Application menu shortcuts" : "Application menu visibility and color"}>
      <div role="row" className="xd-customize-row is-head"><span role="columnheader">Application Menu Command</span>{tab === "shortcuts" ? <span role="columnheader">Shortcut</span> : <><span role="columnheader">Visibility</span><span role="columnheader">Color</span></>}</div>
      {visible.map(({ path, item, depth }) => {
        const live = now.get(path), menu = draft.menus[path];
        return <div key={path} role="row" className="xd-customize-row" aria-selected={selected === path} data-depth={depth} onClick={() => setSelected(path)}>
          <span role="rowheader" style={{ paddingInlineStart: depth * 14 }}>{depth === 0
            ? <button type="button" className="xd-customize-disclosure" aria-expanded={expanded.has(path)} onClick={() => setExpanded(open => { const next = new Set(open); if (!next.delete(path)) next.add(path); return next; })}>{expanded.has(path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{item.label}</button>
            : item.label}</span>
          {tab === "shortcuts"
            ? <span role="cell">{depth > 0 && !item.items && (editing === path
              ? <input aria-label={`Shortcut for ${shown(path)}`} readOnly autoFocus value={pending?.path === path ? shortcutGlyphs(pending.shortcut) : live?.shortcut ? shortcutGlyphs(live.shortcut) : ""} onKeyDown={capture(path)} />
              : <button type="button" className="xd-customize-shortcut" aria-label={`Shortcut for ${shown(path)}`} onClick={() => { setSelected(path); setEditing(path); setPending(null); setProblem(null); }}>{live?.shortcut ? shortcutGlyphs(live.shortcut) : ""}</button>)}</span>
            : <Fragment>
              <span role="cell">{depth > 0 && !ALWAYS_VISIBLE.has(path) && <button type="button" className="xd-customize-eye" aria-label={`Visibility for ${shown(path)}`} aria-pressed={!menu?.hidden} onClick={() => setMenu(path, { hidden: !menu?.hidden })}>{menu?.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}</span>
              <span role="cell">{depth > 0 && <select aria-label={`Color for ${shown(path)}`} value={menu?.color ?? "none"} onChange={event => setMenu(path, { color: event.target.value === "none" ? null : event.target.value as MenuColor })}>{LAYER_COLORS.map(([value, label]) => <option key={value} value={value}>{value === "none" ? "None" : label}</option>)}</select>}</span>
            </Fragment>}
        </div>;
      })}
    </div>
    {tab === "shortcuts" && <div className="xd-customize-actions">
      <button type="button" disabled={!leaf || !defaults.get(selected!) || now.get(selected!)?.shortcut === defaults.get(selected!)} onClick={() => { setEditing(selected); propose(selected!, defaults.get(selected!)!); }}>Use Default</button>
      <button type="button" disabled={!leaf || !now.get(selected!)?.shortcut} onClick={() => { setDraft(base => assign(base, selected!, null)); setEditing(null); setPending(null); }}>Delete Shortcut</button>
    </div>}
    {pending && <div className="xd-customize-conflict" role="alert">
      <p>{shortcutGlyphs(pending.shortcut)} is already in use and will be removed from {shown(pending.conflict)} if accepted.</p>
      <button type="button" onClick={acceptConflict}>Accept and Go to Conflict</button><button type="button" onClick={() => setPending(null)}>Undo Changes</button>
    </div>}
    {problem && <p role="alert" className="xd-customize-problem">{problem}</p>}
    {tab === "menus" && <p className="xd-photo-section-help">Hidden commands also lose their shortcuts until shown again.</p>}
  </PhotoDialog>;
}

/** Edit › Toolbar…: move tools between the toolbar and Extra Tools, which the toolbar's … button lists. */
export function ToolbarDialog({ groups: defaults, close }: { groups: EditorToolGroup[]; close: () => void }) {
  const dialog = useDesignDialog<HTMLFormElement>(close);
  const [draft, setDraft] = useState<Toolbar | null>(() => useCustomization.getState().toolbar), [problem, setProblem] = useState<string | null>(null);
  const { groups, extra } = toolbarGroups(defaults, draft);
  const layout = (): Toolbar => ({ groups: groups.map(group => group.tools.map(tool => tool.id)), extra: extra.map(tool => tool.id) });
  const toExtra = (id: string) => { const next = layout(); setDraft({ groups: next.groups.map(group => group.filter(tool => tool !== id)).filter(group => group.length), extra: [...next.extra, id] }); };
  // A tool the layout doesn't mention rejoins its default group.
  const toToolbar = (id: string) => { const next = layout(); setDraft({ groups: next.groups, extra: next.extra.filter(tool => tool !== id) }); };
  return <PhotoDialog dialog={dialog} title="Customize Toolbar" className="xd-customize-dialog" ok="Done" close={close}
    buttons={<><button type="button" onClick={() => setDraft(null)}>Restore Defaults</button><button type="button" onClick={() => setDraft({ groups: [], extra: defaults.flatMap(group => group.tools.map(tool => tool.id)) })}>Clear Tools</button></>}
    onSubmit={event => { event.preventDefault(); const failed = saveCustomization({ ...useCustomization.getState(), toolbar: draft }); if (failed) setProblem(failed); else close(); }}>
    <p className="xd-photo-section-help">Move tools to Extra Tools to take them, and their keys, off the toolbar.</p>
    <div className="xd-customize-toolbar">
      <section aria-label="Toolbar"><h4>Toolbar</h4>{groups.map(group => <ul key={group.label} aria-label={group.label}>{group.tools.map(({ id, label, icon: Icon, shortcut }) => <li key={id}><Icon size={14} /><span>{label}</span><kbd>{shortcut}</kbd><button type="button" aria-label={`Move ${label} to Extra Tools`} onClick={() => toExtra(id)}><ArrowRight size={13} /></button></li>)}</ul>)}</section>
      <section aria-label="Extra Tools"><h4>Extra Tools</h4><ul>{extra.map(({ id, label, icon: Icon }) => <li key={id}><button type="button" aria-label={`Move ${label} to Toolbar`} onClick={() => toToolbar(id)}><ArrowLeft size={13} /></button><Icon size={14} /><span>{label}</span></li>)}</ul></section>
    </div>
    {problem && <p role="alert" className="xd-customize-problem">{problem}</p>}
  </PhotoDialog>;
}
