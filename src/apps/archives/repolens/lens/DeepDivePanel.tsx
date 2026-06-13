import type { DeepDive } from "../types";

export function DeepDivePanel({ d }: { d: DeepDive }) {
  return (
    <div className="rl-section">
      <h3>Deep Dive — Feynman explanation</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{d.feynman.explanation}</p>

      <h3 style={{ marginTop: 16 }}>Atoms</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {d.atoms.map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong> <em>({a.kind})</em> — {a.purpose}
            {a.files.length ? ` · ${a.files.join(", ")}` : ""}
          </li>
        ))}
      </ul>

      {d.lineage.links.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Lineage</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.lineage.links.map((l, i) => (
              <li key={i}>
                {l.from} <span style={{ color: "var(--repolens-green)" }}>{l.relation}</span> {l.to}
                {l.why ? ` — ${l.why}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {d.feynman.questions.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Self-test</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.feynman.questions.map((q, i) => (
              <li key={i}>
                <strong>{q.q}</strong> — {q.a}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.feynman.gaps.length > 0 && (
        <p style={{ marginTop: 12, color: "var(--t-tertiary)" }}>Gaps: {d.feynman.gaps.join("; ")}</p>
      )}
    </div>
  );
}
