import type { SharedEditorBinding, SharedEditorHistory } from './sharedEditor';
import type { PendingRoomComment } from './roomCommentPending';
import type { RoomCommentCommand, RoomCommentHistoryEntry, RoomCommentResponse } from './roomCommentProtocol';

export type CanvasHistoryState = { undoLabel: string | null; redoLabel: string | null; busy: boolean };
type Artwork = { kind: 'artwork'; key: string; label: string; order: number; redoOrder: number; undone: boolean };
type Comment = { kind: 'comment'; key: string; label: string; order: number; redoOrder: number; undone: boolean; serverUrl: string; actorId: string; clientId: string; requestId: string; threadId: string; step: number };
type Item = Artwork | Comment;
type Options = {
  scope(): { serverUrl: string; actorId: string } | null;
  change(state: CanvasHistoryState): void;
  artwork(direction: 'undo' | 'redo'): void;
  comment(command: RoomCommentCommand): Promise<unknown>;
};
const labels = { add: 'Add comment', reply: 'Reply', edit: 'Edit comment', delete: 'Delete comment', resolve: 'Change resolution', move: 'Move pin', react: 'Reaction' };
const identity = (serverUrl: string, actorId: string, clientId: string, requestId: string) => JSON.stringify([serverUrl, actorId, clientId, requestId]);

export class CanvasHistory {
  private items: Item[] = [];
  private readonly reservations = new Map<string, number>();
  private readonly ignoredArtworkRedo = new Set<string>();
  private sequence = 0;
  private busy = false;
  private closed = false;
  private readonly stop: () => void;
  constructor(private readonly binding: Pick<SharedEditorBinding, 'subscribeHistory' | 'historyBoundary' | 'flush' | 'history'>, private readonly options: Options) {
    this.stop = binding.subscribeHistory(history => this.artworkChanged(history));
  }
  private next(): number { if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Reopen the canvas before recording more history.'); return ++this.sequence; }
  private visible(item: Item): boolean {
    const scope = this.options.scope(); return item.kind === 'artwork' || !!scope && item.serverUrl === scope.serverUrl && item.actorId === scope.actorId;
  }
  private target(direction: 'undo' | 'redo'): Item | undefined {
    const redo = direction === 'redo';
    return this.items.filter(item => item.undone === redo && this.visible(item)).sort((a, b) => redo ? b.redoOrder - a.redoOrder : b.order - a.order)[0];
  }
  get snapshot(): CanvasHistoryState { return { undoLabel: this.target('undo')?.label ?? null, redoLabel: this.target('redo')?.label ?? null, busy: this.busy }; }
  refresh(): void { if (!this.closed) this.options.change(this.snapshot); }
  private artworkChanged(history: SharedEditorHistory): void {
    if (this.closed) return;
    if (history.source === 'clear') { this.items = []; this.reservations.clear(); this.ignoredArtworkRedo.clear(); this.refresh(); return; }
    const active = new Set([...history.undo, ...history.redo].map(item => item.key));
    this.items = this.items.filter(item => item.kind === 'comment' || active.has(item.key));
    for (const key of this.ignoredArtworkRedo) if (!active.has(key)) this.ignoredArtworkRedo.delete(key);
    if (history.source === 'record') this.items = this.items.filter(item => item.kind === 'artwork' || !item.undone);
    for (const [undone, headers] of [[false, history.undo], [true, history.redo]] as const) {
      for (const header of headers) {
        if (undone && this.ignoredArtworkRedo.has(header.key)) continue;
        let item = this.items.find((item): item is Artwork => item.kind === 'artwork' && item.key === header.key);
        if (!item) {
          if (history.source === 'record' && !undone) this.items = this.items.filter(item => !item.undone);
          item = { kind: 'artwork', key: header.key, label: header.label, order: this.next(), redoOrder: undone ? this.next() : 0, undone }; this.items.push(item);
        } else { if (!item.undone && undone) item.redoOrder = this.next(); item.undone = undone; item.label = header.label; }
      }
    }
    this.refresh();
  }
  prepare(pending: PendingRoomComment): void {
    if (this.closed) throw new Error('The canvas history is closed.');
    this.binding.historyBoundary();
    const key = identity(pending.serverUrl, pending.actorId, pending.packet.clientId, pending.packet.requestId);
    this.reservations.set(key, this.next());
    while (this.reservations.size > 200) this.reservations.delete(this.reservations.keys().next().value!);
  }
  restore(pending: PendingRoomComment): void {
    if (this.closed) return;
    const key = identity(pending.serverUrl, pending.actorId, pending.packet.clientId, pending.packet.requestId);
    if (!this.reservations.has(key)) this.reservations.set(key, 0);
  }
  applied(pending: PendingRoomComment, receipt: RoomCommentResponse): void {
    if (this.closed) return;
    const { command } = pending.packet, history = command.type === 'history';
    const clientId = history ? command.sourceClientId : pending.packet.clientId, requestId = history ? command.sourceRequestId : pending.packet.requestId;
    const key = identity(pending.serverUrl, pending.actorId, clientId, requestId);
    const packetKey = identity(pending.serverUrl, pending.actorId, pending.packet.clientId, pending.packet.requestId);
    let item = this.items.find((item): item is Comment => item.kind === 'comment' && item.key === key);
    if (item && (!history || item.step > command.step)) return;
    if (!item) {
      if (!history) {
        for (const entry of this.items) if (entry.kind === 'artwork' && entry.undone) this.ignoredArtworkRedo.add(entry.key);
        this.items = this.items.filter(item => !item.undone);
      }
      item = { kind: 'comment', key, label: history ? 'Comment' : labels[command.type], order: this.reservations.get(packetKey) ?? this.next(), redoOrder: 0, undone: false, serverUrl: pending.serverUrl, actorId: pending.actorId, clientId, requestId, threadId: receipt.result.threadId, step: 0 };
      this.items.push(item);
    }
    if (history) { item.step = command.step + 1; item.undone = command.direction === 'undo'; if (item.undone) item.redoOrder = this.next(); }
    this.reservations.delete(packetKey);
    const comments = this.items.filter(item => item.kind === 'comment').sort((a, b) => b.order - a.order);
    const retained = new Set(comments.slice(0, 200)); this.items = this.items.filter(item => item.kind === 'artwork' || retained.has(item));
    this.refresh();
  }
  reconcile(entries: RoomCommentHistoryEntry[]): void {
    const scope = this.options.scope(); if (!scope || this.closed) return;
    for (const entry of entries) {
      const key = identity(scope.serverUrl, scope.actorId, entry.clientId, entry.requestId);
      const item = this.items.find((item): item is Comment => item.kind === 'comment' && item.key === key);
      if (!item || entry.step < item.step) continue;
      if (!item.undone && entry.undone) item.redoOrder = this.next();
      item.step = entry.step; item.undone = entry.undone; item.label = labels[entry.action];
    }
    this.refresh();
  }
  kind(direction: 'undo' | 'redo'): Item['kind'] | null { return this.target(direction)?.kind ?? null; }
  async replay(direction: 'undo' | 'redo'): Promise<void> {
    if (this.closed) throw new Error('The canvas history is closed.');
    if (this.busy) throw new Error('Wait for undo or redo to finish.');
    this.binding.flush(); const item = this.target(direction); if (!item) return;
    this.busy = true; this.refresh();
    try {
      if (item.kind === 'artwork') {
        if (this.binding.history[direction].at(-1)?.key !== item.key) throw new Error('The artwork history changed. Try undo or redo again.');
        this.options.artwork(direction);
      }
      else await this.options.comment({ type: 'history', threadId: item.threadId, sourceClientId: item.clientId, sourceRequestId: item.requestId, step: item.step, direction });
    } finally { this.busy = false; this.refresh(); }
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.stop(); this.items = []; this.reservations.clear(); this.ignoredArtworkRedo.clear(); }
}
