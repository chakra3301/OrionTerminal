import { useCallback, useEffect, useRef, useState } from "react";
import { confirmAction } from "@/components/ConfirmModal";
import { useProvidersStore } from "@/store/providersStore";
import { appRegistry, useAppDescriptors } from "@/plugins/appRegistry";
import { owningProvider, providerModelValue } from "@/features/agents/modelSelection";
import { providerSessionIdentity } from "@/features/agents/dispatchSend";
import { runExplicitModelAnalysis } from "@/features/agents/textCall";
import { prepareAnalysisReview, approveAnalysisUpload, analyzeReviewedSource, type AnalysisReview } from "@/features/repoAnalysis/service";
import type { AnalysisEvidence, AnalysisSource, HostProfile } from "@/features/repoAnalysis/contracts";
import type { IntakeCandidate } from "./contracts";
import { readAnalysisSource } from "./analysisSource";
import { useIntakeCollection } from "./collectionStore";
import { useAnalysisHistory } from "./analysisHistory";
import { selectRepositoryDocuments } from "./repositoryAnalysis";
import { DeclarationEvidenceView } from "./DeclarationEvidenceView";
import { IntegrationPlanComposer } from "./IntegrationPlansPanel";

function hostProfile(): HostProfile { return { policy: "intake-text-v1", enabledApps: appRegistry.list().map((a) => a.id).filter((id) => ["orion", "archives", "xdesign"].includes(id)).sort() }; }
function EvidenceView({ evidence }: { evidence: AnalysisEvidence }) {
  const a = evidence.assessment;
  return <article className="skill-intake-preview">
    <h4>AI assessment · not installation approval</h4>
    <p>{evidence.label} · {evidence.origin}</p><p>{evidence.model} · {new Date(evidence.createdAt).toLocaleString()}</p>
    <p>Scope: {evidence.scope === "repository-documents" ? "selected repository documents · not installable" : "staged skill package"}</p>
    <p>Goal: {evidence.goal}</p><p>Snapshot SHA-256: <code>{evidence.artifactHash}</code></p>
    <p>Security, vulnerabilities, functional behavior and license clearance: not verified. Excerpts only; this is not a full repository audit.</p>
    {evidence.declarations && <DeclarationEvidenceView items={evidence.declarations} />}
    <h4>Summary</h4><p>{a.summary}</p><h4>Mental model</h4><p>{a.mentalModel}</p>
    <p>Assessed goal fit: {a.goalFit} · strategy: {a.strategy} · integration cost: {a.integrationCost}</p><p>{a.stackFit}</p>
    <h4>Blockers</h4>{a.blockers.length ? <ul>{a.blockers.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p>No blockers reported by the model—not a clean scan.</p>}
    <h4>Risks</h4>{a.risks.map((r, i) => <section key={i}><b>{r.title} · {r.severity} · {r.basis}</b><p>{r.detail}</p>{r.citations.map((c, j) => <p key={j}><code>{c.path}</code>: “{c.quote}”</p>)}</section>)}
    <h4>Suggested next steps · text only</h4><ol>{a.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
    <h4>Limitations</h4><ul>{a.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <IntegrationPlanComposer key={evidence.id} evidence={evidence} />
    <details><summary>Excerpt coverage and fingerprints</summary>{evidence.coverage.map((e) => <p key={e.path}>{e.path} · original {e.originalBytes.toLocaleString()} bytes · {e.truncated ? "excerpt only" : "complete text, sanitized"} · excerpt SHA-256 <code>{e.excerptHash}</code></p>)}</details>
  </article>;
}
export function PackageAnalysisPanel({ candidate }: { candidate: IntakeCandidate }) {
  return <AnalysisPanel identity={candidate} files={candidate.files} initialPaths={[`${candidate.metadata.name}/SKILL.md`]} repository={false}
    readSource={(paths, signal) => readAnalysisSource(candidate, paths, signal)} assertCurrent={() => {
      if (!useIntakeCollection.getState().items.some((c) => c.id === candidate.id && c.artifactHash === candidate.artifactHash)) throw new Error("The staged snapshot is no longer available. Review the source again.");
    }} />;
}
export function RepositoryAnalysisPanel({ source }: { source: AnalysisSource }) {
  return <AnalysisPanel identity={source} files={source.inventory} initialPaths={source.excerpts.map((f) => f.path)} repository={true}
    assertCurrent={() => {}} readSource={async (paths) => selectRepositoryDocuments(source, paths)} />;
}
function AnalysisPanel({ identity, files, initialPaths, repository, readSource, assertCurrent }: {
  identity: { id: string; artifactHash: string }; files: { path: string; bytes: number; kind: string }[]; initialPaths: string[]; repository: boolean;
  readSource: (paths: string[], signal: AbortSignal) => Promise<AnalysisSource>; assertCurrent: () => void;
}) {
  const providers = useProvidersStore((s) => s.providers);
  const apps = useAppDescriptors();
  const [model, setModel] = useState(""), [goal, setGoal] = useState("");
  const [paths, setPaths] = useState<string[]>(initialPaths);
  const [review, setReview] = useState<AnalysisReview | null>(null), [report, setReport] = useState<AnalysisEvidence | null>(null);
  const [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(true), [stopping, setStopping] = useState(false);
  const savedReports = useAnalysisHistory((s) => s.items);
  const saved = !!report && savedReports.some((e) => e.id === report.id);
  const job = useRef<AbortController | null>(null), seq = useRef(0), operationOwner = useRef(0), locked = useRef(false), alive = useRef(true);
  const owner = owningProvider(providers, model);
  const ownerIdentity = owner ? providerSessionIdentity(owner) : "";
  let endpoint: string = owner?.kind ?? "unavailable";
  if (owner?.baseUrl) { try { endpoint = new URL(owner.baseUrl).origin; } catch { endpoint = "invalid endpoint"; } }
  const appKey = JSON.stringify(apps.map((a) => a.id).filter((id) => ["orion", "archives", "xdesign"].includes(id)).sort());
  const invalidate = useCallback(() => { ++seq.current; job.current?.abort(); if (locked.current) setStopping(true); setAck(false); setReview(null); setReport(null); setError(null); }, []);
  useEffect(() => { invalidate(); }, [ownerIdentity, appKey, identity.id, identity.artifactHash, invalidate]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++seq.current; job.current?.abort(); }; }, []);
  const current = (ticket: number) => alive.current && seq.current === ticket;
  async function run(operation: (signal: AbortSignal, ticket: number) => Promise<void>, durable = false) {
    if (locked.current) return;
    locked.current = true; const ticket = ++seq.current, controller = new AbortController(); job.current = controller; operationOwner.current = ticket;
    setBusy(true); setStopping(false); setCanCancel(!durable); setError(null);
    try { await operation(controller.signal, ticket); }
    catch (e) { if (current(ticket)) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (operationOwner.current === ticket) { locked.current = false; operationOwner.current = 0; job.current = null; if (alive.current) { setBusy(false); setStopping(false); } } }
  }
  return <section className="skill-analysis" aria-label="Advisory source analysis" aria-busy={busy}>
    <h4>{repository ? "Analyze selected repository documents" : "Analyze this staged skill"}</h4>
    <p>Optional RepoLens-style goal, risk and stack-fit assessment. Selected excerpts only—not the whole repository. No AI call until you approve the exact upload below. {repository && "These documents cannot be installed or activated."}</p>
    <fieldset disabled={busy}>
      <label>Goal<input className="cp-input" value={goal} maxLength={2000} placeholder="What should this add to Orion?" onChange={(e) => { invalidate(); setGoal(e.target.value); }} /></label>
      <label>Analysis model<select className="cp-input" value={model} onChange={(e) => { invalidate(); setModel(e.target.value); }}>
        <option value="">Choose an explicit model…</option>{providers.filter((p) => p.enabled).map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.id} value={providerModelValue(p.id, m.id)}>{m.label} · {p.name}</option>)}</optgroup>)}
      </select></label>
      <div>{files.filter((f) => f.kind !== "opaque" && f.bytes <= 256 * 1024).map((f) => <label key={f.path}>
        <input type="checkbox" checked={paths.includes(f.path)} disabled={!paths.includes(f.path) && paths.length >= 4} onChange={(e) => { invalidate(); setPaths(e.target.checked ? [...paths, f.path] : paths.filter((p) => p !== f.path)); }} />{f.path} · {f.bytes.toLocaleString()} bytes
      </label>)}</div>
      <button className="cp-btn ghost" disabled={!owner || !goal.trim() || paths.length === 0} onClick={() => void run(async (signal, ticket) => {
        setReview(null); setReport(null); setAck(false); assertCurrent();
        const source = await readSource(paths, signal);
        const next = await prepareAnalysisReview({ source, host: hostProfile(), goal, model, providerIdentity: ownerIdentity });
        assertCurrent(); if (current(ticket) && !signal.aborted) setReview(next);
      })}>Prepare upload preview · local only</button>
    </fieldset>
    {review && <div>
      <p>Recipient: {owner?.name} · {endpoint} · {review.model}. Review expires after 10 minutes. Each text excerpt is capped at 8,000 characters; instruction-like phrases are sanitized. Selected repository files also contribute declaration summaries from their complete contents. Unselected contents are omitted, but the snapshot's file inventory is included.</p>
      <p>App-owned system instructions and user payload are shown below. Connectors/providers may add their own framing; context capacity remains your confirmation, not a tokenizer guarantee. Cancellation cannot retract already-shared data.</p>
      <pre tabIndex={0} aria-label="Analysis system instructions">{review.systemPrompt}</pre>
      <pre tabIndex={0} aria-label="Exact analysis upload">{review.prompt}</pre>
      <p>Review fingerprint: <code>{review.promptHash}</code></p>
      <label><input type="checkbox" disabled={busy} checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed this payload for private data and approve sharing it with this model. I confirm the model supports at least 128k context.</label>
      <button className="cp-btn" disabled={busy || !ack} onClick={() => void run(async (signal, ticket) => {
        setReport(null); setAck(false);
        const consent = approveAnalysisUpload(review);
        const result = await analyzeReviewedSource(review, consent, { signal, call: runExplicitModelAnalysis, assertCurrent: () => {
          assertCurrent();
          if (!current(ticket) || JSON.stringify(hostProfile()) !== JSON.stringify(review.host)) throw new Error("Analysis context changed; review again.");
        } });
        if (current(ticket)) setReport(result);
      })}>Analyze reviewed payload</button>
    </div>}
    {busy && <p role="status">{canCancel ? stopping ? "Stopping analysis… Wait for the request to settle; already-shared data cannot be retracted." : "Working…" : "Saving assessment… This committed save cannot be cancelled by changing the review."} {canCancel && !stopping && <button className="cp-btn ghost" onClick={invalidate}>Cancel analysis</button>}</p>}
    {error && <p className="skill-intake-error" role="alert">{error}</p>}
    {report && <><EvidenceView evidence={report} /><button className="cp-btn ghost" disabled={busy || saved} onClick={() => void run(async () => { await useAnalysisHistory.getState().save(report); }, true)}>{saved ? "Assessment saved locally" : "Save assessment locally"}</button></>}
  </section>;
}
export function AnalysisHistoryPanel() {
  const items = useAnalysisHistory((s) => s.items), loaded = useAnalysisHistory((s) => s.loaded), error = useAnalysisHistory((s) => s.error);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true), removing = useRef(false);
  useEffect(() => { alive.current = true; void useAnalysisHistory.getState().load(); return () => { alive.current = false; }; }, []);
  async function remove(id: string) {
    if (removing.current) return;
    removing.current = true;
    try {
      const yes = await confirmAction({ title: "Remove saved assessment?", body: "Only this local analysis record is removed. Saved plans containing an assessment copy, staged packages and installed skills are unchanged. Existing backups may retain the record.", confirmLabel: "Remove assessment", danger: true });
      if (yes && alive.current) await useAnalysisHistory.getState().remove(id);
    } catch (err) { if (alive.current) setFailure(String(err)); }
    finally { removing.current = false; }
  }
  return <details className="skill-analysis"><summary>Saved assessments · {items.length}/8</summary>
    <p>Historical AI opinions, not current verification or install permissions. Source/prompt bodies are not retained separately; goals, quoted source text, selected declaration summaries, findings and provenance remain in your local database. Nothing in this history is executable.</p>
    <button className="cp-btn ghost" onClick={() => { setFailure(null); void useAnalysisHistory.getState().load(); }}>Reload analysis history</button>
    {(error || failure) && <p role="alert" className="skill-intake-error">{error || failure}</p>}
    {items.map((e) => <details key={e.id}><summary>{e.label} · {e.goal}</summary><EvidenceView evidence={e} /><button className="cp-link-danger" disabled={!loaded} onClick={() => void remove(e.id)}>Remove saved assessment</button></details>)}
  </details>;
}
