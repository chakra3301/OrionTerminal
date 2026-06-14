import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe } from "lucide-react";
import { useContextMenu } from "@/components/ContextMenu";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { RepoLensWebsiteProgress } from "./RepoLensWebsiteProgress";
import { phaseLabel } from "./websiteRip";
import type { WebsiteRipRow, WebsiteStatus } from "./repolensWebsitesDb";

export function RepoLensWebsitesLibrary() {
  const { rips, loaded, load, remove, continueRip, openInOrion } =
    useRepoLensWebsites();
  const { openAt, menu } = useContextMenu();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = rips.find(
    (r) => r.status === "running" || r.status === "paused",
  );

  if (loaded && rips.length === 0) {
    return (
      <div className="rl-empty">
        <Globe />
        <h2>Clone any website</h2>
        <p>
          Paste a URL above and hit Rip. RepoLens reverse-engineers it into an
          editable Next.js project, saved here with a preview.
        </p>
        <p className="rl-web-legal">
          For learning and personal use only — do not use clones to impersonate,
          phish, or violate a site's terms.
        </p>
      </div>
    );
  }

  return (
    <>
      {active && <RepoLensWebsiteProgress rip={active} />}
      <div className="rl-lib-grid">
        {rips.map((r) => (
          <WebsiteCard
            key={r.id}
            r={r}
            onOpen={() => {
              if (r.status === "done") void openInOrion(r.id);
            }}
            onMenu={(e) =>
              openAt(e, [
                {
                  label: "Open in Orion",
                  onClick: () => void openInOrion(r.id),
                  disabled: r.status !== "done",
                },
                {
                  label: "Continue",
                  onClick: () => void continueRip(r.id),
                  disabled: r.status !== "paused",
                },
                { type: "separator" },
                {
                  label: "Delete",
                  danger: true,
                  onClick: () => void remove(r.id),
                },
              ])
            }
          />
        ))}
      </div>
      {menu}
    </>
  );
}

function WebsiteCard({
  r,
  onOpen,
  onMenu,
}: {
  r: WebsiteRipRow;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const thumb = r.thumbnail_path ? convertFileSrc(r.thumbnail_path) : null;
  return (
    <div
      className={`rl-web-card rl-web-${r.status}`}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <div className="rl-web-thumb">
        {thumb ? (
          <img src={thumb} alt={r.hostname} />
        ) : (
          <div className="rl-web-thumb-empty">
            <Globe />
          </div>
        )}
        <span className={`rl-web-badge rl-web-badge--${r.status}`}>
          {r.status === "running" ? phaseLabel(r.phase) : statusLabel(r.status)}
        </span>
      </div>
      <div className="rl-web-meta">
        <span className="rl-web-host">{r.hostname}</span>
      </div>
    </div>
  );
}

function statusLabel(s: WebsiteStatus): string {
  return {
    queued: "Queued",
    running: "Running",
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
    paused: "Paused",
  }[s];
}
