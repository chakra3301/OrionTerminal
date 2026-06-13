import { useMemo, useState } from "react";
import { useRepoLens } from "./useRepoLens";
import { combineCandidates, type ComboRow } from "./combinator";

function dots(n: number): string {
  return "●".repeat(n) + "○".repeat(Math.max(0, 5 - n));
}

export function RepoLensCombinator() {
  const library = useRepoLens((s) => s.library);
  const running = useRepoLens((s) => s.running);
  const result = useRepoLens((s) => s.combinatorResult);
  const inputs = useRepoLens((s) => s.combinatorInputs);
  const runCombinator = useRepoLens((s) => s.runCombinator);
  const closeCombinator = useRepoLens((s) => s.closeCombinator);

  const [selected, setSelected] = useState<string[]>([]);

  const rows: ComboRow[] = useMemo(
    () =>
      library.map((r) => ({
        repoId: r.repo_id,
        capabilities: r.analysis.capabilities,
        eli5: r.analysis.eli5,
      })),
    [library],
  );
  const suggestions = useMemo(() => combineCandidates(rows, { topK: 6 }), [rows]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));

  const running_ = running === "combinator";

  if (library.length < 2) {
    return (
      <div className="rl-empty">
        <h2>Combinator needs a few repos</h2>
        <p>Scan at least two repositories, then come back to fuse them into a brand-new project idea.</p>
        <button className="rl-btn" style={{ marginTop: 14 }} onClick={closeCombinator}>
          ← Library
        </button>
      </div>
    );
  }

  return (
    <div className="rl-report" style={{ maxWidth: 920 }}>
      <div className="rl-toolbar">
        <h2 style={{ margin: 0, font: "600 20px var(--f-display)" }}>Combinator</h2>
        <button className="rl-btn" onClick={closeCombinator}>
          ← Library
        </button>
      </div>
      <p className="rl-prose" style={{ color: "var(--t-tertiary)", fontSize: 13, marginTop: -6 }}>
        Pick 2–3 repos (or use a suggestion) and fuse them into one project none of them is alone.
      </p>

      {suggestions.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Suggested combinations</div>
          <div className="rl-pills">
            {suggestions.map((c) => (
              <button
                key={c.repoIds.join("|")}
                className="rl-pill"
                disabled={running_}
                title={`novelty ${(c.disjointness * 100) | 0}% · spread ${c.spread.toFixed(1)}`}
                onClick={() => {
                  setSelected(c.repoIds);
                  void runCombinator(c.repoIds);
                }}
              >
                {c.repoIds.join("  +  ")}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rl-card">
        <div className="rl-card-head">
          <div className="rl-eyebrow">Or pick your own ({selected.length}/3)</div>
          <button
            className="rl-btn rl-btn--primary rl-btn--mini"
            disabled={running_ || selected.length < 2}
            onClick={() => void runCombinator(selected)}
          >
            {running_ ? "Fusing…" : `Fuse ${selected.length}`}
          </button>
        </div>
        <div className="rl-pills">
          {rows.map((r) => (
            <button
              key={r.repoId}
              className={`rl-pill${selected.includes(r.repoId) ? " rl-pill--cap" : ""}`}
              onClick={() => toggle(r.repoId)}
            >
              {r.repoId}
            </button>
          ))}
        </div>
      </section>

      {running_ && !result && (
        <div className="rl-spinner">
          <span>Fusing {inputs.join(" + ")} into something new…</span>
        </div>
      )}

      {result && (
        <section className="rl-card rl-lens-panel">
          <div className="rl-eyebrow">{inputs.join(" + ")}</div>
          <h3 style={{ margin: "0 0 6px", font: "600 22px/1.2 var(--f-display)", color: "var(--t-primary)" }}>
            {result.title}
          </h3>
          <p className="rl-prose rl-prose--lg" style={{ marginBottom: 12 }}>
            {result.pitch}
          </p>

          {result.contributions.length > 0 && (
            <>
              <div className="sub-h">What each repo brings</div>
              <ul className="rl-list">
                {result.contributions.map((c, i) => (
                  <li key={i}>
                    <b>{c.repoId}</b> <span className="sub">— {c.role}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div style={{ display: "flex", gap: 20, margin: "14px 0" }}>
            <div>
              <div className="rl-kv-key">Novelty</div>
              <div style={{ font: "14px var(--f-mono)", color: "var(--repolens-green)" }}>
                {dots(result.novelty)}
              </div>
            </div>
            <div>
              <div className="rl-kv-key">Feasibility</div>
              <div style={{ font: "14px var(--f-mono)", color: "var(--neon-cyan)" }}>
                {dots(result.feasibility)}
              </div>
            </div>
          </div>

          {result.first_step && (
            <p className="rl-prose">
              <b>First step:</b> {result.first_step}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
