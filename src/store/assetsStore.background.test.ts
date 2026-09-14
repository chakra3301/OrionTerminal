import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ consent: vi.fn(), analysis: vi.fn(), upsert: vi.fn(), attach: vi.fn(), warn: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { assetStoreFile: m.store, assetDeleteFile: vi.fn(async () => undefined) } }));
vi.mock("@/lib/db", () => ({ listAssets: vi.fn(), insertAsset: vi.fn(async () => undefined), deleteAsset: vi.fn(async () => undefined), setAssetFavorite: vi.fn(), upsertTagsByName: m.upsert, attachAssetTags: m.attach, listAllAssetTags: vi.fn() }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex: vi.fn(), removeEntityEmbedding: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/store/toastStore", () => ({ toast: { warning: m.warn } }));
vi.mock("@/features/agents/textCall", () => ({ runSurfaceAnalysis: m.analysis }));
vi.mock("@/store/backgroundAiStore", () => ({ withBackgroundConsent: m.consent }));
import { useAssetsStore } from "./assetsStore";
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); useAssetsStore.setState({ assets: new Map(), taggingIds: new Set(), loaded: true });
  m.store.mockResolvedValue({ id: "asset-fixture", kind: "image", originalName: "orb.png", filePath: "/synthetic/orb.png", mimeType: "image/png", sizeBytes: 100 });
  m.consent.mockImplementation(async (_kind, work) => work(new AbortController().signal));
  m.analysis.mockResolvedValue('orb'); m.upsert.mockResolvedValue([{ id: "tag-orb", name: "orb" }]); m.attach.mockResolvedValue(undefined);
});
it("retains the ingested image without starting analysis when consent is off", async () => {
  m.consent.mockResolvedValue(null);
  const assets = await useAssetsStore.getState().ingestPaths(["/synthetic/orb.png"]);
  await vi.waitFor(() => expect(useAssetsStore.getState().taggingIds.size).toBe(0));
  expect(assets).toHaveLength(1); expect(m.consent).toHaveBeenCalledWith("assets", expect.any(Function));
  expect(m.analysis).not.toHaveBeenCalled(); expect(m.attach).not.toHaveBeenCalled();
});
it("uses the Archives route and real image path, preserving manual tags added during persistence", async () => {
  const tags = deferred<Array<{ id: string; name: string }>>(); m.upsert.mockReturnValue(tags.promise);
  await useAssetsStore.getState().ingestPaths(["/synthetic/orb.png"]);
  await vi.waitFor(() => expect(m.upsert).toHaveBeenCalled());
  expect(m.analysis).toHaveBeenCalledWith(expect.any(String), "archives", { signal: expect.any(AbortSignal), imagePath: "/synthetic/orb.png" });
  useAssetsStore.getState().setTags("asset-fixture", ["manual"]);
  expect(useAssetsStore.getState().taggingIds.has("asset-fixture")).toBe(true);
  tags.resolve([{ id: "tag-orb", name: "orb" }]);
  await vi.waitFor(() => expect(useAssetsStore.getState().taggingIds.size).toBe(0));
  expect(useAssetsStore.getState().assets.get("asset-fixture")?.tags).toEqual(["manual", "orb"]);
});
it("does not persist late tags for a deleted asset and keeps activity until the request finishes", async () => {
  const reply = deferred<string>(); m.analysis.mockReturnValue(reply.promise);
  await useAssetsStore.getState().ingestPaths(["/synthetic/orb.png"]);
  await vi.waitFor(() => expect(m.analysis).toHaveBeenCalled());
  await useAssetsStore.getState().remove("asset-fixture");
  expect(useAssetsStore.getState().taggingIds.has("asset-fixture")).toBe(true);
  reply.resolve('orb');
  await vi.waitFor(() => expect(useAssetsStore.getState().taggingIds.size).toBe(0));
  expect(m.attach).not.toHaveBeenCalled(); expect(useAssetsStore.getState().assets.has("asset-fixture")).toBe(false);
});
it("surfaces tagging failure without losing the asset", async () => {
  m.analysis.mockRejectedValue(new Error("Selected provider is disconnected"));
  await useAssetsStore.getState().ingestPaths(["/synthetic/orb.png"]);
  await vi.waitFor(() => expect(m.warn).toHaveBeenCalledWith("Automatic media tagging failed", expect.objectContaining({ body: expect.stringContaining("disconnected") })));
  expect(useAssetsStore.getState().assets.has("asset-fixture")).toBe(true); expect(useAssetsStore.getState().taggingIds.size).toBe(0);
});
