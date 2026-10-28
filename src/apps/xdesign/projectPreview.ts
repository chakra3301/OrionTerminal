import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { log } from "@/lib/log";
import { usePencilWorkspace } from "./pencil/runtime";
import { usePhotoWorkspace } from "./photo/runtime";
import { captureProjectPicture } from "./previewCapture";
import { useXDProjects } from "./projectsStore";

export const PREVIEW_MAX_EDGE = 640, PREVIEW_IDLE_MS = 1500, PREVIEW_THROTTLE_MS = 15_000, PREVIEW_LEAVE_BUDGET_MS = 400;

export type PreviewEntry = { path: string; revision: number };

type ProjectPreviewsState = {
  entries: Record<string, PreviewEntry>;
  loaded: boolean;
  load: () => Promise<void>;
  noteWritten: (id: string, entry: PreviewEntry) => void;
  forget: (id: string) => void;
};

export const useProjectPreviews = create<ProjectPreviewsState>((set) => ({
  entries: {},
  loaded: false,
  load: async () => {
    if (!isTauri()) { set({ loaded: true }); return; }
    try { set({ entries: await invoke<Record<string, PreviewEntry>>("xdesign_preview_list"), loaded: true }); }
    catch (error) { log.warn("xdesign: project previews could not be listed", error); set({ loaded: true }); }
  },
  noteWritten: (id, entry) => set((s) => ({ entries: { ...s.entries, [id]: entry } })),
  forget: (id) => set((s) => {
    if (!(id in s.entries)) return s;
    const { [id]: _, ...entries } = s.entries;
    return { entries };
  }),
}));

type CaptureJob = { projectId: string; abandoned: boolean; done: Promise<void> };

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
let tracking = false;
let dirty = new Set<string>();
let job: CaptureJob | null = null;
let lastStart = -Infinity;
let lastInput = -Infinity;
let timer: ReturnType<typeof setTimeout> | null = null;

const operationRunning = () => usePhotoWorkspace.getState().busy || usePencilWorkspace.getState().busy;

function schedule(delay: number): void {
  if (!tracking) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, Math.max(0, delay));
}

function markDirty(projectId: string): void {
  dirty.add(projectId);
  schedule(0);
}

function tick(): void {
  timer = null;
  const { activeId, transitioning } = useXDProjects.getState();
  if (!activeId || !dirty.has(activeId) || job) return;
  if (transitioning || operationRunning()) { schedule(PREVIEW_IDLE_MS); return; }
  const wait = Math.max(lastInput + PREVIEW_IDLE_MS, lastStart + PREVIEW_THROTTLE_MS) - Date.now();
  if (wait > 0) { schedule(wait); return; }
  void capture(activeId);
}

function capture(projectId: string): Promise<void> {
  dirty.delete(projectId);
  lastStart = Date.now();
  const current: CaptureJob = { projectId, abandoned: false, done: Promise.resolve() };
  job = current;
  current.done = (async () => {
    try {
      const picture = await captureProjectPicture(projectId, PREVIEW_MAX_EDGE);
      if (picture === null || current.abandoned || useXDProjects.getState().activeId !== projectId) { dirty.add(projectId); return; }
      if (picture === "clear") {
        await invoke("xdesign_preview_delete", { projectId });
        useProjectPreviews.getState().forget(projectId);
      } else {
        const entry = await invoke<PreviewEntry>("xdesign_preview_write", { projectId, png: Array.from(picture) });
        useProjectPreviews.getState().noteWritten(projectId, entry);
      }
    } catch (error) {
      log.warn("xdesign: project preview was not saved", error);
      dirty.add(projectId);
    } finally {
      if (job === current) job = null;
      schedule(0);
    }
  })();
  return current.done;
}

export function startPreviewTracking(): () => void {
  if (!isTauri()) return () => {};
  tracking = true;
  const noteInput = () => { lastInput = Date.now(); };
  for (const type of INPUT_EVENTS) window.addEventListener(type, noteInput, { capture: true, passive: true });
  const unsubscribe = useXDProjects.subscribe((state, previous) => {
    const id = state.activeId;
    if (id !== previous.activeId && job) job.abandoned = true;
    if (!id) return;
    if (id !== previous.activeId) { markDirty(id); return; }
    if (state.registry !== previous.registry && state.registry.find((m) => m.id === id)?.updatedAt !== previous.registry.find((m) => m.id === id)?.updatedAt) markDirty(id);
  });
  const { activeId } = useXDProjects.getState();
  if (activeId) markDirty(activeId);
  return () => {
    tracking = false;
    for (const type of INPUT_EVENTS) window.removeEventListener(type, noteInput, { capture: true });
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (job) job.abandoned = true;
    timer = null; job = null; dirty = new Set(); lastStart = -Infinity; lastInput = -Infinity;
  };
}

/** Called while leaving a project: captures now if it changed, and waits only as long as the budget allows. */
export async function settlePreview(projectId: string, budgetMs = PREVIEW_LEAVE_BUDGET_MS): Promise<void> {
  if (!tracking) return;
  if (!job && dirty.has(projectId) && !operationRunning()) void capture(projectId);
  const current = job;
  if (!current || current.projectId !== projectId) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    current.done.then(() => false),
    new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(true), budgetMs); }),
  ]);
  clearTimeout(timeout);
  if (timedOut) current.abandoned = true;
}

export async function deleteProjectPreview(projectId: string): Promise<void> {
  useProjectPreviews.getState().forget(projectId);
  if (!isTauri()) return;
  try { await invoke("xdesign_preview_delete", { projectId }); }
  catch (error) { log.warn("xdesign: project preview was not deleted", error); }
}
