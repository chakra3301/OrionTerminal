// Central parser + dispatcher for orion:// URIs.
// External Tauri-side handler (when a user pastes an orion:// link into
// another app and clicks it) is wired separately; this module is the
// in-app handler for clicks inside the editor and palette.
//
// Schemes:
//   orion://note/<id>
//   orion://asset/<id>
//   orion://chat/<id>           (future)

import { useWorkspace } from "@/components/workspace/workspaceStore";

export type OrionRef =
  | { kind: "note"; id: string }
  | { kind: "asset"; id: string }
  | { kind: "chat"; id: string };

export function isOrionUri(href: string): boolean {
  return href.startsWith("orion://");
}

export function parseOrionUri(href: string): OrionRef | null {
  if (!isOrionUri(href)) return null;
  const rest = href.slice("orion://".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const kind = rest.slice(0, slash);
  const id = rest.slice(slash + 1).split(/[?#]/)[0] ?? "";
  if (!id) return null;
  switch (kind) {
    case "note":
      return { kind: "note", id };
    case "asset":
      return { kind: "asset", id };
    case "chat":
      return { kind: "chat", id };
    default:
      return null;
  }
}

export function formatOrionUri(ref: OrionRef): string {
  return `orion://${ref.kind}/${ref.id}`;
}

/** Optional in-app note router (Archives sets this so orion://note clicks
 * navigate the Archives view instead of opening an Orion workspace tab). */
let noteNavigator: ((id: string) => boolean) | null = null;
export function setNoteNavigator(fn: ((id: string) => boolean) | null): void {
  noteNavigator = fn;
}

export function handleOrionUri(href: string): boolean {
  const ref = parseOrionUri(href);
  if (!ref) return false;
  switch (ref.kind) {
    case "note":
      if (noteNavigator?.(ref.id)) return true;
      useWorkspace.getState().openTab({ kind: "note", noteId: ref.id });
      return true;
    case "asset":
      useWorkspace.getState().openTab({ kind: "asset-detail", assetId: ref.id });
      return true;
    case "chat":
      // future: route to chat list / open chat
      return false;
  }
}
