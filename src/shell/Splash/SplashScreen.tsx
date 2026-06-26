import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { EnergyCore, type CoreMode } from "./EnergyCore";
import "./splash.css";

const FADE_MS = 480;

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}
function reduceGlassActive(): boolean {
  return document.documentElement.classList.contains("ot-reduce-glass");
}

/** Renders the CSS glow only if the WebGL canvas blows up — the splash must
 * never block boot behind a GPU error. */
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

export function SplashScreen({
  mode = "launch",
  ready = true,
  minMs = 1300,
  particleCount,
  onDone,
}: {
  mode?: CoreMode;
  /** Gate dismissal — the cold-boot splash waits for hydrate() before fading.
   * Idle/preview backdrops pass false to stay up indefinitely. */
  ready?: boolean;
  minMs?: number;
  particleCount?: number;
  onDone?: () => void;
}) {
  const [fading, setFading] = useState(false);
  // Only the OS "Reduce Motion" accessibility preference makes the core static.
  // The app's reduce_glass (a GPU/transparency setting) merely trims particle
  // count — the one-shot launch animation still plays.
  const staticCore = useRef(prefersReducedMotion()).current;
  const lowGpu = useRef(prefersReducedMotion() || reduceGlassActive()).current;
  const mountedAt = useRef(performance.now());
  const doneFired = useRef(false);

  // Begin the cross-fade once boot is ready AND the minimum on-screen time has
  // elapsed (never just a flash). minMs trimmed when motion is reduced.
  useEffect(() => {
    if (!ready || !onDone || fading) return;
    const effMin = staticCore ? Math.min(minMs, 800) : minMs;
    const remaining = Math.max(0, effMin - (performance.now() - mountedAt.current));
    const t = setTimeout(() => setFading(true), remaining);
    return () => clearTimeout(t);
  }, [ready, onDone, fading, minMs, staticCore]);

  // After the fade transition, hand off.
  useEffect(() => {
    if (!fading || !onDone || doneFired.current) return;
    const t = setTimeout(() => {
      doneFired.current = true;
      onDone();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [fading, onDone]);

  const count =
    particleCount ??
    (mode === "idle"
      ? lowGpu
        ? 220
        : 520
      : staticCore
        ? 140
        : lowGpu
          ? 850
          : 1600);

  return (
    <div
      className={`ot-splash${fading ? " out" : ""}${mode === "idle" ? " idle" : ""}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      aria-hidden
    >
      <div className="ot-splash-glow" />
      <div className="ot-splash-vignette" />
      <div className="ot-splash-canvas">
        <CoreBoundary>
          <EnergyCore mode={mode} reduced={staticCore} particleCount={count} />
        </CoreBoundary>
      </div>
      {mode === "launch" && (
        <div className="ot-splash-label">
          <span className="ot-splash-mark">ORION TERMINAL</span>
          <span className="ot-splash-sub">initializing core</span>
        </div>
      )}
    </div>
  );
}
