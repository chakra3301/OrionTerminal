import { NativeRoomTransport } from './nativeRoomTransport';
import { readCommentOwnership } from './roomAuthorProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';
import type { RoomCommentContext } from './roomCommentClient';

export type CommentOwnershipState = { phase: 'idle' | 'loading' | 'ready' | 'error'; authorIds: string[]; error: string | null };
type Transport = { read(signal: AbortSignal): Promise<unknown>; dispose(): Promise<void> };
type Options = { current(): boolean; context(): RoomCommentContext | null; onState(state: CommentOwnershipState): void; open?: (server: string, documentId: string, signal: AbortSignal) => Promise<Transport> };
const empty = (): CommentOwnershipState => ({ phase: 'idle', authorIds: [], error: null });
const same = (a: RoomCommentContext, b: RoomCommentContext | null) => !!b && a.serverUrl === b.serverUrl && a.actor.id === b.actor.id && a.epoch === b.epoch;
export class RoomCommentOwnershipClient {
  private state = empty();
  private version = 0;
  private closed = false;
  private context: RoomCommentContext | null = null;
  private active: AbortController | null = null;
  constructor(readonly documentId: string, private readonly options: Options) { validateSharedDocumentId(documentId); }
  get snapshot(): CommentOwnershipState { return structuredClone(this.state); }
  private update(state: CommentOwnershipState): void { if (this.closed) return; this.state = state; if (this.options.current()) this.options.onState(this.snapshot); }
  invalidate(): void { this.version++; this.context = null; this.active?.abort(); this.update(empty()); }
  refresh(): void { if (this.context && (!this.options.current() || !same(this.context, this.options.context()))) this.invalidate(); }
  async load(): Promise<void> {
    const context = this.options.context();
    if (this.closed || !this.options.current() || !context) throw new Error('Connect the room before refreshing comment access.');
    if (this.active) throw new Error('Wait for comment access to finish loading.');
    const controller = new AbortController(), version = ++this.version; this.active = controller; this.context = structuredClone(context); this.update({ ...empty(), phase: 'loading' });
    const check = () => { if (this.closed || controller.signal.aborted || version !== this.version || !this.options.current() || !same(context, this.options.context())) throw new DOMException('The room changed. Refresh comment access.', 'AbortError'); };
    const open = this.options.open ?? (async (server: string, documentId: string, signal: AbortSignal): Promise<Transport> => { const native = await NativeRoomTransport.open(server, documentId, signal); return { read: cancel => native.commentOwnership(cancel), dispose: () => native.dispose() }; });
    let transport: Transport | undefined;
    try {
      transport = await open(context.serverUrl, this.documentId, controller.signal); check();
      const result = readCommentOwnership(await transport.read(controller.signal), this.documentId); check();
      if (result.actor.id !== context.actor.id) throw new Error('The comment access reply belongs to another room member.');
      this.update({ phase: 'ready', authorIds: result.authorIds, error: null });
    } catch (error) {
      if (!this.closed && version === this.version && this.options.current() && same(context, this.options.context())) this.update({ ...empty(), phase: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { try { await transport?.dispose(); } finally { if (this.active === controller) this.active = null; } }
  }
  dispose(): void { this.closed = true; this.version++; this.active?.abort(); this.context = null; this.state = empty(); }
}
