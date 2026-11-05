import { getAppState, setAppState } from '@/lib/db';
import { serialQueue } from '@/lib/serialQueue';
import { roomServerOrigin } from './nativeRoomTransport';
import { readAuthorGrantRequest } from './roomAuthorProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';

type GrantScope = { projectId: string; documentId: string; serverUrl: string; requestId: string; name: string };
export type PendingRoomCreation = GrantScope & { kind: 'create'; ownerName: string; checkpointSha256: string };
export type PendingRoomInvitation = GrantScope & { kind: 'invite'; role: 'editor' | 'viewer'; ownerId: string };
export type PendingRoomAuthorGrant = GrantScope & { kind: 'author'; ownerId: string; authorId: string; memberId: string | null; step: number };
export type PendingRoomGrant = PendingRoomCreation | PendingRoomInvitation | PendingRoomAuthorGrant;
const write = serialQueue();
export function roomGrantKey(projectId: string): `xdesign.roomGrants.${string}` {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(projectId)) throw new Error('Invalid room project identity.');
  return `xdesign.roomGrants.${projectId}`;
}
export function roomGrantName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error('Enter a room or member name up to 128 characters.');
  return value.trim();
}
function grant(value: unknown, projectId: string): PendingRoomGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending room request. It was preserved.');
  const record = value as PendingRoomGrant;
  const fields = ['kind', 'projectId', 'documentId', 'serverUrl', 'requestId', 'name', ...(record.kind === 'create' ? ['ownerName', 'checkpointSha256'] : record.kind === 'invite' ? ['role', 'ownerId'] : ['authorId', 'memberId', 'step', 'ownerId'])];
  if (Object.keys(record).some(key => !fields.includes(key)) || record.projectId !== projectId || roomServerOrigin(record.serverUrl) !== record.serverUrl || roomGrantName(record.name) !== record.name) throw new Error('Invalid pending room request. It was preserved.');
  validateSharedDocumentId(record.documentId); validateSharedDocumentId(record.requestId);
  if (record.kind === 'create') {
    if (roomGrantName(record.ownerName) !== record.ownerName || !/^[a-f0-9]{64}$/.test(record.checkpointSha256)) throw new Error('Invalid pending room creation. It was preserved.');
  } else if (record.kind === 'invite') {
    validateSharedDocumentId(record.ownerId); if (!['editor', 'viewer'].includes(record.role)) throw new Error('Invalid pending room invitation. It was preserved.');
  } else if (record.kind === 'author') {
    validateSharedDocumentId(record.ownerId); readAuthorGrantRequest({ version: 1, requestId: record.requestId, authorId: record.authorId, memberId: record.memberId, step: record.step });
  } else throw new Error('Invalid pending room request. It was preserved.');
  const scope = { projectId, documentId: record.documentId, serverUrl: record.serverUrl, requestId: record.requestId, name: record.name };
  return record.kind === 'create' ? { ...scope, kind: 'create', ownerName: record.ownerName, checkpointSha256: record.checkpointSha256 } : record.kind === 'invite' ? { ...scope, kind: 'invite', role: record.role, ownerId: record.ownerId } : { ...scope, kind: 'author', ownerId: record.ownerId, authorId: record.authorId, memberId: record.memberId, step: record.step };
}
export function roomGrantState(projectId: string, values: PendingRoomGrant[]): { version: 1; grants: PendingRoomGrant[] } {
  roomGrantKey(projectId);
  if (values.length > 65) throw new Error('Finish or dismiss a pending invitation before creating another.');
  const grants = values.map(value => grant(value, projectId));
  if (new Set(grants.map(value => value.requestId)).size !== grants.length || grants.filter(value => value.kind === 'create').length > 1) throw new Error('Duplicate pending room requests. They were preserved.');
  return { version: 1, grants };
}
export function sameRoomGrant(left: PendingRoomGrant, right: PendingRoomGrant): boolean { return JSON.stringify(grant(left, left.projectId)) === JSON.stringify(grant(right, right.projectId)); }
export async function loadRoomGrants(projectId: string): Promise<PendingRoomGrant[]> {
  const value = await getAppState<unknown>(roomGrantKey(projectId), true); if (value === null) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending room requests. They were preserved.');
  const record = value as { version: unknown; grants: unknown };
  if (record.version !== 1) throw new Error('Pending room requests need a newer application. They were preserved.');
  if (Object.keys(record).some(key => !['version', 'grants'].includes(key)) || !Array.isArray(record.grants)) throw new Error('Invalid pending room requests. They were preserved.');
  return roomGrantState(projectId, record.grants).grants;
}
export function rememberRoomGrant(value: PendingRoomGrant): Promise<void> {
  const next = grant(value, value.projectId);
  return write(async () => {
    const grants = await loadRoomGrants(next.projectId), old = grants.find(value => value.requestId === next.requestId);
    if (old && JSON.stringify(old) !== JSON.stringify(next)) throw new Error('This room request identity already has a different payload.');
    if (!old) grants.push(next);
    await setAppState(roomGrantKey(next.projectId), roomGrantState(next.projectId, grants));
  });
}
export function forgetRoomGrant(value: PendingRoomGrant): Promise<void> {
  const next = grant(value, value.projectId);
  return write(async () => {
    const grants = await loadRoomGrants(next.projectId), old = grants.find(value => value.requestId === next.requestId);
    if (!old) return;
    if (JSON.stringify(old) !== JSON.stringify(next)) throw new Error('The pending room request changed. Refresh before dismissing it.');
    await setAppState(roomGrantKey(next.projectId), roomGrantState(next.projectId, grants.filter(value => value.requestId !== next.requestId)));
  });
}
export async function checkpointDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
}
