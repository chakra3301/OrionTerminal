import { create } from "zustand";
import { BookOpen, Cpu, Info, KeyRound, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { ProvidersPanel } from "@/features/controlpanel/ProvidersPanel";
import { ArchivesSettings as ArchivesAssistantSettings } from "@/features/controlpanel/ArchivesSettings";
import { APIKeySection } from "@/features/settings/ApiKeySection";
import { useControlPanelFocus } from "@/features/controlpanel/useControlPanelFocus";
import { APP_NAME, APP_TAGLINE } from "./brand";
import "@/features/controlpanel/controlpanel.css";
import "@/features/controlpanel/settingsExperience.css";
import { version as APP_VERSION } from "../../../package.json";

export type SettingsSection = "providers" | "assistant" | "keys" | "about";

type SettingsState = { open: boolean; section: SettingsSection; show: (section?: SettingsSection) => void; hide: () => void };

export const useArchivesSettings = create<SettingsState>((set) => ({
  open: false,
  section: "providers",
  show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  hide: () => set({ open: false }),
}));

const NAV: { key: SettingsSection; label: string; Icon: LucideIcon }[] = [
  { key: "providers", label: "AI Providers", Icon: Cpu },
  { key: "assistant", label: "Archive Assistant", Icon: BookOpen },
  { key: "keys", label: "API Keys", Icon: KeyRound },
  { key: "about", label: "About", Icon: Info },
];

function About() {
  return (
    <div className="cp-list">
      <div className="cp-card">
        <div className="cp-card-main">
          <div className="cp-card-title">{APP_NAME}</div>
          <div className="cp-card-sub">{APP_TAGLINE} · version {APP_VERSION}</div>
          <div className="cp-card-sub" style={{ marginTop: 8 }}>
            Your notes, journal, media and chats are stored on this Mac in {APP_NAME}'s own library. API keys
            live in the macOS Keychain under {APP_NAME}.
          </div>
        </div>
      </div>
    </div>
  );
}

/** AI-only settings window for the standalone app (⌘,). */
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
            <div className="cp-rail-group">
              {NAV.map((n) => (
                <button type="button" key={n.key}
                  className={`cp-rail-item${section === n.key ? " active" : ""}`} aria-current={section === n.key ? "page" : undefined}
                  onClick={() => useArchivesSettings.getState().show(n.key)}>
                  <n.Icon size={15} strokeWidth={1.6} />{n.label}
                </button>
              ))}
            </div>
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
            {section === "about" && <About />}
          </div>
        </main>
      </div>
    </div>
  );
}
