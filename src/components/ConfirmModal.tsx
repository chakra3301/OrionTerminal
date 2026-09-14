import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalRequest } from "./useModalRequest";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

let openConfirmImpl: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return openConfirmImpl?.(opts) ?? Promise.resolve(false);
}

export function ConfirmModalHost() {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { request, open, close, dialogRef } = useModalRequest<ConfirmOptions, boolean>(false, cancelRef);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    openConfirmImpl = open;
    return () => { if (openConfirmImpl === open) openConfirmImpl = null; };
  }, [open]);

  if (!request) return null;
  const { opts } = request;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ot-prompt-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={opts.body ? bodyId : undefined}
      onCancel={(event) => { event.preventDefault(); close(false); }}
      onClose={(event) => { if (!event.currentTarget.open) close(false); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}
    >
      <div className="ot-prompt-card">
        <div id={titleId} className="ot-prompt-title">{opts.title}</div>
        {opts.body && <div id={bodyId} className="ot-prompt-body">{opts.body}</div>}
        <div className="ot-prompt-actions">
          <button ref={cancelRef} type="button" className="ot-prompt-btn" onClick={() => close(false)}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button type="button" className={`ot-prompt-btn ${opts.danger ? "danger" : "primary"}`} onClick={() => close(true)}>
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
