import type { RepoAnalysis } from "../types";
import { useRepoLens } from "../useRepoLens";
import { findSimilar } from "../search";

export function SimilarPanel({ a }: { a: RepoAnalysis }) {
  const library = useRepoLens((s) => s.library);
  const openFromLibrary = useRepoLens((s) => s.openFromLibrary);

  const matches = findSimilar(
    { repoId: a.repoId ?? "", language: a.language, category: a.category },
    library,
    5,
  );

  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">Similar in your library</div>
      {matches.length === 0 ? (
        <p className="rl-prose" style={{ color: "var(--t-tertiary)", fontSize: 13 }}>
          Nothing close yet — scan more repos in the same language or category.
        </p>
      ) : (
        <ul className="rl-list">
          {matches.map((m) => (
            <li key={m.repoId}>
              <button
                className="rl-linkish"
                onClick={() => void openFromLibrary(m.repoId)}
                title="Open this scan"
              >
                {m.repoId}
              </button>
              {m.category ? <span className="sub"> · {m.category}</span> : null}
              {m.language ? <span className="sub"> · {m.language}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
