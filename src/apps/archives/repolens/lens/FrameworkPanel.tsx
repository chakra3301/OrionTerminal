import type { ReactNode } from "react";
import { frameworkLabel } from "../frameworks";
import { LensGuide } from "./LensGuide";
import { LoopDiagram } from "./LoopDiagram";

function humanize(k: string): string {
  return k.replace(/_/g, " ");
}

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

/** Generic renderer for a framework's arbitrary JSON result. */
function Val({ v }: { v: unknown }): ReactNode {
  if (v == null) return null;
  if (isScalar(v)) return <>{String(v)}</>;
  if (Array.isArray(v)) {
    return (
      <ul className="rl-list">
        {v.map((x, i) => (
          <li key={i}>{isScalar(x) ? String(x) : <Val v={x} />}</li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(v as Record<string, unknown>);
  return (
    <div className="rl-kv">
      {entries.map(([k, val]) => (
        <div className="rl-kv-row" key={k}>
          <span className="rl-kv-key">{humanize(k)}</span>
          <span className="rl-kv-val">{isScalar(val) ? String(val) : <Val v={val} />}</span>
        </div>
      ))}
    </div>
  );
}

type Loop = { type?: string; name?: string; cycle?: unknown; effect?: string };

export function FrameworkPanel({ fkey, data }: { fkey: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  const loops = fkey === "loops" && Array.isArray(data.loops) ? (data.loops as Loop[]) : null;
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">{frameworkLabel(fkey)}</div>
      <LensGuide k={fkey} />
      {loops ? (
        <div className="rl-loops">
          {loops.map((l, i) => {
            const cycle = Array.isArray(l.cycle) ? l.cycle.map(String) : [];
            return (
              <div className="rl-loop" key={i}>
                {cycle.length >= 2 && <LoopDiagram cycle={cycle} type={l.type} />}
                <div className="rl-loop-meta">
                  <b>{l.name || `Loop ${i + 1}`}</b> <span className="sub">({l.type || "reinforcing"})</span>
                  {l.effect && (
                    <p className="rl-prose" style={{ fontSize: 13, marginTop: 4 }}>
                      {l.effect}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        entries.map(([k, v]) => (
          <div className="rl-fw-block" key={k}>
            <div className="sub-h">{humanize(k)}</div>
            <div className="rl-fw-val">
              <Val v={v} />
            </div>
          </div>
        ))
      )}
    </section>
  );
}
