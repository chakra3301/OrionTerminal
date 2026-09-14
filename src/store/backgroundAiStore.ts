import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";

export type BackgroundAiKind = "notes" | "assets" | "companion";
type Permissions = Record<BackgroundAiKind, boolean>;
const OFF: Permissions = { notes: false, assets: false, companion: false };
const versions: Record<BackgroundAiKind, number> = { notes: 0, assets: 0, companion: 0 };
const active = new Map<BackgroundAiKind, AbortController>();
const saveInOrder = serialQueue();
let loading: Promise<void> | null = null;

type State = {
  permissions: Permissions;
  loaded: boolean;
  load: () => Promise<void>;
  setConsent: (kind: BackgroundAiKind, on: boolean) => Promise<void>;
};

export const useBackgroundAi = create<State>((set, get) => ({
  permissions: { ...OFF },
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    if (!loading) loading = (async () => {
      const saved = await getAppState<{ version?: number; permissions?: Partial<Permissions> }>("ai.background");
      const permissions = { ...OFF };
      if (saved?.version === 1) for (const key of Object.keys(OFF) as BackgroundAiKind[]) {
        permissions[key] = saved.permissions?.[key] === true;
      }
      set({ permissions, loaded: true });
    })().finally(() => { loading = null; });
    await loading;
  },
  setConsent: async (kind, on) => {
    const version = ++versions[kind];
    if (!on) {
      active.get(kind)?.abort();
      set({ permissions: { ...get().permissions, [kind]: false } });
    }
    await get().load();
    if (!on && versions[kind] === version) set({ permissions: { ...get().permissions, [kind]: false } });
    await saveInOrder(async () => {
      const permissions = { ...get().permissions, [kind]: on };
      await setAppState("ai.background", { version: 1, permissions });
      if (versions[kind] === version) set({ permissions: { ...get().permissions, [kind]: on } });
    });
  },
}));

const queues = Object.fromEntries(Object.keys(OFF).map((kind) => [kind, serialQueue()])) as Record<BackgroundAiKind, ReturnType<typeof serialQueue>>;

export async function withBackgroundConsent<T>(kind: BackgroundAiKind, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  const version = versions[kind];
  await useBackgroundAi.getState().load();
  if (!useBackgroundAi.getState().permissions[kind] || version !== versions[kind]) return null;
  return queues[kind](async () => {
    if (signal?.aborted || !useBackgroundAi.getState().permissions[kind] || version !== versions[kind]) return null;
    const controller = new AbortController();
    active.set(kind, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await task(controller.signal);
      return controller.signal.aborted || version !== versions[kind] ? null : result;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (active.get(kind) === controller) active.delete(kind);
    }
  });
}
