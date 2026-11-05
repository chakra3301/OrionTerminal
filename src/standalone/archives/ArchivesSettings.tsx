import { create } from "zustand";
import { BookOpen, Cpu, Database, Info, Keyboard, KeyRound, Palette, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { ProvidersPanel } from "@/features/controlpanel/ProvidersPanel";
import { ArchivesSettings as ArchivesAssistantSettings } from "@/features/controlpanel/ArchivesSettings";
import { APIKeySection } from "@/features/settings/ApiKeySection";
import { useControlPanelFocus } from "@/features/controlpanel/useControlPanelFocus";
import { APP_NAME } from "./brand";
import { AboutSection, GeneralSection, LibrarySection, ShortcutsSection } from "./settingsSections";
import "@/features/controlpanel/controlpanel.css";
import "@/features/controlpanel/settingsExperience.css";

export type SettingsSection = "general" | "providers" | "assistant" | "keys" | "library" | "shortcuts" | "about";

type SettingsState = { open: boolean; section: SettingsSection; show: (section?: SettingsSection) => void; hide: () => void };

export const useArchivesSettings = create<SettingsState>((set) => ({
  open: false,
  section: "general",
  show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  hide: () => set({ open: false }),
}));

const NAV: { key: SettingsSection; label: string; Icon: LucideIcon; group: string }[] = [
  { key: "general", label: "General", Icon: Palette, group: "App" },
  { key: "library", label: "Library", Icon: Database, group: "App" },
  { key: "shortcuts", label: "Shortcuts", Icon: Keyboard, group: "App" },
  { key: "providers", label: "AI Providers", Icon: Cpu, group: "AI" },
  { key: "assistant", label: "Archive Assistant", Icon: BookOpen, group: "AI" },
  { key: "keys", label: "API Keys", Icon: KeyRound, group: "AI" },
  { key: "about", label: "About", Icon: Info, group: "Help" },
];
const GROUPS = ["App", "AI", "Help"];

/** The standalone app's Settings window (⌘, or the sidebar Settings button). */
export function ArchivesSettingsWindow() {
  const open = useArchivesSettings((s) => s.open);
  const section = useArchivesSettings((s) => s.section);
  const hide = useArchivesSettings((s) => s.hide);
  const surfaceRef = useControlPanelFocus(open, hide);

  if (!open) return null;
  const current = NAV.find((n) => n.key === section);
  return (
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="cp-surface a47-settings" ref={surfaceRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <aside className="cp-rail">
          <div className="cp-rail-brand"><span><SlidersHorizontal size={17} /></span><div>Settings<small>{APP_NAME}</small></div></div>
          <nav aria-label="Settings sections">
            {GROUPS.map((g) => (
              <div className="cp-rail-group" key={g}>
                <div className="cp-rail-group-label">{g}</div>
                {NAV.filter((n) => n.group === g).map((n) => (
                  <button type="button" key={n.key}
                    className={`cp-rail-item${section === n.key ? " active" : ""}`} aria-current={section === n.key ? "page" : undefined}
                    onClick={() => useArchivesSettings.getState().show(n.key)}>
                    <n.Icon size={15} strokeWidth={1.6} />{n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <main className="cp-main">
          <header className="cp-main-head">
            <div className="cp-head-location"><small>Settings</small><span>{current?.label}</span></div>
            <button className="cp-close" onClick={hide} aria-label="Close"><X size={14} /></button>
          </header>
          <div className="cp-main-body" key={section}>
            {section === "providers" && <ProvidersPanel />}
            {section === "assistant" && <ArchivesAssistantSettings />}
            {section === "keys" && <APIKeySection />}
            {section === "general" && <GeneralSection />}
            {section === "library" && <LibrarySection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
