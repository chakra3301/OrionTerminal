import { useLayoutEffect, useRef } from "react";

const dialogs: HTMLElement[] = [];
export const isDesignDialogOpen = () => dialogs.length > 0;

/** Keep keyboard focus in the active editor dialog and return it when the dialog closes. */
export function useDesignDialog<T extends HTMLElement>(close: () => void, busy = false, options: { additionalRoots?: () => readonly (Element | null)[]; focusRoot?: () => Element | null } = {}) {
  const element = useRef<T>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const actions = useRef({ close, busy, options }); actions.current = { close, busy, options };
  useLayoutEffect(() => {
    const dialog = element.current; if (!dialog) return;
    dialogs.push(dialog);
    const roots = () => [actions.current.options.focusRoot?.() ?? dialog, ...(actions.current.options.additionalRoots?.() ?? []).filter((root): root is Element => !!root)];
    const contains = (node: Node | null) => roots().some(root => root.contains(node));
    const focusable = () => roots().flatMap(root => [...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"],a[href]')])
      .filter(node => {
        const details = node.closest('details:not([open])');
        return node.tabIndex >= 0 && !node.closest('[hidden],[inert]') && (!details || node.tagName === "SUMMARY" && node.parentElement === details) && getComputedStyle(node).display !== "none";
      });
    dialog.tabIndex = -1;
    if (!contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return;
      // A menu opened from the dialog handles its own Escape and arrow keys.
      if ((event.target as Element | null)?.closest?.('[role="menu"]')) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!actions.current.busy) actions.current.close();
      } else if (event.key === "Tab") {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        const active = document.activeElement;
        if (!first || !last) { event.preventDefault(); dialog.focus(); }
        else if (!contains(active) || (event.shiftKey && (active === first || active === dialog))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (!event.shiftKey && (active === last || active === dialog)) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      const index = dialogs.indexOf(dialog); if (index !== -1) dialogs.splice(index, 1);
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, []);
  return element;
}
