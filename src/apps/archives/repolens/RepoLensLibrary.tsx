import { useEffect } from "react";
import { useRepoLens } from "./useRepoLens";
import { deriveFit } from "./verdict";

export function RepoLensLibrary() {
  const library = useRepoLens((s) => s.library);
  const loadLibrary = useRepoLens((s) => s.loadLibrary);
  const openFromLibrary = useRepoLens((s) => s.openFromLibrary);
  const removeFromLibrary = useRepoLens((s) => s.removeFromLibrary);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  if (library.length === 0) {
    return (
      <p style={{ color: "var(--t-tertiary)" }}>
        No scans yet. Paste a repository above and hit Scan to get an adoption briefing.
      </p>
    );
  }
  return (
    <div className="rl-lib-grid">
      {library.map((row) => {
        const fit = deriveFit(row.analysis);
        return (
          <div key={row.repo_id} className="rl-lib-card" onClick={() => void openFromLibrary(row.repo_id)}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ wordBreak: "break-word" }}>{row.repo_id}</strong>
              <span className={`rl-chip rl-verdict-${fit.level}`}>{fit.label}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--t-tertiary)", margin: "6px 0" }}>
              {row.analysis.category || row.platform}
              {row.analysis.stars ? ` · ${row.analysis.stars}★` : ""}
            </div>
            <p
              style={{
                fontSize: 13,
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {row.analysis.eli5}
            </p>
            <button
              className="rl-btn"
              style={{ marginTop: 8, fontSize: 12, padding: "4px 8px" }}
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
  );
}
