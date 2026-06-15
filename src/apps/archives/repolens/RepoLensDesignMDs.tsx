import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe, RefreshCw, Copy, Download } from "lucide-react";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { useRepoLens } from "./useRepoLens";
import { parseDesignSpec, designSpecToMarkdown, type DesignSpec } from "./designSpec";
import type { WebsiteRipRow } from "./repolensWebsitesDb";
import { toast } from "@/store/toastStore";

function age(ms: number | null): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RepoLensDesignMDs() {
  const rips = useRepoLensWebsites((s) => s.rips);
  const withDesign = rips.filter((r) => r.design_json != null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = withDesign.find((r) => r.id === openId) ?? null;

  if (open) return <DesignSpecBoard row={open} onBack={() => setOpenId(null)} />;

  if (withDesign.length === 0) {
    return (
      <div className="rl-empty">
        <Globe />
        <h2>No design MDs yet</h2>
        <p>
          Extract a design MD from a finished clone in the Rips tab — RepoLens
          reverse-engineers its color system, typography, and components.
        </p>
      </div>
    );
  }

  return (
    <div className="rl-lib-grid">
      {withDesign.map((r) => {
        const thumb = r.thumbnail_path ? convertFileSrc(r.thumbnail_path) : null;
        return (
          <div key={r.id} className="rl-web-card rl-web-done" onClick={() => setOpenId(r.id)}>
            <div className="rl-web-thumb">
              {thumb ? <img src={thumb} alt={r.hostname} /> : <div className="rl-web-thumb-empty"><Globe /></div>}
              <span className="rl-web-badge rl-web-badge--done">Design MD</span>
            </div>
            <div className="rl-web-meta">
              <span className="rl-web-host">{r.hostname}</span>
              <span className="rl-dm-age">{age(r.design_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DesignSpecBoard({ row, onBack }: { row: WebsiteRipRow; onBack: () => void }) {
  const extractDesign = useRepoLensWebsites((s) => s.extractDesign);
  const extracting = useRepoLensWebsites((s) => s.extracting.has(row.id));
  const model = useRepoLens((s) => s.model.default_model);
  const thumb = row.thumbnail_path ? convertFileSrc(row.thumbnail_path) : null;

  let spec: DesignSpec | null = null;
  try {
    spec = row.design_json ? parseDesignSpec(row.design_json) : null;
  } catch {
    spec = null;
  }

  if (!spec) {
    return (
      <div className="rl-dm-board">
        <button className="rl-btn" onClick={onBack}>← Design MDs</button>
        <div className="rl-error">Could not parse this design spec. Try re-extracting.</div>
      </div>
    );
  }

  const copyMd = async () => {
    await navigator.clipboard.writeText(designSpecToMarkdown(spec!));
    toast.success("Markdown copied");
  };
  const downloadMd = () => {
    const blob = new Blob([designSpecToMarkdown(spec!)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.hostname.replace(/[^a-z0-9.-]/gi, "-")}-design.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rl-dm-board">
      <div className="rl-dm-toolbar">
        <button className="rl-btn" onClick={onBack}>← Design MDs</button>
        <div className="rl-dm-actions">
          <button className="rl-btn" disabled={extracting} onClick={() => void extractDesign(row.id, model)}>
            <RefreshCw size={13} /> {extracting ? "Re-extracting…" : "Re-extract"}
          </button>
          <button className="rl-btn" onClick={() => void copyMd()}><Copy size={13} /> Copy .md</button>
          <button className="rl-btn" onClick={downloadMd}><Download size={13} /> Download .md</button>
        </div>
      </div>

      <section className="rl-card rl-dm-hero">
        {thumb && <img className="rl-dm-hero-thumb" src={thumb} alt={row.hostname} />}
        <div>
          <div className="rl-eyebrow">{row.hostname}</div>
          <h1 className="rl-dm-title">{spec.title || row.hostname}</h1>
          {spec.aesthetic && <p className="rl-dm-aesthetic">{spec.aesthetic}</p>}
        </div>
      </section>

      {spec.designLanguage && (
        <section className="rl-card"><div className="rl-eyebrow">Design Language</div><p>{spec.designLanguage}</p></section>
      )}

      {spec.colors.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Color System</div>
          <div className="rl-dm-swatches">
            {spec.colors.map((c, i) => (
              <div key={i} className="rl-dm-swatch">
                <div className="rl-dm-swatch-chip" style={{ background: c.hex }} />
                <div className="rl-dm-swatch-name">{c.name}</div>
                <div className="rl-dm-swatch-hex">{c.hex}</div>
                <div className="rl-dm-swatch-role">{c.role}</div>
                {c.ramp && c.ramp.length > 0 && (
                  <div className="rl-dm-ramp">
                    {c.ramp.map((shade, j) => (
                      <span key={j} className="rl-dm-ramp-chip" style={{ background: shade }} title={shade} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.typography.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Typography</div>
          <div className="rl-dm-specimens">
            {spec.typography.map((t, i) => (
              <div key={i} className="rl-dm-specimen">
                <div
                  className="rl-dm-specimen-sample"
                  style={{
                    fontFamily: `${t.family}, ${t.fallback ?? "sans-serif"}`,
                    fontSize: t.sizePx ? `${Math.min(t.sizePx, 64)}px` : "32px",
                    fontWeight: t.weight ?? 400,
                  }}
                >
                  {t.sample || "Aa"}
                </div>
                <div className="rl-dm-specimen-meta">
                  <strong>{t.role}</strong> · {t.family}
                  {t.weight ? ` · ${t.weight}` : ""}
                  {t.sizePx ? ` · ${t.sizePx}px` : ""}
                  {t.usage ? ` · ${t.usage}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.components.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Components</div>
          <div className="rl-dm-components">
            {spec.components.map((c, i) => (
              <div key={i} className="rl-dm-component">
                {c.preview && (
                  <div className="rl-dm-component-preview">
                    <span
                      className={`rl-dm-prev rl-dm-prev--${c.preview.kind}`}
                      style={{
                        background: c.preview.fillHex,
                        color: c.preview.textHex,
                        borderRadius: c.preview.radiusPx != null ? `${c.preview.radiusPx}px` : undefined,
                      }}
                    >
                      {c.name}
                    </span>
                  </div>
                )}
                <div className="rl-dm-component-name">{c.name}</div>
                <div className="rl-dm-component-desc">{c.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.spacing.scale.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Spacing</div>
          <div className="rl-dm-bars">
            {spec.spacing.scale.map((n, i) => (
              <div key={i} className="rl-dm-bar-row">
                <span className="rl-dm-bar-label">{n}</span>
                <span className="rl-dm-bar" style={{ width: `${Math.min(n * 3, 300)}px` }} />
              </div>
            ))}
          </div>
          {spec.spacing.notes && <p className="rl-dm-notes">{spec.spacing.notes}</p>}
        </section>
      )}

      {([
        ["Motion", spec.motion],
        ["Responsive", spec.responsive],
        ["Imagery", spec.imagery],
        ["Voice", spec.voice],
        ["Rebuild Notes", spec.rebuildNotes],
      ] as [string, string][])
        .filter(([, body]) => body)
        .map(([heading, body]) => (
          <section key={heading} className="rl-card">
            <div className="rl-eyebrow">{heading}</div>
            <p>{body}</p>
          </section>
        ))}
    </div>
  );
}
