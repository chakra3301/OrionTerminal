/** Central Finder/native drag-drop orchestrator.
 *
 * Tauri intercepts native OS drops before DOM `onDrop` ever fires, so we
 * register ONE `onDragDropEvent` listener at the webview level and route
 * each event to the right component by hit-testing the cursor position
 * against `data-drop-zone` attributes in the DOM.
 *
 * Components opt in with the `useFileDropZone` hook — they receive `enter`,
 * `leave`, and `drop` events so they can show their own hover affordance and
 * decide what to do with the paths (ingest, open as tab, append `@<path>`,
 * …). The first ancestor with a registered `data-drop-zone` wins, so nested
 * zones (e.g. a chat input inside an app shell) take precedence over the
 * shell — exactly what you want for "drop into the chat to attach a file".
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { log } from "@/lib/log";

export type DropEvent =
  | { type: "enter" }
  | { type: "leave" }
  | { type: "drop"; paths: string[]; point?: { x: number; y: number } };

type ZoneHandler = (event: DropEvent) => void;

const handlers = new Map<string, ZoneHandler>();
let listening: Promise<() => void> | null = null;
let users = 0;
let currentZone: string | null = null;

/** Tauri types the drag position as physical pixels, but on macOS wry reports
 * window points (already CSS pixels); dividing by the Retina DPR there would
 * hit-test halfway toward the window's top-left corner. */
function cssPoint(position: { x: number; y: number }): { x: number; y: number } {
  const scale = /Mac/.test(navigator.userAgent) ? 1 : window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

function zoneAt(position: { x: number; y: number }): string | null {
  const { x, y } = cssPoint(position);
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const z = el.dataset?.dropZone;
    if (z && handlers.has(z)) return z;
    el = el.parentElement;
  }
  return null;
}

function setActive(zone: string | null) {
  if (zone === currentZone) return;
  if (currentZone) handlers.get(currentZone)?.({ type: "leave" });
  currentZone = zone;
  if (zone) handlers.get(zone)?.({ type: "enter" });
}

function onDragDrop(event: { payload: unknown }) {
  const p = event.payload as {
    type: "enter" | "over" | "leave" | "drop";
    position?: { x: number; y: number };
    paths?: string[];
  };
  if (p.type === "over" || p.type === "enter") {
    const pos = p.position;
    setActive(pos ? zoneAt(pos) : null);
  } else if (p.type === "drop") {
    const pos = p.position;
    const zone = (pos ? zoneAt(pos) : null) ?? currentZone;
    setActive(null);
    if (zone) handlers.get(zone)?.({ type: "drop", paths: p.paths ?? [], ...(pos ? { point: cssPoint(pos) } : {}) });
  } else {
    // "leave" / cancel
    setActive(null);
  }
}

/** Register the single webview-level listener, shared by every caller and
 * removed when the last one releases it. StrictMode's mount → unmount →
 * mount must not let the first, cancelled caller tear down the listener the
 * second one is relying on. Returns a release. */
export async function startFileDropOrchestrator(): Promise<() => void> {
  users += 1;
  listening ??= getCurrentWebview().onDragDropEvent(onDragDrop).catch((e) => {
    log.warn("file-drop orchestrator failed to start", e);
    listening = null;
    return () => {};
  });
  await listening;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users > 0 || !listening) return;
    const stop = listening;
    listening = null;
    void stop.then((unlisten) => unlisten());
  };
}

function register(name: string, handler: ZoneHandler): () => void {
  handlers.set(name, handler);
  return () => {
    if (currentZone === name) currentZone = null;
    handlers.delete(name);
  };
}

/** React hook: tag `ref`'s element as a drop zone named `name`, and run
 * `handler` for enter/leave/drop events while it's mounted. The handler is
 * captured by ref so re-renders don't churn the registration. */
export function useFileDropZone<T extends HTMLElement>(
  ref: RefObject<T | null>,
  name: string,
  handler: ZoneHandler,
): void {
  const hRef = useRef(handler);
  hRef.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.dropZone = name;
    const unregister = register(name, (e) => hRef.current(e));
    return () => {
      unregister();
      if (el.dataset.dropZone === name) delete el.dataset.dropZone;
    };
  }, [ref, name]);
}
