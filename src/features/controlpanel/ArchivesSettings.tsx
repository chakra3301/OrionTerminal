import { useEffect } from "react";
import { ModelSelect } from "@/components/ModelSelect";
import { useRepoLens } from "@/apps/archives/repolens/useRepoLens";
import { TONES } from "@/apps/archives/repolens/tone";
import { AppEditor, ACCENT_RGB } from "./AppEditor";

// ── Archives 47 ─────────────────────────────────────────────────────────────

export function ArchivesSettings() {
  const tone = useRepoLens((s) => s.tone);
  const setTone = useRepoLens((s) => s.setTone);
  const hydratePrefs = useRepoLens((s) => s.hydratePrefs);
  useEffect(() => { void hydratePrefs(); }, [hydratePrefs]);

  return (
    <div>
      <AppEditor app="archives" surface="archives" />

      <div className="cp-eyebrow">Learn — AI tutor</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.archives }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Tutor model</div>
            <div className="cp-card-sub">Drives lessons, knowledge graph & Feynman checks</div>
            <div className="cp-cli-status">
              <ModelSelect surface="learn" />
            </div>
          </div>
        </div>
      </div>

      <div className="cp-eyebrow">RepoLens</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.archives }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Analysis voice</div>
            <div className="cp-card-sub">{TONES.find((t) => t.key === tone)?.blurb ?? tone}</div>
            <div className="cp-cli-status">
              <select className="ot-model-select" value={tone} onChange={(e) => setTone(e.target.value)}>
                {TONES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
