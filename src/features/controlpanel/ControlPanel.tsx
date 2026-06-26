import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { useControlPanel, type CpSection } from "@/store/controlPanelStore";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { AgentForge } from "./AgentForge";
import { APIKeySection, ThemeSection, WallpaperSection, McpSection, ShortcutsSection, AboutSection } from "@/features/settings/SettingsPanel";
import { AccountSection } from "@/features/auth/AccountSection";
import { X, Cpu, Hammer, Sparkles, KeyRound, Palette, Image as ImageIcon, Plug, Keyboard, Info, ShieldCheck } from "lucide-react";
import "./controlpanel.css";

const NAV: { key: CpSection; label: string; Icon: LucideIcon }[] = [
  { key: "providers", label: "Providers", Icon: Cpu },
  { key: "agents", label: "Agent Forge", Icon: Hammer },
  { key: "skills", label: "Skill Library", Icon: Sparkles },
  { key: "account", label: "Account", Icon: ShieldCheck },
  { key: "key", label: "API Keys", Icon: KeyRound },
  { key: "theme", label: "Appearance", Icon: Palette },
  { key: "wallpaper", label: "Wallpaper", Icon: ImageIcon },
  { key: "mcp", label: "MCP Servers", Icon: Plug },
  { key: "shortcuts", label: "Shortcuts", Icon: Keyboard },
  { key: "about", label: "About", Icon: Info },
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
          <div className="cp-rail-title">Control Panel</div>
          {NAV.map((n) => (
            <Fragment key={n.key}>
              {n.key === "account" && <div className="cp-rail-divider" />}
              <button
                className={`cp-rail-item${section === n.key ? " active" : ""}`}
                onClick={() => setSection(n.key)}
              >
                <n.Icon size={15} strokeWidth={1.75} />{n.label}
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
            {section === "account" && <AccountSection />}
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
