import type { RepoAnalysis } from "../types";
import { useRepoLens } from "../useRepoLens";
import { egoLayout, buildConnections } from "../connections";

const trunc = (s: string, n = 12) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function ConnectionsPanel({ a }: { a: RepoAnalysis }) {
  const library = useRepoLens((s) => s.library);
  const openFromLibrary = useRepoLens((s) => s.openFromLibrary);

  const centerId = a.repoId ?? "";
  const neighbors = buildConnections({ repoId: centerId, capabilities: a.capabilities }, library, 8);

  if (neighbors.length === 0) {
    return (
      <section className="rl-card rl-lens-panel">
        <div className="rl-eyebrow">Connections</div>
        <p className="rl-prose" style={{ color: "var(--t-tertiary)", fontSize: 13 }}>
          No related repos in your library yet — scan a few more with overlapping capabilities.
        </p>
      </section>
    );
  }

  const nodes = egoLayout(centerId, neighbors.map((n) => ({ id: n.repoId })));
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const c = pos.get(centerId)!;
  const maxW = Math.max(...neighbors.map((n) => n.weight));

  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">Connections · capability overlap</div>
      <svg viewBox="0 0 400 300" className="rl-ego" role="img" aria-label="Related repositories">
        {neighbors.map((nb) => {
          const p = pos.get(nb.repoId)!;
          return (
            <line
              key={`e-${nb.repoId}`}
              x1={c.x}
              y1={c.y}
              x2={p.x}
              y2={p.y}
              stroke="var(--repolens-green)"
              strokeOpacity={0.18 + (0.6 * nb.weight) / maxW}
              strokeWidth={1 + (2.5 * nb.weight) / maxW}
            />
          );
        })}
        <g>
          <circle cx={c.x} cy={c.y} r={27} className="rl-ego-center" />
          <text x={c.x} y={c.y} className="rl-ego-clabel">
            {trunc(c.id.split("/").pop() || c.id, 14)}
          </text>
        </g>
        {neighbors.map((nb) => {
          const p = pos.get(nb.repoId)!;
          return (
            <g key={`n-${nb.repoId}`} className="rl-ego-node" onClick={() => void openFromLibrary(nb.repoId)}>
              <title>{`${nb.repoId} · shares ${nb.shared.join(", ") || "tags"}`}</title>
              <circle cx={p.x} cy={p.y} r={19} />
              <text x={p.x} y={p.y}>
                {trunc(nb.name)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
