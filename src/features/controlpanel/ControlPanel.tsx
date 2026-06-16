import { Fragment } from "react";
import { useControlPanel, type CpSection } from "@/store/controlPanelStore";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { AgentForge } from "./AgentForge";
import { APIKeySection, ThemeSection, WallpaperSection, McpSection, ShortcutsSection, AboutSection } from "@/features/settings/SettingsPanel";
import { X } from "lucide-react";
import "./controlpanel.css";

const NAV: { key: CpSection; label: string; icon: string }[] = [
  { key: "providers", label: "Providers", icon: "🧠" },
  { key: "agents", label: "Agent Forge", icon: "⚒" },
  { key: "skills", label: "Skill Library", icon: "📚" },
  { key: "key", label: "API Keys", icon: "🔑" },
  { key: "theme", label: "Appearance", icon: "🎨" },
  { key: "wallpaper", label: "Wallpaper", icon: "🖼" },
  { key: "mcp", label: "MCP Servers", icon: "🔌" },
  { key: "shortcuts", label: "Shortcuts", icon: "⌨" },
  { key: "about", label: "About", icon: "ℹ" },
];

export function ControlPanel() {
  const open = useControlPanel((s) => s.open);
  const section = useControlPanel((s) => s.section);
  const setSection = useControlPanel((s) => s.setSection);
  const hide = useControlPanel((s) => s.hide);
  if (!open) return null;

  return (
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="cp-surface" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="cp-rail">
          <div className="cp-rail-title">⌃ Control Panel</div>
          {NAV.map((n) => (
            <Fragment key={n.key}>
              {n.key === "key" && <div className="cp-rail-divider" />}
              <button
                className={`cp-rail-item${section === n.key ? " active" : ""}`}
                onClick={() => setSection(n.key)}
              >
                <span className="cp-rail-icon">{n.icon}</span>{n.label}
              </button>
            </Fragment>
          ))}
        </aside>
        <main className="cp-main">
          <header className="cp-main-head">
            <span>{NAV.find((n) => n.key === section)?.label}</span>
            <button className="cp-close" onClick={hide} aria-label="Close"><X size={14} /></button>
          </header>
          <div className="cp-main-body">
            {section === "providers" && <ProvidersPanel />}
            {section === "agents" && <AgentForge />}
            {section === "skills" && <SkillLibraryPanel />}
            {section === "key" && <APIKeySection />}
            {section === "theme" && <ThemeSection />}
            {section === "wallpaper" && <WallpaperSection />}
            {section === "mcp" && <McpSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
