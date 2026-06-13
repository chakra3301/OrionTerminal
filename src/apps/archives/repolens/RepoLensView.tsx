import { useEffect } from "react";
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
        <input
          className="rl-url"
          placeholder="Paste a GitHub/GitLab/npm/PyPI URL or owner/repo…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hit && !running) void scan(input);
          }}
        />
        <RepoLensPickers />
        <button className="rl-btn" disabled={!hit || running !== null} onClick={() => void scan(input)}>
          {running === "core" ? "Scanning…" : "Scan"}
        </button>
        {current && (
          <button className="rl-btn" onClick={closeReport}>
            Library
          </button>
        )}
      </div>

      {error && <div className="rl-error">{error}</div>}

      <div className="rl-body">
        {running === "core" && !current && (
          <div className="rl-spinner">
            Scanning {hit?.repoId}… the full briefing usually takes ~30–90s (Claude is writing the whole
            report). Pick the <strong>Haiku</strong> model above for faster scans, or Opus for the deepest.
          </div>
        )}
        {current ? <RepoLensReport a={current} /> : !running && <RepoLensLibrary />}
      </div>
    </div>
  );
}
