import { afterEach, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import { CanvasHistory } from './canvasHistory';
import { SharedDesign } from './sharedDesign';
import { SharedEditorBinding } from './sharedEditor';
import { allComments, createCommentAnchor } from './comments';
import { applyRoomCommentCommand } from './roomCommentCommands';
import { commentHistorySnapshot, replayCommentHistory, type CommentHistoryRecord } from './roomCommentHistory';
import { roomBinary } from './sharedRoomProtocol';
import type { RoomCommentCommand, RoomCommentResponse } from './roomCommentProtocol';
import type { PendingRoomComment } from './roomCommentPending';

const editors: Editor[] = [], replicas: SharedDesign[] = [], histories: CanvasHistory[] = [];
afterEach(() => { histories.splice(0).forEach(history => history.dispose()); editors.splice(0).forEach(editor => editor.dispose()); replicas.splice(0).forEach(replica => replica.dispose()); });
function setup() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id, node = graph.createNode('RECTANGLE', page, { x: 10, width: 100 });
  const replica = SharedDesign.fromGraph(graph), peer = SharedDesign.fromUpdate(replica.update()); replicas.push(replica, peer);
  const editor = createEditor({ graph }); editors.push(editor); const binding = new SharedEditorBinding(editor, replica);
  const actor = { id: ulid(), name: 'Designer', role: 'editor' as const }, serverUrl = 'https://rooms.example.test/', documentId = ulid(), projectId = ulid();
  let scope: { actorId: string; serverUrl: string } | null = { actorId: actor.id, serverUrl }, history: CanvasHistory;
  const records = new Map<string, CommentHistoryRecord>(); let revision = 1;
  const pending = (command: RoomCommentCommand): PendingRoomComment => ({ projectId, serverUrl, actorId: actor.id, packet: { version: 1, type: 'comment', documentId, clientId: ulid(), requestId: ulid(), vector: roomBinary(replica.stateVector(), true), command } });
  async function execute(request: PendingRoomComment) {
    peer.receive(replica.update()); const command = request.packet.command;
    const result = { threadId: command.type === 'add' ? `thread_${request.packet.requestId}` : command.threadId, ...(['add', 'reply'].includes(command.type) ? { messageId: `message_${request.packet.requestId}` } : 'messageId' in command ? { messageId: command.messageId } : {}) };
    if (command.type === 'history') peer.edit('History', graph => replayCommentHistory(graph, records.get(command.sourceRequestId)!, command.direction));
    else {
      const before = commentHistorySnapshot(peer.graph, result.threadId);
      peer.edit('Comment', graph => applyRoomCommentCommand(graph, command, actor, result, 1000));
      records.set(request.packet.requestId, { version: 1, actorId: actor.id, command, result, before, after: commentHistorySnapshot(peer.graph, result.threadId) });
    }
    const receipt: RoomCommentResponse = { version: 1, type: 'comment', documentId, clientId: request.packet.clientId, requestId: request.packet.requestId, actor, revision: ++revision, acceptedRevision: revision, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update()), result };
    await binding.receive(peer.update()); history.applied(request, receipt); return receipt;
  }
  history = new CanvasHistory(binding, { scope: () => scope, change() {}, artwork: direction => editor[direction === 'undo' ? 'undoAction' : 'redoAction'](), comment: async command => { const request = pending(command); history.prepare(request); await execute(request); } }); histories.push(history);
  async function add(body = 'Comment') { const request = pending({ type: 'add', pageId: page, anchor: createCommentAnchor(editor.graph, page, [{ x: 10, y: 20 }]), body }); history.prepare(request); const receipt = await execute(request); return { request, receipt }; }
  return { editor, binding, peer, history, node, pending, execute, add, setScope(value: typeof scope) { scope = value; history.refresh(); }, scope: { actorId: actor.id, serverUrl } };
}
it('undoes and redoes interleaved artwork and semantic comments in order while retaining peer changes', async () => {
  const { editor, binding, peer, history, node, add } = setup();
  editor.updateNodeWithUndo(node.id, { x: 60 }, 'First move'); await add(); editor.updateNodeWithUndo(node.id, { x: 90 }, 'Second move'); binding.flush();
  peer.receive(binding.replica.update()); await binding.receive(peer.edit('Peer resize', graph => graph.updateNode(node.id, { width: 310 })).update);
  expect(history.snapshot.undoLabel).toBe('Second move'); await history.replay('undo'); expect(node).toMatchObject({ x: 60, width: 310 }); expect(allComments(editor.graph)).toHaveLength(1);
  expect(history.snapshot.undoLabel).toBe('Add comment'); await history.replay('undo'); expect(allComments(editor.graph)).toHaveLength(0); expect(node.x).toBe(60);
  await history.replay('undo'); expect(node).toMatchObject({ x: 10, width: 310 }); expect(history.snapshot.undoLabel).toBeNull();
  await history.replay('redo'); expect(node.x).toBe(60); await history.replay('redo'); expect(allComments(editor.graph)).toHaveLength(1); await history.replay('redo'); expect(node).toMatchObject({ x: 90, width: 310 }); expect(history.snapshot.redoLabel).toBeNull();
});
it('does not resurrect native redo discarded by a new comment', async () => {
  const { editor, binding, history, node, add } = setup(); editor.updateNodeWithUndo(node.id, { x: 60 }, 'Abandoned move'); binding.flush(); await history.replay('undo'); expect(editor.undo.canRedo).toBe(true);
  await add(); expect(history.snapshot.redoLabel).toBeNull(); await history.replay('undo'); await history.replay('redo'); expect(node.x).toBe(10); expect(history.snapshot.redoLabel).toBeNull();
  editor.updateNodeWithUndo(node.id, { x: 75 }, 'Fresh move'); binding.flush(); await history.replay('undo'); await history.replay('redo'); expect(node.x).toBe(75); expect(history.snapshot.redoLabel).toBeNull();
});
it('breaks artwork coalescing at a comment intent and reserves its position through a later edit', async () => {
  const { editor, binding, history, node, pending, execute } = setup();
  const move = (x: number) => { const previous = node.x; editor.graph.updateNode(node.id, { x }); editor.pushUndoEntry({ label: 'Move', coalesceKey: 'move', forward: () => editor.graph.updateNode(node.id, { x }), inverse: () => editor.graph.updateNode(node.id, { x: previous }) }); };
  move(40); move(60); const request = pending({ type: 'add', pageId: editor.state.currentPageId, anchor: createCommentAnchor(editor.graph, editor.state.currentPageId, [{ x: 10, y: 20 }]), body: 'Delayed' }); history.prepare(request); move(90); binding.flush(); await execute(request);
  expect(history.snapshot.undoLabel).toBe('Move'); await history.replay('undo'); expect(node.x).toBe(60); await history.replay('undo'); expect(allComments(editor.graph)).toHaveLength(0); await history.replay('undo'); expect(node.x).toBe(10);
});
it('deduplicates recovered receipts and admits newer scoped history summaries without reverting a later step', async () => {
  const { history, add } = setup(); const { request, receipt } = await add(); history.applied(request, receipt); await history.replay('undo'); expect(history.snapshot.undoLabel).toBeNull();
  history.applied(request, receipt); expect(history.snapshot.undoLabel).toBeNull(); expect(history.snapshot.redoLabel).toBe('Add comment');
  history.reconcile([{ id: 1, clientId: request.packet.clientId, requestId: request.packet.requestId, threadId: receipt.result.threadId, action: 'add', undone: false, step: 4, revision: 5 }]); expect(history.snapshot.undoLabel).toBe('Add comment');
  history.reconcile([{ id: 1, clientId: request.packet.clientId, requestId: request.packet.requestId, threadId: receipt.result.threadId, action: 'add', undone: true, step: 2, revision: 3 }]); expect(history.snapshot.undoLabel).toBe('Add comment');
});
it('keeps original member history isolated and restores its scope when that member reconnects', async () => {
  const { history, add, setScope, scope } = setup(); await add(); setScope({ ...scope, actorId: ulid() }); expect(history.snapshot.undoLabel).toBeNull(); setScope({ ...scope, serverUrl: 'https://other.example.test/' }); expect(history.snapshot.undoLabel).toBeNull(); setScope(scope); expect(history.snapshot.undoLabel).toBe('Add comment');
});
it('retains one batch, ignores rolled-back work and clears the canvas timeline explicitly', async () => {
  const { editor, binding, history, node, add } = setup(); editor.undo.beginBatch('Batch'); editor.updateNodeWithUndo(node.id, { x: 60 }); editor.updateNodeWithUndo(node.id, { y: 80 }); editor.undo.commitBatch(); binding.flush(); await add();
  editor.undo.beginBatch('Canceled'); editor.updateNodeWithUndo(node.id, { x: 999 }); editor.undo.rollbackBatch(); binding.flush(); await history.replay('undo'); expect(history.snapshot.undoLabel).toBe('Batch'); await history.replay('undo'); expect(node).toMatchObject({ x: 10, y: 0 }); editor.undo.clear(); expect(history.snapshot).toEqual({ undoLabel: null, redoLabel: null, busy: false });
});
it('uses detached artwork headers and trims unavailable native entries at the native history limit', async () => {
  const { editor, binding, history, node } = setup();
  for (let index = 0; index < 205; index++) editor.updateNodeWithUndo(node.id, { x: index + 20 }, `Move ${index}`);
  binding.flush(); const snapshot = binding.history; snapshot.undo.splice(0); expect(binding.history.undo).toHaveLength(200);
  for (let index = 0; index < 200; index++) await history.replay('undo'); expect(history.snapshot.undoLabel).toBeNull(); expect(node.x).toBe(24);
}, 20_000);
it('places a restored pending comment before new artwork recorded in the reopened canvas', async () => {
  const { editor, binding, history, node, pending, execute } = setup();
  const request = pending({ type: 'add', pageId: editor.state.currentPageId, anchor: createCommentAnchor(editor.graph, editor.state.currentPageId, [{ x: 10, y: 20 }]), body: 'Recovered from before reopening' });
  history.restore(request); editor.updateNodeWithUndo(node.id, { x: 75 }, 'New move'); binding.flush(); await execute(request);
  expect(history.snapshot.undoLabel).toBe('New move'); await history.replay('undo'); expect(node.x).toBe(10); expect(allComments(editor.graph)).toHaveLength(1); expect(history.snapshot.undoLabel).toBe('Add comment'); await history.replay('undo'); expect(allComments(editor.graph)).toHaveLength(0);
});
