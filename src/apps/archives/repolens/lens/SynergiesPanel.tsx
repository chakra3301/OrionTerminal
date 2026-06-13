import type { Synergies } from "../types";

export function SynergiesPanel({ s }: { s: Synergies }) {
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">Synergies · pairs well with</div>
      <ul className="rl-list">
        {s.synergies.map((x, i) => (
          <li key={i}>
            <b>{x.repoId}</b> <span className="sub">({x.category})</span>
            {x.in_library ? <span className="rl-rel"> · in your library</span> : null}
            <span className="sub"> — {x.synergy}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
