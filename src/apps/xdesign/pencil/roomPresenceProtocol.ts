import { validateSharedDocumentId } from './sharedCheckpoint';
import type { RoomActor } from './sharedRoomProtocol';

export const PRESENCE_TTL = 15_000;
export const PRESENCE_PEERS = 128;
export type PresenceState = { pageId: string; cursor: [number, number] | null; selection: string[]; view: { center: [number, number]; zoom: number; width: number; height: number }; following: string | null };
export type PresenceRequest = { version: 1; documentId: string; clientId: string; sequence: number; state: PresenceState | null };
export type PresencePeer = { clientId: string; sequence: number; actor: RoomActor; state: PresenceState; expiresInMs: number };
export type PresenceResponse = { version: 1; documentId: string; clientId: string; sequence: number; actor: RoomActor; peers: PresencePeer[] };
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid room presence fields.');
  return value as Record<string, unknown>;
}
function sequence(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid room presence sequence.'); }
function sceneId(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.length || value.length > 128 || /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid presence layer or page identity.'); }
function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e8)) throw new Error('Invalid room presence position.');
  return [value[0], value[1]];
}
function actor(value: unknown): RoomActor {
  const record = object(value, ['id', 'name', 'role']); validateSharedDocumentId(record.id);
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.trim() !== record.name || record.name.length > 128 || /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(record.name) || !['owner', 'editor', 'viewer'].includes(record.role as string)) throw new Error('Invalid presence membership.');
  return { id: record.id, name: record.name, role: record.role as RoomActor['role'] };
}
export function readPresenceState(value: unknown): PresenceState {
  const record = object(value, ['pageId', 'cursor', 'selection', 'view', 'following']); sceneId(record.pageId);
  if (!Array.isArray(record.selection) || record.selection.length > 64) throw new Error('Too many presence selections.');
  const selection = record.selection.map(value => { sceneId(value); return value; }); if (new Set(selection).size !== selection.length) throw new Error('Duplicate presence selections.');
  const view = object(record.view, ['center', 'zoom', 'width', 'height']);
  if (typeof view.zoom !== 'number' || !Number.isFinite(view.zoom) || view.zoom < 1e-8 || view.zoom > 256 || !['width', 'height'].every(key => typeof view[key] === 'number' && Number.isFinite(view[key]) && (view[key] as number) >= 1 && (view[key] as number) <= 100_000)) throw new Error('Invalid presence viewport.');
  if (record.following !== null) validateSharedDocumentId(record.following);
  return { pageId: record.pageId, cursor: record.cursor === null ? null : point(record.cursor), selection, view: { center: point(view.center), zoom: view.zoom, width: view.width as number, height: view.height as number }, following: record.following as string | null };
}
export function readPresenceRequest(value: unknown): PresenceRequest {
  const record = object(value, ['version', 'documentId', 'clientId', 'sequence', 'state']);
  if (record.version !== 1) throw new Error('Unsupported room presence version.'); validateSharedDocumentId(record.documentId); validateSharedDocumentId(record.clientId); sequence(record.sequence);
  const state = record.state === null ? null : readPresenceState(record.state); if (state?.following === record.clientId) throw new Error('A presence client cannot follow itself.');
  return { version: 1, documentId: record.documentId, clientId: record.clientId, sequence: record.sequence, state };
}
export function readPresenceResponse(value: unknown, request: PresenceRequest): PresenceResponse {
  const record = object(value, ['version', 'documentId', 'clientId', 'sequence', 'actor', 'peers']);
  if (record.version !== 1 || record.documentId !== request.documentId || record.clientId !== request.clientId || record.sequence !== request.sequence || !Array.isArray(record.peers) || record.peers.length > PRESENCE_PEERS) throw new Error('The presence response belongs to another room or request.');
  const membership = actor(record.actor), identities = new Set<string>();
  const peers = record.peers.map(value => {
    const peer = object(value, ['clientId', 'sequence', 'actor', 'state', 'expiresInMs']); validateSharedDocumentId(peer.clientId); sequence(peer.sequence);
    const member = actor(peer.actor), identity = peer.clientId;
    if (identities.has(identity) || typeof peer.expiresInMs !== 'number' || !Number.isFinite(peer.expiresInMs) || peer.expiresInMs <= 0 || peer.expiresInMs > PRESENCE_TTL) throw new Error('Invalid or duplicate presence lease.'); identities.add(identity);
    const state = readPresenceState(peer.state); if (state.following === peer.clientId) throw new Error('Invalid presence follow target.');
    if (peer.clientId === request.clientId && (member.id !== membership.id || member.role !== membership.role || member.name !== membership.name || peer.sequence !== request.sequence || !request.state || JSON.stringify(state) !== JSON.stringify(readPresenceState(request.state)))) throw new Error('The presence response has a conflicting client identity.');
    return { clientId: peer.clientId, sequence: peer.sequence, actor: member, state, expiresInMs: peer.expiresInMs };
  });
  return { version: 1, documentId: request.documentId, clientId: request.clientId, sequence: request.sequence, actor: membership, peers };
}
