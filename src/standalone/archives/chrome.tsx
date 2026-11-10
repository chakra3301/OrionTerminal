/** EMP-style window chrome for Archives 47: sidebar wordmark, status bar, window dragging. */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNotesStore } from "@/store/notesStore";
import { log } from "@/lib/log";
import { APP_NAME } from "./brand";
import wordmarkUrl from "./assets/archives-wordmark.svg?url";
import { version as APP_VERSION } from "../../../package.json";

/** The ARCHIVES 47 wordmark (ARCHES outlines, never the font) in the highlight colour. */
export function SidebarBrand() {
  return (
    <div className="a47-brand" data-a47-drag>
      <span
        className="a47-brand__mark"
        role="img"
        aria-label={APP_NAME}
        style={{ maskImage: `url(${wordmarkUrl})`, WebkitMaskImage: `url(${wordmarkUrl})` }}
      />
    </div>
  );
}

export function StatusBar({ status }: { status: (el: HTMLElement | null) => void }) {
  const count = useNotesStore((s) => s.notes.size);
  return (
    <footer className="a47-statusbar" data-a47-drag>
      <span className="a47-statusbar__item">
        <span className="a47-statusbar__dot" aria-hidden="true" />
        Library ready
      </span>
      <span ref={status} className="a47-statusbar__item ot-window-title-status" />
      <span className="a47-statusbar__spacer" />
      <span className="a47-statusbar__item">{count} {count === 1 ? "item" : "items"}</span>
      <span className="a47-statusbar__item a47-statusbar__version">v{APP_VERSION}</span>
    </footer>
  );
}

const DRAG_ZONES = "[data-a47-drag], .ar-toolbar";
const INTERACTIVE = "button, input, select, textarea, a, [role='button'], [role='slider'], [contenteditable='true']";

/** The window has no native title bar: empty parts of the top bar, sidebar header and status bar move it. */
export function useWindowDragging() {
  useEffect(() => {
    const zone = (e: MouseEvent) => {
      const t = e.target as Element | null;
      return !!t && !!t.closest(DRAG_ZONES) && !t.closest(INTERACTIVE);
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail > 1 || !zone(e)) return;
      void getCurrentWindow().startDragging().catch((err) => log.warn("drag failed", err));
    };
    const dbl = (e: MouseEvent) => {
      if (!zone(e)) return;
      void getCurrentWindow().toggleMaximize().catch((err) => log.warn("zoom failed", err));
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("dblclick", dbl);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("dblclick", dbl);
    };
  }, []);
}
