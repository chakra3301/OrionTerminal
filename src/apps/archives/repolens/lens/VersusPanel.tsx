import type { Versus } from "../types";

export function VersusPanel({ v, aId }: { v: Versus; aId: string }) {
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">
        Versus · {aId} vs {v.target}
      </div>

      <div className="rl-vs-heads">
        <div className="rl-vs-head a">
          <span className="who">A</span>
          {aId}
          {v.summary_a && <p className="sm">{v.summary_a}</p>}
        </div>
        <div className="rl-vs-head b">
          <span className="who">B</span>
          {v.target}
          {v.summary_b && <p className="sm">{v.summary_b}</p>}
        </div>
      </div>

      {v.dimensions.length > 0 && (
        <div className="rl-vs-dims">
          {v.dimensions.map((d, i) => (
            <div className="rl-vs-row" key={i}>
              <div className="dim">{d.label}</div>
              <div className={`side${d.winner === "a" ? " win" : ""}`}>{d.a}</div>
              <div className={`side${d.winner === "b" ? " win" : ""}`}>{d.b}</div>
            </div>
          ))}
        </div>
      )}

      {(v.pick_a_when.length > 0 || v.pick_b_when.length > 0) && (
        <div className="rl-grid" style={{ marginTop: 14 }}>
          {v.pick_a_when.length > 0 && (
            <div>
              <div className="sub-h">Pick {aId} when</div>
              <ul className="rl-list">
                {v.pick_a_when.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {v.pick_b_when.length > 0 && (
            <div>
              <div className="sub-h">Pick {v.target} when</div>
              <ul className="rl-list">
                {v.pick_b_when.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {v.verdict && (
        <p className="rl-prose" style={{ marginTop: 14 }}>
          <b>Verdict:</b> {v.verdict}
        </p>
      )}
    </section>
  );
}
