import { describe, expect, it } from "vitest";
import {
  enqueueToast,
  removeToast,
  unreadCount,
  MAX_VISIBLE,
  MAX_HISTORY,
  type Toast,
  type ToastQueueState,
} from "./toastStore";

let seq = 0;
function mkToast(overrides: Partial<Toast> = {}): Toast {
  seq += 1;
  return {
    id: `t${seq}`,
    kind: "info",
    title: `toast ${seq}`,
    durationMs: 4000,
    createdAt: seq,
    ...overrides,
  };
}

const empty: ToastQueueState = { visible: [], queued: [], history: [] };

function fill(n: number): ToastQueueState {
  let s = empty;
  for (let i = 0; i < n; i++) s = enqueueToast(s, mkToast());
  return s;
}

describe("unreadCount", () => {
  it("counts history entries newer than lastReadAt", () => {
    const history = [
      mkToast({ createdAt: 30 }),
      mkToast({ createdAt: 20 }),
      mkToast({ createdAt: 10 }),
    ];
    expect(unreadCount(history, 15)).toBe(2); // 30 and 20
  });
  it("is zero when everything has been seen", () => {
    const history = [mkToast({ createdAt: 5 }), mkToast({ createdAt: 3 })];
    expect(unreadCount(history, 10)).toBe(0);
  });
  it("counts all when never read", () => {
    expect(unreadCount(fill(3).history, 0)).toBe(3);
  });
});

describe("enqueueToast", () => {
  it("shows toasts directly until the visible cap", () => {
    const s = fill(MAX_VISIBLE);
    expect(s.visible).toHaveLength(MAX_VISIBLE);
    expect(s.queued).toHaveLength(0);
  });

  it("queues past the cap instead of stacking more on screen", () => {
    const s = fill(MAX_VISIBLE + 3);
    expect(s.visible).toHaveLength(MAX_VISIBLE);
    expect(s.queued).toHaveLength(3);
  });

  it("records every toast in history, newest first, capped", () => {
    let s = empty;
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = enqueueToast(s, mkToast({ title: `h${i}` }));
    }
    expect(s.history).toHaveLength(MAX_HISTORY);
    expect(s.history[0]?.title).toBe(`h${MAX_HISTORY + 4}`);
  });

  it("replaces a visible toast with the same dedupeKey in place", () => {
    let s = enqueueToast(empty, mkToast({ dedupeKey: "k", title: "first" }));
    s = enqueueToast(s, mkToast());
    s = enqueueToast(s, mkToast({ dedupeKey: "k", title: "second" }));
    expect(s.visible).toHaveLength(2);
    expect(s.visible[0]?.title).toBe("second");
  });

  it("replaces a queued toast with the same dedupeKey", () => {
    let s = fill(MAX_VISIBLE);
    s = enqueueToast(s, mkToast({ dedupeKey: "k", title: "old" }));
    s = enqueueToast(s, mkToast({ dedupeKey: "k", title: "new" }));
    expect(s.queued).toHaveLength(1);
    expect(s.queued[0]?.title).toBe("new");
  });
});

describe("removeToast", () => {
  it("promotes the next queued toast when a visible one is dismissed", () => {
    const s = fill(MAX_VISIBLE + 2);
    const firstQueued = s.queued[0]!;
    const next = removeToast(s, s.visible[0]!.id);
    expect(next.visible).toHaveLength(MAX_VISIBLE);
    expect(next.visible[MAX_VISIBLE - 1]?.id).toBe(firstQueued.id);
    expect(next.queued).toHaveLength(1);
  });

  it("removes from the queue without touching visible", () => {
    const s = fill(MAX_VISIBLE + 2);
    const next = removeToast(s, s.queued[1]!.id);
    expect(next.visible).toEqual(s.visible);
    expect(next.queued).toHaveLength(1);
  });

  it("is a no-op for an unknown id", () => {
    const s = fill(3);
    const next = removeToast(s, "nope");
    expect(next.visible).toEqual(s.visible);
    expect(next.queued).toEqual(s.queued);
  });
});
