import type { Editor } from '@open-pencil/core/editor';
import type { SceneGraph, UndoEntry } from '@open-pencil/scene-graph';
import { SharedDesign, type SharedDesignChange, type SharedDesignAdmission } from './sharedDesign';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { installSharedIds } from './sharedIds';
import { applyPencilGraphSnapshot } from './toolExecution';

type View = { page: string; selection: string[]; entered: string | null; panX: number; panY: number; zoom: number };
type Token = { original: UndoEntry | null; before: View; after: View; key: string; changed: boolean };
type Batch = { label: string; key: string; coalesce?: string; tokens: Token[]; before: View; snapshot: string; viewOnly: boolean };
type Header = { key: string; label: string; coalesce?: string };
export type SharedEditorHistory = { undo: { key: string; label: string }[]; redo: { key: string; label: string }[]; source: 'record' | 'undo' | 'redo' | 'clear' | 'status' };
export type SharedReceiveOptions = { signal?: AbortSignal; isCurrent?: () => boolean; admit?: SharedDesignAdmission };
type Pending = { bytes: Uint8Array; options: SharedReceiveOptions; cleanup: () => void; resolve: (change: SharedDesignChange) => void; reject: (error: unknown) => void };
export type SharedEditorOptions = {
  isCurrent?: () => boolean;
  publish?: () => void;
  onUpdate?: (change: SharedDesignChange) => void;
  onError?: (error: Error) => void;
  onBusyChange?: (busy: boolean) => void;
  canEdit?: () => boolean;
};
const bindings = new WeakMap<Editor, SharedEditorBinding>();
const MAX_PENDING_BYTES = 32 * 1024 * 1024;

export class SharedEditorBinding {
  private accepted: SceneGraph;
  private acceptedCheckpoint: Uint8Array | null = null;
  private checkpointRevision = 0;
  private publication: { graph: SceneGraph; checkpoint: Uint8Array } | null = null;
  private stableView: View;
  private actionView: View | null = null;
  private batches: Batch[] = [];
  private settling: { key: string; label: string; tokens: Token[] } | null = null;
  private sequence = 0;
  private generation = 0;
  private undoHeaders: Header[] = [];
  private redoHeaders: Header[] = [];
  private muted = 0;
  private nativeDepth = 0;
  private replayTokens: Token[] | null = null;
  private queued = false;
  private dirty = false;
  private automaticRecord = false;
  private pending: Pending[] = [];
  private pendingBytes = 0;
  private closed = false;
  private readOnly = false;
  private connected = true;
  private asyncDepth = 0;
  private callingWork = 0;
  private busyNotified = false;
  private readonly asyncMethods: { key: keyof Editor; original: unknown; wrapped: unknown }[] = [];
  private restoreIds: () => void;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly localListeners = new Set<(change: SharedDesignChange) => void>();
  private readonly historyListeners = new Set<(history: SharedEditorHistory) => void>();
  private readonly originals;
  private readonly wrappers;
  private readonly originalDispose;
  private readonly originalReplace;
  private readonly replace;
  private readonly disposeEditor;
  lastError: Error | null = null;

  constructor(readonly editor: Editor, readonly replica: SharedDesign, private readonly options: SharedEditorOptions = {}) {
    if (bindings.has(editor) || editor.undo.canUndo || editor.undo.canRedo || editor.undo.isBatching || editor.isInteractiveEditing() || replica.canUndo || replica.canRedo) throw new Error('Start a shared binding on a fresh editor session. Existing history was preserved.');
    const canonical = SharedDesign.fromGraph(editor.graph);
    try { if (serializeGraph(canonical.graph) !== serializeGraph(replica.graph)) throw new Error('The editor and shared document do not match.'); }
    finally { canonical.dispose(); }
    this.accepted = replica.graph; this.stableView = this.view();
    this.originals = { record: editor.undo.record, undo: editor.undo.undo, redo: editor.undo.redo, beginBatch: editor.undo.beginBatch, commitBatch: editor.undo.commitBatch, rollbackBatch: editor.undo.rollbackBatch, discardBatches: editor.undo.discardBatches, clear: editor.undo.clear };
    this.wrappers = {
      record: (entry: UndoEntry) => this.record(entry),
      undo: () => this.replay('undo'), redo: () => this.replay('redo'),
      beginBatch: (label: string, coalesceKey?: string) => this.begin(label, coalesceKey),
      commitBatch: () => this.commitBatch(), rollbackBatch: () => this.rollback(),
      discardBatches: () => this.discard(), clear: () => this.clear(),
    };
    Object.assign(editor.undo, this.wrappers);
    this.restoreIds = installSharedIds(editor.graph, () => replica.peerId);
    this.originalDispose = editor.dispose; this.originalReplace = editor.replaceGraph;
    this.replace = (graph: SceneGraph) => this.replaceGraph(graph); editor.replaceGraph = this.replace;
    this.disposeEditor = () => { this.close(); this.originalDispose(); }; editor.dispose = this.disposeEditor;
    const schedule = () => { if (!this.muted) { this.dirty = true; this.actionView ??= this.view(); this.schedule(); } };
    for (const event of ['node:created', 'node:updated', 'node:deleted', 'node:reparented', 'node:reordered', 'node:previewUpdated'] as const) this.unsubscribe.push(editor.onEditorEvent(event, schedule));
    for (const event of ['render:requested', 'repaint:requested'] as const) this.unsubscribe.push(editor.onEditorEvent(event, () => { if (!this.muted && (this.dirty || this.settling || this.pending.length)) this.schedule(); }));
    for (const event of ['selection:changed', 'page:changed', 'viewport:changed'] as const) this.unsubscribe.push(editor.onEditorEvent(event, () => {
      if (this.muted) return;
      if (this.settling) this.settling.tokens.forEach(token => { token.after = this.view(); });
      if (!this.actionView && !this.batches.length) this.stableView = this.view();
    }));
    this.unsubscribe.push(editor.onEditorEvent('graph:replaced', () => { this.restoreIds(); this.restoreIds = installSharedIds(editor.graph, () => replica.peerId); }));
    bindings.set(editor, this);
    for (const [key, label] of [['pasteFromHTML', 'Paste'], ['pasteSnapshot', 'Paste'], ['placeFiles', 'Place files'], ['placeImageFiles', 'Place images'], ['runMutationWithLayout', 'Edit design'], ['switchPage', 'Switch page'], ['focusComponent', 'Focus component'], ['goToMainComponent', 'Go to main component']] as const) {
      const original = editor[key], wrapped = (...args: unknown[]) => this.transaction(label, () => (original as (...args: unknown[]) => unknown).apply(editor, args), ['switchPage', 'focusComponent', 'goToMainComponent'].includes(key));
      this.asyncMethods.push({ key, original, wrapped }); Object.assign(editor, { [key]: wrapped });
    }
  }
  private assertCurrent(): void {
    if (this.closed || this.options.isCurrent && !this.options.isCurrent()) throw new Error('The shared design editor is no longer active.');
  }
  private assertEditable(): void {
    if (this.readOnly || this.options.canEdit && !this.options.canEdit()) throw new Error('This room has viewer access. Artwork changes are unavailable.');
  }
  setReadOnly(value: boolean): void { this.assertCurrent(); if (typeof value !== 'boolean') throw new Error('Invalid room access.'); this.readOnly = value; }
  private view(): View { const state = this.editor.state; return { page: state.currentPageId, selection: [...state.selectedIds], entered: state.enteredContainerId, panX: state.panX, panY: state.panY, zoom: state.zoom }; }
  private restoreView(view: View, viewport = false): void {
    const state = this.editor.state, graph = this.editor.graph;
    if (graph.getNode(view.page)?.type === 'CANVAS' && !graph.getNode(view.page)!.internalOnly) state.currentPageId = view.page;
    else if (!graph.getNode(state.currentPageId) || graph.getNode(state.currentPageId)!.internalOnly) state.currentPageId = graph.getPages()[0]!.id;
    this.editor.select(view.selection.filter(id => graph.nodes.has(id) && graph.isDescendant(id, state.currentPageId)));
    state.enteredContainerId = view.entered && graph.nodes.has(view.entered) ? view.entered : null;
    if (viewport && state.currentPageId === view.page) Object.assign(state, { panX: view.panX, panY: view.panY, zoom: view.zoom });
  }
  private publish(graph: SceneGraph, rollback = this.accepted, rollbackView = this.stableView, targetView = this.view(), viewport = false, checkpoint = this.replica.update()): void {
    this.assertCurrent(); this.muted++;
    this.publication = { graph, checkpoint };
    try {
      applyPencilGraphSnapshot(this.editor, graph); this.restoreView(targetView, viewport);
      const result: unknown = this.options.publish?.();
      if (result && typeof result === 'object' && 'then' in result) throw new Error('Shared editor publication must be synchronous.');
    } catch (error) {
      this.publication = null;
      this.invalidateCheckpoint();
      try { applyPencilGraphSnapshot(this.editor, rollback); this.restoreView(rollbackView, true); } finally { this.muted--; }
      throw error;
    }
    this.publication = null;
    this.acceptedCheckpoint = new Uint8Array(checkpoint);
    this.checkpointRevision++;
    this.muted--;
  }
  private invalidateCheckpoint(): void { this.acceptedCheckpoint = null; this.checkpointRevision += 2; }
  snapshot(options: { acceptedOnly?: boolean } = {}): { graph: string; checkpoint: Uint8Array; revision: number; view: View; photoLinks: Record<string, string> } {
    if (this.closed) throw new Error('The shared design editor is closed.');
    if (!options.acceptedOnly) { this.assertCurrent(); this.flush(); }
    const graph = (!options.acceptedOnly && this.publication?.graph) || this.accepted, view = this.view();
    if (graph.getNode(view.page)?.type !== 'CANVAS') Object.assign(view, this.stableView);
    const photoLinks = Object.fromEntries([...graph.nodes.values()].flatMap(node => {
      const id = node.pluginData.find(entry => entry.pluginId === 'orion.xdesign' && entry.key === 'photoDocumentId')?.value;
      return id ? [[node.id, id]] : [];
    }));
    if (options.acceptedOnly || !this.publication) this.acceptedCheckpoint ??= this.replica.update();
    return { graph: serializeGraph(graph), checkpoint: new Uint8Array((!options.acceptedOnly && this.publication?.checkpoint) || this.acceptedCheckpoint!), revision: this.checkpointRevision + (!options.acceptedOnly && this.publication ? 1 : 0), view, photoLinks };
  }
  private report(value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value)); this.lastError = error;
    try { this.options.onError?.(error); } catch { /* The editor already accepted the action; reporting cannot erase it. */ }
  }
  private emit(change: SharedDesignChange): void {
    if (!change.changed || change.source === 'remote') return;
    for (const listener of [...this.localListeners]) try { listener(change); } catch (error) { this.report(error); }
    if (this.connected) try { this.options.onUpdate?.(change); } catch (error) { this.report(error); }
  }
  subscribeUpdates(listener: (change: SharedDesignChange) => void): () => void {
    this.assertCurrent(); this.localListeners.add(listener); return () => { this.localListeners.delete(listener); };
  }
  get history(): SharedEditorHistory { return { undo: this.undoHeaders.map(({ key, label }) => ({ key, label })), redo: this.redoHeaders.map(({ key, label }) => ({ key, label })), source: 'record' }; }
  subscribeHistory(listener: (history: SharedEditorHistory) => void): () => void {
    this.assertCurrent(); this.historyListeners.add(listener); listener(this.history); return () => { this.historyListeners.delete(listener); };
  }
  private emitHistory(source: SharedEditorHistory['source']): void {
    const history = { ...this.history, source };
    for (const listener of [...this.historyListeners]) try { listener(history); } catch (error) { this.report(error); }
  }
  historyBoundary(): void { this.assertCurrent(); this.flush(); this.generation++; }
  private incomingCurrent(options: SharedReceiveOptions): void {
    const current = !options.isCurrent || options.isCurrent();
    if (options.signal?.aborted || !current) { const error = new Error('The room changed before applying the update.'); error.name = 'AbortError'; throw error; }
  }
  private coalesce(value?: string): string | undefined { return value ? `${this.generation}:${value}` : undefined; }
  private key(coalesce?: string): string { return coalesce && this.undoHeaders.at(-1)?.coalesce === coalesce ? this.undoHeaders.at(-1)!.key : `entry:${++this.sequence}`; }
  private remember(header: Header): void {
    if (header.coalesce && this.undoHeaders.at(-1)?.coalesce === header.coalesce) this.undoHeaders[this.undoHeaders.length - 1] = header;
    else this.undoHeaders.push(header);
    this.undoHeaders = this.undoHeaders.slice(-200); this.redoHeaders = [];
  }
  private record(entry: UndoEntry): void {
    this.assertCurrent(); if (this.muted) throw new Error('Cannot record local history during shared publication.');
    const batch = this.batches.at(-1), coalesce = this.coalesce(entry.coalesceKey), token: Token = { original: entry, before: this.actionView ?? this.stableView, after: this.view(), key: batch?.key ?? this.key(coalesce), changed: false };
    const wrapped: UndoEntry = {
      label: entry.label, coalesceKey: coalesce,
      forward: () => { if (token.original) token.original.forward(); else this.replayTokens?.push(token); },
      inverse: () => { if (token.original) token.original.inverse(); else this.replayTokens?.push(token); },
    };
    let change: SharedDesignChange | null = null;
    this.nativeDepth++;
    try {
      if (!batch?.viewOnly || serializeGraph(this.editor.graph) !== serializeGraph(this.accepted)) this.assertEditable();
      if (!batch) change = this.replica.commit(this.accepted, this.editor.graph, entry.label, (graph, checkpoint) => this.publish(graph, this.accepted, token.before, undefined, false, checkpoint), token.key);
      if (!batch && change && !change.changed && this.automaticRecord) { this.accepted = change.graph; this.dirty = false; this.actionView = null; return; }
      this.originals.record.call(this.editor.undo, wrapped);
      if (batch) batch.tokens.push(token);
      else if (change) { this.remember({ key: token.key, label: entry.label, coalesce }); this.accepted = change.graph; token.changed = change.changed; token.original = null; this.settling = { key: token.key, label: entry.label, tokens: [token] }; this.emit(change); this.emitHistory('record'); }
      this.stableView = this.view(); this.actionView = null; this.dirty = false;
    } catch (error) {
      this.invalidateCheckpoint();
      if (!batch) { this.muted++; try { applyPencilGraphSnapshot(this.editor, this.accepted); this.restoreView(token.before, true); } finally { this.muted--; } }
      throw error;
    } finally { this.nativeDepth--; this.schedule(); }
  }
  private begin(label: string, coalesce?: string, viewOnly = false): void {
    this.assertCurrent(); const parent = this.batches.at(-1), effective = this.coalesce(coalesce);
    if (!viewOnly) this.assertEditable();
    if (this.batches.length >= 64) throw new Error('Shared design history batches exceed the nesting limit.');
    this.batches.push({ label, key: parent?.key ?? this.key(effective), coalesce: effective, tokens: [], before: this.actionView ?? this.view(), snapshot: serializeGraph(this.editor.graph), viewOnly }); this.originals.beginBatch.call(this.editor.undo, label, effective); this.emitHistory('status');
  }
  private commitBatch(): void {
    this.assertCurrent(); const batch = this.batches.at(-1); if (!batch) return;
    if (this.batches.length > 1) {
      this.originals.commitBatch.call(this.editor.undo); this.batches.pop(); this.batches.at(-1)!.tokens.push(...batch.tokens); return;
    }
    this.nativeDepth++;
    try {
      if (serializeGraph(this.editor.graph) !== serializeGraph(this.accepted)) this.assertEditable();
      const change = this.replica.commit(this.accepted, this.editor.graph, batch.label, (graph, checkpoint) => this.publish(graph, this.accepted, batch.before, undefined, false, checkpoint), batch.key);
      if (change.changed && !batch.tokens.length) this.record({ label: batch.label, forward: () => {}, inverse: () => {} });
      this.originals.commitBatch.call(this.editor.undo); this.batches.pop();
      batch.tokens.forEach(token => { token.original = null; token.changed = change.changed; token.after = this.view(); });
      if (batch.tokens.length) this.remember({ key: batch.key, label: batch.label, coalesce: batch.coalesce });
      this.accepted = change.graph; this.settling = { key: batch.key, label: batch.label, tokens: batch.tokens }; this.stableView = this.view(); this.actionView = null; this.dirty = false; this.emit(change); if (batch.tokens.length) this.emitHistory('record');
    } catch (error) { this.invalidateCheckpoint(); throw error; }
    finally { this.nativeDepth--; this.schedule(); }
  }
  private rollback(): void {
    const batch = this.batches.pop(); if (!batch) return; this.nativeDepth++; this.muted++;
    try { this.originals.rollbackBatch.call(this.editor.undo); }
    finally {
      try { applyPencilGraphSnapshot(this.editor, deserializeGraph(batch.snapshot, true)); this.restoreView(batch.before, true); }
      finally { this.muted--; this.nativeDepth--; this.actionView = null; this.dirty = false; this.emitHistory('status'); this.schedule(); }
    }
  }
  private discard(): void {
    this.batches = []; this.originals.discardBatches.call(this.editor.undo); this.actionView = null; this.emitHistory('status'); this.schedule();
  }
  private clear(): void {
    this.assertCurrent(); this.originals.clear.call(this.editor.undo); this.replica.clearHistory(); this.undoHeaders = []; this.redoHeaders = []; this.generation++; this.settling = null; this.stableView = this.view(); this.emitHistory('clear'); this.schedule();
  }
  private replay(direction: 'undo' | 'redo'): string | null {
    this.assertCurrent(); this.assertEditable(); if (this.batches.length || this.editor.isInteractiveEditing()) throw new Error('Finish the current shared edit before undo or redo.');
    this.flush(); const tokens: Token[] = []; this.replayTokens = tokens; this.nativeDepth++;
    this.invalidateCheckpoint();
    try {
      // Native entries retain labels/batching/coalescing and view endpoints. Their
      // old graph callbacks have been released, so rehearsal cannot erase a peer.
      const label = this.originals[direction].call(this.editor.undo); if (label === null) return null;
      const target = tokens.at(-1), changes = tokens.some(token => token.changed), key = target?.key;
      let change: SharedDesignChange | null = null;
      const desired = target ? direction === 'undo' ? target.before : target.after : this.view();
      const admit = (graph: SceneGraph, checkpoint = this.replica.update()) => this.publish(graph, this.accepted, this.stableView, desired, !!target && target.before.page !== target.after.page, checkpoint);
      try {
        if (changes && this.replica.historyKey(direction) === key) change = direction === 'undo' ? this.replica.undoOne(admit) : this.replica.redoOne(admit);
        if (change) { this.accepted = change.graph; if (!change.changed) tokens.forEach(token => { token.changed = false; }); }
        if (!change?.changed) admit(this.accepted);
        const from = direction === 'undo' ? this.undoHeaders : this.redoHeaders, to = direction === 'undo' ? this.redoHeaders : this.undoHeaders, header = from.pop(); if (header) to.push(header);
        this.generation++; this.stableView = this.view(); this.actionView = null; this.settling = null; if (change) this.emit(change); this.emitHistory(direction); return label;
      } catch (error) {
        this.invalidateCheckpoint();
        this.replayTokens = []; this.originals[direction === 'undo' ? 'redo' : 'undo'].call(this.editor.undo); throw error;
      }
    } finally { this.replayTokens = null; this.nativeDepth--; this.schedule(); }
  }
  private replaceGraph(graph: SceneGraph): void {
    this.assertCurrent(); this.assertEditable(); if (this.batches.length || this.editor.isInteractiveEditing() || graph.rootId !== this.accepted.rootId) throw new Error('Open a different shared document in a new editor session.');
    const previous = this.editor.graph, view = this.view(); this.nativeDepth++; this.actionView = view;
    try { this.originalReplace(graph); this.editor.undo.record({ label: 'Replace design', forward: () => {}, inverse: () => {} }); }
    catch (error) { this.muted++; try { this.originalReplace(previous); this.restoreView(view, true); } finally { this.muted--; } throw error; }
    finally { this.nativeDepth--; this.schedule(); }
  }
  private schedule(): void {
    if (this.closed || this.queued) return; this.queued = true;
    queueMicrotask(() => { this.queued = false; if (this.closed) return; try { this.flush(false); } catch (error) { this.report(error); } });
  }
  flush(force = true): void {
    this.assertCurrent(); if (this.muted || this.nativeDepth || this.batches.length || this.editor.isInteractiveEditing()) return;
    if ((force || this.dirty || this.settling) && serializeGraph(this.editor.graph) !== serializeGraph(this.accepted)) {
      try { this.assertEditable(); } catch (error) {
        this.muted++; try { applyPencilGraphSnapshot(this.editor, this.accepted); this.restoreView(this.actionView ?? this.stableView, true); } finally { this.muted--; }
        this.dirty = false; this.settling = null; this.actionView = null; throw error;
      }
      if (this.settling) {
        const change = this.replica.commit(this.accepted, this.editor.graph, this.settling.label, (graph, checkpoint) => this.publish(graph, undefined, undefined, undefined, false, checkpoint), this.settling.key);
        this.settling.tokens.forEach(token => { token.changed ||= change.changed; token.after = this.view(); }); this.accepted = change.graph; this.emit(change);
      } else { this.automaticRecord = true; try { this.editor.undo.record({ label: 'Update design', forward: () => {}, inverse: () => {} }); } finally { this.automaticRecord = false; } }
    }
    this.settling = null; this.actionView = null; this.dirty = false; this.stableView = this.view();
    while (this.pending.length && !this.batches.length && !this.editor.isInteractiveEditing()) {
      const request = this.pending.shift()!; this.pendingBytes -= request.bytes.byteLength; request.cleanup();
      try {
        this.incomingCurrent(request.options);
        const change = this.replica.receive(request.bytes, (graph, checkpoint) => {
          this.incomingCurrent(request.options);
          const result: unknown = request.options.admit?.(graph, checkpoint);
          if (result && typeof result === 'object' && 'then' in result) { void Promise.resolve(result).catch(() => {}); throw new Error('Shared update admission must be synchronous.'); }
          this.incomingCurrent(request.options); this.publish(graph, undefined, undefined, undefined, false, checkpoint);
        });
        this.accepted = change.graph; this.stableView = this.view(); request.resolve(change);
      } catch (error) { this.invalidateCheckpoint(); request.reject(error); if (!(error instanceof Error && error.name === 'AbortError')) this.report(error); }
    }
    this.emitHistory('status');
  }
  receive(bytes: Uint8Array, options: SharedReceiveOptions = {}): Promise<SharedDesignChange> {
    const captured = { ...options };
    try { this.assertCurrent(); this.incomingCurrent(captured); if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > MAX_PENDING_BYTES || this.pending.length >= 256 || this.pendingBytes + bytes.byteLength > MAX_PENDING_BYTES) throw new Error('Shared update queue is full or the update is invalid. Resynchronize after the current edit.'); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const pending: Pending = { bytes: new Uint8Array(bytes), options: captured, cleanup: () => captured.signal?.removeEventListener('abort', abort), resolve, reject };
      const abort = () => {
        const index = this.pending.indexOf(pending); if (index < 0) return;
        this.pending.splice(index, 1); this.pendingBytes -= pending.bytes.byteLength; pending.cleanup();
        const error = new Error('The room changed before applying the update.'); error.name = 'AbortError'; reject(error);
      };
      this.pending.push(pending); this.pendingBytes += bytes.byteLength; captured.signal?.addEventListener('abort', abort, { once: true }); this.schedule();
    });
  }
  async transaction<T>(label: string, work: () => T | Promise<T>, viewOnly = false): Promise<T> {
    if (this.asyncDepth && !this.callingWork) throw new Error('Wait for the current shared design action to finish.');
    this.begin(label, undefined, viewOnly);
    this.asyncDepth++; if (this.asyncDepth === 1) { this.busyNotified = true; try { this.options.onBusyChange?.(true); } catch (error) { this.report(error); } }
    try {
      let result: T | Promise<T>; this.callingWork++;
      try { result = work(); } finally { this.callingWork--; }
      const value = await result; this.assertCurrent(); this.commitBatch(); return value;
    }
    catch (error) { this.rollback(); throw error; }
    finally { this.asyncDepth--; if (!this.asyncDepth && this.busyNotified) { this.busyNotified = false; try { this.options.onBusyChange?.(false); } catch (error) { this.report(error); } } this.emitHistory('status'); }
  }
  get busy(): boolean { return !this.closed && (this.asyncDepth > 0 || this.batches.length > 0 || this.editor.isInteractiveEditing()); }
  disconnect(): void { this.connected = false; }
  reconnect(): void { this.assertCurrent(); this.connected = true; }
  private close(): void {
    if (this.closed) return; this.closed = true; this.connected = false;
    this.acceptedCheckpoint = null; this.publication = null;
    if (this.busyNotified) { this.busyNotified = false; try { this.options.onBusyChange?.(false); } catch (error) { this.report(error); } }
    this.pending.splice(0).forEach(request => { request.cleanup(); request.reject(new Error('The shared editor closed before applying the update.')); }); this.pendingBytes = 0; this.localListeners.clear(); this.historyListeners.clear();
    this.unsubscribe.splice(0).forEach(stop => stop()); this.restoreIds();
    for (const method of this.asyncMethods) if (this.editor[method.key] === method.wrapped) Object.assign(this.editor, { [method.key]: method.original });
    for (const key of Object.keys(this.originals) as (keyof typeof this.originals)[]) if (this.editor.undo[key] === this.wrappers[key]) Object.assign(this.editor.undo, { [key]: this.originals[key] });
    if (this.editor.replaceGraph === this.replace) this.editor.replaceGraph = this.originalReplace;
    if (this.editor.dispose === this.disposeEditor) this.editor.dispose = this.originalDispose;
    bindings.delete(this.editor);
  }
  dispose(): void { if (!this.closed) this.editor.dispose(); }
}
