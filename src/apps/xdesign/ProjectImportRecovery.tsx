import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { decodeTime } from 'ulid';
import { confirmAction } from '@/components/ConfirmModal';
import { toast } from '@/store/toastStore';
import { interruptedProjectImports, type InterruptedProjectImport } from './projectAssetImport';
import { useXDProjects } from './projectsStore';
import { trackXDesignActivity } from './runtimeActivity';
import './projectImportRecovery.css';

export function ProjectImportRecovery() {
  const desktop = isTauri();
  const transitioning = useXDProjects(state => state.transitioning);
  const [copies, setCopies] = useState<InterruptedProjectImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'open' | 'remove' } | null>(null);
  const alive = useRef(false), generation = useRef(0), scanning = useRef(true), acting = useRef(false);
  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    scanning.current = true; setLoading(true); setError(null);
    try {
      const pending = await trackXDesignActivity('project-recovery-scan', 'Wait for interrupted copies to finish loading before disabling XDesign.', interruptedProjectImports);
      if (alive.current && ticket === generation.current) setCopies(pending);
    } catch (error) {
      if (alive.current && ticket === generation.current) setError(String(error));
    } finally {
      if (alive.current && ticket === generation.current) { scanning.current = false; setLoading(false); }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    if (desktop && !transitioning && !acting.current) void reload();
  }, [desktop, transitioning, reload]);

  const act = async (copy: InterruptedProjectImport, action: 'open' | 'remove') => {
    if (acting.current || scanning.current || useXDProjects.getState().transitioning) return;
    acting.current = true; setBusy({ id: copy.projectId, action }); setError(null);
    const receipt = { projectId: copy.projectId, operationId: copy.operationId };
    try {
      if (action === 'open') await useXDProjects.getState().recoverDesignImport(receipt);
      else {
        const confirmed = await confirmAction({ title: `Remove “${copy.name ?? 'Interrupted copy'}”?`,
          body: 'Remove this unused copy and its copied images. Original files and saved projects are preserved.',
          confirmLabel: 'Remove unused copy', danger: true });
        if (!confirmed || !alive.current) return;
        const result = await useXDProjects.getState().removeInterruptedImport(receipt);
        if (alive.current) toast.info(result === 'kept' ? 'This copy was saved as a project and was kept.' : 'Unused copy removed');
      }
      if (action === 'remove' && alive.current) await reload();
    } catch (error) { if (alive.current) setError(String(error)); }
    finally { acting.current = false; if (alive.current) setBusy(null); }
  };

  if (!desktop || !loading && !error && !copies.length) return null;
  const disabled = loading || !!busy || transitioning;
  return <section className="xd-home-section xd-import-recovery" aria-label="Interrupted copies" aria-busy={loading || !!busy}>
    <header>
      <h2 className="xd-home-section-title">Interrupted copies</h2>
      <button type="button" disabled={disabled} onClick={() => { void reload(); }}>Refresh</button>
    </header>
    {loading && <p role="status">Checking for saved copies…</p>}
    {copies.map(copy => {
      const date = new Date(decodeTime(copy.operationId));
      const current = busy?.id === copy.projectId;
      const label = copy.name ?? `Interrupted copy from ${date.toLocaleString()}`;
      return <article key={copy.projectId} aria-label={label}>
        <div className="xd-import-recovery-info">
          <strong>{copy.name ?? 'Interrupted copy'}</strong>
          <time dateTime={date.toISOString()}>Started {date.toLocaleString()}</time>
          <p>{copy.phase === 'discarded' ? 'Removal stopped before it finished.' : copy.canOpen ? 'Saved artwork is available to recover.' : 'Copy preparation did not finish.'}</p>
        </div>
        <div className="xd-import-recovery-actions">
          <button type="button" className="primary" aria-label={`Open recovered copy: ${label}`} disabled={disabled || !copy.canOpen} onClick={() => { void act(copy, 'open'); }}>Open recovered copy</button>
          <button type="button" aria-label={`${copy.phase === 'discarded' ? 'Finish removing copy' : 'Remove unused copy'}: ${label}`} disabled={disabled} onClick={() => { void act(copy, 'remove'); }}>{copy.phase === 'discarded' ? 'Finish removing copy' : 'Remove unused copy…'}</button>
        </div>
        {current && <p role="status">{busy?.action === 'open' ? 'Opening saved copy…' : 'Removing unused copy…'}</p>}
      </article>;
    })}
    {error && <p role="alert">{error}</p>}
  </section>;
}
