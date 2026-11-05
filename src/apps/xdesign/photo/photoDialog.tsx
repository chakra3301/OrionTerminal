import { useEffect, useRef, useState, type HTMLAttributes, type PointerEvent, type ReactNode, type Ref, type SubmitEventHandler } from "react";
import "./photoDialog.css";

/** Alt/Option and Ctrl/Command as currently held; Photoshop dialogs relabel buttons while they are down. */
export function useHeldModifiers() {
  const [held, setHeld] = useState({ alt: false, command: false });
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setHeld(current => current.alt === event.altKey && current.command === (event.metaKey || event.ctrlKey) ? current : { alt: event.altKey, command: event.metaKey || event.ctrlKey });
    const clear = () => setHeld({ alt: false, command: false });
    window.addEventListener("keydown", sync); window.addEventListener("keyup", sync); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", sync); window.removeEventListener("keyup", sync); window.removeEventListener("blur", clear); };
  }, []);
  return held;
}

type Drag = { pointer: number; x: number; y: number; from: [number, number]; min: [number, number]; max: [number, number] };

// Photoshop reopens a moved dialog where it was left; offsets are from the dialog's default place, kept for the session.
const positions = new Map<string, [number, number]>();

/** Moves a dialog by its title bar. The dialog's parent bounds the drag so the title bar cannot be lost off screen. `memory` names the dialog whose place is kept. */
export function useDialogDrag(memory?: string) {
  const [offset, setOffset] = useState<[number, number]>(() => (memory && positions.get(memory)) || [0, 0]);
  const drag = useRef<Drag | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const form = event.currentTarget.closest("form"), parent = form?.parentElement;
    if (event.button !== 0 || !form || !parent || (event.target as Element).closest("button,input,select,textarea,a")) return;
    const box = form.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    drag.current = { pointer: event.pointerId ?? 0, x: event.clientX, y: event.clientY, from: offset, min: [Math.min(0, bounds.left - box.left), Math.min(0, bounds.top - box.top)], max: [Math.max(0, bounds.right - box.right), Math.max(0, bounds.bottom - box.bottom)] };
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current; if (!current || current.pointer !== (event.pointerId ?? 0)) return;
    const clamp = (axis: 0 | 1, delta: number) => current.from[axis] + Math.max(current.min[axis], Math.min(current.max[axis], delta));
    const next: [number, number] = [clamp(0, event.clientX - current.x), clamp(1, event.clientY - current.y)];
    if (memory) positions.set(memory, next);
    setOffset(next);
  };
  const end = (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointer === (event.pointerId ?? 0)) drag.current = null; };
  return { style: { transform: `translate(${offset[0]}px, ${offset[1]}px)` }, handle: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end } };
}

type PreviewToggle = { checked: boolean; disabled?: boolean; busy?: boolean; change: (checked: boolean) => void };

/** Photoshop's modal frame: a title bar to drag it by, the controls, and a right-hand column with OK above Cancel. Holding Alt turns Cancel into Reset when the dialog can restore its opening values; information dialogs pass `cancel={false}` for OK alone. */
export function PhotoDialog({ dialog, title, label, className, beside = false, busy = false, ok = "OK", okDisabled = false, cancel = true, noValidate, close, reset, onSubmit, buttons, preview, scrim, children }: {
  dialog: Ref<HTMLFormElement>; title: ReactNode; label?: string; className?: string; beside?: boolean; busy?: boolean; ok?: ReactNode; okDisabled?: boolean; cancel?: boolean; noValidate?: boolean;
  close: () => void; reset?: () => void; onSubmit: SubmitEventHandler<HTMLFormElement>; buttons?: ReactNode; preview?: PreviewToggle; scrim?: HTMLAttributes<HTMLDivElement>; children: ReactNode;
}) {
  const held = useHeldModifiers(), drag = useDialogDrag(label ?? (typeof title === "string" ? title : className));
  return <div {...scrim} className={["xd-photo-dialog-scrim xd-ps-dialog-scrim", beside && "is-beside", scrim?.className].filter(Boolean).join(" ")}>
    <form ref={dialog} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)} className={`xd-photo-dialog xd-ps-dialog${className ? ` ${className}` : ""}`} style={drag.style} noValidate={noValidate} onSubmit={onSubmit}>
      <header {...drag.handle}><h3>{title}</h3></header>
      <div className="xd-ps-dialog-body">
        <div className="xd-ps-dialog-main">{children}</div>
        <div className="xd-ps-dialog-buttons">
          <button type="submit" disabled={busy || okDisabled}>{ok}</button>
          {cancel && <button type="button" disabled={busy} onClick={event => { if (event.altKey && reset) reset(); else close(); }}>{held.alt && reset ? "Reset" : "Cancel"}</button>}
          {buttons}
          {preview && <label className="xd-ps-dialog-check"><input type="checkbox" checked={preview.checked} disabled={preview.disabled} onChange={event => preview.change(event.target.checked)}/>Preview</label>}
          {preview?.busy && <span className="xd-ps-dialog-progress" role="status" aria-label="Updating preview"/>}
        </div>
      </div>
    </form>
  </div>;
}
