import { useEffect, useLayoutEffect, useState } from "react";
import { useOnboarding, COACH_STEPS } from "./onboardingStore";
import "./walkthrough.css";

type Rect = { left: number; top: number; width: number; height: number };

const PAD = 10;
const CARD_W = 312;

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function Walkthrough() {
  const active = useOnboarding((s) => s.active);
  const step = useOnboarding((s) => s.step);
  const next = useOnboarding((s) => s.next);
  const prev = useOnboarding((s) => s.prev);
  const dismiss = useOnboarding((s) => s.dismiss);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = COACH_STEPS[step];

  // Re-measure on step change, resize, and once more next frame (dock magnify /
  // layout settle). Skip steps whose target can't be found.
  useLayoutEffect(() => {
    if (!active || !current) return;
    let raf = 0;
    const update = () => setRect(measure(current.selector));
    update();
    raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [active, current, step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, dismiss, next, prev]);

  if (!active || !current) return null;

  const isLast = step === COACH_STEPS.length - 1;

  // Card sits above the highlighted target (the dock lives at the bottom),
  // horizontally centred on it and clamped to the viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetCenterX = rect ? rect.left + rect.width / 2 : vw / 2;
  const cardLeft = Math.max(
    16,
    Math.min(targetCenterX - CARD_W / 2, vw - CARD_W - 16),
  );
  const cardBottom = rect ? vh - rect.top + 16 : 120;

  return (
    <div className="ot-coach" onMouseDown={(e) => e.stopPropagation()}>
      {/* Dim everything except a cutout over the target. */}
      {rect ? (
        <div
          className="ot-coach-cutout"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="ot-coach-dim" />
      )}

      <div
        className="ot-coach-card"
        style={{ left: cardLeft, bottom: cardBottom, width: CARD_W }}
      >
        <div className="ot-coach-step">
          Step {step + 1} of {COACH_STEPS.length}
        </div>
        <div className="ot-coach-title">{current.title}</div>
        <div className="ot-coach-body">{current.body}</div>

        <div className="ot-coach-dots">
          {COACH_STEPS.map((_, i) => (
            <span key={i} className={`dot${i === step ? " on" : ""}`} />
          ))}
        </div>

        <div className="ot-coach-actions">
          <button type="button" className="ot-coach-skip" onClick={dismiss}>
            Skip tour
          </button>
          <div className="ot-coach-nav">
            {step > 0 && (
              <button type="button" className="ot-coach-back" onClick={prev}>
                Back
              </button>
            )}
            <button type="button" className="ot-coach-next" onClick={next}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
