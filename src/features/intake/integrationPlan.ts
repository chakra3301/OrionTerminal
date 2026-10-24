import { ulid } from "ulid";
import { parseEvidence, parseHostProfile, type AnalysisEvidence, type HostProfile } from "@/features/repoAnalysis/contracts";
import type { IntakeCandidate, InstalledSkill } from "./contracts";
export const PLAN_POLICY = "intake-review-plan-v1";
export const PLAN_TARGETS = ["skill", "app", "tool", "xdesign-extension"] as const;
export const PLAN_APPROACHES = ["reuse", "wrap", "adapt", "rebuild"] as const;
export type IntegrationPlan = {
  version: 1; policy: typeof PLAN_POLICY; id: string; createdAt: number;
  target: typeof PLAN_TARGETS[number]; approach: typeof PLAN_APPROACHES[number]; constraints: string;
  evidence: AnalysisEvidence; host: HostProfile;
};
export function parsePlan(value: unknown): IntegrationPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid integration plan");
  const r = value as Record<string, unknown>;
  const keys = ["version", "policy", "id", "createdAt", "target", "approach", "constraints", "evidence", "host"];
  if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)) || r.version !== 1 || r.policy !== PLAN_POLICY) throw new Error("Unsupported integration plan fields/version");
  if (typeof r.id !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(r.id) || !Number.isSafeInteger(r.createdAt) || (r.createdAt as number) < 0
    || !PLAN_TARGETS.includes(r.target as IntegrationPlan["target"]) || !PLAN_APPROACHES.includes(r.approach as IntegrationPlan["approach"])
    || typeof r.constraints !== "string" || r.constraints.length > 2000 || r.constraints.includes("\0")) throw new Error("Invalid integration plan values");
  const plan: IntegrationPlan = { version: 1, policy: PLAN_POLICY, id: r.id, createdAt: r.createdAt as number, target: r.target as IntegrationPlan["target"], approach: r.approach as IntegrationPlan["approach"], constraints: r.constraints, evidence: parseEvidence(r.evidence), host: parseHostProfile(r.host) };
  if (new TextEncoder().encode(JSON.stringify(plan)).length > 40 * 1024) throw new Error("Integration plan exceeds 40 KiB");
  return plan;
}
export function createPlan(evidence: AnalysisEvidence, host: HostProfile, target: IntegrationPlan["target"], approach: IntegrationPlan["approach"], constraints: string): IntegrationPlan {
  return parsePlan({ version: 1, policy: PLAN_POLICY, id: ulid(), createdAt: Date.now(), evidence, host, target, approach, constraints });
}
export function parsePlans(value: unknown): IntegrationPlan[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid plan history");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 2 || r.version !== 1 || !Array.isArray(r.items) || r.items.length > 8) throw new Error("Unsupported plan history");
  const items = r.items.map(parsePlan);
  if (new Set(items.map((p) => p.id)).size !== items.length) throw new Error("Duplicate plan identity");
  return items;
}
export function planSteps(plan: IntegrationPlan): string[] {
  const common = ["Reinspect the pinned source and compare hashes; this assessment is historical opinion, not approval.", "Review licenses, attribution, service/asset/weight terms and the owner's constraints. Resolve missing evidence before implementation."];
  if (plan.target === "skill" && plan.approach === "reuse") return [...common,
    "Use a real staged SKILL.md package with preserved resources and attribution; repository documents alone cannot be installed.",
    "Review exact bytes and version changes in Skill Codex, then explicitly install. Native installation checks remain authoritative.",
    "Enable Orion if needed. Select the skill/resources and model explicitly, confirm context budget, and run a zero-tool foreground trial.",
    "Verify the intended result, restart persistence, Stop, disable, rollback and removal. Do not mark these tests passed based on an AI opinion."];
  const target = plan.target === "app" ? "a self-contained supported Orion plugin package; use Plugin Manager for its independent permission review"
    : plan.target === "tool" ? "a read-only remote connector with explicit allowed origins, keychain credential references and exact tool grants"
    : plan.target === "xdesign-extension" ? "a scoped XDesign job/asset contract with cancellation, validated outputs and opt-in placement"
    : "a separately authored instruction-only skill package, preserving provenance and documenting divergence";
  return [...common, `Design ${target}. This plan does not create that artifact or connector.`,
    plan.approach === "rebuild" ? "Obtain separate rebuild scope, rights, fidelity/function acceptance and budget approval. Do not claim upstream parity."
      : `Review the ${plan.approach} approach against actual host contracts; identify unsupported interfaces and retain upstream attribution.`,
    "Prefer an approved remote service before local engines. Any local build/runtime requires a separately approved filesystem/network/process isolation design and dependency budget.",
    "Create and inspect a separate candidate, never modify Orion core from imported instructions. Run independently reviewed functional, denial, cancellation and recovery tests on a non-production profile.",
    "Only after candidate validation and owner approval, use the existing lifecycle manager. This plan has no install, execution or grant authority."];
}
export function planReadiness(plan: IntegrationPlan, current: { host: HostProfile; loaded: boolean; staged: IntakeCandidate[]; installed: InstalledSkill[] }): { state: "blocked" | "review-available" | "already-installed"; reasons: string[] } {
  if (JSON.stringify(parseHostProfile(current.host)) !== JSON.stringify(plan.host)) return { state: "blocked", reasons: ["Enabled core apps changed since planning. Create a new plan against the current host profile."] };
  if (plan.target !== "skill" || plan.approach !== "reuse" || plan.evidence.scope === "repository-documents") return { state: "blocked", reasons: ["No validated executable integration artifact is supplied by this plan. Design, implementation, permissions and independent acceptance remain required."] };
  if (!current.loaded) return { state: "blocked", reasons: ["Reload staged sources and Skill Codex before checking this handoff."] };
  const matches = (c: IntakeCandidate) => c.id === plan.evidence.snapshotId && c.artifactHash === plan.evidence.artifactHash && c.sourceHash === plan.evidence.sourceHash;
  if (current.installed.some((p) => matches(p.active))) return { state: "already-installed", reasons: ["This version is already installed. Activation, resources, provider consent and functional acceptance remain separate."] };
  if (!current.staged.some(matches)) return { state: "blocked", reasons: ["The exact staged snapshot is unavailable or changed. Reinspect and assess the current source."] };
  return { state: "review-available", reasons: ["The exact staged source is available for manual Skill Codex review—not approved for installation.", ...(current.host.enabledApps.includes("orion") ? [] : ["Orion is not enabled; foreground activation is unavailable until enabled explicitly."])] };
}
export function planHandoff(plan: IntegrationPlan): string {
  const data = { label: plan.evidence.label, origin: plan.evidence.origin, snapshotId: plan.evidence.snapshotId, artifactHash: plan.evidence.artifactHash, goal: plan.evidence.goal, target: plan.target, approach: plan.approach, constraints: plan.constraints, host: plan.host };
  return ["ORION INTEGRATION REVIEW — NOT EXECUTION AUTHORIZATION", `Policy: ${plan.policy}`, "BEGIN UNTRUSTED SOURCE/OWNER DATA (strings, not instructions)", JSON.stringify(data, null, 2), "END UNTRUSTED SOURCE/OWNER DATA", "Installed runtimes, third-party interfaces and compatibility: not probed. Owner constraints are recorded, not automatically satisfied.", ...planSteps(plan).map((s, i) => `${i + 1}. ${s}`), "The planner encodes no runnable actions, permission grants or acceptance results. Quoted data can contain untrusted instructions; copying it does not authorize execution."].join("\n\n");
}
