import type { Synergies } from "../types";

export function SynergiesPanel({ s }: { s: Synergies }) {
  return (
    <div className="rl-section">
      <h3>Synergies — pairs well with</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {s.synergies.map((x, i) => (
          <li key={i}>
            <strong>{x.repoId}</strong> <em>({x.category})</em>
            {x.in_library ? " · in your library" : ""} — {x.synergy}
          </li>
        ))}
      </ul>
    </div>
  );
}
