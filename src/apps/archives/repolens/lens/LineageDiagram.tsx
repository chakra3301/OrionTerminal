import { useId } from "react";
import { lineageLayout, truncate, DG } from "../diagram";
import type { DeepDive } from "../types";

export function LineageDiagram({ d }: { d: DeepDive }) {
  const arrow = useId().replace(/:/g, "");
  const layout = lineageLayout(d.atoms, d.lineage.links);
  if (!layout) return null;
  return (
    <svg
      className="rl-diagram"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-label="Lineage diagram"
    >
      <defs>
        <marker id={arrow} markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto">
          <path className="dg-arrowhead" d="M0,0 L9,4.5 L0,9 z" />
        </marker>
      </defs>
      {layout.edges.map((e, i) => (
        <path
          key={i}
          className="dg-edge"
          d={`M${e.x1},${e.y1} C${e.mx},${e.y1} ${e.mx},${e.y2} ${e.x2},${e.y2}`}
          markerEnd={`url(#${arrow})`}
        />
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id}>
          <rect className="dg-node" x={n.x} y={n.y} width={DG.NODE_W} height={DG.NODE_H} rx={6} />
          <text
            className="dg-node-text"
            x={n.x + DG.NODE_W / 2}
            y={n.y + DG.NODE_H / 2}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {truncate(n.name, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}
