import { useRepoLens } from "./useRepoLens";
import { RepoLensReport } from "./RepoLensReport";
import { resolveInput } from "./fetch";

export function RepoLensView() {
  const { input, setInput, current, running, error, scan, closeReport } = useRepoLens();
  const hit = resolveInput(input);

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
          <div className="rl-spinner">Scanning {hit?.repoId}… (this takes a few seconds)</div>
        )}
        {current ? (
          <RepoLensReport a={current} />
        ) : (
          !running && (
            <p style={{ color: "var(--t-tertiary)" }}>
              Paste a repository above and hit Scan to get an adoption briefing.
            </p>
          )
        )}
      </div>
    </div>
  );
}
