import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
import { useCoreReactions } from "@/shell/Splash/coreReactions";
import { useWallpaperStore } from "@/store/wallpaperStore";
import { useVisualActivity } from "@/components/effects/useVisualActivity";
import { useShell } from "@/shell/store/useShell";

const EnergyCore = lazy(() =>
  import("@/shell/Splash/EnergyCore").then((m) => ({ default: m.EnergyCore })),
);

class CoreBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Same interactivity as the startup core: keystrokes spark it, and the cursor
// tilts it (with a velocity-driven spark on fast moves).
function useCoreInteraction(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const { spark, setPointer } = useCoreReactions.getState();

    const onKey = () => spark();

    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let lastSparkT = 0;
    let primed = false;
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      setPointer(nx, ny);
      const now = performance.now();
      if (primed) {
        const dt = Math.max(1, now - lastT);
        const speed = Math.hypot(e.clientX - lastX, e.clientY - lastY) / dt;
        if (speed > 1.4 && now - lastSparkT > 90) {
          spark();
          lastSparkT = now;
        }
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
      primed = true;
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      setPointer(0, 0);
    };
  }, [enabled]);
}

export function CoreOverlay({ preview = false }: { preview?: boolean }) {
  const occluded = useShell((s) => s.windows.some((w) => w.maximized && !w.minimized));
  const { ref, active } = useVisualActivity<HTMLDivElement>(preview || !occluded);
  useCoreInteraction(!preview && active);
  const hue = useWallpaperStore((s) => s.coreHue);
  return (
    <div ref={ref} className="ot-wp-core">
      <div className="ot-wp-core-glow" />
      <div className="ot-wp-core-canvas">
        <CoreBoundary>
          <Suspense fallback={null}>
            <EnergyCore
              mode="idle"
              paused={!active}
              particleCount={520}
              hue={hue}
            />
          </Suspense>
        </CoreBoundary>
      </div>
      <div className="ot-wp-core-vignette" />
    </div>
  );
}
