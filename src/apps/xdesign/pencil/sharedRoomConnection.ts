import { ulid } from 'ulid';
import type { SharedEditorBinding } from './sharedEditor';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { readRoomBinary, readRoomResponse, roomBinary, roomCheckpointCovers, roomVectorCovers, type RoomActor, type RoomRequest } from './sharedRoomProtocol';

export class RoomRequestFailure extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = 'RoomRequestFailure'; }
}
class ProtocolFailure extends Error {}
export type RoomConnectionState = { phase: 'disconnected' | 'connecting' | 'syncing' | 'online' | 'readonly' | 'retrying' | 'error' | 'closed'; actor: RoomActor | null; revision: number; unsent: boolean; attempt: number; error: string | null };
export type RoomConnectionOptions = {
  request: (packet: Readonly<RoomRequest>, signal: AbortSignal) => Promise<unknown>;
  isCurrent?: () => boolean;
  onState?: (state: RoomConnectionState) => void;
  pollMilliseconds?: number;
  minimumRevision?: number;
};
type DocumentBinding = Pick<SharedEditorBinding, 'replica' | 'flush' | 'receive' | 'subscribeUpdates'>;
type Upload = { packet: Readonly<RoomRequest>; epoch: number };
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

export class SharedRoomConnection {
  private connected = false;
  private closed = false;
  private generation = 0;
  private localEpoch = 0;
  private acknowledgedEpoch = -1;
  private pending: Upload | null = null;
  private actor: RoomActor | null = null;
  private revision: number;
  private vector: Uint8Array | undefined;
  private lastUpdate: Uint8Array | null = null;
  private fullSync = true;
  private syncTicket = 0;
  private externalReceipt = 0;
  private fullUpload = false;
  private readonlyAttempted = false;
  private dependencyFailures = 0;
  private attempt = 0;
  private error: string | null = null;
  private phase: RoomConnectionState['phase'] = 'disconnected';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private readonly clientId = ulid();
  private readonly poll: number;
  private readonly stopLocal: () => void;
  private readonly listeners = new Set<(state: RoomConnectionState) => void>();

  constructor(readonly documentId: string, private readonly binding: DocumentBinding, private readonly options: RoomConnectionOptions) {
    this.options = Object.freeze({ ...options });
    validateSharedDocumentId(documentId);
    this.poll = options.pollMilliseconds ?? 1500; this.revision = options.minimumRevision ?? 0;
    if (!Number.isSafeInteger(this.poll) || this.poll < 250 || this.poll > 30_000 || !Number.isSafeInteger(this.revision) || this.revision < 0) throw new Error('Invalid shared room polling interval or revision.');
    this.stopLocal = binding.subscribeUpdates(change => {
      if (!change.changed || change.source === 'remote') return;
      this.localEpoch++; this.notify();
      if (this.connected && !this.running && this.phase !== 'retrying') this.schedule(0);
    });
  }
  get state(): RoomConnectionState {
    return { phase: this.phase, actor: this.actor ? { ...this.actor } : null, revision: this.revision, unsent: this.pending !== null || this.localEpoch > this.acknowledgedEpoch, attempt: this.attempt, error: this.error };
  }
  subscribe(listener: (state: RoomConnectionState) => void): () => void { if (this.closed) throw new Error('The room connection is closed.'); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void {
    for (const listener of [this.options.onState, ...this.listeners]) if (listener) try { listener(this.state); } catch { /* Observers cannot undo accepted artwork or receipts. */ }
  }
  private sourceCurrent(): boolean { try { return !this.closed && (!this.options.isCurrent || this.options.isCurrent()); } catch { return false; } }
  private current(generation: number): boolean { return this.connected && this.sourceCurrent() && this.generation === generation; }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule(milliseconds: number): void {
    this.clearTimer(); if (!this.connected || !this.sourceCurrent()) return;
    this.timer = setTimeout(() => { this.timer = null; this.kick(); }, milliseconds);
  }
  private kick(): void {
    if (this.running || !this.connected) return;
    if (!this.sourceCurrent()) { this.disconnect(); return; }
    const work = Promise.resolve().then(() => this.cycle()); this.running = work;
    void work.finally(() => { if (this.running === work) this.running = null; }).catch(error => this.stop(error instanceof Error ? error : new Error('The room connection failed.')));
  }
  connect(): void {
    if (this.closed) throw new Error('The room connection is closed.');
    if (!this.sourceCurrent()) throw new Error('The shared room project is no longer active.');
    this.clearTimer(); this.controller?.abort(); this.generation++; this.connected = true;
    this.fullSync = true; this.syncTicket++; this.readonlyAttempted = false; this.attempt = 0; this.error = null; this.phase = 'connecting'; this.notify(); this.kick();
  }
  syncNow(): void { if (!this.connected) { this.connect(); return; } this.fullSync = true; this.syncTicket++; this.schedule(0); }
  observeCommentReceipt(actor: RoomActor, revision: number): void {
    if (!this.connected || !this.sourceCurrent() || !this.actor || actor.id !== this.actor.id || !Number.isSafeInteger(revision) || revision < this.revision) throw new Error('The comment receipt no longer belongs to this room connection.');
    this.externalReceipt++; this.revision = revision;
    this.actor = { ...this.actor, name: actor.name, ...(actor.role === 'viewer' ? { role: 'viewer' as const } : {}) };
    this.fullSync = true; this.syncTicket++; this.phase = this.actor.role === 'viewer' ? 'readonly' : 'syncing'; this.notify(); this.schedule(0);
  }
  disconnect(): void {
    if (this.closed || !this.connected && this.phase === 'disconnected') return; this.connected = false; this.generation++; this.clearTimer(); this.controller?.abort(); this.phase = 'disconnected'; this.notify();
  }
  dispose(): void {
    if (this.closed) return; this.closed = true; this.connected = false; this.generation++; this.clearTimer(); this.controller?.abort(); this.stopLocal();
    this.phase = 'closed'; this.lastUpdate = null; this.pending = null; this.vector = undefined; this.notify(); this.listeners.clear();
  }
  private sendable(): boolean {
    return this.fullSync || this.actor?.role !== 'viewer' && (this.pending !== null || this.localEpoch > this.acknowledgedEpoch) || this.pending !== null && !this.readonlyAttempted;
  }
  private packet(): Readonly<RoomRequest> {
    this.binding.flush();
    if (this.fullSync) return Object.freeze({ version: 1, type: 'sync', documentId: this.documentId, clientId: this.clientId, requestId: ulid(), vector: roomBinary(new Uint8Array([0]), true) });
    if (this.pending && (this.actor?.role !== 'viewer' || !this.readonlyAttempted)) return this.pending.packet;
    if (this.actor?.role !== 'viewer' && this.localEpoch > this.acknowledgedEpoch) {
      const packet = Object.freeze({ version: 1 as const, type: 'update' as const, documentId: this.documentId, clientId: this.clientId, requestId: ulid(), vector: roomBinary(this.binding.replica.stateVector(), true), update: roomBinary(this.binding.replica.update(this.fullUpload ? undefined : this.vector)) });
      this.pending = { packet, epoch: this.localEpoch }; this.fullUpload = false; return packet;
    }
    return Object.freeze({ version: 1, type: 'sync', documentId: this.documentId, clientId: this.clientId, requestId: ulid(), vector: roomBinary(this.binding.replica.stateVector(), true) });
  }
  private stop(error: Error): void { this.connected = false; this.error = error.message; this.phase = 'error'; this.notify(); }
  private async cycle(): Promise<void> {
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    let next: number | undefined, applying = false, requesting = false;
    try {
      const outgoing = this.packet(), wasFullSync = outgoing.type === 'sync' && this.fullSync, ticket = this.syncTicket, externalReceipt = this.externalReceipt;
      if (!this.current(generation)) return;
      this.phase = this.actor?.role === 'viewer' ? 'readonly' : 'syncing'; this.notify();
      if (!this.current(generation)) return;
      requesting = true; const raw = await this.options.request(outgoing, controller.signal); requesting = false;
      if (!this.current(generation)) return;
      if (externalReceipt !== this.externalReceipt) { next = 0; return; }
      let reply: ReturnType<typeof readRoomResponse>;
      try {
        reply = readRoomResponse(raw, outgoing);
        if (reply.packet.revision < this.revision) throw new Error('The room checkpoint moved backwards. Local changes were retained.');
        if (this.actor && reply.packet.actor.id !== this.actor.id) throw new Error('The room response belongs to a different membership.');
        if (outgoing.type === 'update' && !roomVectorCovers(reply.vector, readRoomBinary(outgoing.vector, true))) throw new Error('The room did not apply the complete uploaded state.');
      } catch (error) { throw new ProtocolFailure(error instanceof Error ? error.message : 'Invalid shared room response.'); }
      if (!this.vector || !this.lastUpdate || reply.packet.revision !== this.revision || !sameBytes(this.vector, reply.vector) || !sameBytes(this.lastUpdate, reply.update)) {
        applying = true;
        await this.binding.receive(reply.update, { signal: controller.signal, isCurrent: () => this.current(generation), admit: (_graph, checkpoint) => {
          if (!roomCheckpointCovers(checkpoint, reply.vector)) throw new ProtocolFailure('The room response is waiting on missing state. Local changes were retained.');
        } });
        applying = false;
      }
      if (!this.current(generation)) return;
      if (externalReceipt !== this.externalReceipt) { next = 0; return; }
      this.actor = { ...reply.packet.actor }; this.revision = reply.packet.revision; this.vector = new Uint8Array(reply.vector); this.lastUpdate = reply.update;
      if (outgoing.type === 'update' && this.pending?.packet === outgoing) {
        this.acknowledgedEpoch = Math.max(this.acknowledgedEpoch, this.pending.epoch); this.pending = null; this.readonlyAttempted = false; this.dependencyFailures = 0;
      }
      if (wasFullSync) {
        this.fullSync = ticket !== this.syncTicket;
        if (!this.pending && sameBytes(this.binding.replica.update(), reply.update)) this.acknowledgedEpoch = this.localEpoch;
      }
      this.error = null; this.attempt = 0; this.phase = this.actor.role === 'viewer' ? 'readonly' : this.sendable() ? 'syncing' : 'online'; this.notify();
    } catch (value) {
      if (!this.current(generation)) return;
      const error = value instanceof Error ? value : new Error(String(value));
      if (error instanceof ProtocolFailure || applying || !requesting) this.stop(error);
      else if (error instanceof RoomRequestFailure && error.status === 403 && error.code === 'readonly') { this.readonlyAttempted = true; this.fullSync = true; next = 0; }
      else if (error instanceof RoomRequestFailure && error.status === 409 && error.code === 'dependencies' && this.dependencyFailures++ < 2) { this.pending = null; this.fullSync = true; this.fullUpload = true; next = 0; }
      else if (error instanceof RoomRequestFailure && error.status >= 400 && error.status < 500 && error.status !== 429) this.stop(error);
      else { this.attempt++; this.error = error.message; this.phase = 'retrying'; next = Math.min(30_000, 500 * 2 ** Math.min(this.attempt - 1, 6)); this.notify(); }
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.connected && !this.sourceCurrent()) this.disconnect();
      if (this.connected) this.schedule(this.generation !== generation ? 0 : next ?? (this.sendable() ? 0 : this.poll));
    }
  }
}
