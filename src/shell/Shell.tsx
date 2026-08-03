import { lazy, Suspense, useEffect, useState } from "react";
import { useShell } from "@/shell/store/useShell";
import { useAppDescriptors, type AppDescriptor } from "@/plugins/appRegistry";
import { Wallpaper } from "@/shell/Wallpaper";
import { MenuBar } from "@/shell/MenuBar";
import { Dock } from "@/shell/Dock";
import { WindowFrame } from "@/shell/WindowFrame";
import { FullscreenNav } from "@/shell/FullscreenNav";
import { Spotlight } from "@/shell/Spotlight";
import { MonitorWidget } from "@/shell/MonitorWidget";
import { PromptModalHost } from "@/components/PromptModal";
import { ConfirmModalHost } from "@/components/ConfirmModal";
import { ToastHost } from "@/components/ToastHost";
import { PluginOverlays } from "@/plugins/PluginOverlays";
import { WelcomeOverlay } from "@/shell/WelcomeOverlay";
import { WakeFlash } from "@/shell/WakeFlash";
import { RosieTaskChip } from "@/shell/RosieTaskChip";
import { useRosie } from "@/features/rosie/rosieStore";
import { CompanionClipTester } from "@/features/rosie/avatar/CompanionClipTester";
import { useProactiveCompanion } from "@/features/rosie/avatar/useProactiveCompanion";
import { ErrorBoundary } from "@/app/ErrorBoundary";

// three.js + r3f are heavy — keep the companion (and its 3D stack) out of the
// main bundle; it streams in after first paint.
const CompanionAvatar = lazy(() =>
  import("@/features/rosie/avatar/CompanionAvatar").then((m) => ({
    default: m.CompanionAvatar,
  })),
);
// The ROSIE chat surface drags react-markdown + highlight.js with it —
// keep that whole stack out of the main bundle. The store stays eager
// (cheap) so wake-word/commands can flip `open` before the UI ever loaded.
const Rosie = lazy(() =>
  import("@/features/rosie/Rosie").then((m) => ({ default: m.Rosie })),
);

/** Mounts ROSIE on first open and keeps it mounted after, so closing the
 * panel never discards a draft or mid-turn stream state. */
function RosieMount() {
  const open = useRosie((s) => s.open);
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);
  if (!everOpened) return null;
  return (
    <Suspense fallback={null}>
      <Rosie />
    </Suspense>
  );
}

function AppLoading() {
  return (
    <div className="ot-app-loading">
      <div className="ot-claude-orb" style={{ width: 28, height: 28 }} />
    </div>
  );
}

function AppBody({ descriptor }: { descriptor: AppDescriptor }) {
  const Component = descriptor.renderer.component;
  return (
    <Suspense fallback={<AppLoading />}>
      <Component />
    </Suspense>
  );
}

export function Shell() {
  const windows = useShell((s) => s.windows);
  const focusedId = useShell((s) => s.focusedWindowId);
  const apps = useAppDescriptors();
  const appById = new Map(apps.map((app) => [app.id, app]));
  useProactiveCompanion();

  // Prefetch the ROSIE chunk once boot has settled so the first ⌘⇧K /
  // wake-word open renders instantly; rendering stays deferred until then.
  useEffect(() => {
    const t = setTimeout(() => void import("@/features/rosie/Rosie"), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Wallpaper />
      <MenuBar />
      <WelcomeOverlay />
      <div className="ot-windows-layer">
        {windows.map((w) => {
          if (w.minimized) return null;
          const descriptor = appById.get(w.app);
          if (!descriptor) return null;
          // A maximized window fills the canvas, so any window stacked below it
          // (lower z) is fully hidden. Skip its paint/layout via the body's
          // content-visibility while keeping its React tree (pty/editor state)
          // mounted and alive. Never true for a partially-covered window —
          // only a *maximized* window above qualifies.
          const occluded = windows.some(
            (o) =>
              (o.maximized || o.fullscreen) &&
              !o.minimized &&
              o.id !== w.id &&
              o.z > w.z,
          );
          return (
            <WindowFrame
              key={w.id}
              window={w}
              focused={focusedId === w.id}
              occluded={occluded}
              title={descriptor.window.title}
              subtitle={descriptor.window.subtitle}
            >
              <ErrorBoundary label={descriptor.window.title} compact>
                <AppBody descriptor={descriptor} />
              </ErrorBoundary>
            </WindowFrame>
          );
        })}
      </div>
      <FullscreenNav />
      <Dock />
      <Spotlight />
      <PromptModalHost />
      <ConfirmModalHost />
      <ToastHost />
      <PluginOverlays />
      <MonitorWidget />
      <ErrorBoundary label="R.O.S.I.E" compact>
        <RosieMount />
      </ErrorBoundary>
      <ErrorBoundary label="Companion" compact>
        <Suspense fallback={null}>
          <CompanionAvatar />
        </Suspense>
      </ErrorBoundary>
      <CompanionClipTester />
      <RosieTaskChip />
      <WakeFlash />
    </>
  );
}
