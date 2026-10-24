import { getAppState, setAppState } from '@/lib/db';
import { serialQueue } from '@/lib/serialQueue';
import { roomServerOrigin } from './nativeRoomTransport';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomCommentRequest, type RoomCommentRequest } from './roomCommentProtocol';

export type PendingRoomComment = { projectId: string; serverUrl: string; actorId: string; packet: RoomCommentRequest };
const write = serialQueue();
export function roomCommentKey(projectId: string): `xdesign.roomComments.${string}` {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(projectId)) throw new Error('Invalid comment project identity.');
  return `xdesign.roomComments.${projectId}`;
}
export function readPendingRoomComment(value: unknown, projectId: string): PendingRoomComment {
  roomCommentKey(projectId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending comment. It was preserved.');
  const record = value as PendingRoomComment;
  if (Object.keys(record).length !== 4 || Object.keys(record).some(key => !['projectId', 'serverUrl', 'actorId', 'packet'].includes(key)) || record.projectId !== projectId || roomServerOrigin(record.serverUrl) !== record.serverUrl) throw new Error('Invalid pending comment scope. It was preserved.');
  validateSharedDocumentId(record.actorId);
  return { projectId, serverUrl: record.serverUrl, actorId: record.actorId, packet: readRoomCommentRequest(record.packet).packet };
}
export function samePendingRoomComment(a: PendingRoomComment, b: PendingRoomComment): boolean { return JSON.stringify(readPendingRoomComment(a, a.projectId)) === JSON.stringify(readPendingRoomComment(b, b.projectId)); }
export async function loadPendingRoomComment(projectId: string): Promise<PendingRoomComment | null> {
  const value = await getAppState<unknown>(roomCommentKey(projectId), true); if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending comment. It was preserved.');
  const record = value as { version: unknown; pending: unknown };
  if (record.version !== 1) throw new Error('This pending comment needs a newer application. It was preserved.');
  if (Object.keys(record).length !== 2 || Object.keys(record).some(key => !['version', 'pending'].includes(key))) throw new Error('Invalid pending comment. It was preserved.');
  return record.pending === null ? null : readPendingRoomComment(record.pending, projectId);
}
export function rememberPendingRoomComment(value: PendingRoomComment): Promise<void> {
  const next = readPendingRoomComment(value, value.projectId);
  return write(async () => {
    const old = await loadPendingRoomComment(next.projectId);
    if (old && !samePendingRoomComment(old, next)) throw new Error('Recover or discard the pending comment before posting another.');
    await setAppState(roomCommentKey(next.projectId), { version: 1, pending: next });
  });
}
export function forgetPendingRoomComment(value: PendingRoomComment): Promise<void> {
  const next = readPendingRoomComment(value, value.projectId);
  return write(async () => {
    const old = await loadPendingRoomComment(next.projectId); if (!old) return;
    if (!samePendingRoomComment(old, next)) throw new Error('The pending comment changed. Reopen the project before continuing.');
    await setAppState(roomCommentKey(next.projectId), { version: 1, pending: null });
  });
}
