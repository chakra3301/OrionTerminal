import type { RepoAnalysis, Health } from "./types";
import { deriveFit } from "./verdict";
import { toMarkdown, slugify } from "./export";
import { useRepoLens } from "./useRepoLens";
import { DeepDivePanel } from "./lens/DeepDivePanel";

function downloadMarkdown(a: RepoAnalysis) {
  const blob = new Blob([toMarkdown(a)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(a.repoId || "repo")}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function Para({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{body}</p>
    </div>
  );
}

function Bullets({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function KV({ title, obj }: { title: string; obj?: Record<string, string> }) {
  if (!obj || !Object.values(obj).some(Boolean)) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {Object.entries(obj)
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <li key={k}>
              <strong>{k.replace(/_/g, " ")}:</strong> {v}
            </li>
          ))}
      </ul>
    </div>
  );
}

const HEALTH_BARS: (keyof Health)[] = [
  "commit_activity",
  "issue_response",
  "pr_merge_rate",
  "maintainer_count",
];

export function RepoLensReport({ a }: { a: RepoAnalysis }) {
  const fit = deriveFit(a);
  const lenses = useRepoLens((s) => s.lenses);
  const running = useRepoLens((s) => s.running);
  const runDeepDive = useRepoLens((s) => s.runDeepDive);
  return (
    <div>
      <div className="rl-section">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{a.repoId}</h2>
          <span className={`rl-chip rl-verdict-${fit.level}`}>
            {fit.label} · {fit.why}
          </span>
          <button
            className="rl-btn"
            style={{ marginLeft: "auto", fontSize: 12, padding: "4px 8px" }}
            onClick={() => downloadMarkdown(a)}
          >
            Export .md
          </button>
        </div>
        {a.bottom_line && <p style={{ marginTop: 8 }}>{a.bottom_line}</p>}
      </div>

      <div className="rl-lens-rail">
        <button className="rl-btn" disabled={running !== null} onClick={() => void runDeepDive()}>
          {running === "deepdive" ? "Running Deep Dive…" : lenses.deepdive ? "Re-run Deep Dive" : "Deep Dive"}
        </button>
      </div>
      {lenses.deepdive && <DeepDivePanel d={lenses.deepdive} />}

      <Para title="ELI5" body={a.eli5} />
      <Bullets title="Analogies" items={a.analogies} />
      <Para title="Technical" body={a.technical} />
      <KV title="Use cases" obj={a.use_cases} />
      <KV title="Skip if" obj={a.skip_if} />
      <Para title="Enables" body={a.enables} />
      <Bullets title="Pros" items={a.pros} />
      <Bullets title="Cons" items={a.cons} />

      {a.alternatives?.length > 0 && (
        <div className="rl-section">
          <h3>Alternatives</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.alternatives.map((alt, i) => (
              <li key={i}>
                <strong>{alt.name}</strong> — {alt.when}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rl-section">
        <h3>Health — {a.health.score}/100</h3>
        {HEALTH_BARS.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
            <span style={{ width: 130, fontSize: 12, color: "var(--t-tertiary)" }}>
              {k.replace(/_/g, " ")}
            </span>
            <div className="rl-bar" style={{ flex: 1 }}>
              <span style={{ width: `${Number(a.health[k]) || 0}%` }} />
            </div>
          </div>
        ))}
        {a.health.summary && <p style={{ marginTop: 6 }}>{a.health.summary}</p>}
      </div>

      {a.red_flags?.length > 0 && (
        <div className="rl-section">
          <h3>Red flags</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.red_flags.map((f, i) => (
              <li key={i}>
                {f.severity === "ok" ? "✅" : "⚠️"} <strong>{f.title}</strong> — {f.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.start_here?.length > 0 && (
        <div className="rl-section">
          <h3>Start here</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.start_here.map((s, i) => (
              <li key={i}>
                {s.icon} <strong>{s.title}</strong> ({s.tag}) — {s.desc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.tech_stack?.built_with?.length || a.tech_stack?.key_dependencies?.length ? (
        <div className="rl-section">
          <h3>Tech stack</h3>
          {a.tech_stack.built_with?.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>Built with: {a.tech_stack.built_with.join(", ")}</p>
          )}
          {a.languages?.length ? (
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "6px 0" }}>
              {a.languages.map((l) => (
                <span
                  key={l.name}
                  title={`${l.name} ${l.pct}%`}
                  style={{ width: `${l.pct}%`, background: "var(--repolens-green)", opacity: 0.5 + l.pct / 200 }}
                />
              ))}
            </div>
          ) : null}
          {a.tech_stack.key_dependencies?.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {a.tech_stack.key_dependencies.map((d, i) => (
                <li key={i}>
                  <code>{d.name}</code> — {d.purpose}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {a.tags?.length || a.capabilities?.length ? (
        <div className="rl-section">
          <h3>Tags</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {a.capabilities.map((c) => (
              <span key={`c-${c}`} className="rl-chip rl-verdict-strong">
                {c}
              </span>
            ))}
            {a.tags.map((t) => (
              <span key={`t-${t}`} className="rl-chip">
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {a.highlights?.length > 0 && (
        <div className="rl-section">
          <h3>Highlights</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.highlights.map((h, i) => (
              <li key={i}>
                <strong>{h.text}</strong>
                {h.why ? ` — ${h.why}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
