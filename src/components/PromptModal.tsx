import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PromptOptions = {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
};

let openPromptImpl: ((opts: PromptOptions) => Promise<string | null>) | null =
  null;

/**
 * Imperative text-input dialog — `const name = await promptText({ ... })`.
 * Returns the trimmed string on confirm, or null on cancel. Mount
 * <PromptModalHost/> once at the app root for this to work.
 */
export function promptText(opts: PromptOptions): Promise<string | null> {
  if (!openPromptImpl) return Promise.resolve(null);
  return openPromptImpl(opts);
}

export function PromptModalHost() {
  const [state, setState] = useState<{
    opts: PromptOptions;
    resolve: (v: string | null) => void;
  } | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    openPromptImpl = (opts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initialValue ?? "");
        setState({ opts, resolve });
      });
    return () => {
      openPromptImpl = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      // Focus + select the field once it mounts.
      const id = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [state]);

  if (!state) return null;

  const close = (result: string | null) => {
    state.resolve(result);
    setState(null);
  };

  const confirm = () => {
    const v = value.trim();
    close(v.length > 0 ? v : null);
  };

  return createPortal(
    <div className="ot-prompt-overlay" onMouseDown={() => close(null)}>
      <div
        className="ot-prompt-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ot-prompt-title">{state.opts.title}</div>
        {state.opts.label && (
          <div className="ot-prompt-label">{state.opts.label}</div>
        )}
        <input
          ref={inputRef}
          className="ot-prompt-input"
          type="text"
          value={value}
          placeholder={state.opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close(null);
            }
          }}
          spellCheck={false}
        />
        <div className="ot-prompt-actions">
          <button
            type="button"
            className="ot-prompt-btn"
            onClick={() => close(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ot-prompt-btn primary"
            onClick={confirm}
          >
            {state.opts.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
