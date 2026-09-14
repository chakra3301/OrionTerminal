import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ saved: null as unknown, get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: db.get, setAppState: db.set }));
beforeEach(() => {
  vi.resetModules(); db.saved = null;
  db.get.mockReset().mockImplementation(async () => db.saved);
  db.set.mockReset().mockImplementation(async (_key, value) => { db.saved = structuredClone(value); });
});
describe("background upload consent", () => {
  it("defaults off and does not run an upload", async () => {
    const { withBackgroundConsent, useBackgroundAi } = await import("./backgroundAiStore");
    const task = vi.fn();
    expect(await withBackgroundConsent("assets", task)).toBeNull();
    expect(task).not.toHaveBeenCalled();
    expect(useBackgroundAi.getState().permissions).toEqual({ assets: false, notes: false, companion: false });
  });
  it("accepts only versioned literal booleans", async () => {
    db.saved = { version: 1, permissions: { assets: "true", notes: true } };
    const { useBackgroundAi } = await import("./backgroundAiStore");
    await useBackgroundAi.getState().load();
    expect(useBackgroundAi.getState().permissions).toEqual({ assets: false, notes: true, companion: false });
  });
  it("persists explicit consent across reloads", async () => {
    let store = await import("./backgroundAiStore");
    await store.useBackgroundAi.getState().setConsent("assets", true);
    vi.resetModules(); store = await import("./backgroundAiStore");
    const task = vi.fn().mockResolvedValue("tags");
    expect(await store.withBackgroundConsent("assets", task)).toBe("tags");
    expect(task).toHaveBeenCalledOnce();
  });
  it("does not enable on failed persistence", async () => {
    const { useBackgroundAi, withBackgroundConsent } = await import("./backgroundAiStore");
    db.set.mockRejectedValueOnce(new Error("disk"));
    await expect(useBackgroundAi.getState().setConsent("notes", true)).rejects.toThrow("disk");
    const task = vi.fn(); await withBackgroundConsent("notes", task);
    expect(task).not.toHaveBeenCalled();
  });
  it("aborts active work, discards queued uploads and suppresses late output", async () => {
    const { useBackgroundAi, withBackgroundConsent } = await import("./backgroundAiStore");
    await useBackgroundAi.getState().setConsent("assets", true);
    let release!: (v: string) => void;
    let signal!: AbortSignal;
    const first = withBackgroundConsent("assets", (s) => { signal = s; return new Promise<string>((r) => { release = r; }); });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const next = vi.fn().mockResolvedValue("queued");
    const second = withBackgroundConsent("assets", next);
    await useBackgroundAi.getState().setConsent("assets", false);
    expect(signal.aborted).toBe(true);
    release("late");
    expect(await first).toBeNull(); expect(await second).toBeNull(); expect(next).not.toHaveBeenCalled();
  });
  it("never reinstates a later opt-out when an earlier enable finishes", async () => {
    const { useBackgroundAi } = await import("./backgroundAiStore");
    await useBackgroundAi.getState().load();
    let release!: () => void;
    db.set.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    const enable = useBackgroundAi.getState().setConsent("notes", true);
    await vi.waitFor(() => expect(release).toBeDefined());
    const disable = useBackgroundAi.getState().setConsent("notes", false);
    release(); await Promise.all([enable, disable]);
    expect(useBackgroundAi.getState().permissions.notes).toBe(false);
  });
  it("a failed disable still stops uploads in memory", async () => {
    const { useBackgroundAi, withBackgroundConsent } = await import("./backgroundAiStore");
    await useBackgroundAi.getState().setConsent("companion", true);
    db.set.mockRejectedValueOnce(new Error("disk"));
    await expect(useBackgroundAi.getState().setConsent("companion", false)).rejects.toThrow("disk");
    const task = vi.fn(); await withBackgroundConsent("companion", task);
    expect(task).not.toHaveBeenCalled();
  });
});
