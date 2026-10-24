import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: m.get, setAppState: m.set }));
import { useAnalysisHistory } from "./analysisHistory";
import { prepareAnalysisReview, approveAnalysisUpload, analyzeReviewedSource } from "@/features/repoAnalysis/service";
import { sha256 } from "@/features/repoAnalysis/sourceText";
import type { AnalysisEvidence } from "@/features/repoAnalysis/contracts";
let report: AnalysisEvidence;
beforeEach(async () => {
  vi.resetAllMocks(); m.get.mockResolvedValue(null); m.set.mockResolvedValue(undefined);
  useAnalysisHistory.setState({ items: [], loaded: true, error: null });
  const hash = await sha256("example text");
  const review = await prepareAnalysisReview({ model: "provider:p/model", providerIdentity: "id", goal: "Goal", host: { policy: "intake-text-v1", enabledApps: [] }, source: { id: "snapshot", label: "Example", origin: "Local", artifactHash: hash, sourceHash: hash, inventory: [{ path: "SKILL.md", bytes: 12, sha256: hash, kind: "text" }], excerpts: [{ path: "SKILL.md", text: "example text", originalBytes: 12, sha256: hash, excerptHash: hash, truncated: false }] } });
  report = await analyzeReviewedSource(review, approveAnalysisUpload(review), { signal: new AbortController().signal, assertCurrent: () => {}, call: async () => JSON.stringify({ summary: "Example", mentalModel: "Example", goalFit: "uncertain", strategy: "unsupported", stackFit: "Unknown", integrationCost: "unknown", blockers: [], risks: [], nextSteps: [], limitations: ["Excerpt only"] }) });
});
it("publishes only after durable acknowledgement and roundtrips without source bodies", async () => {
  let finish!: () => void; m.set.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
  const saving = useAnalysisHistory.getState().save(report); await vi.waitFor(() => expect(m.set).toHaveBeenCalledOnce());
  expect(useAnalysisHistory.getState().items).toEqual([]); finish(); await saving;
  m.get.mockResolvedValue(m.set.mock.calls[0]![1]); await useAnalysisHistory.getState().load();
  expect(useAnalysisHistory.getState().items).toEqual([report]); expect(m.get).toHaveBeenCalledWith("intake.analysis", true);
});
it("failed/unknown hydration preserves the view and blocks writes", async () => {
  useAnalysisHistory.setState({ items: [report] }); m.get.mockResolvedValue({ version: 99, items: [] }); await useAnalysisHistory.getState().load();
  expect(useAnalysisHistory.getState().items).toEqual([report]); expect(useAnalysisHistory.getState().loaded).toBe(false);
  await expect(useAnalysisHistory.getState().save(report)).rejects.toThrow("Reload"); expect(m.set).not.toHaveBeenCalled();
});
it("ambiguous writes require reload and retry without duplicate reports", async () => {
  m.set.mockRejectedValueOnce(new Error("commit uncertain")); await expect(useAnalysisHistory.getState().save(report)).rejects.toThrow("uncertain");
  expect(useAnalysisHistory.getState().items).toEqual([]); m.get.mockResolvedValue({ version: 1, items: [report] }); await useAnalysisHistory.getState().load();
  await useAnalysisHistory.getState().save(report); expect(m.set).toHaveBeenCalledOnce();
});
it("does not silently evict a full history", async () => {
  useAnalysisHistory.setState({ items: Array.from({ length: 8 }, (_, i) => ({ ...report, id: String(i) })) });
  await expect(useAnalysisHistory.getState().save(report)).rejects.toThrow("Eight"); expect(m.set).not.toHaveBeenCalled();
});
