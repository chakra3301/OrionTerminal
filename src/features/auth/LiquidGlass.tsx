import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useGlassRect } from "@/shell/Splash/glassRect";

const CARD_RADIUS = 16; // matches --r-lg

/** Layered liquid-glass card. The real refraction is rendered in WebGL by the
 * energy core's post pass (true edge-lens + chromatic aberration, which CSS
 * backdrop-filter can't do in WebKit) — so this publishes its on-screen rect
 * to `useGlassRect`. The DOM layers add the light frost, specular edge and
 * sheen on top; the body holds the form. */
export function LiquidGlassCard({
  wide,
  onSubmit,
  children,
}: {
  wide?: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    // Track the card's screen rect every frame so the WebGL glass stays locked
    // to it through entrance animations, resizes and layout shifts (a
    // ResizeObserver misses transform-driven moves → the glass would drift off
    // the card and read as a double box). getBoundingClientRect is cheap; we
    // only push to the store when it actually changes.
    let raf = 0;
    let prev = "";
    const tick = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
      if (key !== prev) {
        prev = key;
        useGlassRect.getState().setRect({
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          w: r.width,
          h: r.height,
          r: CARD_RADIUS,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      useGlassRect.getState().setRect(null);
    };
  }, []);

  return (
    <form
      ref={formRef}
      className={`ot-auth-card ot-glass${wide ? " wide" : ""}`}
      onSubmit={onSubmit}
    >
      <span className="ot-glass-tint" aria-hidden />
      <span className="ot-glass-specular" aria-hidden />
      <div className="ot-glass-body">{children}</div>
    </form>
  );
}
