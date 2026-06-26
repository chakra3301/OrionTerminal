import { useEffect, useState, lazy, Suspense } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { EventBridge } from "@/app/EventBridge";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { ControlPanel } from "@/features/controlpanel/ControlPanel";
import { KeybindingsOverlay } from "@/features/keybindings/KeybindingsOverlay";
import { installBuiltinCommands } from "@/commands/builtins";
import { installShellCommands } from "@/shell/commands/shellCommands";
import { installSpotifyCommands } from "@/shell/commands/spotifyCommands";
import { HotkeyHost } from "@/lib/hotkeys";
import { useTerminalStore } from "@/store/terminalStore";
import { getAppState, getDb } from "@/lib/db";
import { useLayoutStore } from "@/store/layoutStore";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useHermes } from "@/store/hermesStore";
import { useCommand } from "@/store/commandStore";
import { useProvidersStore } from "@/store/providersStore";
import { useDesignSystems } from "@/store/designSystemStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { LinkInsertPalette } from "@/features/notes/LinkInsertPalette";
import { HelpWindow } from "@/features/help/HelpWindow";
import { Walkthrough } from "@/features/onboarding/Walkthrough";
import { useOnboarding } from "@/features/onboarding/onboardingStore";

// Dev-only boot-splash preview harness. import.meta.env.DEV is statically false
// in the bundled .app, so this lazy chunk is dead-code-eliminated there.
const SplashPreview = import.meta.env.DEV
  ? lazy(() =>
      import("@/shell/Splash/SplashPreview").then((m) => ({
        default: m.SplashPreview,
      })),
    )
  : null;
import { purgeEmptyNotes } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { startFileDropOrchestrator } from "@/lib/fileDrop";
import { useProjectStore } from "@/store/projectStore";
import { useThemeStore } from "@/store/themeStore";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useWallpaperStore, type WallpaperState } from "@/store/wallpaperStore";
import { usePreviewStore, type PreviewState } from "@/store/previewStore";
import { useXDesign } from "@/apps/xdesign/store";
import {
  useXDProjects,
  flushActive as flushActiveXDProject,
} from "@/apps/xdesign/projectsStore";
import {
  setAppState,
  getWorkspaceLayout,
  setWorkspaceLayout,
  logActivity,
} from "@/lib/db";
import { runEmbeddingBackfill } from "@/lib/embeddingIndexer";
import { startContextSnapshotter } from "@/lib/contextSnapshot";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { useAutocomplete } from "@/store/autocompleteStore";
import { startGitWatch } from "@/store/gitStore";
import { Shell } from "@/shell/Shell";
import { SplashScreen } from "@/shell/Splash/SplashScreen";
import { useAuth } from "@/features/auth/authStore";
import { LockScreen } from "@/features/auth/LockScreen";
import { FirstRunSetup } from "@/features/auth/FirstRunSetup";
import { useShell, type WindowState } from "@/shell/store/useShell";
import { ensureOrionTheme } from "@/apps/orion/monacoTheme";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import type { LayoutNode } from "@/components/workspace/types";

installBuiltinCommands();
installShellCommands();
installSpotifyCommands();
void ensureOrionTheme();

/**
 * Walk the persisted layout tree and drop file tabs whose paths no longer
 * exist on disk. Splits and panels with no surviving tabs collapse naturally
 * because the workspace's hydrate path uses the same tree-pruning rules.
 */
async function sanitizeLayout(node: LayoutNode): Promise<LayoutNode> {
  if (node.kind === "panel") {
    const keptTabs: typeof node.tabs = [];
    for (const t of node.tabs) {
      if (t.descriptor.kind === "file") {
        try {
          const ok = await ipc.pathExists(t.descriptor.path);
          if (ok) keptTabs.push(t);
        } catch {
          /* drop unreadable file tabs silently */
        }
      } else {
        keptTabs.push(t);
      }
    }
    const active =
      keptTabs.find((t) => t.id === node.activeTabId)?.id ??
      keptTabs[0]?.id ??
      null;
    return { ...node, tabs: keptTabs, activeTabId: active };
  }
  const children = await Promise.all(node.children.map(sanitizeLayout));
  return { ...node, children };
}

async function hydrate() {
  await getDb();
  const [
    panelSizes,
    sidebarOpen,
    rightOpen,
    workspaceLayout,
    focusedPanelId,
    lastProjectId,
    theme,
    windowSize,
    terminalOpen,
    terminalHeight,
    wallpaper,
    preview,
    modelPrefs,
    reduceGlass,
    tabAutocomplete,
  ] = await Promise.all([
    getAppState<{ sidebar: number; main: number; right: number }>("panel_sizes"),
    getAppState<boolean>("sidebar_open"),
    getAppState<boolean>("right_rail_open"),
    getAppState<LayoutNode>("workspace.layout"),
    getAppState<string>("workspace.focusedPanel"),
    getAppState<string>("last_project_id"),
    getAppState<string>("theme"),
    getAppState<{ width: number; height: number }>("window_size"),
    getAppState<boolean>("terminal_open"),
    getAppState<number>("terminal_height"),
    getAppState<WallpaperState>("wallpaper"),
    getAppState<PreviewState>("preview"),
    getAppState<Record<string, string>>("models"),
    getAppState<boolean>("reduce_glass"),
    getAppState<boolean>("tab_autocomplete"),
  ]);

  useThemeStore.getState().hydrate(theme ?? null);
  useThemeStore.getState().hydrateGlass(reduceGlass);
  useAutocomplete.getState().hydrate(tabAutocomplete);
  if (wallpaper) useWallpaperStore.getState().hydrate(wallpaper);
  if (preview) usePreviewStore.getState().hydrate(preview);
  void useXDProjects.getState().init();
  useModelPrefs.getState().hydrate(modelPrefs);

  useLayoutStore.getState().hydrate({
    ...(panelSizes ? { sizes: panelSizes } : {}),
    ...(typeof sidebarOpen === "boolean" ? { sidebarOpen } : {}),
    ...(typeof rightOpen === "boolean" ? { rightOpen } : {}),
  });

  // Per-project layout (new since 2026-05-24) takes precedence over the
  // legacy global `workspace.layout` key. The global is still used as a
  // fallback for first-launch / no-project state.
  let effectiveLayout: LayoutNode | null = workspaceLayout;
  let effectiveFocused: string | null = focusedPanelId ?? null;
  if (lastProjectId) {
    try {
      const perProject = await getWorkspaceLayout<LayoutNode>(lastProjectId);
      if (perProject) {
        effectiveLayout = perProject.layout;
        effectiveFocused = perProject.focusedPanelId;
      }
    } catch (err) {
      log.warn("per-project layout load failed", err);
    }
  }
  if (effectiveLayout) {
    const sanitized = await sanitizeLayout(effectiveLayout);
    useWorkspace.getState().hydrate(sanitized, effectiveFocused);
  }

  if (lastProjectId) {
    await useProjectStore.getState().hydrateFromId(lastProjectId);
  }

  try {
    const purged = await purgeEmptyNotes();
    if (purged > 0) log.info(`purged ${purged} empty notes`);
  } catch (err) {
    log.warn("purgeEmptyNotes failed", err);
  }
  try {
    await useNotesStore.getState().load();
  } catch (err) {
    log.warn("notes load failed", err);
  }
  try {
    await useAssetsStore.getState().load();
  } catch (err) {
    log.warn("assets load failed", err);
  }
  try {
    await useMoodBoardsStore.getState().load();
  } catch (err) {
    log.warn("mood boards load failed", err);
  }
  try {
    await useCollectionsStore.getState().load();
  } catch (err) {
    log.warn("collections load failed", err);
  }
  try {
    await useHermes.getState().load();
  } catch (err) {
    log.warn("hermes load failed", err);
  }
  try {
    await useCommand.getState().load();
  } catch (err) {
    log.warn("command center load failed", err);
  }
  try {
    await useProvidersStore.getState().load();
  } catch (err) {
    log.warn("providers load failed", err);
  }
  try {
    await useSkillsStore.getState().load();
  } catch (err) {
    log.warn("skills load failed", err);
  }
  try {
    await useAgentsStore.getState().load();
  } catch (err) {
    log.warn("agents load failed", err);
  }
  try {
    await useDesignSystems.getState().load();
  } catch (err) {
    log.warn("design systems load failed", err);
  }

  if (typeof terminalHeight === "number") {
    useTerminalStore.getState().setHeight(terminalHeight);
  }
  if (typeof terminalOpen === "boolean") {
    useTerminalStore.getState().setOpen(terminalOpen);
  }

  if (windowSize) {
    try {
      await getCurrentWindow().setSize(
        new LogicalSize(windowSize.width, windowSize.height),
      );
    } catch (err) {
      log.warn("failed to restore window size", err);
    }
  }

  // Restore in-canvas window state from the last session. If nothing was
  // persisted (first launch, or last session ended with no windows open),
  // fall back to the "auto-open Orion when a project exists" default.
  const [savedWindows, savedFocused] = await Promise.all([
    getAppState<WindowState[]>("shell.windows"),
    getAppState<string>("shell.focusedWindowId"),
  ]);
  const restored = useShell
    .getState()
    .restoreWindows(savedWindows ?? [], savedFocused ?? null);
  if (!restored && useProjectStore.getState().active) {
    useShell.getState().openApp("orion");
  }

  // Kick off the semantic-search backfill after the rest of the app is up.
  // Fire-and-forget — the indexer never throws, and the search layer falls
  // back to FTS5 when embeddings aren't available yet.
  void scheduleEmbeddingBackfill();

  // Codebase semantic index for the active project (and on project switch).
  scheduleCodebaseIndex();

  // Resume the user's last Core conversation so the panel re-opens to
  // where they left off. Lazy import keeps the Core bundle out of the
  // hydrate path until needed.
  void import("@/features/rosie/rosieStore").then(async (m) => {
    const ttsEnabled = await getAppState<boolean>("rosie.ttsEnabled");
    if (typeof ttsEnabled === "boolean") {
      m.useRosie.setState({ ttsEnabled });
    }
    void m.useRosie.getState().resumeLatest();
  });
  // Warm SpeechSynthesis so voices are enumerated by the time the user
  // first triggers TTS. Cheap — no network, no permission.
  void import("@/lib/voiceSpeak").then((m) => m.warmTts());
  // Note: wake-word listening (`voice.listenMode`) is intentionally NOT
  // auto-restored on launch — silently opening the mic on boot would
  // surprise the user and trigger an OS permission prompt unprompted.
  // They re-arm it each session with ⌘⇧J.

  // Begin writing the agent-visible context snapshot. Subscribes to the
  // shell/project/workspace/archives stores so any UI change refreshes
  // the file the MCP server's `orion_get_context` tool reads from.
  startContextSnapshotter();

  // Live git status (branch, dirty files) for the active project.
  startGitWatch();
}

let backfillStarted = false;
function scheduleEmbeddingBackfill(): void {
  if (backfillStarted) return;
  backfillStarted = true;
  // Defer past the first paint so the model download/load doesn't compete
  // with initial UI render.
  setTimeout(() => {
    void runEmbeddingBackfill().catch((err) =>
      log.warn("embedding backfill rejected", err),
    );
  }, 1500);
}

let codebaseIndexStarted = false;
function scheduleCodebaseIndex(): void {
  if (codebaseIndexStarted) return;
  codebaseIndexStarted = true;
  const kick = (p: { id: string; root_path: string } | null) => {
    if (!p) return;
    // Give boot + the notes backfill a head start; the indexer itself is
    // hash-aware so repeat runs are cheap. Lazy import keeps the indexer
    // out of the boot path entirely.
    setTimeout(() => {
      void import("@/features/context/codebaseIndexer").then((m) =>
        m.indexCodebase(p.id, p.root_path),
      );
    }, 4000);
  };
  kick(useProjectStore.getState().active);
  useProjectStore.subscribe((s, prev) => {
    if (s.active?.id !== prev.active?.id) {
      kick(s.active ?? null);
    }
  });
}

function useWindowSizePersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;

    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onResized(({ payload }) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const factor = window.devicePixelRatio || 1;
          void setAppState("window_size", {
            width: Math.round(payload.width / factor),
            height: Math.round(payload.height / factor),
          });
        }, 400);
      });
    })().catch((err) => log.warn("window listener failed", err));

    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, []);
}

/**
 * Debounced auto-persist for in-canvas window state (positions, sizes,
 * z-order, minimized/maximized). Subscribed once at app boot — every shell
 * mutation flushes through this writer after a short idle so we don't
 * thrash sqlite on every drag pixel.
 */
function useShellWindowsPersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      const state = useShell.getState();
      void setAppState("shell.windows", state.windows);
      void setAppState("shell.focusedWindowId", state.focusedWindowId);
    };
    const unsubscribe = useShell.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}

/**
 * Debounced auto-persist for the XDesign document. Subscribed once at app
 * boot. The first emission right after hydrate is intentionally let through —
 * it's idempotent (same shapes back to disk) and avoids needing a "loaded"
 * flag.
 */
function useXDesignPersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Opening / switching projects hydrates the store, which fires this
    // subscription — but that's a load, not an edit. Track the last project we
    // logged for so a fresh activeId is treated as a load (persist, don't log).
    let lastLoggedId: string | null = null;
    const flush = () => {
      // Edits only persist when a project is open. On the Home screen there's
      // no active project, so there's nothing to write to.
      const activeId = useXDProjects.getState().activeId;
      if (!activeId) return;
      const s = useXDesign.getState();
      void flushActiveXDProject();
      if (activeId === lastLoggedId) {
        const page = s.pages.find((p) => p.id === s.activePageId);
        void logActivity({
          source: "xdesign",
          kind: "design.edit",
          title: page?.name || "Canvas",
          summary: `${s.shapes.length} layer${s.shapes.length === 1 ? "" : "s"}`,
          refId: s.activePageId,
        });
      } else {
        lastLoggedId = activeId;
      }
    };
    const unsubscribe = useXDesign.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}

/**
 * Keeps the workspace layout scoped per project: switching projects saves
 * the prior project's layout (synchronously, no debounce — so the swap is
 * atomic) and loads the new project's layout. Within a single project,
 * layout changes are debounced and written to that project's slot.
 *
 * Falls back to the global `workspace.layout` app_state key when there's
 * no active project (e.g., first launch) so nothing regresses.
 */
function useProjectScopedLayout() {
  useEffect(() => {
    let currentProjectId: string | null =
      useProjectStore.getState().active?.id ?? null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flushSnapshotTo = (projectId: string) => {
      const ws = useWorkspace.getState();
      void setWorkspaceLayout(projectId, ws.root, ws.focusedPanelId);
    };

    const unsubWorkspace = useWorkspace.subscribe(() => {
      if (!currentProjectId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (currentProjectId) flushSnapshotTo(currentProjectId);
      }, 400);
    });

    const unsubProject = useProjectStore.subscribe((s) => {
      const nextId = s.active?.id ?? null;
      if (nextId === currentProjectId) return;
      // 1. Flush prior project's layout immediately (cancel any pending
      // debounce so the snapshot can't land in the new project's slot).
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (currentProjectId) flushSnapshotTo(currentProjectId);
      // 2. Load the new project's layout (or reset to default if none).
      void (async () => {
        if (nextId) {
          try {
            const loaded = await getWorkspaceLayout<LayoutNode>(nextId);
            if (loaded) {
              const sanitized = await sanitizeLayout(loaded.layout);
              useWorkspace.getState().hydrate(sanitized, loaded.focusedPanelId);
            } else {
              const { defaultOrionLayout } = await import(
                "@/components/workspace/workspaceStore"
              );
              useWorkspace.getState().resetLayout(defaultOrionLayout);
            }
          } catch (err) {
            log.warn("per-project layout swap failed", err);
          }
        }
      })();
      currentProjectId = nextId;
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubWorkspace();
      unsubProject();
    };
  }, []);
}

/** Boot the single webview-level Finder drag-drop orchestrator (zones opt
 * in via `useFileDropZone`). Mount-once. */
function useFinderDropOrchestrator() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const fn = await startFileDropOrchestrator();
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/** Keep the Rust file watcher pointed at the active project, so external
 * changes (editor saves, git, Finder, downloads, etc.) refresh the tree
 * within ~300ms. Passing null stops watching when no project is open. */
function useFsWatcher() {
  useEffect(() => {
    const sync = (root: string | null) => {
      void ipc.fsWatchSetRoot(root).catch((e) => log.warn("fs watch", e));
    };
    sync(useProjectStore.getState().active?.root_path ?? null);
    return useProjectStore.subscribe((s) =>
      sync(s.active?.root_path ?? null),
    );
  }, []);
}

/** Re-read Archives data from disk when this window regains focus, so edits the
 * iOS sync helper writes into orion.db out-of-band appear without a relaunch.
 * Frontend-only + debounced; a store reload doesn't disturb an open BlockNote
 * editor (its content is held in-memory, not re-seeded from the store). */
function useArchivesLiveRefresh() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        void (async () => {
          try {
            const [{ useCollectionsStore }, { useAssetsStore }, { useArchives }] =
              await Promise.all([
                import("@/store/collectionsStore"),
                import("@/store/assetsStore"),
                import("@/apps/archives/useArchives"),
              ]);
            await Promise.all([
              useNotesStore.getState().load(),
              useCollectionsStore.getState().load(),
              useAssetsStore.getState().load(),
            ]);
            useArchives.getState().setCounts({
              notes: useNotesStore.getState().notes.size,
              assets: useAssetsStore.getState().assets.size,
            });
          } catch (e) {
            log.warn("archives live refresh", e);
          }
        })();
      }, 250);
    };
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) refresh();
    });
    return () => {
      void unlisten.then((f) => f());
      if (t) clearTimeout(t);
    };
  }, []);
}

/** Minimal boot placeholder shown before the gate resolves and during a warm
 * hydrate (no splash). Deliberately quiet — bg-0 with a faint pulse. */
function BootBlank() {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-0)",
      }}
    >
      <div className="ot-claude-orb" style={{ width: 22, height: 22, opacity: 0.5 }} />
    </div>
  );
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [probed, setProbed] = useState(false);
  const authPhase = useAuth((s) => s.phase);
  const warm = useAuth((s) => s.warm);
  // True once we're actually displaying the shell (not splash / gate / blank).
  const inShell =
    hydrated && (warm || (probed && splashDone && authPhase === "unlocked"));
  useWindowSizePersistence();
  useShellWindowsPersistence();
  useXDesignPersistence();
  useProjectScopedLayout();
  useFsWatcher();
  useArchivesLiveRefresh();
  useFinderDropOrchestrator();

  useEffect(() => {
    // Resolve the auth gate in parallel with hydrate. The probe decides cold
    // (splash) vs warm (skip splash) and fails OPEN, so a gate bug can never
    // trap the owner behind the lock.
    void useAuth
      .getState()
      .probe()
      .finally(() => setProbed(true));
    hydrate()
      .catch((err) => {
        log.error("hydrate failed", err);
        // Sticky toast (renders once the Shell's ToastHost mounts) — boot
        // continues with whatever state did load.
        toast.error("Startup hydrate failed", {
          body: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setHydrated(true));
  }, []);

  // First-run walkthrough — offered once we land in the shell. No-op unless
  // this is a genuinely fresh, empty vault (existing vaults are marked seen).
  useEffect(() => {
    if (inShell) void useOnboarding.getState().maybeAutoStart();
  }, [inShell]);

  const shellTree = (
    <ErrorBoundary>
      <HotkeyHost />
      <EventBridge />
      <Shell />
      <SettingsPanel />
      <ControlPanel />
      <KeybindingsOverlay />
      <LinkInsertPalette />
      <HelpWindow />
      <Walkthrough />
      {SplashPreview && (
        <Suspense fallback={null}>
          <SplashPreview />
        </Suspense>
      )}
    </ErrorBoundary>
  );

  // Gate not yet resolved — brief blank so we don't flash the splash before we
  // know whether this is a cold start or a warm (valid-session) unlock.
  if (!probed) return <BootBlank />;

  // Warm unlock: a valid, unexpired session skips the splash entirely (an HMR
  // reload with a live session lands here too).
  if (warm) return hydrated ? shellTree : <BootBlank />;

  // Cold start: the chaotic red energy core plays while hydrate() runs, then
  // cross-fades out. It fully unmounts once we move on — zero GPU after.
  if (!splashDone) {
    return (
      <SplashScreen
        mode="launch"
        ready={hydrated}
        onDone={() => setSplashDone(true)}
      />
    );
  }

  // Post-splash gate. LockScreen / FirstRunSetup keep the calm idle core behind
  // them; both unmount the R3F context the moment the shell takes over.
  if (authPhase === "locked") return <LockScreen />;
  if (authPhase === "first-run") return <FirstRunSetup />;

  // Unlocked (account present + valid session, or accountless install with
  // existing data — never gated).
  return hydrated ? shellTree : <BootBlank />;
}
