import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ saved: null as unknown, get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: db.get, setAppState: db.set }));

beforeEach(() => {
  vi.resetModules();
  db.saved = null;
  db.get.mockReset().mockImplementation(async () => db.saved);
  db.set.mockReset().mockImplementation(async (_key, value) => { db.saved = structuredClone(value); });
});

describe("persisted connector session ownership", () => {
  it("invalidates a changed CLI account without deleting other providers' bindings", async () => {
    let store = await import("./sessionOwnership");
    const codex = JSON.stringify(["codex", "codex_cli", "", ""]);
    const api = JSON.stringify(["api", "openai", "https://example.test", "key-ref"]);
    await store.rememberSessionOwner("codex-session", codex);
    await store.rememberSessionOwner("api-session", api);
    await store.forgetSessionOwnersForKind("codex_cli");
    vi.resetModules(); store = await import("./sessionOwnership");
    expect(await store.hasSessionOwner("codex-session", codex)).toBe(false);
    expect(await store.hasSessionOwner("api-session", api)).toBe(true);
  });
  it("revokes a cancelled session, rejects late init records, and persists the deletion", async () => {
    let store = await import("./sessionOwnership");
    await store.rememberSessionOwner("cancelled", "p");
    await store.rememberSessionOwner("other-chat", "p");
    await store.forgetSessionOwner("cancelled");
    await store.rememberSessionOwner("cancelled", "p");
    expect(await store.hasSessionOwner("cancelled", "p")).toBe(false);
    vi.resetModules(); store = await import("./sessionOwnership");
    expect(await store.hasSessionOwner("cancelled", "p")).toBe(false);
    expect(await store.hasSessionOwner("other-chat", "p")).toBe(true);
  });
  it("keeps a cancelled session revoked in memory when its deletion cannot be saved", async () => {
    const store = await import("./sessionOwnership");
    await store.rememberSessionOwner("cancelled", "p");
    db.set.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(store.forgetSessionOwner("cancelled")).rejects.toThrow("storage unavailable");
    await store.rememberSessionOwner("cancelled", "p");
    expect(await store.hasSessionOwner("cancelled", "p")).toBe(false);
  });
  it("survives a module restart and never assigns another provider's session", async () => {
    let store = await import("./sessionOwnership");
    await store.rememberSessionOwner("session-1", "provider-a");
    vi.resetModules();
    store = await import("./sessionOwnership");
    expect(await store.hasSessionOwner("session-1", "provider-a")).toBe(true);
    expect(await store.hasSessionOwner("session-1", "provider-b")).toBe(false);
    expect(await store.hasSessionOwner("legacy-unbound-session", "provider-a")).toBe(false);
  });
  it("fails closed on read errors but retries when storage recovers", async () => {
    db.get.mockRejectedValueOnce(new Error("database temporarily unavailable"));
    const store = await import("./sessionOwnership");
    expect(await store.hasSessionOwner("s", "p")).toBe(false);
    db.saved = { version: 1, owners: { s: { identity: "p", touched: 1 } } };
    expect(await store.hasSessionOwner("s", "p")).toBe(true);
  });
  it("ignores malformed entries and bounds persisted metadata", async () => {
    db.saved = { version: 1, owners: { invalid: null, ...Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`s${i}`, { identity: "p", touched: i }])) } };
    const store = await import("./sessionOwnership");
    expect(await store.hasSessionOwner("invalid", "p")).toBe(false);
    expect(await store.hasSessionOwner("s0", "p")).toBe(false);
    expect(await store.hasSessionOwner("s519", "p")).toBe(true);
    await store.rememberSessionOwner("latest", "p");
    expect(Object.keys((db.saved as { owners: object }).owners)).toHaveLength(512);
  });
  it("serializes writes so an earlier snapshot cannot overwrite newer ownership", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    db.set.mockImplementationOnce(async (_key, value) => { await gate; db.saved = value; });
    const store = await import("./sessionOwnership");
    const first = store.rememberSessionOwner("s1", "p1");
    await vi.waitFor(() => expect(db.set).toHaveBeenCalledTimes(1));
    const second = store.rememberSessionOwner("s2", "p2");
    await Promise.resolve();
    expect(db.set).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect((db.saved as { owners: object }).owners).toHaveProperty("s1");
    expect((db.saved as { owners: object }).owners).toHaveProperty("s2");
  });
});
