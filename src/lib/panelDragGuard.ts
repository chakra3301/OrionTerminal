/**
 * WebKit (Tauri's macOS webview) fires pointerleave/pointerout with
 * `buttons === 0` while the button is still held, whenever the element under
 * the cursor changes mid-drag. react-resizable-panels listens for those on
 * <body> and reads `buttons === 0` as "released outside the window", so a
 * divider let go of the cursor after a few pixels. This swallows those
 * boundary events before the library sees them, only while a divider is being
 * dragged and no pointerup has arrived. Real releases (pointerup, or a move
 * with no button after releasing outside the window) still end the drag.
 */
let held = false;
let installed = false;

const dividerDragging = () => document.querySelector('[data-resize-handle-state="drag"]') !== null;

function swallowBoundary(e: PointerEvent) {
  if (held && e.buttons === 0 && dividerDragging()) e.stopImmediatePropagation();
}

export function installPanelDragGuard(target: Window = window) {
  if (installed) return;
  installed = true;
  const opts = { capture: true } as const;
  target.addEventListener("pointerdown", (e) => { if (e.button === 0) held = true; }, opts);
  target.addEventListener("pointerup", () => { held = false; }, opts);
  target.addEventListener("pointercancel", () => { held = false; }, opts);
  target.addEventListener("blur", () => { held = false; });
  target.addEventListener("pointerleave", swallowBoundary, opts);
  target.addEventListener("pointerout", swallowBoundary, opts);
}
