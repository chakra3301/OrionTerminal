import type { PointerEvent } from "react";

// Tauri's native drop handler claims every drag over the webview (tauri-runtime-wry always reports
// it handled), so WebKit never fires dragover/drop; reordering rows has to run on pointer events.
export type RowDrag = {
  /** The rows that can take a drop are the `[data-drop-target]` elements inside this one. */
  scope: string;
  /** Copied under the pointer while dragging, like Photoshop's translucent row. */
  ghost: HTMLElement;
  /** The drop position for the row under the pointer, or null when it can't take the drop. */
  position: (target: HTMLElement, clientY: number) => string | null;
  drop: (target: HTMLElement, position: string) => void;
};

const THRESHOLD = 4;

export function startRowDrag(event: PointerEvent<HTMLElement>, drag: RowDrag) {
  if (event.button !== 0) return;
  const scope = event.currentTarget.closest(drag.scope), startX = event.clientX, startY = event.clientY;
  if (!scope) return;
  let ghost: HTMLElement | null = null, origin = { x: 0, y: 0 }, current: { target: HTMLElement; position: string } | null = null;
  const show = (next: typeof current) => {
    if (current && current.target !== next?.target) delete current.target.dataset.drop;
    current = next;
    if (current) current.target.dataset.drop = current.position;
  };
  const move = (moved: globalThis.PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < THRESHOLD) return;
      ghost = drag.ghost.cloneNode(true) as HTMLElement;
      ghost.classList.add("xd-photo-row-ghost"); ghost.removeAttribute("data-drop-target"); ghost.setAttribute("aria-hidden", "true"); ghost.inert = true; ghost.style.width = `${drag.ghost.offsetWidth}px`;
      (scope.closest(".xd-photo") ?? scope).append(ghost);
      // A transformed window becomes the containing block of a fixed element, so measure where it landed.
      const placed = ghost.getBoundingClientRect(); origin = { x: placed.left, y: placed.top };
      document.documentElement.classList.add("xd-photo-row-dragging");
    }
    ghost.style.transform = `translate(${moved.clientX - origin.x + 8}px,${moved.clientY - origin.y - ghost.offsetHeight / 2}px)`;
    const target = document.elementFromPoint(moved.clientX, moved.clientY)?.closest<HTMLElement>("[data-drop-target]");
    const position = target && scope.contains(target) ? drag.position(target, moved.clientY) : null;
    show(target && position ? { target, position } : null);
  };
  const end = (commit: boolean) => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key, true);
    const dropped = current; show(null);
    if (!ghost) return;
    ghost.remove(); document.documentElement.classList.remove("xd-photo-row-dragging");
    // The release would otherwise click the row it started on and select it again.
    const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true));
    if (commit && dropped) drag.drop(dropped.target, dropped.position);
  };
  const up = () => end(true), cancel = () => end(false);
  const key = (pressed: KeyboardEvent) => { if (pressed.key === "Escape") { pressed.preventDefault(); pressed.stopPropagation(); end(false); } };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", key, true);
}
