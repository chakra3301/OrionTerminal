import { useId, type CSSProperties } from "react";
import "./settingsControls.css";

export function SettingsSlider({ label, value, min = 0, max = 1, step = .05, valueText, hint, gradient, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number;
  valueText?: string; hint?: string; gradient?: string; onChange: (value: number) => void;
}) {
  const id = useId();
  const fill = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <div className="ot-setting-slider">
    <label htmlFor={id}>{label}<output aria-hidden="true">{valueText ?? value}</output></label>
    <input id={id} className="ot-setting-range" type="range" min={min} max={max} step={step} value={value}
      aria-valuetext={valueText} aria-describedby={hint ? `${id}-hint` : undefined}
      style={{ "--range-paint": gradient ?? `linear-gradient(to right, var(--neon-cyan) ${fill}%, var(--glass-border-bright) ${fill}%)` } as CSSProperties}
      onChange={event => onChange(Number(event.target.value))} />
    {hint && <p id={`${id}-hint`}>{hint}</p>}
  </div>;
}
