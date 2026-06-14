import { useEffect, useState } from "react";
import { ScanSearch, Globe } from "lucide-react";
import { useRepoLens } from "./useRepoLens";
import { RepoLensReport } from "./RepoLensReport";
import { RepoLensPickers } from "./RepoLensPickers";
import { RepoLensLibrary } from "./RepoLensLibrary";
import { RepoLensCombinator } from "./RepoLensCombinator";
import { RepoLensScanTray } from "./RepoLensScanTray";
import { RepoLensWebsitesLibrary } from "./RepoLensWebsitesLibrary";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { resolveInput } from "./fetch";

export function RepoLensView() {
  const { input, setInput, current, error, scan, closeReport, model } = useRepoLens();
  const combinatorOpen = useRepoLens((s) => s.combinatorOpen);
  const hit = resolveInput(input);

  const [tab, setTab] = useState<"repos" | "websites">("repos");
  const [webInput, setWebInput] = useState("");
  const rip = useRepoLensWebsites((s) => s.rip);

  useEffect(() => {
    void useRepoLens.getState().hydratePrefs();
  }, []);

  return (
    <div className="rl-view">
      <div className="rl-tabs">
        <button className={tab === "repos" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setTab("repos")}>Repos</button>
        <button className={tab === "websites" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setTab("websites")}>Websites</button>
      </div>

      <div className="rl-scanbar">
        {tab === "websites" && !current ? (
          <>
            <div className="rl-scan-field">
              <Globe size={15} />
              <input
                className="rl-url"
                placeholder="Paste a URL…"
                value={webInput}
                onChange={(e) => setWebInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rip(webInput, model.default_model);
                }}
              />
            </div>
            <RepoLensPickers />
            <button className="rl-btn rl-btn--primary" onClick={() => void rip(webInput, model.default_model)}>
              Rip
            </button>
          </>
        ) : (
          <>
            <div className="rl-scan-field">
              <ScanSearch size={15} />
              <input
                className="rl-url"
                placeholder="Paste a GitHub / GitLab / npm / PyPI URL or owner/repo…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hit) scan(input);
                }}
              />
            </div>
            <RepoLensPickers />
            <button className="rl-btn rl-btn--primary" disabled={!hit} onClick={() => scan(input)}>
              Scan
            </button>
            {current && (
              <button className="rl-btn" onClick={closeReport}>
                ← Library
              </button>
            )}
          </>
        )}
      </div>

      {tab === "repos" && <RepoLensScanTray />}

      {error && <div className="rl-error">{error}</div>}

      <div className="rl-body">
        {current ? (
          <RepoLensReport a={current} />
        ) : tab === "websites" ? (
          <RepoLensWebsitesLibrary />
        ) : combinatorOpen ? (
          <RepoLensCombinator />
        ) : (
          <RepoLensLibrary />
        )}
      </div>
    </div>
  );
}
