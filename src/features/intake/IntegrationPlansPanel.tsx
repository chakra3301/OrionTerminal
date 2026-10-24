import { useEffect, useRef, useState } from "react";
import { appRegistry, useAppDescriptors } from "@/plugins/appRegistry";
import { useControlPanel } from "@/store/controlPanelStore";
import { useSkillsStore } from "@/store/skillsStore";
import { confirmAction } from "@/components/ConfirmModal";
import type { AnalysisEvidence, HostProfile } from "@/features/repoAnalysis/contracts";
import { useIntakeCollection } from "./collectionStore";
import { useIntegrationPlans } from "./integrationPlansStore";
import { createPlan, planSteps, planReadiness, planHandoff, PLAN_TARGETS, PLAN_APPROACHES, type IntegrationPlan } from "./integrationPlan";
function currentHost(): HostProfile { return { policy: "intake-text-v1", enabledApps: appRegistry.list().map((a) => a.id).filter((id) => ["orion", "archives", "xdesign"].includes(id)).sort() }; }
function PlanView({ plan }: { plan: IntegrationPlan }) {
  useAppDescriptors();
  const staged = useIntakeCollection((s) => s.items), stagedLoaded = useIntakeCollection((s) => s.loaded);
  const packages = useSkillsStore((s) => s.packages), skillsLoaded = useSkillsStore((s) => s.loaded);
  const readiness = planReadiness(plan, { host: currentHost(), staged, installed: [...packages.values()], loaded: stagedLoaded && skillsLoaded });
  return <article className="skill-intake-preview">
    <h4>{plan.target} · {plan.approach} · review plan only</h4>
    <p>{plan.evidence.label} · {plan.evidence.origin}</p><p>Goal: {plan.evidence.goal}</p>
    <p>Owner constraints: {plan.constraints || "none recorded"}. Constraints are recorded, not automatically satisfied.</p>
    <p>Enabled core apps at planning: {plan.host.enabledApps.join(", ") || "none"}. Installed runtimes and third-party capabilities have not been probed.</p>
    {JSON.stringify(plan.host) !== JSON.stringify(plan.evidence.host) && <p>The captured assessment used a different enabled-app profile. Its host-fit opinions may be stale; this checklist does not refresh them.</p>}
    <p>Current handoff: {readiness.state}</p><ul>{readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    <ol>{planSteps(plan).map((step) => <li key={step}>{step}</li>)}</ol>
    <p>No approvals, grants, executable commands or completed tests are represented by this plan. Rebuild selection records planning intent only.</p>
    <button className="cp-btn ghost" onClick={() => useControlPanel.getState().show(plan.target === "skill" ? "skills" : "plugins")}>Open {plan.target === "skill" ? "Skill Library" : "Plugin Manager"} · navigation only</button>
    <details><summary>Handoff text · select and copy for human review</summary><p>Contains source identity, goal and owner constraints. Copying is not authorization to execute it.</p><textarea className="cp-input" aria-label="Integration plan handoff" readOnly rows={12} value={planHandoff(plan)} /></details>
    <details><summary>Captured historical assessment · not current verification</summary><pre tabIndex={0}>{JSON.stringify(plan.evidence, null, 2)}</pre></details>
  </article>;
}
export function IntegrationPlanComposer({ evidence }: { evidence: AnalysisEvidence }) {
  const [target, setTarget] = useState<IntegrationPlan["target"] | "">(evidence.scope ? "" : "skill");
  const [approach, setApproach] = useState<IntegrationPlan["approach"]>("reuse"), [constraints, setConstraints] = useState("");
  const [plan, setPlan] = useState<IntegrationPlan | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const items = useIntegrationPlans((s) => s.items), loaded = useIntegrationPlans((s) => s.loaded);
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reset = () => { setPlan(null); setError(null); };
  async function save() {
    if (!plan || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await useIntegrationPlans.getState().save(plan); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="skill-analysis" aria-busy={busy}><summary>Create integration review plan · local only</summary>
    <p>Choose the intended target and approach. This creates a review checklist, not an adapter, execution recipe or install approval. No additional model call.</p>
    <fieldset disabled={busy}>
      <label>Target<select className="cp-input" value={target} onChange={(e) => { reset(); setTarget(e.target.value as IntegrationPlan["target"]); }}><option value="">Choose target…</option>{PLAN_TARGETS.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Approach<select className="cp-input" value={approach} onChange={(e) => { reset(); setApproach(e.target.value as IntegrationPlan["approach"]); }}>{PLAN_APPROACHES.map((a) => <option key={a}>{a}</option>)}</select></label>
      <label>Owner constraints<textarea className="cp-input" value={constraints} maxLength={2000} placeholder="Offline needs, budget, data restrictions, required behavior…" onChange={(e) => { reset(); setConstraints(e.target.value); }} /></label>
      <button className="cp-btn ghost" disabled={!target} onClick={() => { if (!target) return; try { setPlan(createPlan(evidence, currentHost(), target, approach, constraints)); setError(null); } catch (e) { setError(String(e)); } }}>Build review plan · no AI</button>
    </fieldset>
    {plan && <><PlanView plan={plan} /><button className="cp-btn" disabled={!loaded || busy || items.some((p) => p.id === plan.id)} onClick={() => void save()}>{items.some((p) => p.id === plan.id) ? "Plan saved locally" : "Save plan locally"}</button></>}
    {!loaded && <p>Load or retry saved plans below before saving. This draft is retained.</p>}
    {busy && <p role="status">Saving plan…</p>}{error && <p role="alert" className="skill-intake-error">{error}</p>}
  </details>;
}
export function IntegrationPlansPanel() {
  const items = useIntegrationPlans((s) => s.items), loaded = useIntegrationPlans((s) => s.loaded), error = useIntegrationPlans((s) => s.error);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true), removing = useRef(false);
  useEffect(() => { alive.current = true; void useIntegrationPlans.getState().load(); return () => { alive.current = false; }; }, []);
  async function remove(id: string) {
    if (removing.current) return;
    removing.current = true;
    try { if (await confirmAction({ title: "Remove saved plan?", body: "Only the review plan and its captured assessment copy are removed. Sources, installed capabilities and other assessments stay unchanged. Backups may retain the plan.", confirmLabel: "Remove plan", danger: true }) && alive.current) await useIntegrationPlans.getState().remove(id); }
    catch (e) { if (alive.current) setFailure(String(e)); } finally { removing.current = false; }
  }
  return <details className="skill-analysis"><summary>Saved integration plans · {items.length}/8</summary>
    <p>Local review records, not a capability registry. Creating or saving a plan installs nothing and grants no authority. Captured assessments can outlive their separate history entries.</p>
    <button className="cp-btn ghost" onClick={() => { setFailure(null); void useIntegrationPlans.getState().load(); }}>Reload saved plans</button>
    {(error || failure) && <p role="alert" className="skill-intake-error">{error || failure}</p>}
    {items.map((plan) => <details key={plan.id}><summary>{plan.evidence.label} · {plan.target} · {plan.evidence.goal}</summary><PlanView plan={plan} /><button className="cp-link-danger" disabled={!loaded} onClick={() => void remove(plan.id)}>Remove saved plan</button></details>)}
  </details>;
}
