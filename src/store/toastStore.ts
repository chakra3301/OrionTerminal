import { create } from "zustand";
import { ulid } from "ulid";

export type ToastKind = "info" | "success" | "warning" | "error";

export type ToastAction = {
  label: string;
  run: () => void | Promise<void>;
};

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Optional button (Undo / Retry / Open…). Running it dismisses the toast. */
  action?: ToastAction;
  /** ms before auto-dismiss; 0 = sticky until the user dismisses it. */
  durationMs: number;
  createdAt: number;
  /** A toast with the same key replaces the prior one instead of stacking —
   * for event feeds that re-fire (progress, repeated failures). */
  dedupeKey?: string;
};

export type ToastInput = {
  kind?: ToastKind;
  title: string;
  body?: string;
  action?: ToastAction;
  durationMs?: number;
  dedupeKey?: string;
};

/** At most this many on screen; the rest wait in a FIFO queue. */
export const MAX_VISIBLE = 4;
/** Ring kept for the notification-center panel (Phase 4). */
export const MAX_HISTORY = 50;

/** Errors are sticky — a failure the user never saw is a silent failure. */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 0,
};

export type ToastQueueState = {
  visible: Toast[];
  queued: Toast[];
  history: Toast[];
};

function pushHistory(history: Toast[], t: Toast): Toast[] {
  const next = [t, ...history];
  return next.length > MAX_HISTORY ? next.slice(0, MAX_HISTORY) : next;
}

export function enqueueToast(s: ToastQueueState, t: Toast): ToastQueueState {
  if (t.dedupeKey) {
    const replaceIn = (list: Toast[]): Toast[] | null => {
      const i = list.findIndex((x) => x.dedupeKey === t.dedupeKey);
      if (i === -1) return null;
      const next = list.slice();
      next[i] = t;
      return next;
    };
    const visible = replaceIn(s.visible);
    if (visible) return { ...s, visible, history: pushHistory(s.history, t) };
    const queued = replaceIn(s.queued);
    if (queued) return { ...s, queued, history: pushHistory(s.history, t) };
  }
  const history = pushHistory(s.history, t);
  if (s.visible.length < MAX_VISIBLE) {
    return { ...s, visible: [...s.visible, t], history };
  }
  return { ...s, queued: [...s.queued, t], history };
}

export function removeToast(s: ToastQueueState, id: string): ToastQueueState {
  let visible = s.visible.filter((t) => t.id !== id);
  let queued = s.queued.filter((t) => t.id !== id);
  const promoted = queued[0];
  if (visible.length < s.visible.length && promoted) {
    visible = [...visible, promoted];
    queued = queued.slice(1);
  }
  return { ...s, visible, queued };
}

type ToastStore = ToastQueueState & {
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  /** Hover pauses auto-dismiss; leaving re-arms the full duration. */
  pause: (id: string) => void;
  resume: (id: string) => void;
  clearHistory: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function armTimers(visible: Toast[], dismiss: (id: string) => void) {
  for (const t of visible) {
    if (t.durationMs > 0 && !timers.has(t.id)) {
      timers.set(
        t.id,
        setTimeout(() => dismiss(t.id), t.durationMs),
      );
    }
  }
}

export const useToasts = create<ToastStore>((set, get) => ({
  visible: [],
  queued: [],
  history: [],

  push: (input) => {
    const t: Toast = {
      id: ulid(),
      kind: input.kind ?? "info",
      title: input.title,
      body: input.body,
      action: input.action,
      durationMs:
        input.durationMs ?? DEFAULT_DURATION[input.kind ?? "info"],
      createdAt: Date.now(),
      dedupeKey: input.dedupeKey,
    };
    set((s) => enqueueToast(s, t));
    armTimers(get().visible, get().dismiss);
    return t.id;
  },

  dismiss: (id) => {
    clearTimer(id);
    set((s) => removeToast(s, id));
    armTimers(get().visible, get().dismiss);
  },

  pause: (id) => clearTimer(id),

  resume: (id) => {
    armTimers(
      get().visible.filter((t) => t.id === id),
      get().dismiss,
    );
  },

  clearHistory: () => set({ history: [] }),
}));

type ToastOpts = Omit<ToastInput, "kind" | "title">;

function push(kind: ToastKind, title: string, opts?: ToastOpts): string {
  return useToasts.getState().push({ ...opts, kind, title });
}

/** Imperative API for non-React call sites (stores, db helpers, EventBridge). */
export const toast = {
  info: (title: string, opts?: ToastOpts) => push("info", title, opts),
  success: (title: string, opts?: ToastOpts) => push("success", title, opts),
  warning: (title: string, opts?: ToastOpts) => push("warning", title, opts),
  error: (title: string, opts?: ToastOpts) => push("error", title, opts),
  /** The do-then-offer-Undo pattern — apply the change optimistically, give
   * the user a beat to take it back. Prefer this over a confirm dialog. */
  undo: (
    title: string,
    undo: () => void | Promise<void>,
    opts?: { body?: string; durationMs?: number },
  ) =>
    push("info", title, {
      body: opts?.body,
      durationMs: opts?.durationMs ?? 6000,
      action: { label: "Undo", run: undo },
    }),
};
