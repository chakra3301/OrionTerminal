import { useState } from "react";
import { ulid } from "ulid";
import { Check, ChevronDown, ChevronRight, CircleDot, FilePlus, FolderPlus, Play, Square, Trash2 } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { findAction, updateAction, useActions, type ActionSet, type PhotoAction } from "./actions";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import type { MenuEntry } from "../menuModel";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function playSteps(action: PhotoAction, from = 0) {
  for (const [index, step] of action.steps.entries()) {
    if (index < from || !step.enabled) continue;
    try { await runPhotoCommand(step.command, step.params); }
    catch (error) { useActions.setState({ failed: { action: action.id, step: index, message: message(error) } }); return false; }
  }
  return true;
}

/** Play Selection: a set plays its checked actions in order, an action plays whole, and a step plays its action from there. */
export async function playSelection() {
  const { selected, sets, playing, recording } = useActions.getState();
  if (!selected || playing || recording) return;
  useActions.setState({ playing: true, failed: null });
  try {
    const set = sets.find(item => item.id === selected.set), found = findAction(selected.action);
    if (found) await playSteps(found.action, selected.step ?? 0);
    else if (set) for (const action of set.actions) if (action.enabled && !await playSteps(action)) break;
  } finally { useActions.setState({ playing: false }); }
}

const selectedSet = () => { const { sets, selected } = useActions.getState(); return sets.find(set => set.id === selected?.set) ?? null; };

export function stopRecording() { useActions.setState({ recording: null }); }

function startRecording() {
  const { selected } = useActions.getState();
  if (selected?.action) useActions.setState({ recording: { set: selected.set, action: selected.action }, failed: null });
}

function deleteSelected() {
  const { selected, sets, recording } = useActions.getState();
  if (!selected) return;
  if (selected.step !== undefined) updateAction(selected.action!, action => ({ ...action, steps: action.steps.filter((_, index) => index !== selected.step) }));
  else if (selected.action) useActions.setState({ sets: sets.map(set => ({ ...set, actions: set.actions.filter(action => action.id !== selected.action) })) });
  else useActions.setState({ sets: sets.filter(set => set.id !== selected.set) });
  const gone = selected.step === undefined && (recording?.action === selected.action || (!selected.action && recording?.set === selected.set));
  useActions.setState({ selected: null, ...gone && { recording: null } });
}

function duplicateSelected() {
  const { selected, sets } = useActions.getState();
  if (!selected) return;
  const copy = (action: PhotoAction): PhotoAction => ({ ...action, id: ulid(), name: `${action.name} copy` });
  if (selected.action) {
    const found = findAction(selected.action)!, duplicate = copy(found.action);
    useActions.setState({ sets: sets.map(set => set.id === found.set.id ? { ...set, actions: set.actions.flatMap(action => action.id === found.action.id ? [action, duplicate] : [action]) } : set), selected: { set: found.set.id, action: duplicate.id } });
  } else {
    const set = sets.find(item => item.id === selected.set)!, duplicate: ActionSet = { id: ulid(), name: `${set.name} copy`, actions: set.actions.map(copy) };
    useActions.setState({ sets: sets.flatMap(item => item.id === set.id ? [item, duplicate] : [item]), selected: { set: duplicate.id } });
  }
}

function toggleSet(set: ActionSet) {
  const enabled = !set.actions.every(action => action.enabled);
  useActions.setState(state => ({ sets: state.sets.map(item => item.id === set.id ? { ...item, actions: item.actions.map(action => ({ ...action, enabled, steps: action.steps.map(step => ({ ...step, enabled })) })) } : item) }));
}

const toggleAction = (action: PhotoAction) => { const enabled = !action.enabled; updateAction(action.id, item => ({ ...item, enabled, steps: item.steps.map(step => ({ ...step, enabled })) })); };
const toggleStep = (action: PhotoAction, index: number) => updateAction(action.id, item => ({ ...item, steps: item.steps.map((step, at) => at === index ? { ...step, enabled: !step.enabled } : step) }));

export function ActionsPanel() {
  const busy = usePhotoWorkspace(s => s.busy), { sets, selected, recording, playing, failed, notice } = useActions(), set = useActions(s => s.set);
  const [open, setOpen] = useState<string[]>(["default"]);
  const disclose = (id: string) => setOpen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const is = (target: NonNullable<typeof selected>) => selected?.set === target.set && selected.action === target.action && selected.step === target.step;
  const toggle = (label: string, pressed: boolean, onClick: () => void) => <button className="xd-photo-comp-toggle" aria-label={`Include ${label}`} title="Toggle item on/off" aria-pressed={pressed} disabled={playing} onClick={onClick}><Check size={12}/></button>;
  const disclosure = (id: string, label: string) => <button className="xd-photo-comp-disclose" aria-label={`Expand ${label}`} aria-expanded={open.includes(id)} onClick={() => disclose(id)}>{open.includes(id) ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</button>;
  const idle = busy || playing || !!recording;
  return <div className="xd-photo-rows xd-photo-actions" role="group" aria-label="Actions">
    <ul>
      {sets.flatMap(item => [
        <li key={item.id} className={`xd-photo-row${is({ set: item.id }) ? " selected" : ""}`}>
          {toggle(item.name, item.actions.every(action => action.enabled), () => toggleSet(item))}
          {disclosure(item.id, item.name)}
          <button className="xd-photo-row-name" aria-label={item.name} aria-pressed={is({ set: item.id })} onClick={() => set({ selected: { set: item.id } })} onDoubleClick={() => set({ selected: { set: item.id }, dialog: "options" })}>{item.name}</button>
        </li>,
        ...open.includes(item.id) ? item.actions.flatMap(action => [
          <li key={action.id} className={`xd-photo-row${is({ set: item.id, action: action.id }) ? " selected" : ""}`} data-depth="1">
            {toggle(action.name, action.enabled, () => toggleAction(action))}
            {disclosure(action.id, action.name)}
            <button className="xd-photo-row-name" aria-label={action.name} aria-pressed={is({ set: item.id, action: action.id })} onClick={() => set({ selected: { set: item.id, action: action.id } })} onDoubleClick={() => set({ selected: { set: item.id, action: action.id }, dialog: "options" })}>{action.name}</button>
            {recording?.action === action.id && <span role="status" className="xd-photo-actions-recording" aria-label={`Recording ${action.name}`}><CircleDot size={12}/></span>}
          </li>,
          ...open.includes(action.id) ? action.steps.map((step, index) => {
            const id = `${action.id}:${index}`, params = Object.entries(step.params), failing = failed?.action === action.id && failed.step === index;
            return <li key={id} className={`xd-photo-row${is({ set: item.id, action: action.id, step: index }) ? " selected" : ""}`} data-depth="2">
              {toggle(step.label, step.enabled, () => toggleStep(action, index))}
              {params.length ? disclosure(id, step.label) : <span className="xd-photo-comp-disclose"/>}
              <button className="xd-photo-row-name" aria-label={step.label} aria-pressed={is({ set: item.id, action: action.id, step: index })} onClick={() => set({ selected: { set: item.id, action: action.id, step: index } })}>{step.label}</button>
              {open.includes(id) && <dl className="xd-photo-comp-comment">{params.map(([key, value]) => <div key={key}><dt>{key}:</dt> <dd>{JSON.stringify(value)}</dd></div>)}</dl>}
              {failing && <p role="alert" className="xd-photo-comp-comment">{failed.message}</p>}
            </li>;
          }) : [],
        ]) : [],
      ])}
    </ul>
    {notice && <p role="status" className="xd-photo-comp-comment">{notice}</p>}
    <div className="xd-photo-notes-bar">
      <button aria-label="Stop Playing/Recording" title="Stop playing/recording" disabled={!recording} onClick={stopRecording}><Square size={14}/></button>
      <button aria-label="Begin Recording" title="Begin recording" aria-pressed={!!recording} disabled={idle || !selected?.action} onClick={startRecording}><CircleDot size={14}/></button>
      <button aria-label="Play Selection" title="Play selection" disabled={idle || !selected} onClick={() => void playSelection()}><Play size={14}/></button>
      <button aria-label="Create New Set" title="Create new set" disabled={playing || !!recording} onClick={() => set({ dialog: "newSet" })}><FolderPlus size={14}/></button>
      <button aria-label="Create New Action" title="Create new action" disabled={idle || !sets.length} onClick={() => set({ dialog: "newAction" })}><FilePlus size={14}/></button>
      <button aria-label="Delete" title="Delete" disabled={playing || !selected} onClick={deleteSelected}><Trash2 size={14}/></button>
    </div>
  </div>;
}

export function actionsPanelMenu({ selected, recording, playing, allowTools, sets, set }: ReturnType<typeof useActions.getState>, busy: boolean): MenuEntry[] {
  const idle = busy || playing || !!recording;
  return [
    { label: "New Action…", disabled: idle || !sets.length, run: () => set({ dialog: "newAction" }) },
    { label: "New Set…", disabled: playing || !!recording, run: () => set({ dialog: "newSet" }) },
    { label: "Duplicate", disabled: idle || !selected || selected.step !== undefined, run: duplicateSelected },
    { label: "Delete", disabled: playing || !selected, run: deleteSelected },
    { label: "Play", disabled: idle || !selected, run: () => void playSelection() },
    "-",
    { label: "Start Recording", disabled: idle || !selected?.action, run: startRecording },
    { label: "Record Again…", disabled: true },
    { label: "Insert Menu Item…", disabled: true },
    { label: "Insert Stop…", disabled: true },
    { label: "Insert Conditional…", disabled: true },
    "-",
    { label: "Action Options…", disabled: idle || !selected?.action || selected.step !== undefined, run: () => set({ dialog: "options" }) },
    { label: "Set Options…", disabled: idle || !selected || !!selected.action, run: () => set({ dialog: "options" }) },
    { label: "Playback Options…", disabled: true },
    { label: "Allow Tool Recording", checked: allowTools, run: () => set({ allowTools: !allowTools }) },
    "-",
    { label: "Clear All Actions", disabled: idle || !sets.length, run: () => set({ sets: [], selected: null }) },
    { label: "Reset Actions", disabled: idle, run: () => set({ sets: [{ id: "default", name: "Default Actions", actions: [] }], selected: null }) },
    { label: "Load Actions…", disabled: true },
    { label: "Replace Actions…", disabled: true },
    { label: "Save Actions…", disabled: true },
  ];
}

function NewActionDialog({ close }: { close: () => void }) {
  const sets = useActions(s => s.sets), dialog = useDesignDialog<HTMLFormElement>(close, false);
  const count = sets.reduce((total, set) => total + set.actions.length, 0);
  const [name, setName] = useState(`Action ${count + 1}`), [setId, setSetId] = useState(() => selectedSet()?.id ?? sets[0]?.id ?? "");
  const submit = () => {
    const action: PhotoAction = { id: ulid(), name: name.trim(), enabled: true, steps: [] };
    useActions.setState(state => ({ sets: state.sets.map(set => set.id === setId ? { ...set, actions: [...set.actions, action] } : set), selected: { set: setId, action: action.id }, recording: { set: setId, action: action.id }, failed: null }));
    close();
  };
  return <PhotoDialog dialog={dialog} title="New Action" busy={false} ok="Record" okDisabled={!name.trim() || !setId} close={close} onSubmit={event => { event.preventDefault(); submit(); }}>
    <label className="xd-ps-dialog-field"><span>Name:</span><input aria-label="Action name" value={name} onChange={event => setName(event.target.value)}/></label>
    <label className="xd-ps-dialog-field"><span>Set:</span><select aria-label="Action set" value={setId} onChange={event => setSetId(event.target.value)}>{sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
  </PhotoDialog>;
}

function NameDialog({ title, initial, close, submit }: { title: string; initial: string; close: () => void; submit: (name: string) => void }) {
  const dialog = useDesignDialog<HTMLFormElement>(close, false), [name, setName] = useState(initial);
  return <PhotoDialog dialog={dialog} title={title} busy={false} okDisabled={!name.trim()} close={close} onSubmit={event => { event.preventDefault(); submit(name.trim()); close(); }}>
    <label className="xd-ps-dialog-field"><span>Name:</span><input aria-label={`${title} name`} value={name} onChange={event => setName(event.target.value)}/></label>
  </PhotoDialog>;
}

/** New Action, New Set and the options dialogs. Rendered at studio level because the flyout's box would clip the dialog scrim. */
export function ActionsDialogs() {
  const dialog = useActions(s => s.dialog), selected = useActions(s => s.selected), sets = useActions(s => s.sets), close = () => useActions.setState({ dialog: null });
  if (dialog === "newAction") return <NewActionDialog close={close}/>;
  if (dialog === "newSet") return <NameDialog title="New Set" initial={`Set ${sets.length + 1}`} close={close} submit={name => { const id = ulid(); useActions.setState(state => ({ sets: [...state.sets, { id, name, actions: [] }], selected: { set: id } })); }}/>;
  if (dialog !== "options" || !selected) return null;
  const found = findAction(selected.action), set = sets.find(item => item.id === selected.set);
  if (found) return <NameDialog key={found.action.id} title="Action Options" initial={found.action.name} close={close} submit={name => updateAction(found.action.id, action => ({ ...action, name }))}/>;
  return set ? <NameDialog key={set.id} title="Set Options" initial={set.name} close={close} submit={name => useActions.setState(state => ({ sets: state.sets.map(item => item.id === set.id ? { ...item, name } : item) }))}/> : null;
}
