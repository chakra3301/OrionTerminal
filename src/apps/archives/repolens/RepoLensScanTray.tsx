import { useRepoLens, type ScanStatus } from "./useRepoLens";

function label(s: ScanStatus): string {
  return s === "queued" ? "queued" : s === "running" ? "scanning…" : s === "done" ? "view →" : "failed";
}

export function RepoLensScanTray() {
  const jobs = useRepoLens((s) => s.jobs);
  const openFromLibrary = useRepoLens((s) => s.openFromLibrary);
  const dismissJob = useRepoLens((s) => s.dismissJob);
  const clearDoneJobs = useRepoLens((s) => s.clearDoneJobs);

  if (jobs.length === 0) return null;
  const hasDone = jobs.some((j) => j.status === "done" || j.status === "error");

  return (
    <div className="rl-tray">
      {jobs.map((j) => (
        <div
          key={j.id}
          className={`rl-scan-chip rl-scan-${j.status}`}
          title={j.error ?? j.repoId}
          onClick={j.status === "done" ? () => void openFromLibrary(j.repoId) : undefined}
        >
          <span className="dot" />
          <span className="id">{j.repoId}</span>
          <span className="st">{label(j.status)}</span>
          {(j.status === "done" || j.status === "error") && (
            <button
              className="x"
              title="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismissJob(j.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {hasDone && (
        <button className="rl-tray-clear" onClick={clearDoneJobs}>
          Clear done
        </button>
      )}
    </div>
  );
}
