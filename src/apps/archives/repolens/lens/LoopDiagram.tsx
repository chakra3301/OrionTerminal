import { useId } from "react";
import { loopLayout, truncate } from "../diagram";

export function LoopDiagram({ cycle, type }: { cycle: string[]; type?: string }) {
  const arrow = useId().replace(/:/g, "");
  const layout = loopLayout(cycle);
  if (!layout) return null;
  const cls = type === "balancing" ? "dg-bal" : "dg-rein";
  return (
    <svg className="rl-diagram" viewBox="0 0 260 220" style={{ maxWidth: 300 }} role="img" aria-label="Feedback loop">
      <defs>
        <marker id={arrow} markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto">
          <path className={`dg-arrowhead ${cls}`} d="M0,0 L9,4.5 L0,9 z" />
        </marker>
      </defs>
      {layout.edges.map((e, i) => (
        <line
          key={i}
          className={`dg-edge ${cls}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          markerEnd={`url(#${arrow})`}
        />
      ))}
      {layout.pts.map((p, i) => (
        <g key={i}>
          <circle className={`dg-dot ${cls}`} cx={p.x} cy={p.y} r={5} />
          <text className="dg-loop-text" x={p.x} y={p.y - 11} textAnchor="middle">
            {truncate(p.label, 16)}
          </text>
        </g>
      ))}
    </svg>
  );
}
