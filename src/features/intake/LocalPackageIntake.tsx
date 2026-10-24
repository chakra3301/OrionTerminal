import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "@/lib/ipc";
import { parsePackageInspection } from "@/plugins/pluginInstallReview";
export { parsePackageInspection } from "@/plugins/pluginInstallReview";
import type { CommunityPluginInspection } from "@/plugins/communityTypes";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { useControlPanel } from "@/store/controlPanelStore";

export function LocalPackageIntake() {
  const [review, setReview] = useState<{ path: string; inspection: CommunityPluginInspection } | null>(null);
  const [approved, setApproved] = useState("");
  const [busy, setBusy] = useState<"inspect" | "install" | null>(null), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), locked = useRef(false), generation = useRef(0);
  const installed = useCommunityPlugins((s) => s.installed), managerBusy = useCommunityPlugins((s) => s.busyIds.length > 0);
  const managerReady = useCommunityPlugins((s) => s.hydrated && !s.recoveryBlocked);
  const existing = review && installed.some((p) => p.manifest.id === review.inspection.manifest.id);
  const identity = review ? JSON.stringify([review.path, review.inspection.fingerprint]) : "";
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; }; }, []);
  async function inspect() {
    if (locked.current) return;
    locked.current = true; const ticket = ++generation.current;
    setBusy("inspect"); setReview(null); setApproved(""); setMessage(null); setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose an Orion SDK package folder" });
      if (!alive.current || ticket !== generation.current || typeof path !== "string") return;
      const inspection = parsePackageInspection(await ipc.pluginInspectIntakeDirectory(path));
      if (alive.current && ticket === generation.current) setReview({ path, inspection });
    } catch (e) { if (alive.current && ticket === generation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { locked.current = false; if (alive.current) setBusy(null); }
  }
  async function install() {
    if (locked.current || !review || approved !== identity || existing || !managerReady || managerBusy) return;
    locked.current = true; const ticket = ++generation.current; setBusy("install"); setError(null); setMessage(null);
    try {
      const ok = await useCommunityPlugins.getState().install(review.path, review.inspection, "intake-disabled", approved === identity, undefined, () => alive.current && generation.current === ticket);
      if (!ok) throw new Error(useCommunityPlugins.getState().error || "Installation could not be confirmed. Check Plugin Manager before retrying.");
      if (alive.current) { setMessage("Installed disabled. Enable explicitly in Plugin Manager when you are ready to run its code."); setReview(null); setApproved(""); }
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setApproved(""); } }
    finally { locked.current = false; if (alive.current) setBusy(null); }
  }
  return <section className="skill-analysis skill-intake-app-option" aria-label="Local app package intake" aria-busy={!!busy}>
    <header className="skill-intake-app-heading"><span className="skill-intake-sdk-mark" aria-hidden="true"><FolderOpen size={24} strokeWidth={1.5} /></span><div><h4>Local app packages</h4><span className="skill-intake-app-kind">Prepared Orion SDK folder</span></div></header>
    <p>Choose a prepared Orion SDK directory containing orion-plugin.json, not an arbitrary repository or npm/Python project. No build, AI upload or code execution during inspection or this disabled installation.</p>
    <p>New identities only; updates stay in Plugin Manager. Physical folders, bounded ASCII-relative paths and at most 512 files / 25 MiB. Unsupported packages are rejected, not converted.</p>
    <button type="button" className="cp-btn ghost" disabled={!!busy} onClick={() => void inspect()}>Choose package folder · inspect only</button>
    <button type="button" className="cp-btn ghost" onClick={() => useControlPanel.getState().show("plugins")}>Open Plugin Manager</button>
    {busy === "inspect" && <button type="button" className="cp-btn ghost" onClick={() => { ++generation.current; setMessage("Inspection dismissed. A pending local read or folder dialog may still finish; its result will be ignored."); }}>Dismiss inspection</button>}
    {review && <div className="skill-intake-preview">
      <h4>{review.inspection.manifest.name} · v{review.inspection.manifest.version}</h4>
      <p>{review.path}</p><p>Declared publisher: {review.inspection.manifest.publisher} · not authenticated</p>
      <p>{review.inspection.fileCount} files · {review.inspection.totalBytes.toLocaleString()} bytes</p><code>{review.inspection.fingerprint}</code>
      <h4>Requested capabilities · effective only after explicit enablement</h4>
      <ul>{review.inspection.manifest.permissions.length ? review.inspection.manifest.permissions.map((p) => <li key={p}><code>{p}</code></li>) : <li>No privileged capabilities requested</li>}</ul>
      <details><summary>Validated manifest · data only</summary><pre tabIndex={0}>{JSON.stringify(review.inspection.manifest, null, 2)}</pre></details>
      <p>Review the original files and license/asset terms before approving. No license, security or functional clearance is implied. Enabling later can run UI/startup JavaScript in the existing opaque sandbox; it is not a general Node/Python runtime.</p>
      {existing && <p role="alert">This identity is already installed. Use Plugin Manager for lifecycle changes.</p>}
      {!managerReady && <p>Reload Plugin Manager before approving installation.</p>}
      <label><input type="checkbox" disabled={!!busy || !!existing || !managerReady || managerBusy} checked={approved === identity} onChange={(e) => setApproved(e.target.checked ? identity : "")} />I reviewed the source, rights and exact requested permissions. Install disabled; do not run it yet.</label>
      <button type="button" className="cp-btn" disabled={!!busy || managerBusy || !managerReady || !!existing || approved !== identity} onClick={() => void install()}>Install disabled package</button>
      <button type="button" className="cp-btn ghost" disabled={!!busy} onClick={() => { setReview(null); setApproved(""); }}>Discard package review</button>
    </div>}
    {busy && <p role="status">{busy === "inspect" ? "Inspecting local package…" : "Installing disabled package… This committed operation is not cancellable."}</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="skill-intake-error">{error}</p>}
  </section>;
}
