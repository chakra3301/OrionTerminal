import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Request<Options, Result> = { opts: Options; resolve: (value: Result) => void };

export function useModalRequest<Options, Result>(cancelled: Result, initialFocus: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<Request<Options, Result> | null>(null);
  const pending = useRef<Request<Options, Result> | null>(null);
  const mounted = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = pending.current;
      pending.current = null;
      current?.resolve(cancelled);
    };
  }, [cancelled]);

  const open = useCallback((opts: Options): Promise<Result> => {
    // A second caller must not replace an unresolved user decision.
    if (!mounted.current || pending.current) return Promise.resolve(cancelled);
    return new Promise(resolve => {
      const next = { opts, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, [cancelled]);

  const close = useCallback((value: Result) => {
    if (!request || pending.current !== request) return;
    pending.current = null;
    setRequest(null);
    request.resolve(value);
  }, [request]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!request || !dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    initialFocus.current?.focus();
    if (initialFocus.current instanceof HTMLInputElement) initialFocus.current.select();
    // WebKit can tab past the last control into its browser focus loop even
    // while the page behind showModal() remains inert.
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return;
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    dialog.addEventListener("keydown", trapTab);
    return () => {
      dialog.removeEventListener("keydown", trapTab);
      if (dialog.open) dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [request, initialFocus]);

  return { request, open, close, dialogRef };
}
