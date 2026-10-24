import { getAppState, compareAndSetXDesignRoomLibraryPending } from '@/lib/db';
import { readRoomLibraryScope } from './roomLibraryIdentity';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomLibraryPublish, validateRoomLibraryBundle, type RoomLibraryPublish } from './roomLibraryProtocol';

export type PendingRoomLibrary = { projectId: string; serverUrl: string; documentId: string; actorId: string; packet: RoomLibraryPublish };
export type PendingRoomLibrarySummary = Omit<PendingRoomLibrary, 'packet'> & { requestId: string; libraryId: string; revisionId: string; name: string };
export function pendingRoomLibrarySummary(value: PendingRoomLibrary): PendingRoomLibrarySummary {
  const { projectId, serverUrl, documentId, actorId, packet } = value;
  return { projectId, serverUrl, documentId, actorId, requestId: packet.requestId, libraryId: packet.bundle.manifest.libraryId, revisionId: packet.bundle.manifest.revisionId, name: packet.bundle.manifest.name };
}
type State = { version: 1; pending: PendingRoomLibrary | null };
export type RoomLibraryPendingStorage = { read(projectId: string): Promise<unknown>; write(projectId: string, value: State, expected: unknown): Promise<void> };
export function roomLibraryPendingKey(projectId: string): `xdesign.roomLibraryPending.${string}` {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(projectId)) throw new Error('Invalid shared library project identity.');
  return `xdesign.roomLibraryPending.${projectId}`;
}
export function readPendingRoomLibrary(value: unknown, projectId: string): PendingRoomLibrary {
  roomLibraryPendingKey(projectId);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['projectId', 'serverUrl', 'documentId', 'actorId', 'packet'].includes(key))) throw new Error('Invalid pending library publication. It was preserved.');
  const item = value as PendingRoomLibrary;
  if (item.projectId !== projectId) throw new Error('The pending library belongs to another project. It was preserved.');
  const scope = readRoomLibraryScope({ serverUrl: item.serverUrl, documentId: item.documentId }); validateSharedDocumentId(item.actorId);
  return { projectId, ...scope, actorId: item.actorId, packet: readRoomLibraryPublish(item.packet) };
}
function decode(value: unknown, projectId: string): State {
  if (value === null) return { version: 1, pending: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending library publication. It was preserved.');
  const item = value as State;
  if (item.version !== 1) throw new Error('This pending library publication needs a newer application. It was preserved.');
  if (Object.keys(value).length !== 2 || Object.keys(value).some(key => !['version', 'pending'].includes(key)) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 53 * 1024 * 1024) throw new Error('Invalid or oversized pending library publication. It was preserved.');
  return { version: 1, pending: item.pending === null ? null : readPendingRoomLibrary(item.pending, projectId) };
}
export function samePendingRoomLibrary(a: PendingRoomLibrary, b: PendingRoomLibrary): boolean {
  return JSON.stringify(readPendingRoomLibrary(a, a.projectId)) === JSON.stringify(readPendingRoomLibrary(b, b.projectId));
}
export class RoomLibraryPendingStore {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: RoomLibraryPendingStorage = {
    read: projectId => getAppState(roomLibraryPendingKey(projectId), true), write: (projectId, value, expected) => compareAndSetXDesignRoomLibraryPending(projectId, value, expected),
  }) {}
  async load(projectId: string): Promise<PendingRoomLibrary | null> {
    roomLibraryPendingKey(projectId); const pending = decode(await this.storage.read(projectId), projectId).pending;
    if (pending) await validateRoomLibraryBundle(pending.packet.bundle);
    return pending;
  }
  remember(value: PendingRoomLibrary): Promise<void> {
    const next = readPendingRoomLibrary(value, value.projectId);
    return this.enqueue(async () => {
      const raw = await this.storage.read(next.projectId), old = decode(raw, next.projectId).pending;
      if (old) {
        await validateRoomLibraryBundle(old.packet.bundle);
        if (!samePendingRoomLibrary(old, next)) throw new Error('Recover or dismiss the pending library publication before posting another.');
      }
      await validateRoomLibraryBundle(next.packet.bundle);
      if (!old) await this.storage.write(next.projectId, { version: 1, pending: next }, raw);
    });
  }
  forget(value: PendingRoomLibrary): Promise<void> {
    const next = readPendingRoomLibrary(value, value.projectId);
    return this.enqueue(async () => {
      const raw = await this.storage.read(next.projectId), old = decode(raw, next.projectId).pending;
      if (!old) return;
      await validateRoomLibraryBundle(old.packet.bundle);
      if (!samePendingRoomLibrary(old, next)) throw new Error('The pending library publication changed. Reopen the project before continuing.');
      await this.storage.write(next.projectId, { version: 1, pending: null }, raw);
    });
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.mutation.catch(() => undefined).then(work); this.mutation = result; return result;
  }
}
export const roomLibraryPending = new RoomLibraryPendingStore();
