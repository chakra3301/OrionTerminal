import type { Sktpg } from "../types";

export function SktpgPanel({ s }: { s: Sktpg }) {
  return (
    <section className="rl-card rl-lens-panel">
      <div className="rl-eyebrow">
        SKTPG · {s.score.value}/100 · {s.score.band}
      </div>

      <ul className="rl-list">
        {s.thesis.becoming && (
          <li>
            <b>Becoming</b> <span className="sub">— {s.thesis.becoming}</span>
          </li>
        )}
        {s.thesis.forced_next && (
          <li>
            <b>Forced next</b> <span className="sub">— {s.thesis.forced_next}</span>
          </li>
        )}
        {s.thesis.opportunity && (
          <li>
            <b>Opportunity</b> <span className="sub">— {s.thesis.opportunity}</span>
          </li>
        )}
        {s.thesis.before_consensus && (
          <li>
            <b>Before consensus</b> <span className="sub">— {s.thesis.before_consensus}</span>
          </li>
        )}
        {s.thesis.wrong_if && (
          <li>
            <b>Wrong if</b> <span className="sub">— {s.thesis.wrong_if}</span>
          </li>
        )}
      </ul>

      {(s.forecast.base || s.forecast.bull || s.forecast.bear) && (
        <>
          <div className="sub-h">Forecast</div>
          <ul className="rl-list">
            {s.forecast.base && (
              <li>
                <b>Base</b> <span className="sub">— {s.forecast.base}</span>
              </li>
            )}
            {s.forecast.bull && (
              <li>
                <b>Bull</b> <span className="sub">— {s.forecast.bull}</span>
              </li>
            )}
            {s.forecast.bear && (
              <li>
                <b>Bear</b> <span className="sub">— {s.forecast.bear}</span>
              </li>
            )}
            {s.forecast.wildcard && (
              <li>
                <b>Wildcard</b> <span className="sub">— {s.forecast.wildcard}</span>
              </li>
            )}
          </ul>
        </>
      )}

      {s.premortem.length > 0 && (
        <>
          <div className="sub-h">Pre-mortem</div>
          <ul className="rl-list">
            {s.premortem.map((p, i) => (
              <li key={i}>
                <span className="sub">[{p.likelihood}]</span> {p.kill_path}
                {p.survives ? <span className="sub"> (survivable)</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {s.actions.length > 0 && (
        <>
          <div className="sub-h">Actions</div>
          <ul className="rl-list">
            {s.actions.map((a, i) => (
              <li key={i}>
                <b>{a.timeframe}</b> <span className="sub">— {a.action} · {a.why_now}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
