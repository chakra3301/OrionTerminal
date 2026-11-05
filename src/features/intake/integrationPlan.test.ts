import { describe, expect, it } from "vitest";
import { createPlan, parsePlan, parsePlans, planSteps, planReadiness, planHandoff, PLAN_TARGETS, PLAN_APPROACHES } from "./integrationPlan";
import { planningEvidence as evidence } from "./planningTestFixture";
import { candidateFixture } from "./testFixture";
const make = () => createPlan(evidence, evidence.host, "skill", "reuse", "No network");
const live = { host: evidence.host, staged: [candidateFixture], installed: [], loaded: true };
it("captures historical opinion separately from host-authored checklist without treating model suggestions as steps", () => {
  const p = make(); expect(parsePlan(p)).toEqual(p);
  expect(planSteps(p).join(" ")).not.toContain("Model suggestion");
  expect(planHandoff(p)).toContain("NOT EXECUTION AUTHORIZATION");
  expect(planHandoff(p)).toContain("BEGIN UNTRUSTED SOURCE/OWNER DATA");
  expect(p.evidence).not.toBe(evidence);
});
it("only an exact staged skill source exposes manual review, never install authority", () => {
  const p = make(); expect(planReadiness(p, live).state).toBe("review-available");
  for (const field of ["id", "artifactHash", "sourceHash"] as const) expect(planReadiness(p, { ...live, staged: [{ ...candidateFixture, [field]: "different" }] }).state).toBe("blocked");
  expect(planReadiness(p, { ...live, loaded: false }).state).toBe("blocked");
  expect(planReadiness(p, { ...live, host: { ...evidence.host, enabledApps: [] } }).state).toBe("blocked");
  expect(planReadiness(p, { ...live, installed: [{ skillId: `imported:${candidateFixture.id}`, active: candidateFixture, versions: [candidateFixture], enabled: false }] }).state).toBe("already-installed");
});
it("repository documents cannot gain skill readiness even when identifiers match", () => {
  const p = createPlan({ ...evidence, scope: "repository-documents", assessment: { ...evidence.assessment, strategy: "unsupported" } }, evidence.host, "skill", "reuse", "");
  expect(planReadiness(p, live).state).toBe("blocked");
});
it("keeps v1/v2 assessments historical inside plans without relabeling them", () => {
  for (const analyzer of ["intake-advisory-v1", "intake-advisory-v2"] as const) {
    const p = createPlan({ ...evidence, analyzer }, evidence.host, "skill", "reuse", "");
    expect(parsePlans({ version: 1, items: [p] })[0]!.evidence.analyzer).toBe(analyzer);
  }
});
describe.each(PLAN_TARGETS)("%s target", (target) => {
  it.each(PLAN_APPROACHES)("%s remains a review checklist, not a generated artifact", (approach) => {
    const p = createPlan(evidence, evidence.host, target, approach, "");
    expect(planSteps(p).length).toBeGreaterThan(4);
    if (target !== "skill" || approach !== "reuse") expect(planReadiness(p, live).state).toBe("blocked");
  });
});
it("rejects authority fields, unknown versions, invalid inputs, duplicate IDs and history overflow", () => {
  const p = make();
  for (const patch of [{ tools: [] }, { approved: true }, { version: 2 }, { policy: "execute-v1" }, { target: "runtime" }, { approach: "execute" }, { createdAt: Infinity }, { constraints: "a".repeat(2001) }, { constraints: "\0" }]) expect(() => parsePlan({ ...p, ...patch })).toThrow();
  expect(() => parsePlans({ version: 1, items: [p, p] })).toThrow();
  expect(() => parsePlans({ version: 1, items: Array.from({ length: 9 }, make) })).toThrow();
  expect(() => parsePlans({ version: 2, items: [] })).toThrow();
  expect(() => parsePlans({ version: 1, items: [], approved: true })).toThrow();
});
