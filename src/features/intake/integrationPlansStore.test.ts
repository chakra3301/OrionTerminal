import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: db.get, setAppState: db.set }));
import { useIntegrationPlans as store } from "./integrationPlansStore";
import { createPlan } from "./integrationPlan";
import { planningEvidence as evidence } from "./planningTestFixture";
const plan = () => createPlan(evidence, evidence.host, "skill", "reuse", "No scripts");
beforeEach(() => { vi.resetAllMocks(); db.get.mockResolvedValue(null); db.set.mockResolvedValue(undefined); store.setState({ items: [], loaded: false, error: null }); });
it("publishes only after durable acknowledgement and snapshots queued inputs", async () => {
  await store.getState().load();
  let resolve!: () => void; db.set.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
  const p = plan(), save = store.getState().save(p); p.constraints = "changed";
  await Promise.resolve(); expect(store.getState().items).toEqual([]);
  resolve(); await save;
  expect(store.getState().items[0]!.constraints).toBe("No scripts");
  expect(db.set.mock.calls[0]![0]).toBe("intake.plans");
});
it("failed hydration preserves last-good view, blocks writes and never rewrites unknown data", async () => {
  const p = plan(); store.setState({ items: [p], loaded: true }); db.get.mockResolvedValue({ version: 99, items: [] });
  await store.getState().load(); expect(store.getState().items).toEqual([p]); expect(store.getState().loaded).toBe(false);
  await expect(store.getState().save(plan())).rejects.toThrow("Reload");
  await expect(store.getState().remove(p.id)).rejects.toThrow("Reload"); expect(db.set).not.toHaveBeenCalled();
});
it("ambiguous failed write requires reload and supports idempotent retry", async () => {
  await store.getState().load(); const p = plan(); db.set.mockRejectedValueOnce(new Error("disk"));
  await expect(store.getState().save(p)).rejects.toThrow("disk"); expect(store.getState().items).toEqual([]); expect(store.getState().loaded).toBe(false);
  db.get.mockResolvedValue({ version: 1, items: [p] }); await store.getState().load(); await store.getState().save(p);
  expect(db.set).toHaveBeenCalledOnce(); expect(store.getState().items).toEqual([p]);
  await expect(store.getState().save({ ...p, constraints: "different" })).rejects.toThrow("identity");
});
it("serialized save/remove and reload retain self-contained evidence; quota never evicts", async () => {
  await store.getState().load(); const a = plan(), b = plan();
  await Promise.all([store.getState().save(a), store.getState().save(b), store.getState().remove(a.id)]);
  expect(store.getState().items).toEqual([b]);
  const saved = structuredClone(db.set.mock.calls.at(-1)![1]); store.setState({ items: [], loaded: false }); db.get.mockResolvedValue(saved); await store.getState().load();
  expect(store.getState().items[0]!.evidence).toEqual(evidence);
  store.setState({ items: Array.from({ length: 8 }, plan) }); const count = db.set.mock.calls.length;
  await expect(store.getState().save(plan())).rejects.toThrow("Eight"); expect(db.set).toHaveBeenCalledTimes(count);
});
