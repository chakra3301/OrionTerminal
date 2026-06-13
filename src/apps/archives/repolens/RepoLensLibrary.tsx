import { useEffect } from "react";
import { ScanSearch } from "lucide-react";
import { useRepoLens } from "./useRepoLens";
import { deriveFit } from "./verdict";

export function RepoLensLibrary() {
  const library = useRepoLens((s) => s.library);
  const loadLibrary = useRepoLens((s) => s.loadLibrary);
  const openFromLibrary = useRepoLens((s) => s.openFromLibrary);
  const removeFromLibrary = useRepoLens((s) => s.removeFromLibrary);
  const openCombinator = useRepoLens((s) => s.openCombinator);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  if (library.length === 0) {
    return (
      <div className="rl-empty">
        <div className="glyph">
          <ScanSearch size={40} strokeWidth={1.5} />
        </div>
        <h2>Scan any repository</h2>
        <p>
          Paste a GitHub, GitLab, npm, or PyPI link above and RepoLens writes an honest "should I adopt
          this?" briefing — verdict, health, pros &amp; cons, and deeper lenses on demand. Saved scans
          land here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rl-lib-head">
        <span className="t">Library</span>
        <span className="n">{library.length} scanned</span>
        {library.length >= 2 && (
          <button
            className="rl-btn rl-btn--mini"
            style={{ marginLeft: "auto" }}
            onClick={openCombinator}
            title="Fuse 2-3 repos into a new project idea"
          >
            ⚗ Combinator
          </button>
        )}
      </div>
      <div className="rl-lib-grid">
        {library.map((row) => {
          const fit = deriveFit(row.analysis);
          return (
            <div
              key={row.repo_id}
              className={`rl-lib-card rl-lvl-${fit.level}`}
              onClick={() => void openFromLibrary(row.repo_id)}
            >
              <div className="rl-lib-top">
                <span className="rl-lib-id">{row.repo_id}</span>
                <span className="rl-lib-badge">
                  {row.analysis.health?.score ?? "—"}
                  <span className="s"> / {fit.label}</span>
                </span>
              </div>
              <div className="rl-lib-meta">
                {row.analysis.category || row.platform}
                {row.analysis.stars ? ` · ${row.analysis.stars.toLocaleString()}★` : ""}
              </div>
              <p className="rl-lib-eli5">{row.analysis.eli5}</p>
              <button
                className="rl-lib-del"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeFromLibrary(row.repo_id);
                }}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
