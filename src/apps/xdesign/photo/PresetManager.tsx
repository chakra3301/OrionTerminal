import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Trash2 } from "lucide-react";
import { ContextMenu } from "../EditorMenus";
import type { MenuEntry } from "../menuModel";
import { useDesignDialog } from "../useDesignDialog";
import { runPhotoCommand, usePhotoWorkspace, controlsLocked } from "./runtime";
import { startRowDrag } from "./rowDrag";

type Kind = "gradient" | "style" | "shape" | "pattern";
type Preset = { name: string; id?: string };
export type Prompt = { title: string; initial?: string; message?: string; submit: (name: string) => Promise<unknown> };
const NOUNS: Record<Kind, string> = { gradient: "Gradient", style: "Style", shape: "Shape", pattern: "Pattern" };
const key = (preset: Preset) => preset.id ?? preset.name;

export function PresetPrompt({ prompt, close }: { prompt: Prompt; close: () => void }) {
  const busy = usePhotoWorkspace(controlsLocked), [name, setName] = useState(prompt.initial ?? "");
  const dialog = useDesignDialog<HTMLFormElement>(close, busy);
  return <div className="xd-photo-dialog-scrim"><form ref={dialog} role="dialog" aria-modal="true" aria-label={prompt.title} className="xd-photo-dialog" onSubmit={event => {
    event.preventDefault();
    void prompt.submit(name.trim()).then(close).catch(() => {});
  }}><h3>{prompt.title}</h3>
    {prompt.message ? <p>{prompt.message}</p> : <label>Name<input aria-label={prompt.title} required maxLength={255} disabled={busy} value={name} onChange={event => setName(event.target.value)}/></label>}
    <div className="xd-photo-dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={busy || !prompt.message && !name.trim()}>OK</button></div>
  </form></div>;
}

// Photoshop's Gradients, Patterns, Shapes and Styles panels keep presets in folder groups: right-click a preset or a group
// to rename or delete it, drag a preset onto another group to move it, and use the footer to add a group or delete.
export function PresetGroups<P extends Preset>({ kind, groups, search, layout, children }: { kind: Kind; groups: { name: string; presets: P[] }[]; search: string; layout: "grid" | "list"; children: (preset: P, group: string) => ReactNode }) {
  const busy = usePhotoWorkspace(controlsLocked), noun = NOUNS[kind];
  const host = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]), [selected, setSelected] = useState<{ group: string; preset?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null), [prompt, setPrompt] = useState<Prompt | null>(null);
  const edit = (params: Record<string, unknown>) => runPhotoCommand(`${kind}.presets.edit`, params);
  const newGroup = () => setPrompt({ title: "Group Name", initial: `Group ${groups.length + 1}`, submit: name => edit({ action: "newGroup", name }) });
  const deleteGroup = (group: string) => setPrompt({ title: "Delete Group", message: `Delete the group “${group}” and all of its presets? Layers that use them keep their own copies.`, submit: () => edit({ action: "deleteGroup", group }).then(() => setSelected(null)) });
  const deletePreset = (group: string, preset: string) => { setSelected(null); void edit({ action: "delete", group, preset }).catch(() => {}); };
  const openMenu = (event: { preventDefault: () => void; clientX: number; clientY: number }, target: { group: string; preset?: string }, items: MenuEntry[]) => {
    event.preventDefault(); if (busy) return;
    setSelected(target); setMenu({ x: event.clientX, y: event.clientY, items });
  };
  const drag = (event: PointerEvent<HTMLElement>, group: string, preset: string) => {
    if (busy) return;
    startRowDrag(event, { scope: ".xd-photo-preset-list", ghost: event.currentTarget,
      position: target => target.dataset.group === group ? null : "into",
      drop: target => { if (!controlsLocked(usePhotoWorkspace.getState())) void edit({ action: "move", group, preset, to: target.dataset.group }).catch(() => {}); } });
  };
  const query = search.toLowerCase(), dialogHost = host.current?.closest(".xd-photo");
  const current = selected && groups.some(group => group.name === selected.group && (!selected.preset || group.presets.some(preset => key(preset) === selected.preset))) ? selected : null;
  return <div ref={host} className="xd-photo-preset-groups">
    <div className="xd-photo-preset-list">{groups.map(group => {
      const presets = group.presets.filter(preset => `${group.name} ${preset.name}`.toLowerCase().includes(query));
      if (query && !presets.length) return null;
      const open = !!query || !collapsed.includes(group.name);
      return <div key={group.name} className="xd-photo-preset-group" data-drop-target="" data-group={group.name}>
        <button type="button" className={`xd-photo-preset-folder${current?.group === group.name && !current.preset ? " selected" : ""}`} aria-expanded={open} disabled={busy}
          onClick={() => { setSelected({ group: group.name }); setCollapsed(list => open ? [...list, group.name] : list.filter(name => name !== group.name)); }}
          onContextMenu={event => openMenu(event, { group: group.name }, [
            { label: "New Group…", run: newGroup },
            { label: "Rename Group…", run: () => setPrompt({ title: "Group Name", initial: group.name, submit: name => name === group.name ? Promise.resolve() : edit({ action: "renameGroup", group: group.name, name }) }) },
            { label: "Delete Group", run: () => deleteGroup(group.name) },
          ])}>{open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<Folder size={13}/><span>{group.name}</span></button>
        {open && <div className={layout === "grid" ? "xd-photo-preset-grid" : "xd-photo-brush-presets"}>{presets.map(preset => <div key={key(preset)} className={current?.group === group.name && current.preset === key(preset) ? "selected" : undefined}
          onPointerDown={event => drag(event, group.name, key(preset))} onDragStart={event => event.preventDefault()}
          onClickCapture={() => setSelected({ group: group.name, preset: key(preset) })}
          onContextMenu={event => openMenu(event, { group: group.name, preset: key(preset) }, [
            { label: `Rename ${noun}…`, run: () => setPrompt({ title: `${noun} Name`, initial: preset.name, submit: name => name === preset.name ? Promise.resolve() : edit({ action: "rename", group: group.name, preset: key(preset), name }) }) },
            { label: `Delete ${noun}`, run: () => deletePreset(group.name, key(preset)) },
          ])}>{children(preset, group.name)}</div>)}</div>}
      </div>;
    })}</div>
    <div className="xd-photo-layer-actions xd-ps-layer-actions">
      <button aria-label="Create new group" title="Create new group" disabled={busy} onClick={newGroup}><FolderPlus size={14}/></button>
      <button aria-label={current?.preset ? `Delete ${noun.toLowerCase()}` : "Delete group"} title={current?.preset ? `Delete ${noun.toLowerCase()}` : "Delete group"} disabled={busy || !current}
        onClick={() => { if (current?.preset) deletePreset(current.group, current.preset); else if (current) deleteGroup(current.group); }}><Trash2 size={14}/></button>
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={`${noun} presets`} close={() => setMenu(null)} items={menu.items}/>}
    {prompt && (dialogHost ? createPortal(<PresetPrompt prompt={prompt} close={() => setPrompt(null)}/>, dialogHost) : <PresetPrompt prompt={prompt} close={() => setPrompt(null)}/>)}
  </div>;
}
