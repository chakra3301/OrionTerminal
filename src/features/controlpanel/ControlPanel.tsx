import { Suspense, lazy, useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { useControlPanel, type CpSection } from "@/store/controlPanelStore";
import { useAppDescriptors } from "@/plugins/appRegistry";
import { ProvidersPanel } from "./ProvidersPanel";
import { useControlPanelFocus } from "./useControlPanelFocus";
import { ThemeBorder } from "@/components/effects/ThemeBorder";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { AgentForge } from "./AgentForge";
import { PluginManagerPanel } from "./PluginManagerPanel";
import { APIKeySection, ThemeSection, WallpaperSection, McpSection, ShortcutsSection, AboutSection } from "@/features/settings/SettingsPanel";
import { AccountSection } from "@/features/auth/AccountSection";
import { OrionSettings, ArchivesSettings, XDesignSettings } from "./AppSettingsPanels";
const CharacterPicker = lazy(() =>
  import("@/features/characters/CharacterPicker").then((m) => ({
    default: m.CharacterPicker,
  })),
);
import { X, Cpu, Hammer, Sparkles, KeyRound, Palette, Image as ImageIcon, Plug, Keyboard, Info, ShieldCheck, Code2, BookOpen, PenTool, Users, Package, SlidersHorizontal } from "lucide-react";
import "./controlpanel.css";
import "./settingsExperience.css";

const NAV: { key: CpSection; label: string; Icon: LucideIcon }[] = [
  { key: "plugins", label: "Plugins", Icon: Package },
  { key: "providers", label: "Providers", Icon: Cpu },
  { key: "agents", label: "Agent Forge", Icon: Hammer },
  { key: "skills", label: "Skill Library", Icon: Sparkles },
  { key: "app-orion", label: "Orion", Icon: Code2 },
  { key: "app-archives", label: "Archives 47", Icon: BookOpen },
  { key: "app-xdesign", label: "XDesign", Icon: PenTool },
  { key: "account", label: "Account", Icon: ShieldCheck },
  { key: "key", label: "API Keys", Icon: KeyRound },
  { key: "theme", label: "Appearance", Icon: Palette },
  { key: "wallpaper", label: "Wallpaper", Icon: ImageIcon },
  { key: "characters", label: "Characters", Icon: Users },
  { key: "mcp", label: "MCP Servers", Icon: Plug },
  { key: "shortcuts", label: "Shortcuts", Icon: Keyboard },
  { key: "about", label: "About", Icon: Info },
];

const NAV_GROUPS: { label: string; sections: CpSection[] }[] = [
  { label: "Workspace", sections: ["theme", "wallpaper", "characters"] },
  { label: "Intelligence", sections: ["providers", "agents", "skills", "key", "mcp"] },
  { label: "Applications", sections: ["app-orion", "app-archives", "app-xdesign", "plugins"] },
  { label: "Personal", sections: ["account", "shortcuts", "about"] },
];

const APP_SETTINGS_SECTION: Partial<Record<CpSection, string>> = {
  "app-orion": "orion",
  "app-archives": "archives",
  "app-xdesign": "xdesign",
};

export function ControlPanel() {
  const open = useControlPanel((s) => s.open);
  const section = useControlPanel((s) => s.section);
  const setSection = useControlPanel((s) => s.setSection);
  const hide = useControlPanel((s) => s.hide);
  const appDescriptors = useAppDescriptors();
  const enabledApps = new Set(appDescriptors.map((descriptor) => descriptor.id));
  const nav = NAV.filter((item) => {
    const appId = APP_SETTINGS_SECTION[item.key];
    return !appId || enabledApps.has(appId);
  });

  useEffect(() => {
    if (!nav.some((item) => item.key === section)) setSection("plugins");
  }, [nav, section, setSection]);

  const surfaceRef = useControlPanelFocus(open, hide);

  if (!open) return null;

  return (
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="cp-surface" ref={surfaceRef} role="dialog" aria-modal="true" aria-label="Control Panel" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <ThemeBorder />
        <aside className="cp-rail">
          <div className="cp-rail-brand"><span><SlidersHorizontal size={17} /></span><div>Settings<small>Orion Terminal</small></div></div>
          <nav aria-label="Settings sections">
            {NAV_GROUPS.map(group => <div className="cp-rail-group" key={group.label}>
              <div className="cp-rail-group-label">{group.label}</div>
              {group.sections.flatMap(key => nav.filter(n => n.key === key)).map(n => <button type="button" key={n.key}
                className={`cp-rail-item${section === n.key ? " active" : ""}`} aria-current={section === n.key ? "page" : undefined}
                onClick={() => setSection(n.key)}><n.Icon size={15} strokeWidth={1.6} />{n.label}</button>)}
            </div>)}
          </nav>
        </aside>
        <main className="cp-main">
          <header className="cp-main-head">
            <div className="cp-head-location"><small>{NAV_GROUPS.find(g => g.sections.includes(section))?.label}</small><span>{nav.find(n => n.key === section)?.label}</span></div>
            <button className="cp-close" onClick={hide} aria-label="Close"><X size={14} /></button>
          </header>
          <div className="cp-main-body" key={section}>
            {section === "plugins" && <PluginManagerPanel />}
            {section === "providers" && <ProvidersPanel />}
            {section === "agents" && <AgentForge />}
            {section === "skills" && <SkillLibraryPanel />}
            {section === "app-orion" && <OrionSettings />}
            {section === "app-archives" && <ArchivesSettings />}
            {section === "app-xdesign" && <XDesignSettings />}
            {section === "account" && <AccountSection />}
            {section === "key" && <APIKeySection />}
            {section === "theme" && <ThemeSection />}
            {section === "wallpaper" && <WallpaperSection />}
            {section === "characters" && (
              <Suspense fallback={<div className="ot-settings-p">Loading…</div>}>
                <CharacterPicker />
              </Suspense>
            )}
            {section === "mcp" && <McpSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
