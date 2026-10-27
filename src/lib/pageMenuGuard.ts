/**
 * WebKit's own context menu offers Back, Forward and Reload, and Reload restarts
 * Orion Terminal, dropping whatever hasn't been saved. Apps open their own
 * menus; anywhere else a right-click does nothing, as in a native app. Text
 * fields keep Cut/Copy/Paste, and selected text keeps Copy and Look Up; neither
 * of those menus offers Reload.
 */
const TYPING_INPUTS = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

/** Whether the target is somewhere the user types, so WebKit's editing menu belongs there. */
export function editsText(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest("input, textarea");
  if (field instanceof HTMLInputElement) return TYPING_INPUTS.has(field.type);
  return !!field || !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

function onSelectedText(page: Document, x: number, y: number) {
  const selection = page.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  return Array.from(selection.getRangeAt(0).getClientRects()).some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

export function installPageMenuGuard(page: Document = document) {
  const guard = (event: MouseEvent) => {
    if (!editsText(event.target) && !onSelectedText(page, event.clientX, event.clientY)) event.preventDefault();
  };
  page.addEventListener("contextmenu", guard);
  return () => page.removeEventListener("contextmenu", guard);
}
