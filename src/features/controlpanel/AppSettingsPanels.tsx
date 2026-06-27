import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { ModelSelect } from "@/components/ModelSelect";
import { type ModelSurface } from "@/store/modelPrefsStore";
import { useAppConfig, APP_DEFAULTS, resolveConfig, type AppId } from "@/store/appConfigStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useMcpServers } from "@/store/mcpServersStore";
import { BUILTIN_TOOLS } from "@/features/agents/toolCatalog";
import type { ToolGrant } from "@/features/agents/agentTypes";
import { useTerminalStore } from "@/store/terminalStore";
import { useRepoLens } from "@/apps/archives/repolens/useRepoLens";
import { TONES } from "@/apps/archives/repolens/tone";
import { defaultImageModel, isImageProvider } from "@/apps/xdesign/imageGen";
import { useProvidersStore } from "@/store/providersStore";

// Per-app settings — every piece of each app's embedded-Claude identity is
// editable here, with on/off gates and reset-to-default. Skills & tool grants
// are toggled the same way and flow into the app's sends (appConfigStore).

const ACCENT_RGB: Record<AppId, string> = {
  orion: "var(--neon-cyan-rgb)",
  archives: "var(--neon-green-rgb)",
  xdesign: "var(--neon-magenta-rgb)",
};

function hasGrant(tools: ToolGrant[], g: ToolGrant): boolean {
  return tools.some(
    (t) =>
      (t.kind === "builtin" && g.kind === "builtin" && t.name === g.name) ||
      (t.kind === "mcp" && g.kind === "mcp" && t.server === g.server),
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`cp-badge ${on ? "live" : "wait"}`}
      style={{ cursor: "pointer", border: "none" }}
      onClick={onClick}
      aria-pressed={on}
    >
      {on ? "On" : "Off"} · {label}
    </button>
  );
}

function ResetBtn({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" className="cp-link" title={title} onClick={onClick}>
      <RotateCcw size={11} style={{ verticalAlign: "-1px" }} /> Reset
    </button>
  );
}

// ── Generic editor (used by all three apps) ─────────────────────────────────

function AppEditor({ app, surface }: { app: AppId; surface: ModelSurface }) {
  const cfg = useAppConfig((s) => s.configs[app]);
  const resolved = useMemo(() => resolveConfig(app, cfg), [app, cfg]);
  const patch = useAppConfig((s) => s.patch);
  const reset = useAppConfig((s) => s.reset);
  const def = APP_DEFAULTS[app];

  const skills = Array.from(useSkillsStore((s) => s.skills).values());
  const mcp = useMcpServers((s) => s.servers).filter((x) => x.enabled);

  // Local drafts for free-text fields → commit on blur (avoids a DB write per
  // keystroke). Re-seed if the resolved value changes underneath us.
  const [name, setName] = useState(resolved.name);
  const [subtitle, setSubtitle] = useState(resolved.subtitle);
  const [prompt, setPrompt] = useState(resolved.systemPrompt);
  const [opening, setOpening] = useState(resolved.openingLine);
  const [chips, setChips] = useState(resolved.chips.join("\n"));
  useEffect(() => {
    setName(resolved.name);
    setSubtitle(resolved.subtitle);
    setPrompt(resolved.systemPrompt);
    setOpening(resolved.openingLine);
    setChips(resolved.chips.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  const toggleSkill = (id: string) =>
    patch(app, {
      skillIds: cfg.skillIds.includes(id)
        ? cfg.skillIds.filter((s) => s !== id)
        : [...cfg.skillIds, id],
    });

  const toggleTool = (g: ToolGrant) => {
    const current = resolved.tools;
    patch(app, {
      toolsCustomized: true,
      tools: hasGrant(current, g) ? current.filter((t) => !hasGrant([t], g)) : [...current, g],
    });
  };

  return (
    <div style={{ ["--acc-rgb" as string]: ACCENT_RGB[app] }}>
      {/* Identity */}
      <div className="cp-eyebrow">Identity</div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-label">Assistant name</div>
        <input
          className="cp-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => patch(app, { name: name.trim() || undefined })}
        />
        <div className="cp-label">Subtitle</div>
        <input
          className="cp-input"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          onBlur={() => patch(app, { subtitle: subtitle.trim() || undefined })}
        />
        <div className="cp-label">Model</div>
        <div className="cp-cli-status">
          <ModelSelect surface={surface} />
        </div>
      </div>

      {/* System prompt */}
      <div className="cp-eyebrow">System prompt</div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-form-row" style={{ justifyContent: "space-between" }}>
          <Toggle
            on={cfg.systemPromptEnabled}
            label="apply on first turn"
            onClick={() => patch(app, { systemPromptEnabled: !cfg.systemPromptEnabled })}
          />
          <ResetBtn
            title="Restore the shipped system prompt"
            onClick={() => {
              patch(app, { systemPrompt: undefined });
              setPrompt(def.systemPrompt);
            }}
          />
        </div>
        <textarea
          className="cp-input"
          rows={7}
          value={prompt}
          disabled={!cfg.systemPromptEnabled}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => patch(app, { systemPrompt: prompt })}
        />
      </div>

      {/* Opening line */}
      <div className="cp-eyebrow">Opening line</div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-form-row" style={{ justifyContent: "space-between" }}>
          <Toggle
            on={cfg.openingLineEnabled}
            label="greet on empty chat"
            onClick={() => patch(app, { openingLineEnabled: !cfg.openingLineEnabled })}
          />
          <ResetBtn
            title="Restore the shipped opening line"
            onClick={() => {
              patch(app, { openingLine: undefined });
              setOpening(def.openingLine);
            }}
          />
        </div>
        <textarea
          className="cp-input"
          rows={3}
          value={opening}
          disabled={!cfg.openingLineEnabled}
          onChange={(e) => setOpening(e.target.value)}
          onBlur={() => patch(app, { openingLine: opening })}
        />
      </div>

      {/* Suggestion chips */}
      <div className="cp-eyebrow">Suggestion chips</div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-form-row" style={{ justifyContent: "space-between" }}>
          <Toggle
            on={cfg.chipsEnabled}
            label="show starter chips"
            onClick={() => patch(app, { chipsEnabled: !cfg.chipsEnabled })}
          />
          <ResetBtn
            title="Restore the shipped chips"
            onClick={() => {
              patch(app, { chips: undefined });
              setChips(def.suggestionChips.join("\n"));
            }}
          />
        </div>
        <div className="cp-label">One per line</div>
        <textarea
          className="cp-input"
          rows={4}
          value={chips}
          disabled={!cfg.chipsEnabled}
          onChange={(e) => setChips(e.target.value)}
          onBlur={() =>
            patch(app, {
              chips: chips.split("\n").map((c) => c.trim()).filter(Boolean),
            })
          }
        />
      </div>

      {/* Skills */}
      <div className="cp-eyebrow">
        Skills <span className="cp-count">{cfg.skillIds.length}</span>
      </div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-card-sub" style={{ marginBottom: 4 }}>
          Enabled skills inject their instructions (and grant their tools) on this app's
          chats.
        </div>
        <div className="cp-tool-grid">
          {skills.length === 0 && <div className="cp-card-sub">No skills yet — add them under Skill Library.</div>}
          {skills.map((s) => (
            <label key={s.id} className="cp-tool">
              <input
                type="checkbox"
                checked={cfg.skillIds.includes(s.id)}
                onChange={() => toggleSkill(s.id)}
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="cp-eyebrow">Tools</div>
      <div className="cp-form" style={{ marginBottom: 18 }}>
        <div className="cp-form-row" style={{ justifyContent: "space-between" }}>
          <Toggle
            on={cfg.toolsCustomized}
            label="restrict to selected"
            onClick={() => patch(app, { toolsCustomized: !cfg.toolsCustomized })}
          />
          {cfg.toolsCustomized && (
            <ResetBtn
              title="Clear restriction — allow all tools"
              onClick={() => patch(app, { toolsCustomized: false, tools: [] })}
            />
          )}
        </div>
        <div className="cp-card-sub">
          {cfg.toolsCustomized
            ? "Only the checked tools are offered to this app's Claude."
            : "Unrestricted — Claude may use any available tool. Turn on to limit."}
        </div>
        {cfg.toolsCustomized && (
          <div className="cp-tool-grid">
            {BUILTIN_TOOLS.map((t) => {
              const g: ToolGrant = { kind: "builtin", name: t.name };
              return (
                <label key={t.name} className="cp-tool">
                  <input type="checkbox" checked={hasGrant(resolved.tools, g)} onChange={() => toggleTool(g)} />
                  {t.label}
                </label>
              );
            })}
            {mcp.map((s) => {
              const g: ToolGrant = { kind: "mcp", server: s.name };
              return (
                <label key={s.id} className="cp-tool">
                  <input type="checkbox" checked={hasGrant(resolved.tools, g)} onChange={() => toggleTool(g)} />
                  MCP: {s.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="cp-form-actions">
        <button className="cp-btn ghost" onClick={() => reset(app)}>
          <RotateCcw size={12} style={{ verticalAlign: "-2px" }} /> Reset all to defaults
        </button>
      </div>
    </div>
  );
}

// ── Orion (editor) ──────────────────────────────────────────────────────────

export function OrionSettings() {
  const termOpen = useTerminalStore((s) => s.open);
  const termHeight = useTerminalStore((s) => s.height);
  return (
    <div>
      <AppEditor app="orion" surface="orion" />
      <div className="cp-eyebrow">Workspace</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.orion }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Integrated terminal</div>
            <div className="cp-card-sub">
              {termOpen ? "open" : "hidden"} · panel height {termHeight}%
            </div>
          </div>
          <span className={`cp-badge ${termOpen ? "live" : "wait"}`}>{termOpen ? "open" : "hidden"}</span>
        </div>
      </div>
    </div>
  );
}

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

// ── XDesign ─────────────────────────────────────────────────────────────────

export function XDesignSettings() {
  const providers = useProvidersStore((s) => s.providers);
  const imageProvider = providers.find((p) => p.enabled && isImageProvider(p));

  return (
    <div>
      <AppEditor app="xdesign" surface="xdesign" />

      <div className="cp-eyebrow">Image generation</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.xdesign }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Raster image model</div>
            <div className="cp-card-sub">
              {imageProvider
                ? `${imageProvider.name} · ${defaultImageModel(imageProvider.kind)}`
                : "No image-capable provider — add one under Providers"}
            </div>
          </div>
          <span className={`cp-badge ${imageProvider ? "live" : "wait"}`}>
            {imageProvider ? "ready" : "none"}
          </span>
        </div>
      </div>
    </div>
  );
}
