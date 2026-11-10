import { getAppState, setAppState } from '@/lib/db';
import { serialQueue } from '@/lib/serialQueue';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { roomServerOrigin } from './nativeRoomTransport';
import type { RoomActor } from './sharedRoomProtocol';

export type RoomPreference = { documentId: string; serverUrl: string; revision: number; role: RoomActor['role'] };
const write = serialQueue();
function preference(value: unknown): RoomPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['documentId', 'serverUrl', 'revision', 'role'].includes(key))) throw new Error('Invalid saved room connection.');
  const record = value as RoomPreference; validateSharedDocumentId(record.documentId);
  if (roomServerOrigin(record.serverUrl) !== record.serverUrl || !Number.isSafeInteger(record.revision) || record.revision < 1 || !['owner', 'editor', 'viewer'].includes(record.role)) throw new Error('Invalid saved room connection.');
  return { documentId: record.documentId, serverUrl: record.serverUrl, revision: record.revision, role: record.role };
}
export async function loadRoomPreferences(): Promise<RoomPreference[]> {
  const value = await getAppState<unknown>('xdesign.rooms', true); if (value === null) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved room connections.');
  const record = value as { version: unknown; rooms: unknown };
  if (record.version !== 1) throw new Error('Saved room connections need a newer application. They were preserved.');
  if (Object.keys(record).some(key => !['version', 'rooms'].includes(key)) || !Array.isArray(record.rooms) || record.rooms.length > 128) throw new Error('Invalid saved room connections. They were preserved.');
  const rooms = record.rooms.map(preference); if (new Set(rooms.map(room => room.documentId)).size !== rooms.length) throw new Error('Duplicate saved room connections. They were preserved.'); return rooms;
}
export async function loadRoomPreference(documentId: string): Promise<RoomPreference | null> { validateSharedDocumentId(documentId); return (await loadRoomPreferences()).find(room => room.documentId === documentId) ?? null; }
export function rememberRoom(value: RoomPreference): Promise<RoomPreference> {
  const next = preference(value);
  return write(async () => {
    const rooms = await loadRoomPreferences(), index = rooms.findIndex(room => room.documentId === next.documentId), old = rooms[index];
    const saved = old?.serverUrl === next.serverUrl && old.revision > next.revision ? old : next;
    if (index < 0) { if (rooms.length >= 128) throw new Error('The saved room connection limit has been reached.'); rooms.push(saved); } else rooms[index] = saved;
    await setAppState('xdesign.rooms', { version: 1, rooms }); return saved;
  });
}
