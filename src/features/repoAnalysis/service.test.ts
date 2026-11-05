import { beforeEach, expect, it, vi } from "vitest";
import { prepareAnalysisReview, approveAnalysisUpload, analyzeReviewedSource } from "./service";
import { parseAssessment, parseHistory, type AnalysisSource } from "./contracts";
import { sha256 } from "./sourceText";
import { inspectDeclarations } from "./declarations";
export const assessmentFixture = {
  summary: "Text guidance only.", mentalModel: "A Markdown skill with a resource.", goalFit: "candidate", strategy: "direct-skill", stackFit: "No new runtime is needed.", integrationCost: "low", blockers: [],
  risks: [{ title: "Execution requests", detail: "Review these instructions manually.", severity: "warning", basis: "excerpt", citations: [{ path: "example/SKILL.md", quote: "Use DESIGN.md" }] }], nextSteps: ["Review the preserved attribution."], limitations: ["Excerpts only; behavior was not tested."],
};
let source: AnalysisSource;
beforeEach(async () => {
  const text = "Use DESIGN.md; no tools are granted.";
  const hash = await sha256(text);
  source = { id: "snapshot", artifactHash: "a".repeat(64), sourceHash: "b".repeat(64), label: "example", origin: "Local snapshot", inventory: [{ path: "example/SKILL.md", bytes: text.length, sha256: hash, kind: "text" }], excerpts: [{ path: "example/SKILL.md", originalBytes: text.length, sha256: hash, excerptHash: hash, truncated: false, text }] };
});
const prepare = () => prepareAnalysisReview({ source, host: { policy: "intake-text-v1", enabledApps: ["orion"] }, model: "provider:chosen/model", providerIdentity: "identity", goal: "Improve frontend design" });
const dependencies = () => ({ signal: new AbortController().signal, assertCurrent: vi.fn(), call: vi.fn().mockResolvedValue(JSON.stringify(assessmentFixture)) });
it("prepares locally, freezes source input, and accepts only exact one-shot consent", async () => {
  const review = await prepare(); const deps = dependencies();
  expect(deps.call).not.toHaveBeenCalled(); source.excerpts[0]!.text = "changed later";
  expect(review.prompt).toContain("Use DESIGN.md"); expect(Object.isFrozen(review.source.excerpts[0])).toBe(true);
  await expect(analyzeReviewedSource(review, { reviewHash: review.promptHash }, deps)).rejects.toThrow("consent");
  const consent = approveAnalysisUpload(review); const evidence = await analyzeReviewedSource(review, consent, deps);
  expect(evidence.kind).toBe("ai-assessment"); expect(evidence.artifactHash).toBe(source.artifactHash); expect(evidence.coverage[0]).not.toHaveProperty("text");
  expect(parseHistory({ version: 1, items: [evidence] })[0]).toEqual(evidence);
  await expect(analyzeReviewedSource(review, consent, deps)).rejects.toThrow("consent"); expect(deps.call).toHaveBeenCalledOnce();
});
it("scopes repository opinions separately and preserves legacy saved records", async () => {
  const skill = await prepare();
  const legacy = await analyzeReviewedSource(skill, approveAnalysisUpload(skill), dependencies());
  legacy.analyzer = "intake-advisory-v1";
  expect(parseHistory({ version: 1, items: [legacy] })[0]!.analyzer).toBe("intake-advisory-v1");
  source.scope = "repository-documents";
  const review = await prepare();
  expect(review.promptHash).not.toBe(skill.promptHash); expect(review.prompt).toContain("SELECTED ROOT DOCUMENT SNAPSHOT");
  await expect(analyzeReviewedSource(review, approveAnalysisUpload(review), dependencies())).rejects.toThrow("cannot qualify");
  const deps = dependencies(); deps.call.mockResolvedValue(JSON.stringify({ ...assessmentFixture, strategy: "unsupported" }));
  const evidence = await analyzeReviewedSource(review, approveAnalysisUpload(review), deps);
  expect(parseHistory({ version: 1, items: [legacy, evidence] })[1]!.scope).toBe("repository-documents");
  expect(() => parseHistory({ version: 1, items: [{ ...evidence, analyzer: "intake-advisory-v1" }] })).toThrow("legacy");
});
it("binds host declaration evidence to selected source hashes and preserves v2 history", async () => {
  source.scope = "repository-documents";
  const original = await prepare();
  const file = source.excerpts[0]!;
  source.declarations = [inspectDeclarations({ path: file.path, sha256: file.sha256, text: file.text })];
  const reviewed = await prepare(); expect(reviewed.promptHash).not.toBe(original.promptHash);
  const deps = dependencies(); deps.call.mockResolvedValue(JSON.stringify({ ...assessmentFixture, strategy: "unsupported" }));
  const evidence = await analyzeReviewedSource(reviewed, approveAnalysisUpload(reviewed), deps);
  expect(evidence.declarations).toEqual(source.declarations);
  expect(() => parseHistory({ version: 1, items: [{ ...evidence, analyzer: "intake-advisory-v2" }] })).toThrow("legacy");
  const { declarations: _removed, ...v2 } = evidence;
  expect(parseHistory({ version: 1, items: [{ ...v2, analyzer: "intake-advisory-v2" }] })[0]!.analyzer).toBe("intake-advisory-v2");
  source.declarations![0]!.sha256 = "f".repeat(64);
  await expect(prepare()).rejects.toThrow("identity mismatch");
});
it("rejects model-authored approval fields and unsupported decisions", () => {
  expect(() => parseAssessment({ ...assessmentFixture, verified: true })).toThrow("fields");
  expect(() => parseAssessment({ ...assessmentFixture, strategy: "run-shell" })).toThrow();
  expect(() => parseAssessment({ ...assessmentFixture, risks: [{ ...assessmentFixture.risks[0], approved: true }] })).toThrow();
});
it("rejects fabricated citations and incorrectly labelled inference", async () => {
  expect(() => parseAssessment({ ...assessmentFixture, risks: [{ ...assessmentFixture.risks[0], citations: [{ path: "outside/.env", quote: "Use DESIGN.md" }] }] }, source.excerpts)).toThrow("citation");
  expect(() => parseAssessment({ ...assessmentFixture, risks: [{ ...assessmentFixture.risks[0], basis: "inferred" }] }, source.excerpts)).toThrow("basis");
  const review = await prepare(), deps = dependencies(); deps.call.mockResolvedValue("```json\n{}\n```");
  await expect(analyzeReviewedSource(review, approveAnalysisUpload(review), deps)).rejects.toThrow("required analysis JSON");
});
it("blocks missing host capabilities, tampered excerpts and potential credentials before upload", async () => {
  source.excerpts[0]!.text = "different"; await expect(prepare()).rejects.toThrow("identity mismatch");
  source.excerpts[0]!.excerptHash = await sha256("different");
  await expect(prepareAnalysisReview({ source, host: { policy: "intake-text-v1", enabledApps: ["admin"] }, model: "provider:chosen/model", providerIdentity: "id", goal: "goal" })).rejects.toThrow();
  await expect(prepareAnalysisReview({ source, host: { policy: "intake-text-v1", enabledApps: [] }, model: "provider:chosen/model", providerIdentity: "id", goal: `Use sk-${"a".repeat(32)}` })).rejects.toThrow("credential");
});
it("does not start or publish stale/cancelled analysis", async () => {
  const review = await prepare(), deps = dependencies(); deps.assertCurrent.mockImplementation(() => { throw new Error("stale"); });
  await expect(analyzeReviewedSource(review, approveAnalysisUpload(review), deps)).rejects.toThrow("stale"); expect(deps.call).not.toHaveBeenCalled();
  const controller = new AbortController(); let finish!: (s: string) => void;
  deps.assertCurrent.mockImplementation(() => undefined); deps.call.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const result = analyzeReviewedSource(review, approveAnalysisUpload(review), { ...deps, signal: controller.signal });
  const rejected = expect(result).rejects.toThrow("cancelled"); controller.abort(); finish(JSON.stringify(assessmentFixture)); await rejected;
});
it("expires review and fingerprints goal/model/host changes separately", async () => {
  const first = await prepare();
  const second = await prepareAnalysisReview({ ...first, source: first.source, goal: "A different goal" });
  expect(first.promptHash).not.toBe(second.promptHash);
  const clock = vi.spyOn(Date, "now").mockReturnValue(first.createdAt + 600_001);
  try { expect(() => approveAnalysisUpload(first)).toThrow("expired"); } finally { clock.mockRestore(); }
});
