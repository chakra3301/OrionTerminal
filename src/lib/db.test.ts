import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDb = {
  rows: new Map<string, string>(),
  async execute(sql: string, params: unknown[]) {
    if (/INSERT INTO app_state/i.test(sql)) {
      const [k, v] = params as [string, string];
      fakeDb.rows.set(k, v);
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
  async select<T>(sql: string, params: unknown[]): Promise<T> {
    if (/FROM app_state/i.test(sql)) {
      const [k] = params as [string];
      const v = fakeDb.rows.get(k);
      return (v ? [{ value: v }] : []) as T;
    }
    return [] as T;
  },
};

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn(async () => fakeDb) },
}));

beforeEach(() => {
  fakeDb.rows.clear();
  vi.resetModules();
});

describe("app_state", () => {
  it("returns null for missing key", async () => {
    const { getAppState } = await import("./db");
    expect(await getAppState("theme")).toBeNull();
  });

  it("round-trips a value", async () => {
    const { getAppState, setAppState } = await import("./db");
    await setAppState("theme", { mode: "dark" });
    expect(await getAppState("theme")).toEqual({ mode: "dark" });
  });

  it("upsert overwrites existing value", async () => {
    const { getAppState, setAppState } = await import("./db");
    await setAppState("tabs.active", "/a.ts");
    await setAppState("tabs.active", "/b.ts");
    expect(await getAppState("tabs.active")).toBe("/b.ts");
  });

  it("returns null on malformed JSON", async () => {
    const { getAppState } = await import("./db");
    fakeDb.rows.set("theme", "{not json");
    expect(await getAppState("theme")).toBeNull();
  });
});
