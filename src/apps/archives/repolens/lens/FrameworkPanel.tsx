import type { ReactNode } from "react";
import { frameworkLabel } from "../frameworks";

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

export function FrameworkPanel({ fkey, data }: { fkey: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">{frameworkLabel(fkey)}</div>
      {entries.map(([k, v]) => (
        <div className="rl-fw-block" key={k}>
          <div className="sub-h">{humanize(k)}</div>
          <div className="rl-fw-val">
            <Val v={v} />
          </div>
        </div>
      ))}
    </section>
  );
}
