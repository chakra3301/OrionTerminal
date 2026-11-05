import { useEffect, useId, useRef, useState } from "react";
import { ulid } from "ulid";
import { staticCaptures, type CaptureSummary } from "./capture";
import { preparedApps, type PreparedReview, type PreparedSummary } from "./prepared";
import { RECIPE_2048 } from "./recipe";
import { decodeText, fromBase64 } from "./hash";
import { useControlPanel } from "@/store/controlPanelStore";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { confirmAction } from "@/components/ConfirmModal";

export function StaticAppPreparation() {
  const id = useId(), alive = useRef(true), locked = useRef(false), lockOwner = useRef(0), ticket = useRef(0), job = useRef<string | null>(null);
  const [sources, setSources] = useState<readonly CaptureSummary[]>([]), [candidates, setCandidates] = useState<readonly PreparedSummary[]>([]);
  const [loaded, setLoaded] = useState(false), [consent, setConsent] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<PreparedReview | null>(null), [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [installApproval, setInstallApproval] = useState("");
  const installed = useCommunityPlugins((s) => s.installed), managerReady = useCommunityPlugins((s) => s.hydrated && !s.recoveryBlocked), managerBusy = useCommunityPlugins((s) => s.busyIds.length > 0);
  const current = (n: number) => alive.current && ticket.current === n;
  const reviewIdentity = review ? JSON.stringify([review.summary.id, review.summary.source.captureHash, review.summary.outputHash, review.summary.inspection.fingerprint]) : "";
  const existing = review ? installed.find((p) => p.manifest.id === review.summary.pluginId) : undefined;
  async function reload() {
    if (locked.current) return;
    locked.current = true; const n = ++ticket.current; lockOwner.current = n; setBusy("Loading preparation records…"); setError(null); setLoaded(false); setReview(null); setPreview(null); setConsent(false); setInstallApproval("");
    try {
      const [s, c] = await Promise.all([staticCaptures.list(), preparedApps.list()]);
      if (current(n)) { setSources(s); setCandidates(c); setLoaded(true); }
    } catch (e) { if (current(n)) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (lockOwner.current === n) { locked.current = false; lockOwner.current = 0; if (alive.current) setBusy(null); } }
  }
  useEffect(() => {
    alive.current = true; void reload();
    return () => { alive.current = false; ++ticket.current; locked.current = false; lockOwner.current = 0; const active = job.current; if (active) void staticCaptures.cancel(active).catch(() => undefined); };
    // Only read saved records on mount; network and durable changes require explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(label: string, work: (n: number) => Promise<void>, durable = false) {
    if (locked.current || !loaded) return;
    locked.current = true; const n = ++ticket.current; lockOwner.current = n; setBusy(label); setError(null); setMessage(null); setReview(null); setPreview(null); setInstallApproval("");
    try { await work(n); }
    catch (e) { if (current(n)) { setError(e instanceof Error ? e.message : String(e)); if (durable) setLoaded(false); } }
    finally { if (lockOwner.current === n) { locked.current = false; lockOwner.current = 0; if (alive.current) setBusy(null); } }
  }
  function stop() {
    ++ticket.current; setReview(null); setPreview(null); setConsent(false); setInstallApproval("");
    const active = job.current;
    setBusy(active ? "Stopping capture…" : "Dismissing preparation…");
    setMessage("Dismissed local review. A capture publication that already won may be saved; reload records after this operation settles. Committed saves are not rolled back.");
    if (active) void staticCaptures.cancel(active).catch((e) => { if (alive.current) setError(String(e)); });
    setLoaded(false);
  }
  function fetch() {
    if (!consent) return;
    void run("Fetching pinned source…", async (n) => {
      const active = ulid(); job.current = active; setConsent(false);
      try {
        const captured = await staticCaptures.fetch(active);
        if (current(n)) { setSources((s) => [captured.summary, ...s]); setMessage("Pinned source captured locally. Nothing was prepared, installed or run."); }
      } finally { if (job.current === active) job.current = null; }
    }, true);
  }
  function prepare(source: CaptureSummary) {
    void run("Preparing candidate…", async (n) => {
      const saved = await preparedApps.prepare(source, () => current(n), () => { if (current(n)) setBusy("Saving candidate…"); });
      if (current(n)) { setCandidates((c) => [saved, ...c]); setMessage("Candidate saved locally. Review its bytes and rights; it is not installed or enabled."); }
    }, true);
  }
  function openReview(candidate: PreparedSummary) {
    void run("Revalidating prepared bytes…", async (n) => { const r = await preparedApps.read(candidate); if (current(n)) setReview(r); });
  }
  function removeSource(source: CaptureSummary) {
    void run("Discarding captured source…", async (n) => {
      if (!await confirmAction({ title: "Discard captured source?", body: "Only this local source record is removed. Prepared candidates referencing it must be discarded first. Installed code/data and backups are not removed.", confirmLabel: "Discard source", danger: true }) || !current(n)) return;
      await staticCaptures.discard(source); if (current(n)) setSources((s) => s.filter((v) => v.id !== source.id));
    }, true);
  }
  function removeCandidate(candidate: PreparedSummary) {
    void run("Discarding prepared candidate…", async (n) => {
      if (!await confirmAction({ title: "Discard prepared candidate?", body: "Only this saved candidate is removed. Its captured source, installed packages, plugin data and backups remain.", confirmLabel: "Discard candidate", danger: true }) || !current(n)) return;
      await preparedApps.discard(candidate); if (current(n)) setCandidates((c) => c.filter((v) => v.id !== candidate.id));
    }, true);
  }
  function installCandidate() {
    if (!review || installApproval !== reviewIdentity || !managerReady || managerBusy || existing) return;
    const selected = review.summary;
    void run("Rechecking installation review…", async (n) => {
      const checked = await preparedApps.read(selected);
      if (!current(n)) return;
      setBusy("Installing disabled…");
      const s = checked.summary;
      const ok = await useCommunityPlugins.getState().installPrepared({ id: s.id, captureHash: s.source.captureHash, outputHash: s.outputHash, inspection: s.inspection }, true, () => current(n));
      if (!current(n)) return;
      if (!ok) throw new Error(useCommunityPlugins.getState().error ?? "Installation couldn't be confirmed. Reload Plugin Manager before retrying.");
      setMessage("Installed disabled. Enable explicitly in Plugin Manager after reviewing the package. Captured source/candidate remain saved; nothing was run.");
    }, true);
  }
  const disabled = !loaded || !!busy;
  return <section className="skill-analysis skill-intake-app-option" aria-labelledby={`${id}-title`} aria-busy={!!busy}>
    <header className="skill-intake-app-heading"><span className="skill-intake-2048-mark" aria-hidden="true">2048</span><div><h4 id={`${id}-title`}>Supported app preparation</h4><span className="skill-intake-app-kind">Pinned 2048 recipe</span></div></header>
    <p>Original 2048 · pinned recipe only. Fetch → prepare → review → install disabled are separate actions. No AI upload, dependency setup or source execution; other repositories and runtimes are not converted.</p>
    <details><summary>Exact source, fonts and notices · 24 files / 172,077 bytes</summary>
      <ul>{RECIPE_2048.files.map((f) => <li key={`${f.repository}/${f.path}`}><code>{f.repository}@{f.commit}/{f.path}</code> · {f.bytes.toLocaleString()} bytes · {f.kind}<br /><code>{f.sha256}</code></li>)}</ul>
      <p>Commit/tree metadata is also requested to verify these pins, but no unlisted file bodies. No README links, build tools, icons or SVG/EOT will be fetched. Publisher identity and font conversion are not authenticated; source hashes are not security/licensing clearance.</p>
    </details>
    <label><input type="checkbox" disabled={disabled || sources.length >= 8} checked={consent} onChange={(e) => setConsent(e.target.checked)} />Fetch only these pinned public source/font/notice files and save the inert capture locally. No preparation or execution yet.</label>
    <div className="skill-intake-actions">
      <button type="button" className="cp-btn" disabled={disabled || !consent || sources.length >= 8} onClick={fetch}>Fetch pinned source · no AI</button>
      <button type="button" className="cp-btn ghost" disabled={!!busy} onClick={() => void reload()}>Reload preparation records</button>
      <button type="button" className="cp-btn ghost" disabled={!!busy} onClick={() => useControlPanel.getState().show("plugins")}>Open Plugin Manager</button>
      {(busy === "Fetching pinned source…" || busy === "Preparing candidate…" || busy === "Rechecking installation review…") && <button type="button" className="cp-btn ghost" onClick={stop}>Stop local review</button>}
    </div>
    {!loaded && !busy && <p>Reload records before fetching or changing saved data. A native app with schema33 commands is required.</p>}
    {loaded && <p>Saved sources · {sources.length}/8. Discard referencing candidates before their source; installed apps and plugin data are retained.</p>}
    {loaded && sources.length >= 8 && <p>Source storage is full. Discard an unreferenced capture before fetching again; records are never evicted automatically.</p>}
    {loaded && candidates.length >= 8 && <p>Candidate storage is full. Review or discard a saved candidate before preparing another; nothing is installed automatically.</p>}
    {loaded && !sources.length && <p>No captured source yet. Review the inventory above before fetching.</p>}
    {sources.map((source) => <div className="skill-intake-row" key={source.id}>
      <span>2048 source · {source.totalBytes.toLocaleString()} bytes<br /><code>{source.id}</code></span>
      <button type="button" className="cp-btn ghost" disabled={disabled || candidates.length >= 8} onClick={() => prepare(source)}>Prepare and save · no execution</button>
      <button type="button" className="cp-link-danger" disabled={disabled || candidates.some((c) => c.source.id === source.id)} onClick={() => removeSource(source)}>Discard source</button>
    </div>)}
    {loaded && <p>Saved candidates · {candidates.length}/8. No automatic eviction or installation.</p>}
    {candidates.map((c) => <div className="skill-intake-row" key={c.id}>
      <span>2048 · 35 files · {c.totalBytes.toLocaleString()} bytes<br /><code>{c.id}</code></span>
      <button type="button" className="cp-btn ghost" disabled={disabled} onClick={() => openReview(c)}>Review candidate</button>
      <button type="button" className="cp-link-danger" disabled={disabled} onClick={() => removeCandidate(c)}>Discard candidate</button>
    </div>)}
    {review && <article className="skill-intake-preview" aria-label="Prepared app review">
      <h4>2048 · Orion local adaptation</h4><p>Revalidated against the exact saved source and current owned recipe. Saved candidate; installed status comes from Plugin Manager. Source/recipe/output hashes do not grant authority.</p>
      <dl><dt>Source hash</dt><dd><code>{review.summary.source.sourceHash}</code></dd><dt>Recipe hash</dt><dd><code>{review.summary.recipeHash}</code></dd><dt>Output hash</dt><dd><code>{review.summary.outputHash}</code></dd><dt>Native package fingerprint</dt><dd><code>{review.summary.inspection.fingerprint}</code></dd><dt>Requested permission</dt><dd>storage.plugin · private namespaced storage, effective only after explicit enablement</dd></dl>
      <p>New local identity: <code>{review.summary.pluginId}</code>. Declared publisher is the local Orion adapter, not authenticated upstream. Original engine/styles/fonts/notices are retained; owned storage/input/bootstrap and scoped Orion/Original appearance differ from upstream.</p>
      <p>No UI rendering or game execution in this review. Pending saves lack host dirty-close protection; font conversion, licensing/security, all input/layout/state coverage and compatibility remain unverified.</p>
      <div className="skill-intake-files">{review.candidate.files.map((f) => <button key={f.path} type="button" className="cp-btn ghost" onClick={() => {
        try { setPreview({ path: f.path, text: f.path.endsWith(".woff") ? "Opaque font bytes retained; not decoded or executed here." : decodeText(fromBase64(f.dataBase64, f.bytes)) }); }
        catch (e) { setError(String(e)); }
      }}><span>{f.path}</span><small>{f.bytes.toLocaleString()} bytes</small></button>)}</div>
      {preview && <><h4>{preview.path}</h4><pre tabIndex={0}>{preview.text}</pre></>}
      <p>Installation publishes these exact captured bytes disabled, with no startup, background execution or workspace grants. An updated native app with prepared-install support is required; missing commands never use a legacy fallback. This does not establish compatibility, authenticated authorship, security or licensing clearance. Enablement and later updates/removal belong exclusively to Plugin Manager.</p>
      {existing ? <p role="status">This identity is already installed{existing.quarantined ? " and quarantined" : existing.enabled ? " and enabled" : " disabled"}. Manage it in Plugin Manager; this candidate cannot replace it.</p> : <>
        {!managerReady && <p>Reload Plugin Manager before approving installation.</p>}
        <label><input type="checkbox" disabled={disabled || !managerReady || managerBusy} checked={installApproval === reviewIdentity} onChange={(e) => setInstallApproval(e.target.checked ? reviewIdentity : "")} />I reviewed the exact source/recipe/output, adapter changes, retained licences and unknown coverage; I confirm my rights to install these bytes and approve only storage.plugin.</label>
        <button type="button" className="cp-btn" disabled={disabled || !managerReady || managerBusy || installApproval !== reviewIdentity} onClick={installCandidate}>Install disabled</button>
      </>}
      <button type="button" className="cp-btn ghost" onClick={() => { setReview(null); setPreview(null); setInstallApproval(""); }}>Close candidate review</button>
    </article>}
    {busy && <p role="status">{busy}{(busy === "Saving candidate…" || busy === "Installing disabled…") && " This committed operation is not cancellable. Closing review cannot retract it; reload preparation records and Plugin Manager if its result is uncertain."}</p>}
    {message && <p role="status">{message}</p>}{error && <p className="skill-intake-error" role="alert">{error}</p>}
  </section>;
}
