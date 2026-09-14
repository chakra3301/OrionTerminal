import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalRequest } from "./useModalRequest";

type PromptOptions = {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
};

let openPromptImpl: ((opts: PromptOptions) => Promise<string | null>) | null = null;

export function promptText(opts: PromptOptions): Promise<string | null> {
  return openPromptImpl?.(opts) ?? Promise.resolve(null);
}

export function PromptModalHost() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { request, open, close, dialogRef } = useModalRequest<PromptOptions, string | null>(null, inputRef);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    openPromptImpl = open;
    return () => { if (openPromptImpl === open) openPromptImpl = null; };
  }, [open]);

  useLayoutEffect(() => {
    if (!request || !inputRef.current) return;
    inputRef.current.value = request.opts.initialValue ?? "";
    inputRef.current.select();
  }, [request]);

  if (!request) return null;
  const { opts } = request;
  const confirm = () => close(inputRef.current?.value.trim() || null);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ot-prompt-overlay"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close(null); }}
      onClose={(event) => { if (!event.currentTarget.open) close(null); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(null); }}
    >
      <div className="ot-prompt-card">
        <div id={titleId} className="ot-prompt-title">{opts.title}</div>
        {opts.label && <label className="ot-prompt-label" htmlFor={inputId}>{opts.label}</label>}
        <input
          id={inputId}
          ref={inputRef}
          className="ot-prompt-input"
          type="text"
          aria-labelledby={opts.label ? undefined : titleId}
          defaultValue={opts.initialValue ?? ""}
          placeholder={opts.placeholder}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              confirm();
            }
          }}
          spellCheck={false}
        />
        <div className="ot-prompt-actions">
          <button type="button" className="ot-prompt-btn" onClick={() => close(null)}>Cancel</button>
          <button type="button" className="ot-prompt-btn primary" onClick={confirm}>{opts.confirmLabel ?? "OK"}</button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
