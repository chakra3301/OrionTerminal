import { NativeRoomTransport } from './nativeRoomTransport';
import { readRoomCommentHistoryPage, type RoomCommentHistoryEntry } from './roomCommentProtocol';
import type { RoomCommentContext } from './roomCommentClient';
import { validateSharedDocumentId } from './sharedCheckpoint';

export type RoomCommentHistoryState = { phase: 'idle' | 'loading' | 'ready' | 'error' | 'closed'; entries: RoomCommentHistoryEntry[]; next: number | null; before: number | null; error: string | null };
type Transport = { list(signal: AbortSignal, before?: number): Promise<unknown>; dispose(): Promise<void> };
type Options = { current(): boolean; context(): RoomCommentContext | null; onState(state: RoomCommentHistoryState): void; open?: (server: string, documentId: string, signal: AbortSignal) => Promise<Transport> };
const empty = (): RoomCommentHistoryState => ({ phase: 'idle', entries: [], next: null, before: null, error: null });
const same = (a: RoomCommentContext, b: RoomCommentContext | null) => !!b && a.serverUrl === b.serverUrl && a.actor.id === b.actor.id && a.epoch === b.epoch;
export class RoomCommentHistoryClient {
  private state = empty();
  private closed = false;
  private version = 0;
  private context: RoomCommentContext | null = null;
  private active: { controller: AbortController; context: RoomCommentContext; version: number } | null = null;
  constructor(readonly documentId: string, private readonly options: Options) { validateSharedDocumentId(documentId); }
  get snapshot(): RoomCommentHistoryState { return structuredClone(this.state); }
  private update(state: RoomCommentHistoryState): void { if (this.closed || !this.options.current()) return; this.state = state; this.options.onState(this.snapshot); }
  invalidate(): void {
    if (this.closed) return;
    this.version++; this.context = null; this.active?.controller.abort();
    this.update({ ...empty(), phase: this.active ? 'loading' : 'idle' });
  }
  refresh(): void {
    const context = this.context ?? this.active?.context;
    if (context && (!this.options.current() || !same(context, this.options.context()))) this.invalidate();
  }
  private check(active: NonNullable<RoomCommentHistoryClient['active']>): void {
    if (this.closed || active.controller.signal.aborted || active.version !== this.version || !this.options.current() || !same(active.context,this.options.context())) throw new DOMException('The room changed. Refresh your comment history.', 'AbortError');
  }
  async load(before?: number): Promise<void> {
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Invalid comment history cursor.');
    const context = this.options.context();
    if (this.closed || !this.options.current() || !context) throw new Error('Connect the room before opening your comment history.');
    if (this.active) throw new Error('Wait for your comment history to finish loading.');
    const active = { controller: new AbortController(), context: structuredClone(context), version: ++this.version }; this.active = active; this.context = active.context;
    this.update({ ...empty(), phase: 'loading', before: before ?? null }); let transport: Transport | undefined;
    const open = this.options.open ?? (async (server: string, document: string, signal: AbortSignal): Promise<Transport> => {
      const native = await NativeRoomTransport.open(server,document,signal);
      return { list: (cancel,cursor) => native.commentHistory(cancel,cursor), dispose: () => native.dispose() };
    });
    try {
      transport = await open(context.serverUrl,this.documentId,active.controller.signal); this.check(active);
      const page = readRoomCommentHistoryPage(await transport.list(active.controller.signal,before),this.documentId,before); this.check(active);
      if (page.actor.id !== context.actor.id) throw new Error('The history reply belongs to another room member.');
      this.update({ phase: 'ready', entries: page.entries, next: page.next, before: before ?? null, error: null });
    } catch (error) {
      if (!this.closed && active.version === this.version && this.options.current() && same(context,this.options.context())) this.update({ ...empty(), phase: 'error', before: before ?? null, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      try { await transport?.dispose(); }
      finally { if (this.active === active) { this.active = null; if (!this.closed && active.version !== this.version) this.update(empty()); } }
    }
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.active?.controller.abort(); this.context = null; this.state = { ...empty(), phase: 'closed' }; }
}
