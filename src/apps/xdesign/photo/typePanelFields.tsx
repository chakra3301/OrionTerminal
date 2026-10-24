import { useState, type ReactNode } from "react";
import { runPhotoCommand, usePhotoWorkspace, controlsLocked } from "./runtime";
import { rangeStyle } from "./ImageTypographyPanel";
import type { PhotoLayer } from "./types";
import "./typePanels.css";

/** The Character and Paragraph panels edit the whole selected type layer; a layer's runs and paragraphs come from the host. */
export function useTypeTarget(layer: PhotoLayer | undefined) {
  const busy = usePhotoWorkspace(controlsLocked), text = layer?.text, [error, setError] = useState<string | null>(null);
  const length = text ? Array.from(text.text).length : 0, off = busy || !text;
  const value = (field: string, paragraph = false): unknown => text ? rangeStyle((paragraph ? text.paragraphs : text.runs) ?? [], [0, length], field) : undefined;
  const update = (patch: Record<string, unknown>) => { if (!layer) return; setError(null); void runPhotoCommand("type.setStyle", { layer: layer.id, ...patch }).catch(reason => setError(String(reason))); };
  return { text, off, value, update, error, setError };
}

export function NumberField({ label, field, current, min, max, update, off, unit }: { label: string; field: string; current: unknown; min: number; max: number; update: (patch: Record<string, unknown>) => void; off: boolean; unit?: string }) {
  return <label className="xd-type-field">{label}<input aria-label={label} key={String(current)} type="number" min={min} max={max} step="any" placeholder="Mixed" disabled={off} defaultValue={typeof current === "number" ? Math.round(current * 100) / 100 : ""}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
    onBlur={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max && next !== current) update({ [field]: next }); }}/>{unit && <span className="xd-type-unit">{unit}</span>}</label>;
}

export function ToggleButton({ label, title, pressed, off, run, children }: { label: string; title?: string; pressed: boolean; off: boolean; run: () => void; children: ReactNode }) {
  return <button type="button" className="xd-type-toggle" aria-label={label} title={title ?? label} aria-pressed={pressed} disabled={off} onClick={run}>{children}</button>;
}

export const TypeEmpty = ({ what }: { what: string }) => <p className="xd-type-empty">Select a type layer to edit its {what}.</p>;
