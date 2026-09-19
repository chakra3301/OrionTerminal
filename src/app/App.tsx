import { useEffect, useState, lazy, Suspense } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { EventBridge } from "@/app/EventBridge";
import { useQuitGuard } from "@/features/recovery/useQuitGuard";
import { useStartupBackupWarning } from "@/features/recovery/useStartupBackupWarning";
import { useDraftRecovery } from "@/features/recovery/useDraftRecovery";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { ControlPanel } from "@/features/controlpanel/ControlPanel";
import { KeybindingsOverlay } from "@/features/keybindings/KeybindingsOverlay";
import { installBuiltinCommands } from "@/commands/builtins";
import { installShellCommands } from "@/shell/commands/shellCommands";
import { installSpotifyCommands } from "@/shell/commands/spotifyCommands";
import { BUILTIN_APP_PLUGIN_IDS } from "@/plugins/builtinApps";
import { appRegistry } from "@/plugins/appRegistry";
import { usePluginManager, type PluginEnablementV1 } from "@/store/pluginManagerStore";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { HotkeyHost } from "@/lib/hotkeys";
import { getAppState, getDb } from "@/lib/db";
import { initializeFirstLaunchDefaults } from "@/lib/firstLaunchDefaults";
import { useHermes } from "@/store/hermesStore";
import { useCommand } from "@/store/commandStore";
import { useProvidersStore } from "@/store/providersStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
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
import { startFileDropOrchestrator } from "@/lib/fileDrop";
import { useThemeStore } from "@/store/themeStore";
import { useThemeExtras } from "@/store/themeExtrasStore";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useAppConfig, type AppConfigsPersist } from "@/store/appConfigStore";
import { useWallpaperStore, type WallpaperState } from "@/store/wallpaperStore";
import { useCharacterStore } from "@/store/characterStore";
import { setAppState } from "@/lib/db";
import { startContextSnapshotter } from "@/lib/contextSnapshot";
import {
  loadArchivesPluginData,
  refreshArchivesPluginData,
} from "@/apps/archives/pluginContributions";
import { loadXDesignPluginData } from "@/apps/xdesign/pluginContributions";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { Shell } from "@/shell/Shell";
import { SplashScreen } from "@/shell/Splash/SplashScreen";
import { useAuth } from "@/features/auth/authStore";
import { LockScreen } from "@/features/auth/LockScreen";
import { FirstRunSetup } from "@/features/auth/FirstRunSetup";
import { useShell, type WindowState } from "@/shell/store/useShell";
import { loadOrionPluginData } from "@/apps/orion/pluginContributions";

installBuiltinCommands();
installShellCommands();
installSpotifyCommands();

async function hydrate() {
  await getDb();
  await initializeFirstLaunchDefaults();
  const [
    theme,
    windowSize,
    wallpaper,
    characters,
    modelPrefs,
    reduceGlass,
    themeExtras,
    customThemes,
    appConfigs,
    pluginState,
  ] = await Promise.all([
    getAppState<string>("theme"),
    getAppState<{ width: number; height: number }>("window_size"),
    getAppState<WallpaperState>("wallpaper"),
    getAppState<Parameters<ReturnType<typeof useCharacterStore.getState>["hydrate"]>[0]>(
      "characters",
    ),
    getAppState<Record<string, string>>("models"),
    getAppState<boolean>("reduce_glass"),
    getAppState<unknown>("theme_extras", true).catch(() => undefined),
    getAppState<unknown>("custom_themes", true).catch(() => undefined),
    getAppState<AppConfigsPersist>("appconfig"),
    getAppState<PluginEnablementV1>("plugins.state"),
  ]);

  useThemeStore.getState().hydrateCustom(customThemes);
  useThemeStore.getState().hydrate(theme ?? null);
  useThemeStore.getState().hydrateGlass(reduceGlass);
  useThemeExtras.getState().hydrate(themeExtras);
  if (wallpaper) useWallpaperStore.getState().hydrate(wallpaper);
  if (characters) useCharacterStore.getState().hydrate(characters);
  usePluginManager.getState().hydrate(pluginState);
  await useCommunityPlugins.getState().hydrate();
  useModelPrefs.getState().hydrate(modelPrefs);
  useAppConfig.getState().hydrate(appConfigs);

  if (usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.orion)) {
    try {
      await loadOrionPluginData();
    } catch (err) {
      log.warn("orion load failed", err);
    }
  }

  if (usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.archives)) {
    try {
      await loadArchivesPluginData();
    } catch (err) {
      log.warn("archives load failed", err);
    }
  }
  if (usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.xdesign)) {
    try {
      await loadXDesignPluginData();
    } catch (err) {
      log.warn("xdesign load failed", err);
    }
  }
  if (usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.hermes)) {
    try {
      await useHermes.getState().load();
    } catch (err) {
      log.warn("hermes load failed", err);
    }
  }
  if (usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.command)) {
    try {
      await useCommand.getState().load();
    } catch (err) {
      log.warn("command center load failed", err);
    }
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
  if (
    !restored &&
    usePluginManager.getState().isEnabled(BUILTIN_APP_PLUGIN_IDS.orion) &&
    appRegistry.has("orion")
  ) {
    const { useProjectStore } = await import("@/store/projectStore");
    if (useProjectStore.getState().active) useShell.getState().openApp("orion");
  }

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

/** Re-read Archives data from disk when this window regains focus, so edits the
 * iOS sync helper writes into orion.db out-of-band appear without a relaunch.
 * Frontend-only + debounced; a store reload doesn't disturb an open BlockNote
 * editor (its content is held in-memory, not re-seeded from the store). */
function useArchivesLiveRefresh() {
  const disabledIds = usePluginManager((state) => state.disabledIds);
  const hydrated = usePluginManager((state) => state.hydrated);
  const enabled = hydrated && !disabledIds.includes(BUILTIN_APP_PLUGIN_IDS.archives);
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        void refreshArchivesPluginData().catch((error) =>
          log.warn("archives live refresh", error),
        );
      }, 250);
    };
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) refresh();
    });
    return () => {
      void unlisten.then((f) => f());
      if (t) clearTimeout(t);
    };
  }, [enabled]);
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
  useQuitGuard(hydrated);
  useStartupBackupWarning(hydrated);
  useDraftRecovery(hydrated);
  useWindowSizePersistence();
  useShellWindowsPersistence();
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
