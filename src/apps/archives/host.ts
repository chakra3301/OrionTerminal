/**
 * What Archives needs from whatever hosts it. Orion Terminal hosts Archives as
 * an in-canvas window next to its other apps; the standalone Archives 47 app
 * hosts it as the whole window. Archives code calls these hooks instead of
 * importing Orion's shell, editor or companion, so the standalone build never
 * pulls those in. Orion installs its implementation in `orionArchivesHost.ts`.
 */
import type { ChatRow } from "@/lib/db";
import { getActiveNoteEditor } from "@/features/notes/editorBridge";

export type ArchivesHost = {
  /** Bring the Archives surface to the front (open/focus its window). */
  reveal: () => void;
  /** Whether a chat from another app can be shown (e.g. Orion editor chats). */
  canShowChatOrigin: (origin: string | null | undefined) => boolean;
  /** Open a chat that Archives can't display itself. Returns false if nothing handled it. */
  openForeignChat: (row: ChatRow, messages: unknown) => Promise<boolean>;
  /** Open a finished RepoLens website clone for editing. Null when the host has no editor. */
  openWebsiteClone: ((projectPath: string, ripId: string) => Promise<void>) | null;
  /** The note the user is focused on, for note-scoped commands (Delete Note, Insert Note Link). */
  focusedNoteId: () => string | null;
  /** Close any note views the host keeps outside Archives (Orion workspace tabs). */
  closeNoteViews: () => void;
  /** Opens the host's settings from the Archives sidebar. Null hides the button (Orion has its own Control Panel). */
  openSettings: (() => void) | null;
  /** Product name shown in empty states ("Orion Terminal", "Archives 47"). */
  productName: string;
};

const standaloneDefaults: ArchivesHost = {
  reveal: () => {},
  canShowChatOrigin: (origin) => !origin || origin === "archives",
  openForeignChat: async () => false,
  openWebsiteClone: null,
  focusedNoteId: () => getActiveNoteEditor()?.id ?? null,
  closeNoteViews: () => {},
  openSettings: null,
  productName: "Archives 47",
};

let host: ArchivesHost = standaloneDefaults;

export function setArchivesHost(next: Partial<ArchivesHost>): () => void {
  const previous = host;
  host = { ...standaloneDefaults, ...next };
  return () => {
    host = previous;
  };
}

export function archivesHost(): ArchivesHost {
  return host;
}

export function revealArchives(): void {
  host.reveal();
}
