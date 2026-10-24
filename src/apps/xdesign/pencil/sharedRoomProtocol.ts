import { validateSharedDocumentId } from './sharedCheckpoint';
import { Doc, applyUpdate, decodeStateVector, encodeStateVector } from 'yjs';

export type RoomActor = { id: string; name: string; role: 'owner' | 'editor' | 'viewer' };
type Envelope = { version: 1; documentId: string; clientId: string; requestId: string };
export type RoomRequest = Envelope & ({ type: 'sync'; vector: string } | { type: 'update'; vector: string; update: string });
export type RoomResponse = Envelope & { type: 'sync' | 'ack'; revision: number; actor: RoomActor; vector: string; update: string; acceptedRevision?: number };
const MAX_UPDATE = 32 * 1024 * 1024;
const MAX_VECTOR = 1024 * 1024;

export function roomBinary(bytes: Uint8Array, vector = false): string {
  if (!(bytes instanceof Uint8Array) || bytes.length < (vector ? 1 : 2) || bytes.length > (vector ? MAX_VECTOR : MAX_UPDATE)) throw new Error('Invalid shared room binary data.');
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(parts.join(''));
}
export function readRoomBinary(value: unknown, vector = false): Uint8Array {
  const max = vector ? MAX_VECTOR : MAX_UPDATE;
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid shared room binary data.');
  const text = atob(value);
  if (text.length < (vector ? 1 : 2) || text.length > max || btoa(text) !== value) throw new Error('Invalid shared room binary data.');
  return Uint8Array.from(text, char => char.charCodeAt(0));
}
export function readRoomVector(value: unknown): Uint8Array {
  const bytes = readRoomBinary(value, true), decoded = decodeStateVector(bytes), canonical = encodeStateVector(decoded);
  if ([...decoded].some(([peer, clock]) => !Number.isSafeInteger(peer) || peer < 0 || !Number.isSafeInteger(clock) || clock < 0) || bytes.length !== canonical.length || bytes.some((byte, index) => byte !== canonical[index])) throw new Error('Invalid shared room state vector.');
  return bytes;
}
export function roomCheckpointCovers(checkpoint: Uint8Array, expected: Uint8Array): boolean {
  const document = new Doc({ gc: false });
  try {
    applyUpdate(document, checkpoint);
    const actual = decodeStateVector(encodeStateVector(document));
    // Encoded pending structs can start at clock zero without being integrated.
    // Only the applied document vector can justify a durable acknowledgement.
    return [...decodeStateVector(expected)].every(([peer, clock]) => (actual.get(peer) ?? 0) >= clock);
  } finally { document.destroy(); }
}
export function roomVectorCovers(actual: Uint8Array, expected: Uint8Array): boolean {
  const clocks = decodeStateVector(actual);
  return [...decodeStateVector(expected)].every(([peer, clock]) => (clocks.get(peer) ?? 0) >= clock);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shared room message.');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported shared room message fields.');
}
function envelope(value: Record<string, unknown>): void {
  if (value.version !== 1) throw new Error('Unsupported shared room protocol version.');
  for (const field of ['documentId', 'clientId', 'requestId']) validateSharedDocumentId(value[field]);
}
export function readRoomRequest(value: unknown): { packet: RoomRequest; vector: Uint8Array; update?: Uint8Array } {
  const record = object(value); envelope(record);
  if (record.type !== 'sync' && record.type !== 'update') throw new Error('Unsupported shared room request.');
  fields(record, ['version', 'type', 'documentId', 'clientId', 'requestId', 'vector', ...(record.type === 'update' ? ['update'] : [])]);
  const vector = readRoomVector(record.vector), update = record.type === 'update' ? readRoomBinary(record.update) : undefined;
  return { packet: record as RoomRequest, vector, ...(update ? { update } : {}) };
}
export function readRoomResponse(value: unknown, expected: RoomRequest): { packet: RoomResponse; vector: Uint8Array; update: Uint8Array } {
  const record = object(value); envelope(record);
  fields(record, ['version', 'type', 'documentId', 'clientId', 'requestId', 'revision', 'actor', 'vector', 'update', ...(expected.type === 'update' ? ['acceptedRevision'] : [])]);
  if (record.documentId !== expected.documentId || record.clientId !== expected.clientId || record.requestId !== expected.requestId || record.type !== (expected.type === 'update' ? 'ack' : 'sync')) throw new Error('The shared room response belongs to another request or document.');
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || expected.type === 'update' && (!Number.isSafeInteger(record.acceptedRevision) || (record.acceptedRevision as number) < 1 || (record.acceptedRevision as number) > (record.revision as number))) throw new Error('Invalid shared room revision.');
  const actor = object(record.actor); fields(actor, ['id', 'name', 'role']); validateSharedDocumentId(actor.id);
  if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 128 || /[\x00-\x1f\x7f]/.test(actor.name) || typeof actor.role !== 'string' || !['owner', 'editor', 'viewer'].includes(actor.role)) throw new Error('Invalid shared room identity.');
  return { packet: record as RoomResponse, vector: readRoomVector(record.vector), update: readRoomBinary(record.update) };
}
