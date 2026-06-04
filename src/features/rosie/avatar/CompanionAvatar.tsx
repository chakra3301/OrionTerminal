import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useDraggable } from "@/shell/useDraggable";
import { useRosie } from "@/features/rosie/rosieStore";
import { CompanionScene } from "./CompanionScene";
import { useCompanionProactive } from "./companionProactiveStore";
import { dragState } from "./dragState";

const W = 300;
const H = 460;
const THROW_SPEED = 1.3; // px/ms — a flick at least this fast dismisses her
const VELOCITY_STALE_MS = 90; // a pause-then-release is not a throw

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const defaultPos = () => ({
  left: Math.max(8, window.innerWidth - W - 24),
  top: Math.max(36, window.innerHeight - H - 96), // hover above the dock
});

/**
 * The floating ROSIE companion: a draggable, transparent widget hosting her 3D
 * avatar over the shell. Always visible by default. Drag to reposition; a
 * click (no drag) toggles the ROSIE chat panel; flinging her off-screen (or
 * dragging her mostly off an edge) dismisses her until she's summoned again
 * (Spotlight → "Summon ROSIE", or ⌥R). Otherwise she snaps back on-screen.
 */
export function CompanionAvatar() {
  const visible = useRosie((s) => s.companionVisible);
  const togglePanel = useRosie((s) => s.togglePanel);
  const openPanel = useRosie((s) => s.openPanel);
  const dismissCompanion = useRosie((s) => s.dismissCompanion);
  const proactivePrompt = useCompanionProactive((s) => s.prompt);
  const dismissProactive = useCompanionProactive((s) => s.dismiss);
  const [box, setBox] = useState(defaultPos);
  const [dragging, setDragging] = useState(false);
  // Track the OS window being hidden/minimized so we can park the render loop.
  const [docHidden, setDocHidden] = useState(() => document.hidden);
  const wasVisible = useRef(visible);
  const drag = useRef({
    left: 0,
    top: 0,
    moved: false,
    lastT: 0,
    lastDx: 0,
    lastDy: 0,
    vx: 0,
    vy: 0,
  });

  // Keep her on-screen when the OS window is resized.
  useEffect(() => {
    const onResize = () =>
      setBox((b) => ({
        left: clamp(b.left, 8, window.innerWidth - W - 8),
        top: clamp(b.top, 36, window.innerHeight - H - 8),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Park the render loop while the window is hidden/minimized.
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Summoning her back drops her at the default spot (she may have been flung
  // off-screen). The Canvas itself never unmounts — we only hide it — so there's
  // exactly one WebGL context for the app's lifetime (no context churn/leak).
  useEffect(() => {
    if (visible && !wasVisible.current) setBox(defaultPos());
    wasVisible.current = visible;
  }, [visible]);

  // A proactive question auto-dismisses after a while if ignored.
  useEffect(() => {
    if (!proactivePrompt) return;
    const id = setTimeout(dismissProactive, 14000);
    return () => clearTimeout(id);
  }, [proactivePrompt, dismissProactive]);

  const { onMouseDown } = useDraggable({
    onStart: () => {
      drag.current = {
        left: box.left,
        top: box.top,
        moved: false,
        lastT: performance.now(),
        lastDx: 0,
        lastDy: 0,
        vx: 0,
        vy: 0,
      };
      setDragging(true);
      dragState.dragging = true;
      dragState.vx = 0;
      dragState.vy = 0;
    },
    onDrag: (dx, dy) => {
      const now = performance.now();
      const dt = now - drag.current.lastT;
      if (dt > 0) {
        drag.current.vx = (dx - drag.current.lastDx) / dt;
        drag.current.vy = (dy - drag.current.lastDy) / dt;
        drag.current.lastT = now;
        drag.current.lastDx = dx;
        drag.current.lastDy = dy;
      }
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
      // Feed the rig so she ragdolls toward the drag motion.
      dragState.vx = drag.current.vx;
      dragState.vy = drag.current.vy;
      // No clamp during the drag — she's allowed off-screen so she can be thrown.
      setBox({ left: drag.current.left + dx, top: drag.current.top + dy });
    },
    onEnd: () => {
      setDragging(false);
      // Released: the rig's spring keeps her momentum, then flops back upright.
      dragState.dragging = false;
      const stale = performance.now() - drag.current.lastT > VELOCITY_STALE_MS;
      const speed = stale ? 0 : Math.hypot(drag.current.vx, drag.current.vy);
      setBox((b) => {
        const cx = b.left + W / 2;
        const cy = b.top + H / 2;
        const offscreen =
          cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight;
        if (offscreen || speed > THROW_SPEED) {
          dismissCompanion();
          return b; // about to unmount anyway
        }
        return {
          left: clamp(b.left, 8, window.innerWidth - W - 8),
          top: clamp(b.top, 36, window.innerHeight - H - 8),
        };
      });
    },
  });

  return (
    <div
      className={`ot-companion${dragging ? " dragging" : ""}${
        visible ? "" : " hidden"
      }`}
      style={{ left: box.left, top: box.top, width: W, height: H }}
      onMouseDown={onMouseDown}
      onClick={() => {
        if (!drag.current.moved) togglePanel();
      }}
      title="R.O.S.I.E — drag to move · fling off-screen to dismiss · click to talk"
    >
      {visible && proactivePrompt && (
        <div
          className="ot-companion-bubble"
          data-no-drag
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openPanel();
            dismissProactive();
          }}
          title="Click to reply"
        >
          <button
            type="button"
            className="bubble-x"
            data-no-drag
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissProactive();
            }}
          >
            <X size={11} />
          </button>
          <span className="bubble-text">{proactivePrompt}</span>
        </div>
      )}
      <CompanionScene frameloop={visible && !docHidden ? "always" : "never"} />
      <div className="ot-companion-base" aria-hidden />
    </div>
  );
}
