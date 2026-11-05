import { ulid } from 'ulid';
import type { SharedEditorBinding } from './sharedEditor';
import { NativeRoomTransport } from './nativeRoomTransport';
import { RoomRequestFailure } from './sharedRoomConnection';
import { roomBinary, roomCheckpointCovers, type RoomActor } from './sharedRoomProtocol';
import { readRoomCommentCommand, readRoomCommentResponse, type RoomCommentCommand, type RoomCommentRequest, type RoomCommentResult, type RoomCommentResponse } from './roomCommentProtocol';
import { forgetPendingRoomComment, loadPendingRoomComment, rememberPendingRoomComment, samePendingRoomComment, type PendingRoomComment } from './roomCommentPending';

export type RoomCommentState = { phase: 'loading' | 'ready' | 'sending' | 'pending' | 'error' | 'closed'; pending: PendingRoomComment | null; error: string | null };
export type RoomCommentContext = { serverUrl: string; actor: RoomActor; revision: number; epoch: number };
type Transport = { comment(packet: RoomCommentRequest, signal: AbortSignal, recoverOnly: boolean): Promise<unknown>; dispose(): Promise<void> };
type Options = {
  current(): boolean;
  context(): RoomCommentContext | null;
  save(): Promise<void>;
  accepted(actor: RoomActor, revision: number): void;
  onState(state: RoomCommentState): void;
  prepared?(pending: PendingRoomComment): void;
  restored?(pending: PendingRoomComment): void;
  applied?(pending: PendingRoomComment, receipt: RoomCommentResponse): void;
  open?: (server: string, documentId: string, signal: AbortSignal) => Promise<Transport>;
};
export class RoomCommentClient {
  private state: RoomCommentState = { phase: 'loading', pending: null, error: null };
  private closed = false;
  private busy = false;
  private loaded = false;
  private active: { controller: AbortController; context: RoomCommentContext } | null = null;
  private readonly clientId = ulid();
  constructor(readonly documentId: string, readonly projectId: string, private readonly binding: Pick<SharedEditorBinding, 'replica' | 'flush' | 'receive'>, private readonly options: Options) {}
  get snapshot(): RoomCommentState { return structuredClone(this.state); }
  private update(patch: Partial<RoomCommentState>): void {
    if (this.closed || !this.options.current()) return;
    this.state = { ...this.state, ...patch }; this.options.onState(this.snapshot);
  }
  async initialize(): Promise<void> {
    if (this.loaded || this.closed) return;
    try { const pending = await loadPendingRoomComment(this.projectId); this.loaded = true; if (pending && !this.closed && this.options.current()) this.options.restored?.(structuredClone(pending)); this.update({ pending, phase: pending ? 'pending' : 'ready', error: null }); }
    catch (error) { this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error) }); }
  }
  refresh(): void {
    const active = this.active; if (!active) return;
    const current = this.options.context();
    if (!this.options.current() || !current || current.serverUrl !== active.context.serverUrl || current.actor.id !== active.context.actor.id || current.epoch !== active.context.epoch) active.controller.abort();
  }
  private check(context: RoomCommentContext, signal: AbortSignal): RoomCommentContext {
    const current = this.options.context();
    if (this.closed || signal.aborted || !this.options.current() || !current || current.serverUrl !== context.serverUrl || current.actor.id !== context.actor.id || current.epoch !== context.epoch) throw new DOMException('The room changed. The pending comment was retained.', 'AbortError');
    return current;
  }
  private begin(): { context: RoomCommentContext; controller: AbortController } {
    const context = this.options.context();
    if (this.closed || !this.options.current() || !context) throw new Error('Connect this room before sending comments.');
    if (!this.loaded) throw new Error('Reopen the project after restoring its pending comment data.');
    if (this.busy) throw new Error('Wait for the pending comment to finish.');
    this.busy = true; const active = { context: structuredClone(context), controller: new AbortController() }; this.active = active; this.update({ phase: 'sending', error: null }); return active;
  }
  async submit(value: RoomCommentCommand): Promise<RoomCommentResult> {
    const command = readRoomCommentCommand(value);
    if (this.state.pending) throw new Error('Recover or discard the pending comment before posting another.');
    const active = this.begin(); let pending: PendingRoomComment | null = null;
    try {
      this.binding.flush();
      pending = { projectId: this.projectId, serverUrl: active.context.serverUrl, actorId: active.context.actor.id, packet: { version: 1, type: 'comment', documentId: this.documentId, clientId: this.clientId, requestId: ulid(), vector: roomBinary(this.binding.replica.stateVector(), true), command } };
      this.options.prepared?.(structuredClone(pending));
      await rememberPendingRoomComment(pending); this.update({ pending }); this.check(active.context, active.controller.signal);
      return await this.deliver(pending, active);
    } catch (error) { await this.failed(error); throw error; }
    finally { this.end(active); }
  }
  async recover(): Promise<RoomCommentResult> {
    const pending = this.state.pending; if (!pending) throw new Error('There is no pending comment to recover.');
    const active = this.begin();
    try { return await this.deliver(pending, active); }
    catch (error) { await this.failed(error); throw error; }
    finally { this.end(active); }
  }
  private async deliver(pending: PendingRoomComment, active: { context: RoomCommentContext; controller: AbortController }): Promise<RoomCommentResult> {
    const { context, controller } = active, signal = controller.signal;
    if (pending.projectId !== this.projectId || pending.packet.documentId !== this.documentId || pending.serverUrl !== context.serverUrl || pending.actorId !== context.actor.id) throw new Error('Reconnect as the original room member to recover this comment.');
    const saved = await loadPendingRoomComment(this.projectId); this.check(context, signal);
    if (!saved || !samePendingRoomComment(saved, pending)) throw new Error('The pending comment changed. Reopen the project before recovering.');
    const open = this.options.open ?? (async (server: string, document: string, cancel: AbortSignal): Promise<Transport> => {
      const native = await NativeRoomTransport.open(server, document, cancel);
      return { comment: async (packet, signal, recoverOnly) => (await native.comment(packet, signal, recoverOnly)).packet, dispose: () => native.dispose() };
    });
    let transport: Transport | undefined;
    try {
      transport = await open(context.serverUrl, this.documentId, signal); this.check(context, signal);
      let raw: unknown;
      try { raw = await transport.comment(pending.packet, signal, true); }
      catch (error) {
        this.check(context, signal);
        if (!(error instanceof RoomRequestFailure) || error.status !== 404 || error.code !== 'receipt') throw error;
        raw = await transport.comment(pending.packet, signal, false);
      }
      const current = this.check(context, signal), reply = readRoomCommentResponse(raw, pending.packet);
      if (reply.packet.actor.id !== pending.actorId) throw new Error('The comment reply belongs to another room member.');
      if (reply.packet.revision < current.revision) throw new Error('The comment reply is older than this canvas. Recover it again.');
      await this.binding.receive(reply.update, { signal, isCurrent: () => { try { this.check(context, signal); return true; } catch { return false; } }, admit: (_graph, checkpoint) => {
        const latest = this.check(context, signal);
        if (reply.packet.revision < latest.revision || !roomCheckpointCovers(checkpoint, reply.vector)) throw new Error('The comment checkpoint is incomplete or outdated. Recover it again.');
      } });
      this.check(context, signal); this.options.accepted(reply.packet.actor, reply.packet.revision);
      this.options.applied?.(structuredClone(pending), reply.packet);
      // The receipt may outlive the canvas. Persist its applied checkpoint before clearing the outbox.
      await this.options.save(); this.check(context, signal);
      await forgetPendingRoomComment(pending); this.check(context, signal);
      this.update({ pending: null, phase: 'ready', error: null }); return { ...reply.packet.result };
    } finally { await transport?.dispose(); }
  }
  private async failed(error: unknown): Promise<void> {
    let pending = this.state.pending;
    try { pending = await loadPendingRoomComment(this.projectId); }
    catch { this.loaded = false; }
    this.update({ pending, phase: pending ? 'pending' : this.loaded ? 'ready' : 'error', error: error instanceof Error ? error.message : String(error) });
  }
  private end(active: { controller: AbortController }): void { if (this.active === active) this.active = null; this.busy = false; }
  async discard(): Promise<void> {
    if (this.closed || !this.options.current() || !this.loaded || this.busy) throw new Error('Wait for the pending comment to finish.');
    const pending = this.state.pending; if (!pending) return;
    this.busy = true; this.update({ phase: 'sending', error: null });
    try { await forgetPendingRoomComment(pending); this.update({ pending: null, phase: 'ready', error: null }); }
    catch (error) { await this.failed(error); throw error; }
    finally { this.busy = false; }
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.active?.controller.abort(); this.state = { ...this.state, phase: 'closed' }; }
}
