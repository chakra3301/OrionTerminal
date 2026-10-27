import { create } from "zustand";
import type { PhotoState } from "./types";

/** Photoshop's Actions panel: recorded steps are the command ids and params sent through `xdesign_photo_command`. */
export type ActionStep = { command: string; params: Record<string, unknown>; label: string; enabled: boolean };
export type PhotoAction = { id: string; name: string; enabled: boolean; steps: ActionStep[] };
export type ActionSet = { id: string; name: string; actions: PhotoAction[] };
export type ActionsSelection = { set: string; action?: string; step?: number } | null;
type Saved = { sets: ActionSet[]; allowTools: boolean };
type Store = Saved & {
  selected: ActionsSelection;
  recording: { set: string; action: string } | null;
  playing: boolean;
  failed: { action: string; step: number; message: string } | null;
  dialog: "newAction" | "newSet" | "options" | null;
  notice: string | null;
  set: (patch: Partial<Omit<Store, "set">>) => void;
};

export const ACTIONS_KEY = "orion.xdesign.actions.v1";
const MAX_BYTES = 512 * 1024;
const DEFAULT: Saved = { sets: [{ id: "default", name: "Default Actions", actions: [] }], allowTools: false };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 200) => typeof value === "string" && value.length <= limit;
const validStep = (step: unknown): step is ActionStep => record(step) && text(step.command) && record(step.params) && text(step.label) && typeof step.enabled === "boolean";
const validAction = (action: unknown): action is PhotoAction => record(action) && text(action.id) && text(action.name) && typeof action.enabled === "boolean" && Array.isArray(action.steps) && action.steps.every(validStep);
const validSet = (set: unknown): set is ActionSet => record(set) && text(set.id) && text(set.name) && Array.isArray(set.actions) && set.actions.every(validAction);

function read(): Saved & { notice: string | null } {
  try {
    const raw = localStorage.getItem(ACTIONS_KEY);
    if (raw === null) return { ...DEFAULT, notice: null };
    if (raw.length * 2 > MAX_BYTES) throw new Error("Actions exceed the limit");
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.schemaVersion !== 1 || !Array.isArray(saved.sets) || !saved.sets.every(validSet) || typeof saved.allowTools !== "boolean") throw new Error("Unsupported actions");
    return { sets: saved.sets, allowTools: saved.allowTools, notice: null };
  } catch {
    return { ...DEFAULT, notice: "Saved actions could not be read." };
  }
}

export const useActions = create<Store>(set => ({
  ...read(), selected: null, recording: null, playing: false, failed: null, dialog: null,
  set: patch => set(patch),
}));

// A failed write leaves the panel's actions as they are for the session and says so, rather than dropping them.
useActions.subscribe((state, previous) => {
  if (state.sets === previous.sets && state.allowTools === previous.allowTools) return;
  const raw = JSON.stringify({ schemaVersion: 1, sets: state.sets, allowTools: state.allowTools });
  try {
    if (raw.length * 2 > MAX_BYTES) throw new Error("Actions exceed the limit");
    localStorage.setItem(ACTIONS_KEY, raw);
    if (state.notice) useActions.setState({ notice: null });
  } catch {
    useActions.setState({ notice: "Actions could not be saved; they last until XDesign closes." });
  }
});

export function updateAction(id: string, change: (action: PhotoAction) => PhotoAction) {
  useActions.setState(state => ({ sets: state.sets.map(set => set.actions.some(action => action.id === id) ? { ...set, actions: set.actions.map(action => action.id === id ? change(action) : action) } : set) }));
}

export function findAction(id: string | undefined) {
  for (const set of useActions.getState().sets) for (const action of set.actions) if (action.id === id) return { set, action };
  return null;
}

const NOT_RECORDED = /^(history\.|edit\.(undo|redo|stepBackward|stepForward)$|view\.|preview\.)/;
// The Brush, Clone Stamp, healing and toning strokes; Photoshop records them only with Allow Tool Recording on.
const TOOL_STROKE = /^paint\.(?!gradient$|bucket$|magicEraser$|redEye$)/;
const current = (state: PhotoState | null | undefined) => state?.historySources?.find(source => source.current);

/** Called by the runtime after the engine applied a command. Records it when it made a History state, as Photoshop
 *  records what it can undo, and records layer selection, which Photoshop records though it adds no state. */
export function recordActionStep(command: string, params: Record<string, unknown>, before: PhotoState | null | undefined, after: PhotoState) {
  const { recording, playing, allowTools } = useActions.getState();
  if (!recording || playing || NOT_RECORDED.test(command) || (!allowTools && TOOL_STROKE.test(command))) return;
  const added = current(after), selects = command.startsWith("layer.select");
  if (!selects && (!added || added.id === current(before)?.id)) return;
  // A step on the layer that was active plays back on whatever layer is active then, as in Photoshop.
  const { layer, ...rest } = params, kept = selects || (layer !== undefined && layer !== before?.activeLayer) ? params : rest;
  const step: ActionStep = { command, params: kept, label: selects ? "Select Layer" : added!.label, enabled: true };
  updateAction(recording.action, action => ({ ...action, steps: [...action.steps, step] }));
}
