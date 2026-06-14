import { phaseLabel } from "./websiteRip";
import type { WebsiteRipRow } from "./repolensWebsitesDb";
import { useRepoLensWebsites } from "./useRepoLensWebsites";

export function RepoLensWebsiteProgress({ rip }: { rip: WebsiteRipRow }) {
  const cancel = useRepoLensWebsites((s) => s.cancel);
  const continueRip = useRepoLensWebsites((s) => s.continueRip);
  const lines = rip.log.split("\n").filter(Boolean).slice(-200);

  return (
    <div className="rl-web-progress">
      <div className="rl-web-progress-head">
        <span className="rl-web-host">{rip.hostname}</span>
        <span className="rl-web-phase">{phaseLabel(rip.phase)}</span>
        {rip.status === "running" && (
          <button
            type="button"
            className="rl-btn rl-btn--mini"
            onClick={() => void cancel(rip.id)}
          >
            Stop
          </button>
        )}
        {rip.status === "paused" && (
          <button
            type="button"
            className="rl-btn rl-btn--mini"
            onClick={() => void continueRip(rip.id)}
          >
            Continue
          </button>
        )}
      </div>
      <pre className="rl-web-feed">
        {lines.map((l, i) => (
          <div key={i} className={feedClass(l)}>
            {l}
          </div>
        ))}
      </pre>
    </div>
  );
}

function feedClass(line: string): string {
  if (line.startsWith("✗")) return "rl-feed-err";
  if (line.startsWith("▸")) return "rl-feed-tool";
  return "rl-feed-text";
}
