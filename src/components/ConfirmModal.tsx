import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action — confirm button renders magenta. */
  danger?: boolean;
};

let openConfirmImpl: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Imperative confirm dialog — `if (await confirmAction({ ... })) { … }`.
 * In-canvas styling (use this instead of the native Tauri dialog). Mount
 * <ConfirmModalHost/> once at the app root. Prefer `toast.undo` over a
 * confirm when the action can be cheaply reversed.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (!openConfirmImpl) return Promise.resolve(false);
  return openConfirmImpl(opts);
}

export function ConfirmModalHost() {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openConfirmImpl = (opts) =>
      new Promise<boolean>((resolve) => setState({ opts, resolve }));
    return () => {
      openConfirmImpl = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      const id = setTimeout(() => confirmRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [state]);

  if (!state) return null;

  const close = (result: boolean) => {
    state.resolve(result);
    setState(null);
  };

  return createPortal(
    <div className="ot-prompt-overlay" onMouseDown={() => close(false)}>
      <div
        className="ot-prompt-card"
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            close(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close(false);
          }
        }}
      >
        <div className="ot-prompt-title">{state.opts.title}</div>
        {state.opts.body && (
          <div className="ot-prompt-body">{state.opts.body}</div>
        )}
        <div className="ot-prompt-actions">
          <button
            type="button"
            className="ot-prompt-btn"
            onClick={() => close(false)}
          >
            {state.opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`ot-prompt-btn ${state.opts.danger ? "danger" : "primary"}`}
            onClick={() => close(true)}
          >
            {state.opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
