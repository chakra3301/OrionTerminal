/** Lets any Archives surface (Brain graph, future views) push a prompt into
 * the live Archives Claude panel. Same registration pattern as
 * orionProtocol's setNoteNavigator — ArchivesApp registers its handleSend on
 * mount; callers fire-and-forget. */

type ChatSender = (text: string) => void;

let sender: ChatSender | null = null;

export function setArchivesChatSender(s: ChatSender | null): void {
  sender = s;
}

/** Send `text` as a user turn in the Archives Claude chat. Returns false if
 * Archives isn't mounted (caller may toast). */
export function sendToArchivesChat(text: string): boolean {
  if (!sender) return false;
  sender(text);
  return true;
}

/** Panel toggles ArchivesApp exposes to its host (the standalone app's View menu). */
export type ArchivesPanelToggles = { toggleSidebar: () => void; toggleChat: () => void };

let toggles: ArchivesPanelToggles | null = null;

export function setArchivesPanelToggles(t: ArchivesPanelToggles | null): void {
  toggles = t;
}

export function archivesPanelToggles(): ArchivesPanelToggles | null {
  return toggles;
}
