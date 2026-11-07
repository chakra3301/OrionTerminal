/** Commands that only the standalone app adds: palette, settings, views, panels. */
import { message } from "@tauri-apps/plugin-dialog";
import { registry, type Command } from "@/commands/registry";
import { useArchives, type ArchivesView } from "@/apps/archives/useArchives";
import { archivesPanelToggles } from "@/apps/archives/chatBridge";
import { ABOUT_TEXT, APP_NAME } from "./brand";
import { usePalette } from "./ArchivesPalette";
import { useArchivesSettings } from "./ArchivesSettings";

export const STANDALONE_OWNER = "@archives47/app";

const VIEWS: Array<{ view: ArchivesView; label: string; hotkey?: string }> = [
  { view: "today", label: "Today", hotkey: "mod+1" },
  { view: "journal", label: "Journal", hotkey: "mod+2" },
  { view: "notes", label: "Notes", hotkey: "mod+3" },
  { view: "projects", label: "Projects", hotkey: "mod+4" },
  { view: "mood", label: "Mood Boards", hotkey: "mod+5" },
  { view: "media", label: "Media", hotkey: "mod+6" },
  { view: "brain", label: "Brain", hotkey: "mod+7" },
  { view: "learn", label: "Learn", hotkey: "mod+8" },
  { view: "repolens", label: "RepoLens", hotkey: "mod+9" },
  { view: "chats", label: "Past Chats" },
  { view: "favorites", label: "Favorites" },
  { view: "downloads", label: "Downloads" },
];

export function standaloneCommands(): Command[] {
  return [
    {
      id: "archives47.palette",
      label: "Search Archives…",
      hotkey: "mod+k",
      keywords: ["search", "find", "palette", "command"],
      group: "View",
      run: () => (usePalette.getState().open ? usePalette.getState().hide() : usePalette.getState().show()),
    },
    {
      id: "archives47.settings",
      label: "Settings…",
      hotkey: "mod+comma",
      keywords: ["settings", "preferences", "providers", "ai"],
      group: "View",
      run: () => useArchivesSettings.getState().show(),
    },
    {
      id: "archives47.about",
      label: `About ${APP_NAME}`,
      keywords: ["about", "version"],
      group: "View",
      run: () => void message(ABOUT_TEXT, { title: APP_NAME, kind: "info" }),
    },
    ...VIEWS.map(({ view, label, hotkey }): Command => ({
      id: `archives47.view.${view}`,
      label,
      hotkey,
      keywords: ["go", "open", "view", view],
      group: "View",
      run: () => useArchives.getState().setView(view),
    })),
    {
      id: "archives47.toggleSidebar",
      label: "Toggle Sidebar",
      hotkey: "mod+backslash",
      keywords: ["sidebar", "panel"],
      group: "View",
      run: () => archivesPanelToggles()?.toggleSidebar(),
    },
    {
      id: "archives47.toggleChat",
      label: "Toggle Archive Assistant",
      hotkey: "mod+shift+backslash",
      keywords: ["assistant", "ai", "chat", "rail"],
      group: "View",
      run: () => archivesPanelToggles()?.toggleChat(),
    },
  ];
}

export function installStandaloneCommands(): () => void {
  const disposers = standaloneCommands().map((c) => registry.register(c, STANDALONE_OWNER));
  return () => disposers.forEach((d) => d());
}
