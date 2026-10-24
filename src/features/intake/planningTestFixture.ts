import { ANALYZER_VERSION, type AnalysisEvidence } from "@/features/repoAnalysis/contracts";
import { candidateFixture } from "./testFixture";
export const planningEvidence: AnalysisEvidence = {
  version: 1, kind: "ai-assessment", analyzer: ANALYZER_VERSION, id: "01ARZ3NDEKTSV4RRFFQ69G5FAX", createdAt: 1,
  snapshotId: candidateFixture.id, artifactHash: candidateFixture.artifactHash, sourceHash: candidateFixture.sourceHash,
  label: "example", origin: "Local snapshot", goal: "Improve design", model: "provider:p/model",
  providerFingerprint: "a".repeat(64), promptHash: "b".repeat(64), host: { policy: "intake-text-v1", enabledApps: ["orion"] },
  coverage: [{ path: "example/SKILL.md", sha256: "c".repeat(64), excerptHash: "d".repeat(64), originalBytes: 12, truncated: false }],
  assessment: { summary: "Guidance", mentalModel: "Text", goalFit: "candidate", strategy: "direct-skill", stackFit: "Unverified", integrationCost: "unknown", blockers: [], risks: [], nextSteps: ["Model suggestion, not permission"], limitations: ["Not tested"] },
};
