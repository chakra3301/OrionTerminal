import { SharedDesign } from './sharedDesign';
import { deserializeGraph, serializeGraph } from './graphDocument';
import type { PencilDocument } from './document';

export type SharedCheckpoint = { version: 1; documentId: string; checkpoint: string };
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;

export function validateSharedDocumentId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) throw new Error('Invalid shared document identity.');
}
export function encodeSharedCheckpoint(documentId: string, bytes: Uint8Array): SharedCheckpoint {
  validateSharedDocumentId(documentId);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > MAX_BYTES) throw new Error('Invalid or oversized shared checkpoint.');
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return { version: 1, documentId, checkpoint: btoa(parts.join('')) };
}
export function decodeSharedCheckpoint(value: unknown): Uint8Array {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shared checkpoint.');
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw new Error('This shared design needs a newer application version.');
  validateSharedDocumentId(record.documentId);
  const encoded = record.checkpoint;
  if (Object.keys(record).some(key => !['version', 'documentId', 'checkpoint'].includes(key)) || typeof encoded !== 'string' || encoded.length < 4 || encoded.length > MAX_BASE64 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid or oversized shared checkpoint.');
  const binary = atob(encoded);
  if (binary.length < 2 || binary.length > MAX_BYTES || btoa(binary) !== encoded) throw new Error('Invalid or oversized shared checkpoint.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function restoreSharedDesign(document: PencilDocument): SharedDesign {
  if (!document.shared) throw new Error('This design has no shared checkpoint.');
  const replica = SharedDesign.fromUpdate(decodeSharedCheckpoint(document.shared));
  let canonical: SharedDesign | undefined;
  try {
    canonical = SharedDesign.fromGraph(deserializeGraph(document.graph, true));
    if (serializeGraph(replica.graph) !== serializeGraph(canonical.graph)) throw new Error('The shared checkpoint and saved artwork do not match. The original project was preserved.');
    return replica;
  } catch (error) { replica.dispose(); throw error; }
  finally { canonical?.dispose(); }
}
