import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe, FileText } from "lucide-react";
import { useContextMenu } from "@/components/ContextMenu";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { useRepoLens } from "./useRepoLens";
import { RepoLensWebsiteProgress } from "./RepoLensWebsiteProgress";
import { RepoLensDesignMDs } from "./RepoLensDesignMDs";
import { phaseLabel } from "./websiteRip";
import type { WebsiteRipRow, WebsiteStatus } from "./repolensWebsitesDb";

export function RepoLensWebsitesLibrary() {
  const { rips, loaded, load, remove, continueRip, openInOrion, extractDesign } =
    useRepoLensWebsites();
  const extractingSet = useRepoLensWebsites((s) => s.extracting);
  const model = useRepoLens((s) => s.model.default_model);
  const { openAt, menu } = useContextMenu();
  const [webSub, setWebSub] = useState<"rips" | "designs">("rips");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = rips.find((r) => r.status === "running" || r.status === "paused");

  const subTabs = (
    <div className="rl-tabs rl-tabs--sub">
      <button className={webSub === "rips" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setWebSub("rips")}>Rips</button>
      <button className={webSub === "designs" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setWebSub("designs")}>Design MDs</button>
    </div>
  );

  if (webSub === "designs") {
    return (
      <>
        {subTabs}
        <RepoLensDesignMDs />
      </>
    );
  }

  if (loaded && rips.length === 0) {
    return (
      <>
        {subTabs}
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
      </>
    );
  }

  return (
    <>
      {subTabs}
      {active && <RepoLensWebsiteProgress rip={active} />}
      <div className="rl-lib-grid">
        {rips.map((r) => (
          <WebsiteCard
            key={r.id}
            r={r}
            extracting={extractingSet.has(r.id)}
            onOpen={() => {
              if (r.status === "done") void openInOrion(r.id);
            }}
            onExtract={() => void extractDesign(r.id, model)}
            onMenu={(e) =>
              openAt(e, [
                {
                  label: "Open in Orion",
                  onClick: () => void openInOrion(r.id),
                  disabled: r.status !== "done",
                },
                {
                  label: r.design_json ? "Re-extract MD" : "Extract MD",
                  onClick: () => void extractDesign(r.id, model),
                  disabled: r.status !== "done" || extractingSet.has(r.id),
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
  extracting,
  onOpen,
  onExtract,
  onMenu,
}: {
  r: WebsiteRipRow;
  extracting: boolean;
  onOpen: () => void;
  onExtract: () => void;
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
        {r.design_json && (
          <span className="rl-web-badge rl-dm-marker" title="Has a design MD">
            <FileText size={11} />
          </span>
        )}
      </div>
      <div className="rl-web-meta">
        <span className="rl-web-host">{r.hostname}</span>
        {r.status === "done" && (
          <button
            className="rl-btn rl-dm-extract-btn"
            disabled={extracting}
            onClick={(e) => {
              e.stopPropagation();
              onExtract();
            }}
          >
            {extracting ? "Extracting…" : r.design_json ? "Re-extract MD" : "Extract MD"}
          </button>
        )}
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
