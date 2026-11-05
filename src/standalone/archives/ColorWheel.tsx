// EMP's colour wheel (packages/ui/src/components/ColorWheel.tsx), ported as is. A colour wheel: hue around the disc, saturation from the centre out, plus a brightness slider.
// The spectrum gradients are built here (they are the picker itself, not theme colours).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { hexToHsv, hsvToHex, isHex, type Hsv } from "./color";

const HUE_STOPS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% 50%)`).join(", ");
const DISC = `radial-gradient(circle closest-side, hsl(0 0% 100%), hsl(0 0% 100% / 0)), conic-gradient(${HUE_STOPS})`;

export interface ColorWheelProps {
  label: string;
  value: string;
  /** `final` is false while dragging (preview), true on release / keyboard / text entry. */
  onChange(hex: string, final: boolean): void;
}

export function ColorWheel({ label, value, onChange }: ColorWheelProps) {
  // Kept locally so hue survives greys (where hex alone loses it).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 220, s: 1, v: 1 });
  const [text, setText] = useState(value);
  const disc = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    setText(value);
    if (hsvToHex(hsv) !== value) {
      const next = hexToHsv(value);
      if (next) setHsv((prev) => (next.s === 0 || next.v === 0 ? { ...next, h: prev.h } : next));
    }
    // Only external changes (the hex field, Reset, another window) resync the wheel.
  }, [value]);

  const commit = (next: Hsv, final: boolean) => {
    setHsv(next);
    onChange(hsvToHex(next), final);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>, final: boolean) => {
    const r = disc.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    commit({ h, s, v: hsv.v || 1 }, final);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15 : 3;
    const next = { ...hsv };
    if (e.key === "ArrowLeft") next.h = (hsv.h - step + 360) % 360;
    else if (e.key === "ArrowRight") next.h = (hsv.h + step) % 360;
    else if (e.key === "ArrowUp") next.s = Math.min(1, hsv.s + step / 100);
    else if (e.key === "ArrowDown") next.s = Math.max(0, hsv.s - step / 100);
    else return;
    e.preventDefault();
    commit(next, true);
  };

  const rad = (hsv.h * Math.PI) / 180;
  const marker = { left: `${50 + 50 * hsv.s * Math.sin(rad)}%`, top: `${50 - 50 * hsv.s * Math.cos(rad)}%` };
  const pure = hsvToHex({ h: hsv.h, s: hsv.s, v: 1 });

  return (
    <div className="a47-wheel">
      <div
        ref={disc}
        className="a47-wheel__disc"
        role="slider"
        tabIndex={0}
        aria-label={`${label}: hue and saturation`}
        aria-valuetext={value}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuemin={0}
        aria-valuemax={360}
        style={{ background: DISC }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          fromPointer(e, false);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e, false)}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          fromPointer(e, true);
        }}
        onKeyDown={onKey}
      >
        <span className="a47-wheel__dim" style={{ background: `hsl(0 0% 0% / ${1 - hsv.v})` }} aria-hidden="true" />
        <span className="a47-wheel__marker" style={{ ...marker, background: value } as CSSProperties} aria-hidden="true" />
      </div>
      <div className="a47-wheel__side">
        <label className="a47-wheel__field">
          <span className="a47-wheel__caption">Brightness</span>
          <input
            type="range"
            className="a47-wheel__brightness"
            aria-label={`${label}: brightness`}
            min={0}
            max={100}
            value={Math.round(hsv.v * 100)}
            style={{ background: `linear-gradient(to right, hsl(0 0% 0%), ${pure})` }}
            onChange={(e) => commit({ ...hsv, v: Number(e.target.value) / 100 }, false)}
            onPointerUp={() => onChange(hsvToHex(hsv), true)}
            onKeyUp={() => onChange(hsvToHex(hsv), true)}
          />
        </label>
        <label className="a47-wheel__field">
          <span className="a47-wheel__caption">Hex</span>
          <span className="a47-wheel__hex">
            <span className="a47-wheel__swatch" style={{ background: value }} aria-hidden="true" />
            <input
              className="cp-input a47-wheel__input"
             
              aria-label={`${label}: hex`}
              spellCheck={false}
              value={text}
              onChange={(e) => {
                const v = e.target.value.trim();
                setText(v);
                if (isHex(v)) onChange(v.toLowerCase(), true);
              }}
              onBlur={() => setText(value)}
            />
          </span>
        </label>
      </div>
    </div>
  );
}
