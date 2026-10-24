import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useArchiveSearchRevision } from "./archiveSearchRevision";

let owners = 0;
let active: { alive: boolean; ready: Promise<UnlistenFn> } | null = null;

export function watchArchiveCaptionChanges(): () => void {
  owners++;
  if (!active) {
    const token = { alive: true, ready: Promise.resolve(() => {}) as Promise<UnlistenFn> };
    active = token;
    token.ready = listen<string[]>("archive-captions-changed", ({ payload }) => {
      if (!token.alive || !Array.isArray(payload) || payload.length > 256 || payload.some((id) => typeof id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))) return;
      useArchiveSearchRevision.getState().changed(payload.length === 1 ? payload[0] : undefined);
    }).catch((error) => { console.warn("Caption search change listener unavailable", error); return () => {}; });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners === 0 && active) {
      const old = active; active = null; old.alive = false;
      void old.ready.then((unlisten) => unlisten());
    }
  };
}
