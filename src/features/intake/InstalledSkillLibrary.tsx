import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { confirmAction } from "@/components/ConfirmModal";
import { installedSkills } from "./installedApi";
import { sameSkillSource } from "./skillDiff";
import { SkillDiffReview } from "./SkillDiffReview";
import type { InstalledSkill, IntakeCandidate } from "./contracts";

export function SkillInstallReview({ candidate, disabled, onInstall }: { candidate: IntakeCandidate; disabled: boolean; onInstall: (target: InstalledSkill | null, acknowledged: boolean) => void }) {
  const packages = useSkillsStore((s) => s.packages);
  const loaded = useSkillsStore((s) => s.loaded), mutating = useSkillsStore((s) => s.mutating);
  const [targetId, setTargetId] = useState("");
  const target = packages.get(targetId) ?? null;
  const [reviewed, setReviewed] = useState("");
  useEffect(() => {
    if (targetId && (!target || !sameSkillSource(target.active, candidate))) { setTargetId(""); setReviewed(""); }
  }, [candidate, targetId, target]);
  const fingerprint = JSON.stringify([candidate.id, candidate.artifactHash, candidate.sourceHash, targetId, target?.active.id, target?.active.artifactHash]);
  const hasAttribution = candidate.files.some((f) => /(?:^|\/)(?:LICENSE|NOTICE)(?:\.md|\.txt)?$/.test(f.path));
  return <fieldset className="skill-install-review" disabled={disabled || mutating || !loaded}>
    <legend>Install reviewed skill</legend>
    <label>Destination<select className="cp-input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
      <option value="">New Skill Codex identity</option>
      {[...packages.values()].filter((p) => sameSkillSource(p.active, candidate)).map((p) => <option key={p.skillId} value={p.skillId}>Update {p.active.metadata.name} · {p.active.id.slice(-8)}</option>)}
    </select></label>
    <p>Instructions and resources only. No grants, scripts, dependencies, AI upload or automatic activation. Updates retain one rollback version.</p>
    {target && <SkillDiffReview before={target.active} after={candidate} />}
    {!hasAttribution && <p role="alert">Include LICENSE/NOTICE bytes before installation. Their presence is not license clearance.</p>}
    <label><input type="checkbox" checked={reviewed === fingerprint} onChange={(e) => setReviewed(e.target.checked ? fingerprint : "")} />I reviewed this source, its attribution, any version changes and my right to use it.</label>
    <button className="cp-btn" disabled={!hasAttribution || reviewed !== fingerprint || (!!targetId && (!target || !sameSkillSource(target.active, candidate)))} onClick={() => onInstall(target, reviewed === fingerprint)}>{target ? "Install reviewed update" : "Install in Skill Codex"}</button>
  </fieldset>;
}

function InstalledCard({ item, disabled }: { item: InstalledSkill; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const rollback = item.versions.find((v) => v.id === rollbackId && v.id !== item.active.id);
  const alive = useRef(true), inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await operation(); }
    catch (e) { if (alive.current) setError(String(e instanceof Error ? e.message : e)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const change = (action: "enable" | "disable" | "rollback" | "remove", version?: string) => useSkillsStore.getState().changePackage(item.skillId, item.active.id, action, version);
  return <article className="skill-intake-preview" aria-busy={busy}>
    <h4>{item.active.metadata.name} · {item.enabled ? "Enabled for selection" : "Disabled"}</h4>
    <p>Immutable original · zero tool grants · {item.active.totalBytes.toLocaleString()} preserved bytes. Use in Orion text chat or attach in Agent Forge. Re-inspect the same source for updates.</p>
    <p>{item.active.repository ? `${item.active.repository.url} · ${item.active.repository.commit}` : `${item.active.sourceLabel} · ${item.active.entrypoint}`}</p>
    <details className="skill-intake-identity"><summary>Version identity</summary><dl><dt>Active version</dt><dd><code>{item.active.id}</code></dd><dt>Snapshot SHA-256</dt><dd><code>{item.active.artifactHash}</code></dd></dl></details>
    <div className="skill-intake-actions">
      <button className="cp-btn ghost" disabled={disabled || busy} onClick={() => void run(() => change(item.enabled ? "disable" : "enable"))}>{item.enabled ? "Disable" : "Enable"}</button>
      {item.versions.filter((v) => v.id !== item.active.id).map((v) => <button className="cp-btn ghost" key={v.id} disabled={disabled || busy} onClick={() => setRollbackId(v.id)}>Roll back · {v.artifactHash.slice(0, 8)}</button>)}
      <button className="cp-link-danger" disabled={disabled || busy} onClick={() => void run(async () => {
        const attached = [...useAgentsStore.getState().agents.values()].filter((a) => a.skillIds.includes(item.skillId)).map((a) => a.name);
        const yes = await confirmAction({ title: `Remove ${item.active.metadata.name}?`, body: `${attached.length ? `Attached agents: ${attached.join(", ")}. Their missing attachments will need repair. ` : ""}Both retained versions and resources will be deleted. Already shared provider context cannot be retracted.`, confirmLabel: "Remove imported skill", danger: true });
        if (yes && alive.current) await change("remove");
      })}>Remove imported skill</button>
    </div>
    {rollback && <div><SkillDiffReview before={item.active} after={rollback} />
      <button className="cp-btn" disabled={disabled || busy} onClick={() => void run(async () => { await change("rollback", rollback.id); if (alive.current) setRollbackId(null); })}>Apply reviewed rollback</button>
      <button className="cp-btn ghost" disabled={busy} onClick={() => setRollbackId(null)}>Cancel rollback review</button>
    </div>}
    <details><summary>Preserved resources and attribution</summary><div className="skill-intake-files">
      {item.active.files.map((f) => <button className="cp-btn ghost" key={f.path} disabled={disabled || busy} onClick={() => void run(async () => {
        setPreview(null);
        const text = await installedSkills.read(item.skillId, item.active.id, f.path);
        if (alive.current) setPreview({ path: f.path, text });
      })}>{f.path} · {f.kind} · {f.bytes.toLocaleString()} bytes</button>)}
    </div></details>
    {preview && <div><h4>{preview.path}</h4><pre tabIndex={0} aria-label="Installed resource text">{preview.text}</pre></div>}
    {error && <p role="alert" className="skill-intake-error">{error}</p>}
    {busy && <p role="status">Working…</p>}
  </article>;
}
export function InstalledSkillLibrary({ onInspectSource }: { onInspectSource?: () => void } = {}) {
  const packages = useSkillsStore((s) => s.packages), loaded = useSkillsStore((s) => s.loaded);
  const error = useSkillsStore((s) => s.error), mutating = useSkillsStore((s) => s.mutating);
  return <section aria-label="Installed imported skills" aria-busy={mutating}>
    <h4>Installed in Skill Codex <span>{packages.size}/24</span></h4>
    {!loaded && <p role="alert">{error || "Skill Codex must be loaded before installation."}</p>}
    <button className="cp-btn ghost" disabled={mutating} onClick={() => void useSkillsStore.getState().load()}>Reload Skill Codex</button>
    {loaded && packages.size === 0 && <div className="skill-intake-empty skill-intake-library-empty"><BookOpen size={26} strokeWidth={1.25} aria-hidden="true" /><div><h4>No imported skills installed.</h4><p>Start with a skill source, review its files, then install it here. Installed guidance grants no tools; choose it explicitly in Orion or Agent Forge.</p>{onInspectSource && <button className="cp-btn ghost" onClick={onInspectSource}>Inspect a source</button>}</div></div>}
    {[...packages.values()].map((p) => <InstalledCard key={`${p.skillId}:${p.active.id}:${p.enabled}`} item={p} disabled={!loaded || mutating} />)}
  </section>;
}
