import { useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import type { AnalysisSource } from "@/features/repoAnalysis/contracts";
import type { IntakeDiscovery } from "./contracts";
import { intake } from "./api";
import { acquireRepositoryAnalysis } from "./repositoryAnalysis";
import { RepositoryAnalysisPanel } from "./PackageAnalysisPanel";
import { DeclarationEvidenceView } from "./DeclarationEvidenceView";

export function RepositoryReviewPanel({ discovery }: { discovery: IntakeDiscovery }) {
  const [paths, setPaths] = useState<string[]>([]), [source, setSource] = useState<AnalysisSource | null>(null);
  const [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState<string | null>(null);
  const job = useRef<string | null>(null), generation = useRef(0), alive = useRef(true);
  function cancel() {
    ++generation.current;
    if (job.current) void intake.cancelRepo(job.current).catch(() => undefined);
    setStopping(true);
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++generation.current; if (job.current) void intake.cancelRepo(job.current).catch(() => undefined); };
  }, []);
  async function acquire() {
    if (job.current) return;
    const ticket = ++generation.current, id = ulid(); job.current = id;
    setBusy(true); setStopping(false); setError(null); setSource(null);
    try {
      const result = await acquireRepositoryAnalysis(discovery, paths, id);
      if (alive.current && ticket === generation.current) setSource(result);
    } catch (e) { if (alive.current && ticket === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (job.current === id) { job.current = null; if (alive.current) { setBusy(false); setStopping(false); } } }
  }
  const documents = discovery.reviewFiles ?? [];
  return <section className="skill-analysis" aria-label="Repository document review" aria-busy={busy}>
    <h4>Repository documents · analysis only</h4>
    <p>Select up to four root README, license or manifest files to fetch from the pinned commit. No clone, dependency resolution, installation or AI call. Other files and linked assets are not fetched.</p>
    {!documents.length && <p>No supported root documents within 256 KiB were found. Oversized, executable, linked and nested files are not offered.</p>}
    <fieldset disabled={busy}><legend>Documents to download</legend>{documents.map((f) => <label key={f.path}>
      <input type="checkbox" checked={paths.includes(f.path)} disabled={!paths.includes(f.path) && paths.length >= 4} onChange={(e) => { setSource(null); setError(null); setPaths(e.target.checked ? [...paths, f.path] : paths.filter((p) => p !== f.path)); }} />{f.path} · {f.bytes.toLocaleString()} bytes
    </label>)}</fieldset>
    <button className="cp-btn ghost" disabled={busy || !paths.length} onClick={() => void acquire()}>Fetch selected documents · no AI</button>
    {busy && <p role="status">{stopping ? "Stopping document fetch… Wait for it to settle before starting another request." : <>Fetching pinned documents… <button className="cp-btn ghost" onClick={cancel}>Cancel document fetch</button></>}</p>}
    {error && <p role="alert" className="skill-intake-error">{error}</p>}
    {source && <div>
      <p>{source.origin} · document snapshot SHA-256 <code>{source.sourceHash}</code>. Kept in this view only; saved assessments retain provenance, not a reusable repository checkout.</p>
      {source.excerpts.map((e) => <details key={e.path}><summary>{e.path} · {e.truncated ? "first 8,000 characters or fewer" : "complete text"} · sanitized</summary><pre tabIndex={0}>{e.text}</pre></details>)}
      {source.declarations && <DeclarationEvidenceView items={source.declarations} />}
      <RepositoryAnalysisPanel key={source.id} source={source} />
    </div>}
  </section>;
}
