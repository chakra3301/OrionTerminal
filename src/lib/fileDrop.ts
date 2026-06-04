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
  | { type: "drop"; paths: string[] };

type ZoneHandler = (event: DropEvent) => void;

const handlers = new Map<string, ZoneHandler>();
let started = false;
let currentZone: string | null = null;

function zoneAt(x: number, y: number): string | null {
  // Tauri's drag-drop position is in PHYSICAL pixels; elementFromPoint wants
  // CSS pixels. Divide by DPR (1 if unavailable).
  const dpr = window.devicePixelRatio || 1;
  let el = document.elementFromPoint(x / dpr, y / dpr) as HTMLElement | null;
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

/** Register the single webview-level listener. Idempotent — safe to call
 * from App's mount effect. Returns an unlisten. */
export async function startFileDropOrchestrator(): Promise<() => void> {
  if (started) return () => {};
  started = true;
  try {
    const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload as {
        type: "enter" | "over" | "leave" | "drop";
        position?: { x: number; y: number };
        paths?: string[];
      };
      if (p.type === "over" || p.type === "enter") {
        const pos = p.position;
        setActive(pos ? zoneAt(pos.x, pos.y) : null);
      } else if (p.type === "drop") {
        const pos = p.position;
        const zone = (pos ? zoneAt(pos.x, pos.y) : null) ?? currentZone;
        setActive(null);
        if (zone) handlers.get(zone)?.({ type: "drop", paths: p.paths ?? [] });
      } else {
        // "leave" / cancel
        setActive(null);
      }
    });
    return () => {
      started = false;
      unlisten();
    };
  } catch (e) {
    started = false;
    log.warn("file-drop orchestrator failed to start", e);
    return () => {};
  }
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
