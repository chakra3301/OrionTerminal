import { lazy, Suspense } from "react";
import { useShell, type AppId } from "@/shell/store/useShell";
import { Wallpaper } from "@/shell/Wallpaper";
import { MenuBar } from "@/shell/MenuBar";
import { Dock } from "@/shell/Dock";
import { WindowFrame } from "@/shell/WindowFrame";
import { Spotlight } from "@/shell/Spotlight";
import { MonitorWidget } from "@/shell/MonitorWidget";
import { PromptModalHost } from "@/components/PromptModal";
import { ConfirmModalHost } from "@/components/ConfirmModal";
import { ToastHost } from "@/components/ToastHost";
import { WelcomeOverlay } from "@/shell/WelcomeOverlay";
import { WakeFlash } from "@/shell/WakeFlash";
import { RosieTaskChip } from "@/shell/RosieTaskChip";
import { Rosie } from "@/features/rosie/Rosie";
import { CompanionClipTester } from "@/features/rosie/avatar/CompanionClipTester";
import { useProactiveCompanion } from "@/features/rosie/avatar/useProactiveCompanion";
import { ErrorBoundary } from "@/app/ErrorBoundary";

// Each app is a heavy, independent surface (Monaco, BlockNote, the XDesign
// canvas). Lazy-load them so the main bundle stays lean and an app's code
// only downloads when its window first opens. Named-export → default shim.
const OrionApp = lazy(() =>
  import("@/apps/orion/OrionApp").then((m) => ({ default: m.OrionApp })),
);
const ArchivesApp = lazy(() =>
  import("@/apps/archives/ArchivesApp").then((m) => ({ default: m.ArchivesApp })),
);
const XDesignApp = lazy(() =>
  import("@/apps/xdesign/XDesignApp").then((m) => ({ default: m.XDesignApp })),
);
const HermesApp = lazy(() =>
  import("@/apps/hermes/HermesApp").then((m) => ({ default: m.HermesApp })),
);
// three.js + r3f are heavy — keep the companion (and its 3D stack) out of the
// main bundle; it streams in after first paint.
const CompanionAvatar = lazy(() =>
  import("@/features/rosie/avatar/CompanionAvatar").then((m) => ({
    default: m.CompanionAvatar,
  })),
);

function AppLoading() {
  return (
    <div className="ot-app-loading">
      <div className="ot-claude-orb" style={{ width: 28, height: 28 }} />
    </div>
  );
}

function AppBody({ app }: { app: AppId }) {
  return (
    <Suspense fallback={<AppLoading />}>
      {app === "orion" && <OrionApp />}
      {app === "archives" && <ArchivesApp />}
      {app === "xdesign" && <XDesignApp />}
      {app === "hermes" && <HermesApp />}
    </Suspense>
  );
}

const APP_TITLES: Record<AppId, { title: string; subtitle: string }> = {
  orion:    { title: "ORION",        subtitle: "orix47" },
  archives: { title: "ARCHIVES 47",  subtitle: "today" },
  xdesign:  { title: "XDESIGN",      subtitle: "untitled frame" },
  hermes:   { title: "HERMES",       subtitle: "agent board" },
};

export function Shell() {
  const windows = useShell((s) => s.windows);
  const focusedId = useShell((s) => s.focusedWindowId);
  useProactiveCompanion();

  return (
    <>
      <Wallpaper />
      <MenuBar />
      <WelcomeOverlay />
      <div className="ot-windows-layer">
        {windows.map((w) => {
          if (w.minimized) return null;
          const meta = APP_TITLES[w.app];
          return (
            <WindowFrame
              key={w.id}
              window={w}
              focused={focusedId === w.id}
              title={meta.title}
              subtitle={meta.subtitle}
            >
              <ErrorBoundary label={meta.title} compact>
                <AppBody app={w.app} />
              </ErrorBoundary>
            </WindowFrame>
          );
        })}
      </div>
      <Dock />
      <Spotlight />
      <PromptModalHost />
      <ConfirmModalHost />
      <ToastHost />
      <MonitorWidget />
      <ErrorBoundary label="R.O.S.I.E" compact>
        <Rosie />
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
