import { useEffect, useRef } from "react";

export function useControlPanelFocus(open: boolean, hide: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    (ref.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? ref.current?.querySelector<HTMLElement>("button"))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open], .ot-prompt-overlay, .ot-spotlight-overlay")) return;
      if (event.key === "Escape") { event.preventDefault(); hide(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const controls = Array.from(ref.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]"))
        .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); ref.current.focus(); return; }
      if (!ref.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, hide]);
  return ref;
}
