import type { Sktpg } from "../types";

export function SktpgPanel({ s }: { s: Sktpg }) {
  return (
    <div className="rl-section">
      <h3>
        SKTPG — {s.score.value}/100 · {s.score.band}
      </h3>
      <p>
        <strong>Becoming:</strong> {s.thesis.becoming}
      </p>
      <p>
        <strong>Forced next:</strong> {s.thesis.forced_next}
      </p>
      <p>
        <strong>Opportunity:</strong> {s.thesis.opportunity}
      </p>
      <p>
        <strong>Before consensus:</strong> {s.thesis.before_consensus}
      </p>
      <p>
        <strong>Wrong if:</strong> {s.thesis.wrong_if}
      </p>

      {(s.forecast.base || s.forecast.bull || s.forecast.bear) && (
        <>
          <h3 style={{ marginTop: 14 }}>Forecast</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <strong>Base:</strong> {s.forecast.base}
            </li>
            <li>
              <strong>Bull:</strong> {s.forecast.bull}
            </li>
            <li>
              <strong>Bear:</strong> {s.forecast.bear}
            </li>
            <li>
              <strong>Wildcard:</strong> {s.forecast.wildcard}
            </li>
          </ul>
        </>
      )}
      {s.premortem.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Pre-mortem</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.premortem.map((p, i) => (
              <li key={i}>
                [{p.likelihood}] {p.kill_path}
                {p.survives ? " (survivable)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.actions.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Actions</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.actions.map((a, i) => (
              <li key={i}>
                <strong>{a.timeframe}:</strong> {a.action} — {a.why_now}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
