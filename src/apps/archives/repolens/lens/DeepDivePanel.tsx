import type { DeepDive } from "../types";

export function DeepDivePanel({ d }: { d: DeepDive }) {
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">Deep Dive</div>
      {d.feynman.explanation && <p className="rl-prose">{d.feynman.explanation}</p>}

      <div className="sub-h">Atoms</div>
      <ul className="rl-list">
        {d.atoms.map((a) => (
          <li key={a.id}>
            <b>{a.name}</b> <span className="sub">({a.kind})</span> — {a.purpose}
            {a.files.length ? <span className="sub"> · {a.files.join(", ")}</span> : null}
          </li>
        ))}
      </ul>

      {d.lineage.links.length > 0 && (
        <>
          <div className="sub-h">Lineage</div>
          <ul className="rl-list">
            {d.lineage.links.map((l, i) => (
              <li key={i}>
                {l.from} <span className="rl-rel">{l.relation}</span> {l.to}
                {l.why ? <span className="sub"> — {l.why}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {d.feynman.questions.length > 0 && (
        <>
          <div className="sub-h">Check your understanding</div>
          <ul className="rl-list">
            {d.feynman.questions.map((q, i) => (
              <li key={i}>
                <b>{q.q}</b> <span className="sub">— {q.a}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {d.feynman.gaps.length > 0 && (
        <p className="rl-prose" style={{ marginTop: 12, color: "var(--t-tertiary)", fontSize: 12 }}>
          Gaps: {d.feynman.gaps.join("; ")}
        </p>
      )}
    </section>
  );
}
