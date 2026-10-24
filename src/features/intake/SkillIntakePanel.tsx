import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { ulid } from "ulid";
import { Archive, BookOpen, FileSearch, FileText, FolderOpen, Github, Layers, RefreshCw } from "lucide-react";
import { useFileDropZone } from "@/lib/fileDrop";
import { open } from "@tauri-apps/plugin-dialog";
import { intake } from "./api";
import { repositoryUrl, type IntakeCandidate, type IntakeDiscovery } from "./contracts";
import { useIntakeCollection } from "./collectionStore";
import { useSkillsStore } from "@/store/skillsStore";
import { InstalledSkillLibrary, SkillInstallReview } from "./InstalledSkillLibrary";
import { PackageAnalysisPanel, AnalysisHistoryPanel } from "./PackageAnalysisPanel";
import { RepositoryReviewPanel } from "./RepositoryReviewPanel";
import { IntegrationPlansPanel } from "./IntegrationPlansPanel";
import { LocalPackageIntake } from "./LocalPackageIntake";
import "./skillIntake.css";
const StaticAppPreparation = lazy(() => import("@/features/staticApps/StaticAppPreparation").then((m) => ({ default: m.StaticAppPreparation })));
const WORKSPACES = [
  { id: "sources", label: "Skills & repositories", Icon: FileSearch },
  { id: "apps", label: "Apps", Icon: Layers },
  { id: "library", label: "Installed skills", Icon: BookOpen },
  { id: "history", label: "Saved reviews", Icon: Archive },
] as const;
type Workspace = typeof WORKSPACES[number]["id"];

export function SkillIntakePanel({ presentation = "embedded" }: { presentation?: "embedded" | "workspace" }) {
  const staged = useIntakeCollection((s) => s.items);
  const loaded = useIntakeCollection((s) => s.loaded);
  const collectionError = useIntakeCollection((s) => s.error);
  const [repoUrl, setRepoUrl] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>("sources"), [navigationNote, setNavigationNote] = useState<string | null>(null);
  const tabs = useRef<Partial<Record<Workspace, HTMLButtonElement>>>({});
  const sectionId = useId();
  const dropZone = useRef<HTMLElement>(null), reviewPane = useRef<HTMLElement>(null);
  const activeJob = useRef<string | null>(null);
  const busyRef = useRef(false), operationOwner = useRef(0);
  const previousStaged = useRef(new Set<string>());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<IntakeDiscovery | null>(null);
  const [entry, setEntry] = useState("");
  const [attribution, setAttribution] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<IntakeCandidate | null>(null);
  const [resource, setResource] = useState<{ path: string; text: string } | null>(null);
  const sequence = useRef(0);
  const handles = useRef(new Set<string>());
  const alive = useRef(true);

  function selectWorkspace(next: Workspace) {
    if (busyRef.current || dropZone.current?.querySelector('[aria-busy="true"]')) {
      setNavigationNote("Finish or cancel the current operation before switching workflows.");
      return false;
    }
    setWorkspace(next); setNavigationNote(null);
    return true;
  }
  function release(id: string) { handles.current.delete(id); void intake.release(id).catch(() => undefined); }
  function remember(id: string, ticket: number) {
    if (!alive.current || ticket !== sequence.current) { release(id); return false; }
    handles.current.add(id); return true;
  }
  async function run(label: string, fn: (ticket: number) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const ticket = ++sequence.current; operationOwner.current = ticket;
    setBusy(label); setError(null);
    try { await fn(ticket); }
    catch (e) { if (alive.current && ticket === sequence.current) setError(String(e instanceof Error ? e.message : e)); }
    finally { if (operationOwner.current === ticket) { busyRef.current = false; operationOwner.current = 0; if (alive.current) setBusy(null); } }
  }
  const current = (ticket: number) => alive.current && ticket === sequence.current;
  function reload() { void run("Loading staged skills…", () => useIntakeCollection.getState().refresh()); }
  function cancelNetwork() {
    const job = activeJob.current; activeJob.current = null;
    if (job) void intake.cancelRepo(job).catch(() => undefined);
  }
  async function network<T>(fn: (job: string) => Promise<T>) {
    const job = ulid(); activeJob.current = job;
    try { return await fn(job); }
    finally { if (activeJob.current === job) activeJob.current = null; }
  }
  useEffect(() => {
    if (candidate && previousStaged.current.has(candidate.id) && !staged.some((s) => s.id === candidate.id)) { setCandidate(null); setResource(null); }
    previousStaged.current = new Set(staged.map((s) => s.id));
  }, [staged, candidate]);
  useEffect(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; ++sequence.current; busyRef.current = false; operationOwner.current = 0; cancelNetwork(); for (const id of handles.current) void intake.release(id).catch(() => undefined); handles.current.clear(); };
    // The native collection is loaded once per mount; retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reviewPane.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [candidate?.id, candidate?.artifactHash]);

  function clearPreview() {
    if (discovery) release(discovery.id);
    if (candidate) release(candidate.id);
    setDiscovery(null); setCandidate(null); setResource(null);
  }
  function acceptDiscovery(next: IntakeDiscovery, ticket: number) {
    if (!remember(next.id, ticket)) return;
    setDiscovery(next); setEntry(next.entries.length === 1 ? next.entries[0]!.path : ""); setAttribution([]);
  }
  async function localDirectory(path: string, ticket: number) { clearPreview(); acceptDiscovery(await intake.discover(path), ticket); }
  function choose() {
    void run("Choosing local folder…", async (ticket) => {
      const path = await open({ directory: true, multiple: false, title: "Inspect a local skill folder" });
      if (current(ticket) && typeof path === "string") await localDirectory(path, ticket);
    });
  }
  function chooseRepository(value = repoUrl) {
    if (!loaded) return;
    void run("Resolving GitHub revision and reviewable sources…", async (ticket) => {
      const url = repositoryUrl(value); setRepoUrl(url); clearPreview();
      acceptDiscovery(await network((job) => intake.discoverRepo(url, job)), ticket);
    });
  }
  useFileDropZone(dropZone, `incubator-${sectionId}`, (event) => {
    if (event.type !== "drop" || busyRef.current || !loaded) return;
    if (workspace !== "sources") { setNavigationNote("Open Skills & repositories to inspect a dropped source."); return; }
    if (event.paths.length !== 1) { setError("Drop one local folder, or paste a public GitHub link above."); return; }
    void run("Discovering local skills…", (ticket) => localDirectory(event.paths[0]!, ticket));
  });
  function inspect() {
    if (!discovery || !entry) return;
    void run("Inspecting bytes — nothing executes…", async (ticket) => {
      if (candidate) release(candidate.id);
      setCandidate(null); setResource(null);
      const next = discovery.repository
        ? await network((job) => intake.inspectRepo(discovery.id, entry, attribution, job))
        : await intake.inspect(discovery.id, entry, attribution);
      if (remember(next.id, ticket)) setCandidate(next);
    });
  }
  const isStaged = candidate && staged.some((s) => s.id === candidate.id);
  const has2048Recipe = discovery?.repository?.url.toLowerCase() === "https://github.com/gabrielecirulli/2048";
  const durableOperation = busy === "Staging snapshot…" || busy === "Discarding staged snapshot…" || busy === "Installing reviewed skill…";
  return (
    <section ref={dropZone} className="skill-intake" data-presentation={presentation} aria-labelledby={`${sectionId}-heading`} aria-busy={!!busy}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy || !loaded || workspace !== "sources" ? "none" : "copy"; }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); if (busyRef.current || !loaded) return;
        if (workspace !== "sources") { setNavigationNote("Open Skills & repositories to inspect a dropped source."); return; }
        const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (text.length > 2048) { setError("Repository drop text exceeds its limit."); return; }
        const links = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
        if (links.length !== 1) { setError("Drop one public GitHub repository link, or use Choose folder."); return; }
        chooseRepository(links[0]!);
      }}>
      <div className="skill-intake-navigation">
      <h3 id={`${sectionId}-heading`} className="skill-intake-title">Bring in & review</h3>
      <div className="skill-intake-tabs" role="tablist" aria-label="Intake workflows">
        {WORKSPACES.map((item, index) => <button key={item.id} type="button" role="tab" id={`${sectionId}-tab-${item.id}`}
          ref={(element) => { tabs.current[item.id] = element ?? undefined; }} aria-controls={`${sectionId}-panel-${item.id}`} aria-selected={workspace === item.id} tabIndex={workspace === item.id ? 0 : -1}
          onClick={() => selectWorkspace(item.id)} onKeyDown={(event) => {
            const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            const target = event.key === "Home" ? 0 : event.key === "End" ? WORKSPACES.length - 1 : offset ? (index + offset + WORKSPACES.length) % WORKSPACES.length : null;
            if (target === null) return;
            event.preventDefault(); event.stopPropagation(); const next = WORKSPACES[target]!.id;
            if (selectWorkspace(next)) tabs.current[next]?.focus();
          }}><item.Icon size={17} strokeWidth={1.5} aria-hidden="true" /><span>{item.label}</span></button>)}
      </div>
      <div className="skill-intake-navigation-footer"><FileText size={17} strokeWidth={1.5} aria-hidden="true" /><p><strong>Review first.</strong><br />Saving a source doesn't install it. You're in control of what comes next.</p></div>
      </div>
      <div className="skill-intake-content">
      {navigationNote && <p role="status" className="skill-intake-navigation-note">{navigationNote}</p>}
      {/* Keep review leases and selected bytes alive; navigation is never cancellation. */}
      <div className="skill-intake-workspace" role="tabpanel" id={`${sectionId}-panel-sources`} aria-labelledby={`${sectionId}-tab-sources`} tabIndex={0} hidden={workspace !== "sources"} inert={workspace !== "sources"}>
      <header className="skill-intake-header">
        <div><h3>Bring something in</h3><p>Start with a source. Review its contents, then choose what to save or install.</p></div>
      </header>
      <div className="skill-intake-source-options">
        <div className="skill-intake-source-option skill-intake-repository">
          <div className="skill-intake-option-heading"><Github size={21} strokeWidth={1.5} aria-hidden="true" /><div><h4>From GitHub</h4><p>A public repository with skills or documents to review.</p></div></div>
          <label htmlFor={`${sectionId}-url`}>Public GitHub repository</label>
          <div className="skill-intake-url-action"><input id={`${sectionId}-url`} className="cp-input" type="url" maxLength={512} value={repoUrl} disabled={!!busy || !loaded} placeholder="https://github.com/owner/repository" spellCheck={false} onChange={(e) => setRepoUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); chooseRepository(); } }} />
            <button className="cp-btn" disabled={!!busy || !loaded || !repoUrl.trim()} onClick={() => chooseRepository()}>Inspect repository</button></div>
        </div>
        <div className="skill-intake-source-option skill-intake-local">
          <div className="skill-intake-option-heading"><FolderOpen size={21} strokeWidth={1.5} aria-hidden="true" /><div><h4>From your Mac</h4><p>A skill folder you already have.</p></div></div>
          <p>Choose a folder containing <code>SKILL.md</code>. Inspection keeps these files local.</p>
          <button className="cp-btn ghost" disabled={!!busy || !loaded} onClick={choose}>Choose folder</button>
        </div>
      </div>
      <details className="skill-intake-boundary"><summary>Inspection only · no AI, installation or execution</summary><p className="skill-intake-note">Inspect repository or drop a link to contact GitHub without credentials. Only explicitly selected skill packages or root review documents are downloaded. No AI requests, installs, scripts or linked external assets.</p></details>
      {(error || collectionError) && <p role="alert" className="skill-intake-error">{error || collectionError}</p>}
      <div className="skill-intake-actions">
        {busy && <span role="status">{busy}</span>}
        {busy && !durableOperation && busy !== "Dismissing inspection…" && <button className="cp-btn ghost" onClick={() => { ++sequence.current; cancelNetwork(); setBusy("Dismissing inspection…"); }}>Cancel inspection</button>}
        {busy === "Dismissing inspection…" && <p role="status">Waiting for the cancelled request or native folder dialog to settle. Its late result will be ignored; no overlapping inspection will start.</p>}
      </div>
      {discovery && <div className="skill-intake-selection">
        {discovery.repository && <p>Resolved commit <code>{discovery.repository.commit}</code>.</p>}
        {discovery.repository && discovery.reviewFiles && <RepositoryReviewPanel key={discovery.id} discovery={discovery} />}
        {!discovery.entries.length && (has2048Recipe ? <div>
          <p>No SKILL.md packages found. The supported 2048 recipe below uses its own fixed reviewed revision, not necessarily this resolved commit. This inspection does not prepare or install the repository.</p>
          <button type="button" className="cp-btn ghost" aria-controls={`${sectionId}-preparation`} onClick={() => { if (selectWorkspace("apps")) tabs.current.apps?.focus(); }}>Go to pinned 2048 preparation · no fetch</button>
        </div> : <p>No SKILL.md packages found. Repository analysis is available when review documents are listed; app/tool installation remains unsupported.</p>)}
        {discovery.entries.length > 0 && <><label>Skill in {discovery.label}
          <select className="cp-input" value={entry} disabled={!!busy} onChange={(e) => { setEntry(e.target.value); if (candidate) release(candidate.id); setCandidate(null); setResource(null); }}>
            <option value="">Select an entrypoint…</option>
            {discovery.entries.map((e) => <option key={e.path} value={e.path}>{e.path}</option>)}
          </select>
        </label>
        {discovery.attributionFiles.length > 0 && <fieldset disabled={!!busy}><legend>Include root attribution files</legend>
          {discovery.attributionFiles.map((path) => <label key={path}><input type="checkbox" checked={attribution.includes(path)} onChange={(e) => {
            setAttribution((prev) => e.target.checked ? [...prev, path] : prev.filter((p) => p !== path));
            if (candidate) release(candidate.id); setCandidate(null); setResource(null);
          }} />{path}</label>)}
        </fieldset>}
        <button className="cp-btn" disabled={!!busy || !entry || !loaded} onClick={inspect}>Inspect selected skill</button></>}
      </div>}
      <div className="skill-intake-staged">
        <div className="skill-intake-queue-heading"><h4>Staged for review <span>{loaded ? `${staged.length}/4` : "Not loaded"}</span></h4><button className="cp-btn ghost" disabled={!!busy} onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reload staged skills</button></div>
        {loaded && !staged.length && <div className="skill-intake-empty"><FileSearch size={24} strokeWidth={1.25} aria-hidden="true" /><div><h4>Your review queue starts here</h4><p>No staged skills yet. Inspect a source above, then save a snapshot here to review later. Nothing installs automatically.</p></div></div>}
        {loaded && staged.map((item) => <div className="skill-intake-row" key={item.id}>
          <button className="cp-btn ghost" disabled={!!busy} onClick={() => { if (candidate) release(candidate.id); setCandidate(item); setResource(null); }}>{item.metadata.name}</button>
          <span>{item.files.length} files · {item.totalBytes.toLocaleString()} bytes</span>
          <button className="cp-link-danger" disabled={!!busy} onClick={() => {
            void run("Discarding staged snapshot…", async (ticket) => {
              await useIntakeCollection.getState().discard(item.id);
              if (!current(ticket)) return;
              release(item.id);
              if (candidate?.id === item.id) { setCandidate(null); setResource(null); }
            });
          }}>Discard snapshot</button>
        </div>)}
      </div>
      {candidate && <article ref={reviewPane} className="skill-intake-preview">
        <button className="cp-btn ghost skill-intake-back" onClick={(event) => {
          const pane = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]');
          if (pane) { pane.scrollTop = 0; pane.focus({ preventScroll: true }); }
        }}>Back to sources</button>
        <header className="skill-intake-review-heading"><div><h4>{candidate.metadata.name}</h4><p>{candidate.metadata.description}</p></div><span className="skill-intake-review-state">{isStaged ? "Saved for review" : "Inspected · not saved"}</span></header>
        <p className="skill-intake-review-origin">{candidate.sourceLabel} · {candidate.files.length} files · {candidate.totalBytes.toLocaleString()} bytes · zero tool grants</p>
        <details className="skill-intake-provenance"><summary>Source identity, hashes & inspection checks</summary>
        <dl><dt>Source</dt><dd>{candidate.sourceLabel} · {candidate.entrypoint}</dd>
          {candidate.repository && <><dt>Repository</dt><dd>{candidate.repository.url}</dd><dt>Pinned commit</dt><dd><code>{candidate.repository.commit}</code></dd></>}
          <dt>Source SHA-256</dt><dd><code>{candidate.sourceHash}</code></dd>
          <dt>Candidate SHA-256</dt><dd><code>{candidate.artifactHash}</code></dd>
          <dt>Preserved bytes</dt><dd>{candidate.totalBytes.toLocaleString()} in {candidate.files.length} files</dd>
          <dt>Tool grants</dt><dd>None. Declared requests: {candidate.metadata.allowedTools || "none"}</dd></dl>
        <ul>{candidate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
        <div className="skill-intake-resource-browser">
        <div className="skill-intake-files" aria-label="Snapshot resources">{candidate.files.map((file) => <button key={file.path} className="cp-btn ghost" disabled={!!busy} onClick={() => {
          void run("Reading resource…", async (ticket) => {
            setResource(null);
            const text = await intake.read(candidate.id, file.path);
            if (current(ticket)) setResource({ path: file.path, text });
          });
        }} aria-pressed={resource?.path === file.path}><span>{file.path}</span><small>{file.bytes.toLocaleString()} bytes · {file.kind}</small></button>)}</div>
        <div className="skill-intake-resource-preview">{resource ? <><h4>{resource.path}</h4><pre tabIndex={0} aria-label="Resource text">{resource.text}</pre></> : <div className="skill-intake-empty"><FileText size={24} strokeWidth={1.25} aria-hidden="true" /><div><h4>Read the original files</h4><p>Select a resource to preview its preserved text. Scripts and links stay inert.</p></div></div>}</div>
        </div>
        {isStaged ? <div><p role="status">Saved for review only. Installation is a separate explicit step.</p><SkillInstallReview key={candidate.id} candidate={candidate} disabled={!!busy} onInstall={(target, acknowledged) => {
          void run("Installing reviewed skill…", async (ticket) => {
            try { await useSkillsStore.getState().install(candidate, target, acknowledged, () => current(ticket)); }
            finally { await useIntakeCollection.getState().refresh(); }
          });
        }} /></div> : <button className="cp-btn" disabled={!!busy || !loaded || staged.length >= 4} onClick={() => {
          void run("Staging snapshot…", async (ticket) => {
            const saved = await useIntakeCollection.getState().stage(candidate);
            if (current(ticket)) setCandidate(saved);
          });
        }}>Keep staged snapshot</button>}
        {isStaged && <PackageAnalysisPanel key={`${candidate.id}:${candidate.artifactHash}`} candidate={candidate} />}
      </article>}
      </div>
      <div className="skill-intake-workspace" role="tabpanel" id={`${sectionId}-panel-apps`} aria-labelledby={`${sectionId}-tab-apps`} tabIndex={0} hidden={workspace !== "apps"} inert={workspace !== "apps"}>
        <header className="skill-intake-header"><div><h3>Prepare an app</h3><p>Use the pinned 2048 recipe or inspect a prepared Orion SDK folder. Both install disabled; Plugin Manager owns activation.</p></div></header>
        <div id={`${sectionId}-preparation`}><Suspense fallback={<p role="status">Loading supported app preparation…</p>}><StaticAppPreparation /></Suspense></div>
        <LocalPackageIntake />
      </div>
      <div className="skill-intake-workspace" role="tabpanel" id={`${sectionId}-panel-library`} aria-labelledby={`${sectionId}-tab-library`} tabIndex={0} hidden={workspace !== "library"} inert={workspace !== "library"}>
        <header className="skill-intake-header"><div><h3>Imported skills</h3><p>Preserved instructions and resources, not executable plugins. Enable selection here; choose guidance explicitly in Orion or Agent Forge.</p></div></header>
        <InstalledSkillLibrary onInspectSource={() => { if (selectWorkspace("sources")) tabs.current.sources?.focus(); }} />
      </div>
      <div className="skill-intake-workspace" role="tabpanel" id={`${sectionId}-panel-history`} aria-labelledby={`${sectionId}-tab-history`} tabIndex={0} hidden={workspace !== "history"} inert={workspace !== "history"}>
        <header className="skill-intake-header"><div><h3>Saved reviews</h3><p>Local assessments and integration checklists. Historical findings are not current verification, installation approval or execution authority.</p></div></header>
        <AnalysisHistoryPanel />
        <IntegrationPlansPanel />
      </div>
      </div>
    </section>
  );
}
