/**
 * Root of the standalone Archives 47 app: one native window whose content is
 * the Archives UI, with a native menu bar, ⌘K palette and an AI-only Settings
 * window. No Orion desktop, dock, wallpaper, companion or sign-in.
 */
import { useEffect, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { ArchivesApp } from "@/apps/archives/ArchivesApp";
import { registerArchivesContributions, loadArchivesPluginData, refreshArchivesPluginData } from "@/apps/archives/pluginContributions";
import { DisposableScope } from "@/plugins/contracts";
import { PluginOverlays } from "@/plugins/PluginOverlays";
import { HotkeyHost } from "@/lib/hotkeys";
import { getAppState, getDb, setAppState } from "@/lib/db";
import { log } from "@/lib/log";
import { startFileDropOrchestrator } from "@/lib/fileDrop";
import { toast } from "@/store/toastStore";
import { useThemeStore } from "@/store/themeStore";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { useAppConfig, type AppConfigsPersist } from "@/store/appConfigStore";
import { useProvidersStore } from "@/store/providersStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { PromptModalHost } from "@/components/PromptModal";
import { ConfirmModalHost } from "@/components/ConfirmModal";
import { ToastHost } from "@/components/ToastHost";
import { RecoveryPanel } from "@/features/recovery/RecoveryPanel";
import { useQuitGuard } from "@/features/recovery/useQuitGuard";
import { useDraftRecovery } from "@/features/recovery/useDraftRecovery";
import { useStartupBackupWarning } from "@/features/recovery/useStartupBackupWarning";
import { WindowTitleStatusContext } from "@/shell/WindowTitleStatusContext";
import { ArchivesPalette } from "./ArchivesPalette";
import { ArchivesSettingsWindow } from "./ArchivesSettings";
import { StandaloneEventBridge } from "./StandaloneEventBridge";
import { installStandaloneCommands, STANDALONE_OWNER } from "./archivesCommands";
import { installNativeMenu } from "./nativeMenu";
import { archivesQuitRisks } from "./archivesQuitRisks";
import { APP_NAME } from "./brand";

const contributions = new DisposableScope();
registerArchivesContributions(STANDALONE_OWNER, contributions);
installStandaloneCommands();

async function hydrate(): Promise<void> {
  await getDb();
  const [theme, windowSize, modelPrefs, appConfigs] = await Promise.all([
    getAppState<string>("theme"),
    getAppState<{ width: number; height: number }>("window_size"),
    getAppState<Record<string, string>>("models"),
    getAppState<AppConfigsPersist>("appconfig"),
  ]);
  useThemeStore.getState().hydrate(theme ?? null);
  useModelPrefs.getState().hydrate(modelPrefs);
  useAppConfig.getState().hydrate(appConfigs);
  for (const [name, load] of [
    ["providers", () => useProvidersStore.getState().load()],
    ["skills", () => useSkillsStore.getState().load()],
    ["agents", () => useAgentsStore.getState().load()],
    ["archives", () => loadArchivesPluginData()],
  ] as const) {
    try {
      await load();
    } catch (err) {
      log.warn(`${name} load failed`, err);
    }
  }
  if (windowSize) {
    await getCurrentWindow()
      .setSize(new LogicalSize(windowSize.width, windowSize.height))
      .catch((err) => log.warn("failed to restore window size", err));
  }
}

function useWindowSizePersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onResized(({ payload }) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const factor = window.devicePixelRatio || 1;
          void setAppState("window_size", { width: Math.round(payload.width / factor), height: Math.round(payload.height / factor) });
        }, 400);
      })
      .then((u) => { unlisten = u; })
      .catch((err) => log.warn("window listener failed", err));
    return () => { if (timer) clearTimeout(timer); unlisten?.(); };
  }, []);
}

/** Re-read the library when the window regains focus (edits made by the assistant's tools). */
function useRefreshOnFocus(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void refreshArchivesPluginData().catch((e) => log.warn("archives refresh", e)), 250);
    });
    return () => { void unlisten.then((f) => f()); if (t) clearTimeout(t); };
  }, [enabled]);
}

function useFinderDrops() {
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void startFileDropOrchestrator().then((fn) => { if (cancelled) fn(); else off = fn; });
    return () => { cancelled = true; off?.(); };
  }, []);
}

/** Drag strip under the macOS traffic lights; the window has no native title bar. */
function TitleStrip({ status }: { status: (el: HTMLElement | null) => void }) {
  return (
    <div className="a47-titlebar" data-tauri-drag-region>
      <span className="a47-title" data-tauri-drag-region>{APP_NAME}</span>
      <span ref={status} className="ot-window-title-status" />
    </div>
  );
}

export function ArchivesStandaloneApp() {
  const [hydrated, setHydrated] = useState(false);
  const [statusTarget, setStatusTarget] = useState<HTMLElement | null>(null);
  useQuitGuard(hydrated, archivesQuitRisks);
  useStartupBackupWarning(hydrated);
  useDraftRecovery(hydrated);
  useWindowSizePersistence();
  useRefreshOnFocus(hydrated);
  useFinderDrops();

  useEffect(() => {
    hydrate()
      .catch((err) => {
        log.error("hydrate failed", err);
        toast.error("Startup failed", { body: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => setHydrated(true));
    void installNativeMenu().catch((err) => log.warn("native menu failed", err));
  }, []);

  return (
    <ErrorBoundary>
      <HotkeyHost />
      <StandaloneEventBridge />
      <div className="a47-window">
        <TitleStrip status={setStatusTarget} />
        <div className="a47-body ot-window-body">
          {hydrated ? (
            <WindowTitleStatusContext.Provider value={statusTarget}>
              <ErrorBoundary label={APP_NAME} compact>
                <ArchivesApp />
              </ErrorBoundary>
            </WindowTitleStatusContext.Provider>
          ) : (
            <div className="ot-app-loading"><div className="ot-claude-orb" style={{ width: 28, height: 28 }} /></div>
          )}
        </div>
      </div>
      <RecoveryPanel />
      <PluginOverlays />
      <ArchivesPalette />
      <ArchivesSettingsWindow />
      <PromptModalHost />
      <ConfirmModalHost />
      <ToastHost />
    </ErrorBoundary>
  );
}
