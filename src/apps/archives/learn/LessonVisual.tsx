// src/apps/archives/learn/LessonVisual.tsx
// Inline lesson diagrams (dual coding). One dispatcher + six renderers:
//   flow / cycle / timeline  → step-through player (active step + caption)
//   tree                     → SVG hierarchy with hover-reveal detail
//   compare                  → side-by-side table, row hover highlight
//   analogy                  → familiar ↔ concept pairs, hover to highlight
// Pure geometry comes from visualLayout.ts; everything here is presentation.

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import type { LessonVisual as Visual } from "./learnTypes";
import { cycleLayout, treeLayout } from "./visualLayout";

const STEP_MS = 2400;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// ── Shared step-through controller ─────────────────────────────────────────
function useStepper(count: number, loop: boolean) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPlaying(false);
  }, []);

  const next = useCallback(() => {
    setActive((a) => (a + 1 >= count ? (loop ? 0 : a) : a + 1));
  }, [count, loop]);
  const prev = useCallback(() => setActive((a) => (a - 1 < 0 ? (loop ? count - 1 : 0) : a - 1)), [count, loop]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setActive((a) => {
        if (a + 1 >= count) {
          if (loop) return 0;
          stop();
          return a;
        }
        return a + 1;
      });
    }, STEP_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, count, loop, stop]);

  const toggle = useCallback(() => {
    if (prefersReducedMotion()) return; // no auto-advance under reduced motion
    setPlaying((p) => !p);
  }, []);

  const goto = useCallback((i: number) => { stop(); setActive(i); }, [stop]);

  return { active, playing, next, prev, toggle, goto };
}

function StepControls({ active, count, playing, onPrev, onNext, onToggle }: {
  active: number; count: number; playing: boolean;
  onPrev: () => void; onNext: () => void; onToggle: () => void;
}) {
  const reduced = prefersReducedMotion();
  return (
    <div className="lv-controls">
      <button type="button" className="lv-ctrl-btn" onClick={onPrev} aria-label="Previous step"><ChevronLeft size={14} /></button>
      {!reduced && (
        <button type="button" className="lv-ctrl-btn" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
      )}
      <span className="lv-step-count">{active + 1} / {count}</span>
      <button type="button" className="lv-ctrl-btn" onClick={onNext} aria-label="Next step"><ChevronRight size={14} /></button>
    </div>
  );
}

// ── Flow (vertical connected steps) ────────────────────────────────────────
function FlowVisual({ v }: { v: Visual }) {
  const s = useStepper(v.steps.length, false);
  return (
    <div className="lv-flow">
      <div className="lv-flow-track">
        {v.steps.map((step, i) => (
          <div key={i} className="lv-flow-item">
            <button
              type="button"
              className={`lv-flow-node${i === s.active ? " lv-active" : ""}${i < s.active ? " lv-passed" : ""}`}
              onClick={() => s.goto(i)}
            >
              <span className="lv-flow-idx">{i + 1}</span>
              <span className="lv-flow-label">{step.label}</span>
            </button>
            {i < v.steps.length - 1 && <div className="lv-flow-arrow" aria-hidden>↓</div>}
          </div>
        ))}
      </div>
      <div className="lv-caption-rail">
        <StepControls active={s.active} count={v.steps.length} playing={s.playing} onPrev={s.prev} onNext={s.next} onToggle={s.toggle} />
        {v.steps[s.active]?.detail && <p className="lv-step-detail">{v.steps[s.active]!.detail}</p>}
      </div>
    </div>
  );
}

// ── Cycle (circular loop) ──────────────────────────────────────────────────
function CycleVisual({ v }: { v: Visual }) {
  const s = useStepper(v.steps.length, true);
  const layout = cycleLayout(v.steps.length);
  if (!layout) return null;
  return (
    <div className="lv-cycle">
      <svg className="lv-cycle-svg" viewBox={`0 0 ${layout.size} ${layout.size}`} role="img" aria-label={v.title || "Cycle"}>
        <defs>
          <marker id="lv-cyc-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="lv-cyc-arrowhead" />
          </marker>
        </defs>
        {layout.arcs.map((a, i) => (
          <path key={i} d={a.d} className="lv-cyc-arc" markerEnd="url(#lv-cyc-arrow)" />
        ))}
        {layout.pts.map((p, i) => {
          const outward = i === s.active ? 1 : 0;
          return (
            <g key={i} className={`lv-cyc-node${i === s.active ? " lv-active" : ""}`} onClick={() => s.goto(i)} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r={i === s.active ? 9 : 6} className="lv-cyc-dot" />
              <text x={p.x + Math.cos(p.angle) * 16 * (1 + outward * 0.1)} y={p.y + Math.sin(p.angle) * 16 + 3}
                textAnchor={Math.cos(p.angle) > 0.3 ? "start" : Math.cos(p.angle) < -0.3 ? "end" : "middle"}
                className="lv-cyc-label">
                {v.steps[i]!.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="lv-caption-rail">
        <StepControls active={s.active} count={v.steps.length} playing={s.playing} onPrev={s.prev} onNext={s.next} onToggle={s.toggle} />
        {v.steps[s.active]?.detail && <p className="lv-step-detail"><strong>{v.steps[s.active]!.label}.</strong> {v.steps[s.active]!.detail}</p>}
      </div>
    </div>
  );
}

// ── Timeline (vertical rail) ───────────────────────────────────────────────
function TimelineVisual({ v }: { v: Visual }) {
  const s = useStepper(v.steps.length, false);
  return (
    <div className="lv-timeline">
      <div className="lv-tl-track">
        {v.steps.map((step, i) => (
          <button key={i} type="button" className={`lv-tl-item${i === s.active ? " lv-active" : ""}`} onClick={() => s.goto(i)}>
            <span className="lv-tl-dot" aria-hidden />
            <span className="lv-tl-label">{step.label}</span>
            {i === s.active && step.detail && <span className="lv-tl-detail">{step.detail}</span>}
          </button>
        ))}
      </div>
      <StepControls active={s.active} count={v.steps.length} playing={s.playing} onPrev={s.prev} onNext={s.next} onToggle={s.toggle} />
    </div>
  );
}

// ── Tree (hierarchy with hover-reveal) ─────────────────────────────────────
function TreeVisual({ v }: { v: Visual }) {
  const [hover, setHover] = useState<number | null>(null);
  const layout = treeLayout(v.nodes);
  if (!layout) return null;
  const active = hover != null ? v.nodes[hover] : null;
  return (
    <div className="lv-tree">
      <svg className="lv-tree-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={v.title || "Hierarchy"}>
        {layout.edges.map((e, i) => (
          <path key={i} d={e.d} className="lv-tree-edge" fill="none" />
        ))}
        {layout.nodes.map((b) => (
          <g key={b.index} className={`lv-tree-node${hover === b.index ? " lv-active" : ""}`}
            onMouseEnter={() => setHover(b.index)} onMouseLeave={() => setHover((h) => (h === b.index ? null : h))}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className="lv-tree-rect" />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" className="lv-tree-label">
              {v.nodes[b.index]!.label.length > 16 ? v.nodes[b.index]!.label.slice(0, 15) + "…" : v.nodes[b.index]!.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="lv-step-detail">
        {active?.detail ? <><strong>{active.label}.</strong> {active.detail}</> : <span className="lv-hint">Hover a node to see what it means.</span>}
      </p>
    </div>
  );
}

// ── Compare (side-by-side table) ───────────────────────────────────────────
function CompareVisual({ v }: { v: Visual }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="lv-compare">
      <div className="lv-cmp-head">
        <span className="lv-cmp-aspect-h" />
        <span className="lv-cmp-side lv-cmp-left">{v.leftLabel || "A"}</span>
        <span className="lv-cmp-side lv-cmp-right">{v.rightLabel || "B"}</span>
      </div>
      {v.rows.map((r, i) => (
        <div key={i} className={`lv-cmp-row${hover === i ? " lv-active" : ""}`}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
          <span className="lv-cmp-aspect">{r.aspect}</span>
          <span className="lv-cmp-cell">{r.left}</span>
          <span className="lv-cmp-cell">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

// ── Analogy (familiar ↔ concept pairs) ─────────────────────────────────────
function AnalogyVisual({ v }: { v: Visual }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="lv-analogy">
      <div className="lv-an-head">
        <span className="lv-an-side">{v.leftLabel || "Familiar"}</span>
        <span className="lv-an-spacer" />
        <span className="lv-an-side">{v.rightLabel || "Concept"}</span>
      </div>
      {v.pairs.map((p, i) => (
        <div key={i} className={`lv-an-row${hover === i ? " lv-active" : ""}`}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
          <span className="lv-an-chip lv-an-familiar">{p.familiar}</span>
          <ArrowRight size={14} className="lv-an-arrow" />
          <span className="lv-an-chip lv-an-concept">{p.concept}</span>
          {hover === i && p.note && <span className="lv-an-note">{p.note}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Dispatcher ─────────────────────────────────────────────────────────────
export function LessonVisual({ v }: { v: Visual }) {
  let body: React.ReactNode = null;
  switch (v.kind) {
    case "flow":     body = <FlowVisual v={v} />; break;
    case "cycle":    body = <CycleVisual v={v} />; break;
    case "timeline": body = <TimelineVisual v={v} />; break;
    case "tree":     body = <TreeVisual v={v} />; break;
    case "compare":  body = <CompareVisual v={v} />; break;
    case "analogy":  body = <AnalogyVisual v={v} />; break;
    default: return null;
  }
  return (
    <figure className="lv-figure">
      {v.title && <figcaption className="lv-title"><span className="lv-kind-badge">{v.kind}</span>{v.title}</figcaption>}
      {body}
      {v.caption && <p className="lv-caption">{v.caption}</p>}
    </figure>
  );
}
