import { useState, type CSSProperties, type ReactNode } from "react";
import type { RepoAnalysis, Health } from "./types";
import { deriveFit } from "./verdict";
import { toMarkdown, slugify } from "./export";
import { useRepoLens } from "./useRepoLens";
import { resolveInput } from "./fetch";
import { DeepDivePanel } from "./lens/DeepDivePanel";
import { SktpgPanel } from "./lens/SktpgPanel";
import { SynergiesPanel } from "./lens/SynergiesPanel";
import { VersusPanel } from "./lens/VersusPanel";

const LANG_COLORS = [
  "var(--repolens-green)",
  "var(--neon-cyan)",
  "var(--neon-violet)",
  "var(--neon-yellow)",
  "var(--neon-magenta)",
];

const METRICS: { key: keyof Health; label: string }[] = [
  { key: "commit_activity", label: "commits" },
  { key: "issue_response", label: "issues" },
  { key: "pr_merge_rate", label: "pr merge" },
  { key: "maintainer_count", label: "maintainers" },
];

function downloadMarkdown(a: RepoAnalysis) {
  const blob = new Blob([toMarkdown(a)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(a.repoId || "repo")}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="rl-eyebrow">{children}</div>;
}

function Card({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rl-card ${className}`}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

export function RepoLensReport({ a }: { a: RepoAnalysis }) {
  const fit = deriveFit(a);
  const lenses = useRepoLens((s) => s.lenses);
  const running = useRepoLens((s) => s.running);
  const runDeepDive = useRepoLens((s) => s.runDeepDive);
  const runSktpg = useRepoLens((s) => s.runSktpg);
  const runSynergies = useRepoLens((s) => s.runSynergies);
  const runVersus = useRepoLens((s) => s.runVersus);
  const library = useRepoLens((s) => s.library);

  const repoId = a.repoId ?? "";
  const [versusOpen, setVersusOpen] = useState(false);
  const [vsInput, setVsInput] = useState("");
  const vsHit = resolveInput(vsInput);
  const vsCandidates = library.filter((r) => r.repo_id !== repoId);

  const startVersus = (platform: RepoAnalysis["platform"], target: string) => {
    setVersusOpen(false);
    setVsInput("");
    void runVersus({ platform: platform ?? "github", repoId: target });
  };
  const slash = repoId.lastIndexOf("/");
  const owner = slash > 0 ? repoId.slice(0, slash + 1) : "";
  const name = slash > 0 ? repoId.slice(slash + 1) : repoId;

  const useCases = Object.values(a.use_cases ?? {}).some(Boolean);
  const skipIf = Object.values(a.skip_if ?? {}).some(Boolean);

  return (
    <div className={`rl-report rl-lvl-${fit.level}`}>
      {/* ── HERO ── */}
      <header className="rl-hero">
        <div className="rl-hero-main">
          <div className="rl-hero-eyebrow">
            {a.platform ?? "repo"} {a.category ? `· ${a.category}` : ""}
          </div>
          <h2 className="rl-repoid">
            {owner && <span className="dim">{owner}</span>}
            {name}
          </h2>
          <div className="rl-meta">
            {a.language && a.language !== "Unknown" && (
              <span className="rl-stat">◆ {a.language}</span>
            )}
            {a.stars ? (
              <span className="rl-stat">
                ★ <b>{a.stars.toLocaleString()}</b>
              </span>
            ) : null}
            {a.license && a.license !== "Unknown" && <span className="rl-stat">{a.license}</span>}
          </div>
          {a.bottom_line && <p className="rl-lead">{a.bottom_line}</p>}
        </div>

        <div className="rl-hero-side">
          <div className="rl-verdict-badge">
            <span className="lvl">{fit.label}</span>
            <span className="why">{fit.why}</span>
          </div>
          <div className="rl-scorecard">
            <div className="rl-ring" style={{ "--val": a.health?.score ?? 0 } as CSSProperties}>
              <div className="rl-ring-inner">
                <div className="n">{a.health?.score ?? 0}</div>
                <div className="d">HEALTH</div>
              </div>
            </div>
            <div className="rl-metrics">
              {METRICS.map((m) => {
                const v = Number(a.health?.[m.key]) || 0;
                return (
                  <div className="rl-metric" key={m.key}>
                    <span className="k">{m.label}</span>
                    <span className="v">{v}</span>
                    <div className="bar">
                      <span style={{ width: `${v}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* ── toolbar: lenses + export ── */}
      <div className="rl-toolbar">
        <div className="rl-lens-rail">
          <button
            className={`rl-btn rl-lens-btn${lenses.deepdive ? " has" : ""}`}
            disabled={running !== null}
            onClick={() => void runDeepDive()}
          >
            {running === "deepdive" ? "Running Deep Dive…" : lenses.deepdive ? "↻ Deep Dive" : "Deep Dive"}
          </button>
          <button
            className={`rl-btn rl-lens-btn${lenses.sktpg ? " has" : ""}`}
            disabled={running !== null}
            onClick={() => void runSktpg()}
          >
            {running === "sktpg" ? "Running SKTPG…" : lenses.sktpg ? "↻ SKTPG" : "SKTPG"}
          </button>
          <button
            className={`rl-btn rl-lens-btn${lenses.synergies ? " has" : ""}`}
            disabled={running !== null}
            onClick={() => void runSynergies()}
          >
            {running === "synergies" ? "Running Synergies…" : lenses.synergies ? "↻ Synergies" : "Synergies"}
          </button>
          <button
            className={`rl-btn rl-lens-btn${lenses.versus ? " has" : ""}${versusOpen ? " open" : ""}`}
            disabled={running !== null}
            onClick={() => setVersusOpen((o) => !o)}
          >
            {running === "versus" ? "Running Versus…" : lenses.versus ? "↻ Versus" : "Versus"}
          </button>
        </div>
        <button className="rl-btn" onClick={() => downloadMarkdown(a)}>
          ↓ Export .md
        </button>
      </div>

      {versusOpen && (
        <div className="rl-vs-picker">
          <div className="rl-eyebrow">Compare against</div>
          <div className="row">
            <input
              className="rl-url"
              placeholder="owner/repo or URL…"
              value={vsInput}
              onChange={(e) => setVsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && vsHit) startVersus(vsHit.platform, vsHit.repoId);
              }}
            />
            <button
              className="rl-btn rl-btn--primary"
              disabled={!vsHit}
              onClick={() => vsHit && startVersus(vsHit.platform, vsHit.repoId)}
            >
              Compare
            </button>
          </div>
          {vsCandidates.length > 0 && (
            <div className="rl-pills" style={{ marginTop: 10 }}>
              {vsCandidates.map((r) => (
                <button
                  key={r.repo_id}
                  className="rl-pill"
                  onClick={() => startVersus(r.platform, r.repo_id)}
                >
                  {r.repo_id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── core body ── */}
      {a.eli5 && (
        <Card title="In plain English" className="rl-card--lead">
          <p className="rl-prose rl-prose--lg">{a.eli5}</p>
        </Card>
      )}

      {a.analogies?.length > 0 && (
        <Card title="Analogies">
          <ul className="rl-list">
            {a.analogies.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Card>
      )}

      {a.technical && (
        <Card title="How it works">
          <p className="rl-prose">{a.technical}</p>
        </Card>
      )}

      {(useCases || skipIf) && (
        <div className="rl-grid">
          {useCases && (
            <Card title="Reach for it when">
              <div className="rl-kv">
                {Object.entries(a.use_cases)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div className="rl-kv-row" key={k}>
                      <span className="rl-kv-key">{k.replace(/_/g, " ")}</span>
                      <span className="rl-kv-val">{v}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
          {skipIf && (
            <Card title="Skip it when">
              <div className="rl-kv">
                {Object.entries(a.skip_if)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div className="rl-kv-row" key={k}>
                      <span className="rl-kv-key">{k.replace(/_/g, " ")}</span>
                      <span className="rl-kv-val">{v}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {(a.pros?.length > 0 || a.cons?.length > 0) && (
        <div className="rl-grid">
          {a.pros?.length > 0 && (
            <section className="rl-card rl-pc rl-pc--pro">
              <Eyebrow>Pros</Eyebrow>
              <ul>
                {a.pros.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
          )}
          {a.cons?.length > 0 && (
            <section className="rl-card rl-pc rl-pc--con">
              <Eyebrow>Cons</Eyebrow>
              <ul>
                {a.cons.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {a.enables && (
        <Card title="What it unlocks">
          <p className="rl-prose">{a.enables}</p>
        </Card>
      )}

      {a.alternatives?.length > 0 && (
        <Card title="Alternatives">
          <ul className="rl-list">
            {a.alternatives.map((alt, i) => (
              <li key={i}>
                <b>{alt.name}</b> <span className="sub">— {alt.when}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.health?.summary && (
        <Card title="Maintenance health">
          <p className="rl-prose">{a.health.summary}</p>
        </Card>
      )}

      {a.red_flags?.length > 0 && (
        <Card title="Signals">
          <div className="rl-flags">
            {a.red_flags.map((f, i) => (
              <div key={i} className={`rl-flag rl-flag--${f.severity === "ok" ? "ok" : "warn"}`}>
                <span className="glyph">{f.severity === "ok" ? "✓" : "⚠"}</span>
                <span className="t">
                  <b>{f.title}</b> <span>— {f.text}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {a.start_here?.length > 0 && (
        <Card title="Start here">
          <div className="rl-steps">
            {a.start_here.map((s, i) => (
              <div className="rl-step" key={i}>
                <span className="rl-step-num">{i + 1}</span>
                <span className="body">
                  <b>
                    {s.icon} {s.title}
                  </b>
                  {s.tag && <span className="tag">{s.tag}</span>}
                  <br />
                  {s.desc}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(a.tech_stack?.built_with?.length > 0 || a.tech_stack?.key_dependencies?.length > 0) && (
        <Card title="Tech stack">
          {a.languages && a.languages.length > 0 && (
            <>
              <div className="rl-langbar">
                {a.languages.map((l, i) => (
                  <span
                    key={l.name}
                    style={{ width: `${l.pct}%`, background: LANG_COLORS[i % LANG_COLORS.length] }}
                  />
                ))}
              </div>
              <div className="rl-lang-legend">
                {a.languages.map((l, i) => (
                  <span className="it" key={l.name}>
                    <span className="dot" style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} />
                    {l.name} {l.pct}%
                  </span>
                ))}
              </div>
            </>
          )}
          {a.tech_stack.built_with?.length > 0 && (
            <div className="rl-pills" style={{ marginBottom: 12 }}>
              {a.tech_stack.built_with.map((b, i) => (
                <span className="rl-pill" key={i}>
                  {b}
                </span>
              ))}
            </div>
          )}
          {a.tech_stack.key_dependencies?.length > 0 && (
            <div className="rl-deps">
              {a.tech_stack.key_dependencies.map((d, i) => (
                <div className="rl-dep" key={i}>
                  <code>{d.name}</code> {d.purpose}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {(a.capabilities?.length > 0 || a.tags?.length > 0) && (
        <Card title="Capabilities & tags">
          <div className="rl-pills">
            {a.capabilities.map((c) => (
              <span key={`c-${c}`} className="rl-pill rl-pill--cap">
                {c}
              </span>
            ))}
            {a.tags.map((t) => (
              <span key={`t-${t}`} className="rl-pill">
                {t}
              </span>
            ))}
          </div>
        </Card>
      )}

      {a.highlights?.length > 0 && (
        <Card title="Highlights">
          <div className="rl-hl">
            {a.highlights.map((h, i) => (
              <div className="rl-hl-item" key={i}>
                <div className="txt">
                  <span className={`rl-hl-sev rl-sev-${h.severity}`}>{h.severity}</span> {h.text}
                </div>
                {h.why && <div className="why">{h.why}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── deeper analysis (lens results) ── */}
      {(lenses.deepdive || lenses.sktpg || lenses.synergies || lenses.versus) && (
        <>
          {lenses.deepdive && <DeepDivePanel d={lenses.deepdive} />}
          {lenses.sktpg && <SktpgPanel s={lenses.sktpg} />}
          {lenses.synergies && <SynergiesPanel s={lenses.synergies} />}
          {lenses.versus && <VersusPanel v={lenses.versus} aId={repoId} />}
        </>
      )}
    </div>
  );
}
