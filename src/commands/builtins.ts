import { open as openDialog, confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { registry } from "@/commands/registry";
import { useProjectStore } from "@/store/projectStore";
import { useTabsStore, isFileTabDirty } from "@/store/tabsStore";
import {
  useWorkspace,
  allTabs,
  activeTabInFocusedPanel,
  activeFilePathInFocused,
} from "@/components/workspace/workspaceStore";
import { useThemeStore } from "@/store/themeStore";
import { useFocusStore } from "@/store/focusStore";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useChatStore } from "@/store/chatStore";
import { useTerminalStore } from "@/store/terminalStore";
import { useKeybindingsStore } from "@/store/keybindingsStore";
import { useControlPanel } from "@/store/controlPanelStore";
import { useAutocomplete } from "@/store/autocompleteStore";
import { toast } from "@/store/toastStore";
import { useShell } from "@/shell/store/useShell";
import { useAuth } from "@/features/auth/authStore";
import { useHelp } from "@/features/help/helpStore";
import { useOnboarding } from "@/features/onboarding/onboardingStore";
import { ipc } from "@/lib/ipc";
import { listChatsForProject, logActivity } from "@/lib/db";
import { log } from "@/lib/log";

let installed = false;

async function saveFileBuffer(path: string): Promise<boolean> {
  const buf = useTabsStore.getState().fileBuffers[path];
  if (!buf?.loaded) return false;
  try {
    await ipc.saveFileAtomic(path, buf.contents);
    useTabsStore.getState().markSaved(path);
    void logActivity({
      source: "orion",
      kind: "file.save",
      title: path.split("/").pop() || path,
      refId: path,
    });
    // Keep the codebase semantic index fresh (lazy — module loads on
    // first save, debounced per path inside).
    void import("@/features/context/codebaseIndexer").then((m) =>
      m.scheduleCodeFileReindex(path),
    );
    return true;
  } catch (e) {
    log.error("save failed", path, e);
    return false;
  }
}

function focusedTab() {
  const ws = useWorkspace.getState();
  return activeTabInFocusedPanel(ws.root, ws.focusedPanelId);
}

function focusedFilePath() {
  const ws = useWorkspace.getState();
  return activeFilePathInFocused(ws.root, ws.focusedPanelId);
}

/** True when Orion is the focused window with a project open (its workspace is mounted). */
function orionFocused() {
  if (useProjectStore.getState().active === null) return false;
  const s = useShell.getState();
  return s.windows.find((w) => w.id === s.focusedWindowId)?.app === "orion";
}

export function installBuiltinCommands() {
  if (installed) return;
  installed = true;

  registry.register({
    id: "palette.open",
    label: "Open Spotlight",
    hotkey: "mod+k",
    group: "View",
    run: () => {
      const f = useFocusStore.getState();
      if (f.editorFocused && f.hasSelection) {
        void registry.run("claude.inlineEdit");
      } else {
        useShell.getState().openSpotlight();
      }
    },
  });

  registry.register({
    id: "palette.openCommands",
    label: "Spotlight: Commands Only",
    hotkey: "mod+shift+p",
    group: "View",
    run: () => useShell.getState().openSpotlight(),
  });

  registry.register({
    id: "file.openProject",
    label: "Open Project Folder…",
    keywords: ["folder", "project", "directory"],
    group: "File",
    run: async () => {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "Open project folder",
      });
      if (!picked || typeof picked !== "string") return;
      await useProjectStore.getState().openProjectAtPath(picked);
    },
  });

  registry.register({
    id: "project.switch",
    label: "Switch Project…",
    // ⌘⇧O went to Go to Symbol (Cursor/VS Code muscle memory) 2026-06-13.
    hotkey: "mod+t",
    keywords: ["project", "switch", "recent", "workspace"],
    group: "File",
    run: () => {
      // Refresh recents so the freshest list shows; then surface Spotlight,
      // where project entries appear at the top of the default list.
      void useProjectStore.getState().loadRecents();
      useShell.getState().openSpotlight();
    },
  });

  registry.register({
    id: "file.openFile",
    label: "Go to File…",
    keywords: ["file", "fuzzy", "quick", "open", "jump"],
    hotkey: "mod+p",
    group: "File",
    when: () => {
      if (useProjectStore.getState().active === null) return false;
      const t = focusedTab();
      return t?.descriptor.kind !== "note";
    },
    run: () => {
      // Editor-scoped frecency quick-open (Spotlight stays on ⌘K).
      void import("@/apps/orion/QuickOpen").then((m) =>
        m.useQuickOpen.getState().show(),
      );
    },
  });

  registry.register({
    id: "file.closeTab",
    label: "Close Tab",
    hotkey: "mod+w",
    group: "File",
    when: () => focusedTab() !== null,
    run: async () => {
      const tab = focusedTab();
      if (!tab) return;
      const buffers = useTabsStore.getState().fileBuffers;
      if (isFileTabDirty(tab, buffers)) {
        const ok = await confirmDialog(
          `${tab.label} has unsaved changes. Close anyway?`,
          { title: "Unsaved changes", kind: "warning" },
        );
        if (!ok) return;
      }
      useWorkspace.getState().closeTab(tab.id);
    },
  });

  registry.register({
    id: "file.nextTab",
    label: "Next Tab",
    hotkey: "mod+alt+right",
    group: "File",
    when: () => {
      const ws = useWorkspace.getState();
      const panel = ws.focusedPanelId
        ? ws.findPanel(ws.focusedPanelId)
        : null;
      return !!panel && panel.tabs.length > 1;
    },
    run: () => {
      const ws = useWorkspace.getState();
      if (ws.focusedPanelId) ws.cycleActive(ws.focusedPanelId, 1);
    },
  });

  registry.register({
    id: "file.prevTab",
    label: "Previous Tab",
    hotkey: "mod+alt+left",
    group: "File",
    when: () => {
      const ws = useWorkspace.getState();
      const panel = ws.focusedPanelId
        ? ws.findPanel(ws.focusedPanelId)
        : null;
      return !!panel && panel.tabs.length > 1;
    },
    run: () => {
      const ws = useWorkspace.getState();
      if (ws.focusedPanelId) ws.cycleActive(ws.focusedPanelId, -1);
    },
  });

  registry.register({
    id: "file.save",
    label: "Save File",
    hotkey: "mod+s",
    group: "File",
    when: () => {
      const tab = focusedTab();
      if (!tab) return false;
      return isFileTabDirty(tab, useTabsStore.getState().fileBuffers);
    },
    run: async () => {
      const path = focusedFilePath();
      if (!path) return;
      await saveFileBuffer(path);
    },
  });

  registry.register({
    id: "file.saveAll",
    label: "Save All",
    hotkey: "mod+shift+s",
    group: "File",
    when: () => {
      const ws = useWorkspace.getState();
      const buffers = useTabsStore.getState().fileBuffers;
      return allTabs(ws.root).some((t) => isFileTabDirty(t, buffers));
    },
    run: async () => {
      const ws = useWorkspace.getState();
      const buffers = useTabsStore.getState().fileBuffers;
      const dirtyPaths = allTabs(ws.root)
        .filter((t) => isFileTabDirty(t, buffers))
        .map((t) =>
          t.descriptor.kind === "file" ? t.descriptor.path : null,
        )
        .filter((p): p is string => p !== null);
      // De-dupe in case the same file is open in multiple panels.
      const unique = Array.from(new Set(dirtyPaths));
      await Promise.all(unique.map((p) => saveFileBuffer(p)));
    },
  });

  registry.register({
    id: "view.problems",
    label: "Show Problems",
    hotkey: "mod+shift+m",
    keywords: ["errors", "warnings", "diagnostics", "problems"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "problems" });
    },
  });

  registry.register({
    id: "view.changes",
    label: "Review AI Changes",
    keywords: ["changes", "diff", "review", "ai", "accept", "reject"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "changes" });
    },
  });

  registry.register({
    id: "search.inFiles",
    label: "Find in Files",
    hotkey: "mod+shift+f",
    keywords: ["search", "grep", "find", "files", "content"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "search" });
    },
  });

  registry.register({
    id: "editor.format",
    label: "Format Document",
    hotkey: "shift+alt+f",
    keywords: ["prettier", "format", "indent"],
    group: "View",
    when: () => !!focusedFilePath(),
    run: () => {
      useFocusStore
        .getState()
        .runEditorAction?.("editor.action.formatDocument");
    },
  });

  registry.register({
    id: "editor.gotoSymbol",
    label: "Go to Symbol in Editor…",
    hotkey: "mod+shift+o",
    keywords: ["symbol", "outline", "function", "jump", "navigate"],
    group: "View",
    when: () => !!focusedFilePath(),
    run: () => {
      useFocusStore.getState().runEditorAction?.("editor.action.quickOutline");
    },
  });

  registry.register({
    id: "editor.organizeImports",
    label: "Organize Imports (LSP)",
    keywords: ["imports", "organize", "sort", "clean", "lsp"],
    group: "View",
    when: () => !!focusedFilePath(),
    run: () => {
      const path = focusedFilePath();
      if (!path) return;
      void import("@/features/lsp/lspFeatures").then((m) =>
        m.lspOrganizeImports(path),
      );
    },
  });

  registry.register({
    id: "view.splitEditor",
    label: "Split Editor Right",
    hotkey: "mod+\\",
    keywords: ["split", "side", "pane", "column", "editor"],
    group: "View",
    when: () => !!focusedFilePath(),
    run: () => useWorkspace.getState().splitFocusedPanel(),
  });

  registry.register({
    id: "view.toggleTheme",
    label: "Cycle Theme (Neon / Minimal / Modern)",
    group: "View",
    run: () => useThemeStore.getState().toggle(),
  });

  registry.register({
    id: "view.resetLayout",
    label: "Reset Workspace Layout",
    keywords: ["panels", "layout", "reset", "default"],
    group: "View",
    run: async () => {
      const ok = await confirmDialog(
        "Reset all Orion panels to the default layout?",
        { title: "Reset layout", kind: "info" },
      );
      if (!ok) return;
      const { defaultOrionLayout } = await import(
        "@/components/workspace/workspaceStore"
      );
      useWorkspace.getState().resetLayout(defaultOrionLayout);
    },
  });

  registry.register({
    id: "view.openPreview",
    label: "View: Open Preview",
    keywords: ["preview", "live"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "preview" });
    },
  });

  registry.register({
    id: "view.openFilesTree",
    label: "View: Open Explorer",
    keywords: ["files", "tree", "explorer"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "files-tree" });
    },
  });

  registry.register({
    id: "view.openTerminal",
    label: "View: Open Terminal",
    keywords: ["terminal", "shell"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "terminal" });
    },
  });

  registry.register({
    id: "view.openClaude",
    label: "View: Open Orix47",
    keywords: ["claude", "chat", "companion", "orix47"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "claude" });
    },
  });

  registry.register({
    id: "view.openClaudeCode",
    label: "View: Open Claude Code",
    hotkey: "mod+shift+l",
    keywords: ["claude", "code", "cli", "interactive", "agent"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "claude-code", agent: "claude" });
    },
  });

  registry.register({
    id: "view.openHermes",
    label: "View: Open Hermes",
    keywords: ["hermes", "cli", "interactive", "agent", "code"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "claude-code", agent: "hermes" });
    },
  });

  registry.register({
    id: "view.openPi",
    label: "View: Open Pi",
    keywords: ["pi", "cli", "interactive", "agent", "code"],
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "claude-code", agent: "pi" });
    },
  });

  registry.register({
    id: "controlpanel.open",
    label: "Open Control Panel",
    hotkey: "mod+,",
    group: "View",
    run: () => useControlPanel.getState().show(),
  });
  registry.register({
    id: "settings.open",
    label: "Open Settings",
    group: "View",
    run: () => useControlPanel.getState().show("theme"),
  });
  registry.register({
    id: "plugins.open",
    label: "Open Plugin Manager",
    keywords: ["plugins", "extensions", "capabilities", "enable", "disable"],
    group: "View",
    run: () => useControlPanel.getState().show("plugins"),
  });

  // Sign out — drops the remembered session and returns to the lock screen.
  // Only surfaced once sign-in is enabled (an account exists).
  registry.register({
    id: "auth.lock",
    label: "Lock Orion Terminal",
    keywords: ["lock", "sign out", "log out", "logout", "secure", "session"],
    group: "View",
    when: () => useAuth.getState().hasAccount,
    run: () => void useAuth.getState().lock(),
  });

  // Dev-only: scrutinize the boot splash without relaunching. Never registered
  // in the bundled .app (import.meta.env.DEV is statically false there).
  if (import.meta.env.DEV) {
    registry.register({
      id: "dev.splashPreview",
      label: "Preview Boot Splash (dev)",
      keywords: ["splash", "boot", "energy", "core", "launch", "preview", "dev"],
      group: "Dev",
      run: () => {
        void import("@/shell/Splash/splashPreviewStore").then((m) =>
          m.useSplashPreview.getState().show(),
        );
      },
    });
  }

  registry.register({
    id: "onboarding.show",
    label: "Show Walkthrough",
    keywords: ["walkthrough", "tour", "onboarding", "coachmarks", "intro", "getting started", "guide"],
    group: "View",
    run: () => useOnboarding.getState().start(),
  });

  registry.register({
    id: "help.open",
    label: "Help: Orion Terminal Guide",
    keywords: ["help", "docs", "guide", "manual", "how to", "getting started", "about"],
    group: "View",
    run: () => useHelp.getState().show(),
  });

  registry.register({
    id: "keybindings.show",
    label: "Show keyboard shortcuts",
    hotkey: "mod+/",
    group: "View",
    keywords: ["help", "shortcuts", "keys", "cheatsheet"],
    run: () => useKeybindingsStore.getState().toggle(),
  });

  registry.register({
    id: "xdesign.exportToCode",
    label: "XDesign: Export Selection to React",
    keywords: ["xdesign", "export", "react", "code", "design", "component", "tsx"],
    group: "View",
    run: () => {
      void import("@/apps/xdesign/exportToCode").then((m) =>
        m.exportSelectionToCode(),
      );
    },
  });

  registry.register({
    id: "xdesign.present",
    label: "XDesign: Present Prototype",
    keywords: ["xdesign", "present", "play", "prototype", "preview", "demo", "flow"],
    group: "View",
    run: () => {
      void import("@/apps/xdesign/XDesignApp").then((m) => m.startPresent());
    },
  });

  registry.register({
    id: "editor.toggleTabAutocomplete",
    label: "Toggle Tab Autocomplete",
    keywords: ["autocomplete", "ghost", "suggestion", "completion", "ai", "tab"],
    group: "View",
    run: () => {
      useAutocomplete.getState().toggle();
      const on = useAutocomplete.getState().enabled;
      toast.info(`Tab autocomplete ${on ? "on" : "off"}`, {
        dedupeKey: "tab-autocomplete-toggle",
      });
    },
  });

  registry.register({
    id: "claude.inlineEdit",
    label: "Inline Edit Selection (Claude)",
    keywords: ["claude", "edit", "rewrite", "selection"],
    group: "Claude",
    when: () => {
      const f = useFocusStore.getState();
      return f.editorFocused && f.hasSelection;
    },
    run: () => {
      const f = useFocusStore.getState();
      const ctx = f.getSelectionContext?.();
      if (!ctx) return;
      useInlineEditStore.getState().show(ctx);
    },
  });

  registry.register({
    id: "claude.newChat",
    label: "New Chat in Orix47",
    // No hotkey — ⌘L is reclaimed by Core. Still discoverable via Spotlight.
    group: "Claude",
    run: () => {
      const project = useProjectStore.getState().active;
      useChatStore.getState().newChat(project?.id ?? null);
      useWorkspace.getState().openTab({ kind: "claude" });
    },
  });

  registry.register({
    id: "rosie.toggle",
    label: "Summon R.O.S.I.E",
    hotkey: "mod+l",
    keywords: ["rosie", "core", "claude", "agent", "jarvis", "ai", "oracle"],
    group: "Claude",
    run: () => {
      // Lazy import — rosieStore pulls in transformers/tools etc. only
      // when invoked.
      void import("@/features/rosie/rosieStore").then((m) =>
        m.useRosie.getState().togglePanel(),
      );
    },
  });

  registry.register({
    id: "companion.spawn",
    label: "Summon R.O.S.I.E Companion",
    hotkey: "alt+r",
    keywords: ["rosie", "companion", "avatar", "summon", "spawn", "3d"],
    group: "Claude",
    run: () => {
      void import("@/features/rosie/rosieStore").then((m) =>
        m.useRosie.getState().spawnCompanion(),
      );
    },
  });

  registry.register({
    id: "companion.clipTest",
    label: "Companion: Test Animation Clips",
    hotkey: "alt+shift+r",
    keywords: ["companion", "clip", "animation", "test", "cycle", "rosie"],
    group: "Claude",
    run: () => {
      void import("@/features/rosie/rosieStore").then((m) =>
        m.useRosie.getState().spawnCompanion(),
      );
      void import("@/features/rosie/avatar/companionDebugStore").then((m) =>
        m.useCompanionDebug.getState().toggle(),
      );
    },
  });

  registry.register({
    id: "voice.toggle",
    label: "Voice: Start/Stop Recording",
    hotkey: "mod+shift+v",
    keywords: ["voice", "speak", "dictate", "microphone", "stt", "whisper"],
    group: "Claude",
    run: () => {
      void import("@/store/voiceStore").then((m) =>
        m.useVoice.getState().toggle(),
      );
    },
  });

  registry.register({
    id: "voice.toggleListening",
    label: "Voice: Toggle Wake-Word Listening",
    hotkey: "mod+shift+j",
    keywords: ["voice", "wake", "listen", "ambient", "hands-free", "jarvis", "core"],
    group: "Claude",
    run: () => {
      void import("@/store/voiceStore").then((m) =>
        m.useVoice.getState().toggleListening(),
      );
    },
  });

  registry.register({
    id: "claude.continueChat",
    label: "Continue Most Recent Chat",
    group: "Claude",
    run: async () => {
      const project = useProjectStore.getState().active;
      const rows = await listChatsForProject(project?.id ?? null);
      const row = rows[0];
      if (!row) {
        useChatStore.getState().newChat(project?.id ?? null);
        return;
      }
      let messages: unknown = [];
      try {
        messages = JSON.parse(row.messages_json);
      } catch {
        messages = [];
      }
      useChatStore.getState().setActive({
        id: row.id,
        title: row.title,
        sessionId: row.session_id,
        projectId: row.project_id,
        messages: Array.isArray(messages) ? (messages as never[]) : [],
        totalCostUsd: row.total_cost_usd,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      useWorkspace.getState().openTab({ kind: "claude" });
    },
  });

  registry.register({
    id: "claude.listChats",
    label: "List Past Chats…",
    group: "Claude",
    run: () => {
      log.info("claude.listChats not yet implemented as palette mode");
    },
  });

  registry.register({
    id: "claude.cancel",
    label: "Cancel Claude Turn",
    hotkey: "mod+.",
    group: "Claude",
    when: () => useChatStore.getState().running,
    run: () => {
      const active = useChatStore.getState().active;
      if (!active) return;
      void ipc.claudeCancel(active.id);
    },
  });

  registry.register({
    id: "terminal.toggle",
    label: "Open Terminal Panel",
    hotkey: "mod+`",
    group: "View",
    run: () => {
      useWorkspace.getState().openTab({ kind: "terminal" });
    },
  });

  registry.register({
    id: "terminal.clear",
    label: "Clear Terminal",
    group: "View",
    when: () => useTerminalStore.getState().ptyId !== null,
    run: () => {
      const ptyId = useTerminalStore.getState().ptyId;
      if (!ptyId) return;
      void ipc.terminalWrite(ptyId, "\x0c");
    },
  });

  registry.register({
    id: "dev.openDevtools",
    label: "Open Devtools",
    group: "Dev",
    run: async () => {
      try {
        const w = getCurrentWindow();
        await (w as unknown as { internalToggleDevtools?: () => Promise<void> })
          .internalToggleDevtools?.();
      } catch (err) {
        log.warn("devtools not available", err);
      }
    },
  });

  // Hide/show Orion's explorer (sidebar) and claude (right rail) panels in the
  // workspace tree. The scope check lives inside run() (not `when`) so the menu
  // item stays clickable; it only stops the global ⌘B/⌘J hotkey from mutating
  // Orion's layout while another app is focused.
  registry.register({
    id: "panel.toggleSidebar",
    label: "Toggle Sidebar",
    hotkey: "mod+b",
    group: "View",
    run: () => {
      if (!orionFocused()) return;
      useWorkspace.getState().togglePanelByRole("explorer");
    },
  });
  registry.register({
    id: "panel.toggleRightRail",
    label: "Toggle Right Rail",
    hotkey: "mod+j",
    group: "View",
    run: () => {
      if (!orionFocused()) return;
      useWorkspace.getState().togglePanelByRole("claude");
    },
  });
}
