import type { ReactNode } from "react";
import { X } from "lucide-react";

export type SelectionAction = {
  key: string;
  label: string;
  Icon: typeof X;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

export function SelectionBar({
  count,
  noun,
  onClear,
  actions,
}: {
  count: number;
  noun: string; // singular noun ("asset", "tile", …)
  onClear: () => void;
  actions: SelectionAction[];
}) {
  if (count === 0) return null;
  return (
    <div className="ar-selection-bar" role="region" aria-label="Selection">
      <div className="ar-selection-count">
        {count} {count === 1 ? noun : `${noun}s`} selected
      </div>
      <div className="ar-selection-spacer" />
      <div className="ar-selection-actions">
        {actions.map((a) => {
          const Icon = a.Icon;
          return (
            <button
              type="button"
              key={a.key}
              className={`ar-selection-btn${a.tone === "danger" ? " danger" : ""}`}
              onClick={a.onClick}
              disabled={a.disabled}
            >
              <Icon size={12} />
              {a.label}
            </button>
          );
        })}
        <button
          type="button"
          className="ar-selection-btn ghost"
          onClick={onClear}
          title="Clear (Esc)"
        >
          <X size={12} />
          Clear
        </button>
      </div>
    </div>
  );
}

export function SelectionHint({ children }: { children: ReactNode }) {
  return <span className="ar-selection-hint">{children}</span>;
}
