import { useEffect } from "react";
import { ScanSearch } from "lucide-react";
import { useRepoLens } from "./useRepoLens";
import { RepoLensReport } from "./RepoLensReport";
import { RepoLensPickers } from "./RepoLensPickers";
import { RepoLensLibrary } from "./RepoLensLibrary";
import { RepoLensScanTray } from "./RepoLensScanTray";
import { resolveInput } from "./fetch";

export function RepoLensView() {
  const { input, setInput, current, error, scan, closeReport } = useRepoLens();
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
              if (e.key === "Enter" && hit) scan(input);
            }}
          />
        </div>
        <RepoLensPickers />
        <button className="rl-btn rl-btn--primary" disabled={!hit} onClick={() => scan(input)}>
          Scan
        </button>
        {current && (
          <button className="rl-btn" onClick={closeReport}>
            ← Library
          </button>
        )}
      </div>

      <RepoLensScanTray />

      {error && <div className="rl-error">{error}</div>}

      <div className="rl-body">{current ? <RepoLensReport a={current} /> : <RepoLensLibrary />}</div>
    </div>
  );
}
