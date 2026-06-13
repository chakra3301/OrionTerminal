import { useEffect } from "react";
import { ScanSearch } from "lucide-react";
import { useRepoLens } from "./useRepoLens";
import { RepoLensReport } from "./RepoLensReport";
import { RepoLensPickers } from "./RepoLensPickers";
import { RepoLensLibrary } from "./RepoLensLibrary";
import { resolveInput } from "./fetch";

export function RepoLensView() {
  const { input, setInput, current, running, error, scan, closeReport } = useRepoLens();
  const hit = resolveInput(input);

  useEffect(() => {
    void useRepoLens.getState().hydratePrefs();
  }, []);

  return (
    <div className="rl-view">
      <div className="rl-scanbar">
        <div className="rl-scan-field">
          <ScanSearch size={15} />
          <input
            className="rl-url"
            placeholder="Paste a GitHub / GitLab / npm / PyPI URL or owner/repo…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hit && !running) void scan(input);
            }}
          />
        </div>
        <RepoLensPickers />
        <button
          className="rl-btn rl-btn--primary"
          disabled={!hit || running !== null}
          onClick={() => void scan(input)}
        >
          {running === "core" ? "Scanning…" : "Scan"}
        </button>
        {current && (
          <button className="rl-btn" onClick={closeReport}>
            ← Library
          </button>
        )}
      </div>

      {error && <div className="rl-error">{error}</div>}

      <div className="rl-body">
        {running === "core" && !current && (
          <div className="rl-spinner">
            <span>
              Scanning <b>{hit?.repoId}</b>… the full briefing usually takes ~30–90s (Claude is writing
              the whole report). Pick the <b>Haiku</b> model above for faster scans, or Opus for the
              deepest.
            </span>
          </div>
        )}
        {current ? <RepoLensReport a={current} /> : !running && <RepoLensLibrary />}
      </div>
    </div>
  );
}
