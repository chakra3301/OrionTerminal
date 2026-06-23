import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import {
  type SimNode,
  type SimEdge,
  initialPositions,
  stepForces,
} from "@/apps/archives/learn/forceLayout";
import { type CCProfile } from "@/apps/command/ccTypes";

const W = 1000;
const H = 700;
const PREFERS_REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const KIND_COLOR: Record<string, string> = {
  sources: "#ffc24b",
  concepts: "#00e0ff",
  entities: "#39ff88",
  analyses: "#b14cff",
  syntheses: "#ff3ea5",
  requirements: "#e6ff3a",
};
const kindColor = (k: string) => KIND_COLOR[k] ?? "#5a706a";

type GNode = { id: string; title: string; kind: string; path: string };

/** Obsidian-style force-graph of a profile's memory vault. */
export function CommandGraph({
  profile,
  onClose,
}: {
  profile: CCProfile;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [meta, setMeta] = useState<Map<string, GNode>>(new Map());
  const [edges, setEdges] = useState<SimEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ipc
      .ccVaultGraph(profile.wikiRoot)
      .then((g) => {
        if (!alive) return;
        const m = new Map<string, GNode>(g.nodes.map((n) => [n.id, n]));
        const pos = initialPositions(
          g.nodes.map((n) => n.id),
          W,
          H,
        );
        let sim: SimNode[] = g.nodes.map((n) => ({
          id: n.id,
          x: pos[n.id]!.x,
          y: pos[n.id]!.y,
          vx: 0,
          vy: 0,
        }));
        const simEdges: SimEdge[] = g.edges.map((e) => ({
          from: e.from,
          to: e.to,
        }));
        setMeta(m);
        setEdges(simEdges);
        setLoading(false);

        if (PREFERS_REDUCED || g.nodes.length <= 1) {
          for (let i = 0; i < 280; i++) sim = stepForces(sim, simEdges, W, H);
          setNodes(sim);
          return;
        }
        let frame = 0;
        const tick = () => {
          sim = stepForces(sim, simEdges, W, H);
          setNodes(sim);
          frame++;
          const moving = sim.some((n) => Math.abs(n.vx) + Math.abs(n.vy) > 0.4);
          if (frame < 400 && moving) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      })
      .catch((e) => {
        log.warn("vault graph load failed", e);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [profile.wikiRoot]);

  // Fit: viewBox to the node bounds (+margin) so the SVG scales to fill.
  let vb = `0 0 ${W} ${H}`;
  if (nodes.length) {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80;
    const minY = Math.min(...ys) - 80;
    const w = Math.max(...xs) - minX + 80;
    const h = Math.max(...ys) - minY + 80;
    vb = `${minX} ${minY} ${Math.max(w, 50)} ${Math.max(h, 50)}`;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="cc-graph-overlay">
      <div className="cc-graph-head">
        <span className="title" style={{ color: profile.accent }}>
          {profile.name} · memory graph
        </span>
        <span className="sub">
          {meta.size} page{meta.size === 1 ? "" : "s"} · {edges.length} link
          {edges.length === 1 ? "" : "s"}
        </span>
        <button className="cc-graph-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <div className="cc-graph-empty">Loading memory…</div>
      ) : meta.size === 0 ? (
        <div className="cc-graph-empty">
          No memory yet — this division's brain grows as it works.
        </div>
      ) : (
        <svg className="cc-graph-svg" viewBox={vb} preserveAspectRatio="xMidYMid meet">
          {edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(154,176,168,0.22)"
                strokeWidth={1}
              />
            );
          })}
          {nodes.map((n) => {
            const g = meta.get(n.id);
            const c = kindColor(g?.kind ?? "");
            const active = hover === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={() => g && void ipc.ccOpenPath(g.path, false)}
              >
                <circle r={active ? 9 : 6} fill={c} opacity={active ? 1 : 0.85} />
                {(active || nodes.length <= 30) && (
                  <text
                    x={10}
                    y={4}
                    fontSize={11}
                    fill={active ? "#e6f4ec" : "#9ab0a8"}
                    style={{ pointerEvents: "none", fontFamily: "Space Grotesk, sans-serif" }}
                  >
                    {(g?.title ?? n.id).slice(0, 42)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
