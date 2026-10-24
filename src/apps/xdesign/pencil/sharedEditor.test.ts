import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import { SharedDesign, type SharedDesignChange } from './sharedDesign';
import { SharedEditorBinding, type SharedEditorOptions } from './sharedEditor';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { editPencilGraph, editPencilGraphAndView } from './toolExecution';
import { addComment, allComments, createCommentAnchor, replyToComment } from './comments';

const editors: Editor[] = [], replicas: SharedDesign[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.dispose()); replicas.splice(0).forEach(replica => replica.dispose()); });
const tick = async () => { for (let index = 0; index < 4; index++) await Promise.resolve(); };
function setup(options: SharedEditorOptions = {}) {
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id, node = graph.createNode('RECTANGLE', page, { x: 10, y: 20, width: 100, height: 80 });
  const a = SharedDesign.fromGraph(graph), b = SharedDesign.fromUpdate(a.update()); replicas.push(a, b);
  const editor = createEditor({ graph }); editors.push(editor);
  const updates: SharedDesignChange[] = [], binding = new SharedEditorBinding(editor, a, { ...options, onUpdate: change => { updates.push(change); options.onUpdate?.(change); } });
  return { editor, a, b, binding, updates, page, node };
}
describe('shared native editor binding', () => {
  it('captures actual inspector updates, preserves node identity and undoes only the local property', async () => {
    const { editor, a, b, binding, updates, node } = setup(); const identity = editor.graph.getNode(node.id);
    editor.updateNodeWithUndo(node.id, { x: 200 }, 'Move'); await tick();
    expect(editor.graph.getNode(node.id)).toBe(identity); expect(updates).toHaveLength(1); b.receive(updates[0]!.update);
    await binding.receive(b.edit('Remote resize', graph => graph.updateNode(node.id, { width: 320 })).update);
    editor.undoAction(); await tick(); expect(editor.graph.getNode(node.id)).toMatchObject({ x: 10, width: 320 });
    b.receive(updates.at(-1)!.update); expect(serializeGraph(a.graph)).toBe(serializeGraph(b.graph)); expect(editor.undo.canRedo).toBe(true);
    editor.redoAction(); await tick(); expect(editor.graph.getNode(node.id)).toMatchObject({ x: 200, width: 320 });
  });
  it('replaces whole-graph native callbacks with selective history that retains remote nodes and edits', async () => {
    const { editor, b, binding, node, page, updates } = setup();
    editPencilGraph(editor, 'Atomic local', () => editor.graph.updateNode(node.id, { y: 300 })); await tick(); b.receive(updates[0]!.update); let remote = '';
    await binding.receive(b.edit('Peer', graph => { graph.updateNode(node.id, { width: 250 }); remote = graph.createNode('TEXT', page, { text: 'Peer layer' }).id; }).update);
    editor.undoAction(); expect(editor.graph.getNode(node.id)).toMatchObject({ y: 20, width: 250 }); expect(editor.graph.getNode(remote)?.text).toBe('Peer layer');
    editor.redoAction(); expect(editor.graph.getNode(node.id)).toMatchObject({ y: 300, width: 250 }); expect(editor.graph.nodes.has(remote)).toBe(true);
  });
  it('retains native coalescing, then opens a new edit boundary after undo', async () => {
    const { editor, node, a } = setup();
    const change = (x: number, key = 'x') => { const before = node.x; editor.graph.updateNode(node.id, { x }); editor.undo.push({ label: `X ${x}`, coalesceKey: key, forward: () => editor.graph.updateNode(node.id, { x }), inverse: () => editor.graph.updateNode(node.id, { x: before }) }); };
    change(30); change(60); await tick(); expect(editor.undo.undoLabel).toBe('X 60'); editor.undoAction(); expect(node.x).toBe(10); expect(editor.undo.canUndo).toBe(false);
    editor.redoAction(); expect(node.x).toBe(60); change(100, 'new'); editor.undoAction(); expect(node.x).toBe(60);
    change(80); editor.undoAction(); expect(node.x).toBe(60); expect(a.graph.getNode(node.id)!.x).toBe(60); editor.undoAction(); expect(node.x).toBe(10);
  });
  it('keeps coalescing across a cancelled preview and a no-op synchronization probe', async () => {
    const { editor, binding, node } = setup();
    const change = (x: number) => { const previous = node.x; editor.graph.updateNode(node.id, { x }); editor.undo.push({ label: 'X', coalesceKey: 'same', forward: () => editor.graph.updateNode(node.id, { x }), inverse: () => editor.graph.updateNode(node.id, { x: previous }) }); };
    change(60); await tick(); const finish = editor.beginInteractiveEdit(); editor.graph.updateNodePositionPreview(node.id, 100, 20); editor.graph.updateNodePositionPreview(node.id, 60, 20); finish(); await tick(); binding.flush();
    change(80); editor.undoAction(); expect(node.x).toBe(10); expect(editor.undo.canUndo).toBe(false); editor.redoAction(); expect(node.x).toBe(80);
  });
  it('refuses malformed native edits before recording them and retains the earlier redo', async () => {
    const { editor, node, a } = setup(); editor.updateNodeWithUndo(node.id, { x: 60 }); await tick(); editor.undoAction(); const before = serializeGraph(a.graph);
    editor.graph.updateNode(node.id, { width: NaN }); expect(() => editor.undo.push({ label: 'Invalid', forward: () => {}, inverse: () => {} })).toThrow(); expect(node.width).toBe(100); expect(serializeGraph(a.graph)).toBe(before); expect(editor.undo.canRedo).toBe(true); editor.redoAction(); expect(node.x).toBe(60);
  });
  it('does not compare the whole graph or create history for ordinary view navigation', async () => {
    const { editor, a, updates } = setup(), commit = vi.spyOn(a, 'commit');
    for (let index = 0; index < 20; index++) { editor.state.panX = index * 10; editor.requestRender(); await tick(); }
    expect(commit).not.toHaveBeenCalled(); expect(updates).toHaveLength(0); expect(editor.undo.canUndo).toBe(false);
  });
  it('keeps a remotely overwritten top action from undoing the older local action', async () => {
    const { editor, b, binding, node, updates } = setup();
    editor.updateNodeWithUndo(node.id, { y: 50 }, 'Y'); editor.updateNodeWithUndo(node.id, { x: 70 }, 'X'); await tick(); for (const update of updates) b.receive(update.update);
    await binding.receive(b.edit('Peer X', graph => graph.updateNode(node.id, { x: 90 })).update);
    editor.undoAction(); expect(node).toMatchObject({ x: 90, y: 50 }); expect(editor.undo.undoLabel).toBe('Y');
    editor.undoAction(); expect(node).toMatchObject({ x: 90, y: 20 }); editor.redoAction(); expect(node.y).toBe(50); editor.redoAction(); expect(node.x).toBe(90);
  });
  it('holds remote changes until interactive preview releases and commits the final native move', async () => {
    const { editor, b, binding, node, updates } = setup(), finish = editor.beginInteractiveEdit(); let applied = false;
    const incoming = binding.receive(b.edit('Remote', graph => graph.updateNode(node.id, { width: 400 })).update).then(() => { applied = true; });
    editor.graph.updateNodePositionPreview(node.id, 250, 20); await tick(); expect(applied).toBe(false); expect(updates).toHaveLength(0);
    editor.commitMove(new Map([[node.id, { x: 10, y: 20 }]])); finish(); await incoming; await tick();
    expect(node).toMatchObject({ x: 250, width: 400 }); editor.undoAction(); expect(node).toMatchObject({ x: 10, width: 400 });
  });
  it('captures unrecorded graph edits and does not publish a cancelled preview', async () => {
    const { editor, binding, node, updates } = setup(); const finish = editor.beginInteractiveEdit(); editor.graph.updateNodePositionPreview(node.id, 100, 20); editor.graph.updateNodePositionPreview(node.id, 10, 20); finish(); await tick();
    expect(updates).toHaveLength(0); expect(editor.undo.canUndo).toBe(false);
    editor.graph.updateNode(node.id, { y: 500 }); binding.flush(); expect(editor.undo.undoLabel).toBe('Update design'); editor.undoAction(); expect(node.y).toBe(20);
  });
  it('groups nested batches, releases old inverses and buffers remote updates until the outer commit', async () => {
    const { editor, binding, b, node, updates } = setup(); editor.undo.beginBatch('Batch'); editor.updateNodeWithUndo(node.id, { x: 40 }); editor.undo.beginBatch('Inner'); editor.updateNodeWithUndo(node.id, { y: 80 }); editor.undo.commitBatch();
    let applied = false; const pending = binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { width: 210 })).update).then(() => { applied = true; }); await tick(); expect(applied).toBe(false);
    editor.undo.commitBatch(); await pending; expect(updates.filter(change => change.source === 'local')).toHaveLength(1); expect(editor.undo.undoLabel).toBe('Batch');
    editor.undoAction(); expect(node).toMatchObject({ x: 10, y: 20, width: 210 }); editor.redoAction(); expect(node).toMatchObject({ x: 40, y: 80, width: 210 });
  });
  it('records bare batched changes and rolls back nested provisional work without publication', async () => {
    const { editor, binding, node, updates, a } = setup(); editor.undo.beginBatch('Bare'); editor.graph.updateNode(node.id, { x: 50 }); editor.undo.commitBatch(); editor.undoAction(); expect(node.x).toBe(10); const count = updates.length;
    editor.undo.beginBatch('Cancel'); editor.updateNodeWithUndo(node.id, { x: 200 }); editor.undo.beginBatch('Inner'); editor.updateNodeWithUndo(node.id, { y: 200 }); editor.undo.rollbackBatch(); expect(node.y).toBe(20); editor.undo.rollbackBatch(); await tick();
    expect(node.x).toBe(10); expect(updates).toHaveLength(count); expect(a.graph.getNode(node.id)).toMatchObject({ x: 10, y: 20 }); expect(editor.undo.canRedo).toBe(true); binding.flush();
  });
  it('waits through controlled asynchronous work, rejects an overlapping action and keeps busy state paired', async () => {
    const busy = vi.fn(), { editor, binding, b, node } = setup({ onBusyChange: busy }); let release!: () => void;
    const work = binding.transaction('Async', async () => { editor.updateNodeWithUndo(node.id, { x: 50 }); await new Promise<void>(resolve => { release = resolve; }); editor.updateNodeWithUndo(node.id, { y: 60 }); });
    const pending = binding.receive(b.edit('Remote', graph => graph.updateNode(node.id, { width: 310 })).update); await tick(); expect(node.width).toBe(100); expect(binding.busy).toBe(true);
    await expect(binding.transaction('Overlap', () => {})).rejects.toThrow('Wait'); release(); await work; await pending; expect(node).toMatchObject({ x: 50, y: 60, width: 310 }); expect(busy.mock.calls).toEqual([[true], [false]]);
    editor.undoAction(); expect(node).toMatchObject({ x: 10, y: 20, width: 310 });
  });
  it('rolls back rejected asynchronous work and allows the queued peer update afterward', async () => {
    const { editor, binding, b, node, updates } = setup(); let reject!: (error: Error) => void;
    const work = binding.transaction('Failed', async () => { editor.updateNodeWithUndo(node.id, { x: 400 }); await new Promise<void>((_resolve, fail) => { reject = fail; }); });
    const pending = binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { width: 190 })).update); reject(new Error('Failed import')); await expect(work).rejects.toThrow('Failed import'); await pending;
    expect(node).toMatchObject({ x: 10, width: 190 }); expect(updates).toHaveLength(0); expect(editor.undo.canUndo).toBe(false);
  });
  it('wraps the actual published clipboard paste as one asynchronous native history operation', async () => {
    const { editor, binding, node, page } = setup(), source = createEditor(); editors.push(source); const copied = source.graph.createNode('RECTANGLE', source.state.currentPageId, { name: 'Pasted', width: 123 }); source.select([copied.id]);
    const payload = await source.prepareCopy(); await editor.pasteSnapshot(payload.snapshot!); expect(binding.busy).toBe(false); const pasted = editor.graph.getChildren(page).find(node => node.name === 'Pasted')!; expect(pasted.width).toBe(123);
    editor.undoAction(); expect(editor.graph.nodes.has(pasted.id)).toBe(false); expect(editor.graph.nodes.has(node.id)).toBe(true); editor.redoAction(); expect(editor.graph.getNode(pasted.id)?.name).toBe('Pasted');
  });
  it('rejects an inactive source before receiving or recording more work', async () => {
    let current = true; const { editor, binding, b, node, a } = setup({ isCurrent: () => current }); const graph = serializeGraph(a.graph); current = false;
    await expect(binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { x: 99 })).update)).rejects.toThrow('no longer active'); expect(() => editor.updateNodeWithUndo(node.id, { x: 90 })).toThrow('no longer active'); expect(serializeGraph(a.graph)).toBe(graph);
  });
  it('preserves replies from a peer while undoing a local comment edit through real editor APIs', async () => {
    const { editor, binding, b, page, updates } = setup(), owner = { id: 'owner', name: 'Owner' }, peer = { id: 'peer', name: 'Peer' };
    const id = addComment(editor, page, createCommentAnchor(editor.graph, page, [{ x: 20, y: 30 }]), owner, 'Root'); await tick(); b.receive(updates[0]!.update);
    replyToComment(editor, id, owner, 'Local'); await tick(); b.receive(updates.at(-1)!.update);
    await binding.receive(b.edit('Peer reply', graph => { const other = createEditor({ graph }); try { replyToComment(other, id, peer, 'Remote'); } finally { other.dispose(); } }).update);
    editor.undoAction(); expect(allComments(editor.graph)[0]!.messages.map(message => message.body)).toEqual(['Root', 'Remote']);
  });
  it('restores page/selection for graph-and-view edits and leaves a later viewport alone on same-page undo', async () => {
    const { editor, node, page } = setup(); editor.select([node.id]);
    editPencilGraphAndView(editor, 'Page', () => { const second = editor.graph.addPage('Second'); editor.state.currentPageId = second.id; editor.select([]); }); await tick(); editor.undoAction(); expect(editor.state.currentPageId).toBe(page); expect([...editor.state.selectedIds]).toEqual([node.id]);
    editor.state.panX = 300; editor.updateNodeWithUndo(node.id, { x: 80 }); await tick(); editor.state.panX = 600; editor.undoAction(); expect(editor.state.panX).toBe(600);
  });
  it('restores schema/color resources on replacement, rebinds peer IDs and reverses the same-root replacement', async () => {
    const { editor, a, node, page } = setup(), previous = editor.graph, replacement = deserializeGraph(serializeGraph(previous));
    replacement.updateNode(node.id, { name: 'Replacement' }); replacement.figKiwiVersion = 106; replacement.figSchemaDeflated = new Uint8Array([1, 2, 3]);
    editor.replaceGraph(replacement); await tick(); expect(editor.graph).toBe(replacement); expect(editor.graph.figSchemaDeflated).toEqual(new Uint8Array([1, 2, 3])); editor.undoAction(); expect(editor.graph.getNode(node.id)!.name).toBe(node.name); expect(editor.graph.figSchemaDeflated).toBeNull();
    const newNode = editor.graph.createNode('TEXT', page); expect(newNode.id).toMatch(new RegExp(`^${a.peerId}:`)); await tick();
    const source = editor.graph; expect(() => editor.replaceGraph(new SceneGraph())).toThrow('new editor'); expect(editor.graph).toBe(source);
  });
  it('rejects a failed local/remote publisher with graph, history and redo intact', async () => {
    let fail = false; const publish = vi.fn(() => { if (fail) throw new Error('Publish failed'); }), { editor, a, b, binding, node } = setup({ publish });
    editor.updateNodeWithUndo(node.id, { x: 60 }); await tick(); editor.undoAction(); const before = serializeGraph(editor.graph), vector = a.stateVector(); fail = true;
    expect(() => editor.updateNodeWithUndo(node.id, { y: 70 })).toThrow('Publish failed'); expect(serializeGraph(editor.graph)).toBe(before); expect(a.stateVector()).toEqual(vector); expect(editor.undo.canRedo).toBe(true);
    await expect(binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { width: 260 })).update)).rejects.toThrow('Publish failed'); expect(node.width).toBe(100); expect(editor.undo.canRedo).toBe(true); fail = false; editor.redoAction(); expect(node.x).toBe(60);
  });
  it('compensates a failed undo publication without consuming the native history entry', async () => {
    let fail = false; const { editor, a, node } = setup({ publish: () => { if (fail) throw new Error('No save'); } }); editor.updateNodeWithUndo(node.id, { x: 60 }); await tick(); fail = true;
    expect(() => editor.undoAction()).toThrow('No save'); expect(node.x).toBe(60); expect(a.graph.getNode(node.id)!.x).toBe(60); expect(editor.undo.canUndo).toBe(true); expect(editor.undo.canRedo).toBe(false);
    fail = false; editor.undoAction(); expect(node.x).toBe(10); editor.redoAction(); expect(node.x).toBe(60);
  });
  it('reports outgoing transport failure while preserving accepted artwork and local undo', async () => {
    const error = vi.fn(), { editor, binding, node } = setup({ onUpdate: () => { throw new Error('Transport'); }, onError: error }); editor.updateNodeWithUndo(node.id, { x: 90 }); await tick(); expect(binding.lastError?.message).toBe('Transport'); expect(error).toHaveBeenCalled(); expect(node.x).toBe(90); editor.undoAction(); expect(node.x).toBe(10);
  });
  it('keeps selective history across disconnect, then provides a complete difference on reconnect', async () => {
    const { editor, a, b, binding, node, updates } = setup(); binding.disconnect(); editor.updateNodeWithUndo(node.id, { x: 90 }); await tick(); expect(updates).toHaveLength(0); editor.undoAction(); editor.redoAction(); expect(node.x).toBe(90);
    binding.reconnect(); b.receive(a.update(b.stateVector())); expect(b.graph.getNode(node.id)!.x).toBe(90); editor.updateNodeWithUndo(node.id, { y: 100 }); expect(updates).toHaveLength(1);
  });
  it('refuses attachment over existing history and preserves the previous editor callbacks and data', () => {
    const graph = new SceneGraph(), editor = createEditor({ graph }), replica = SharedDesign.fromGraph(graph); editors.push(editor); replicas.push(replica); const node = graph.createNode('RECTANGLE', editor.state.currentPageId); editor.updateNodeWithUndo(node.id, { x: 60 }); const undo = editor.undo.undo;
    expect(() => new SharedEditorBinding(editor, replica)).toThrow('history was preserved'); expect(editor.undo.undo).toBe(undo); editor.undoAction(); expect(node.x).toBe(0);
  });
  it('rejects queued updates on disposal and stale source guards without changing accepted data', async () => {
    let current = true; const { editor, binding, b, node } = setup({ isCurrent: () => current }), finish = editor.beginInteractiveEdit();
    const pending = binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { x: 200 })).update); const rejection = expect(pending).rejects.toThrow('closed'); editor.dispose(); await rejection; finish();
    await expect(binding.receive(b.update())).rejects.toThrow('no longer active'); current = false;
  });
  it('tracks accepted local updates for subscribers while disconnected and releases subscriptions', async () => {
    const { editor, binding, node, updates } = setup(), listener = vi.fn(), stop = binding.subscribeUpdates(listener);
    binding.disconnect(); editor.updateNodeWithUndo(node.id, { x: 65 }); await tick(); editor.undoAction(); await tick();
    expect(updates).toHaveLength(0); expect(listener.mock.calls.map(([change]) => change.source)).toEqual(['local', 'undo']); stop(); editor.redoAction(); await tick(); expect(listener).toHaveBeenCalledTimes(2);
  });
  it('immediately releases aborted queued updates and keeps accepted artwork and error state', async () => {
    const { editor, binding, b, node } = setup(), finish = editor.beginInteractiveEdit(), bytes = b.edit('Peer', graph => graph.updateNode(node.id, { x: 200 })).update;
    const controllers = Array.from({ length: 256 }, () => new AbortController()), pending = controllers.map(controller => binding.receive(bytes, { signal: controller.signal }));
    const results = Promise.all(pending.map(promise => promise.then(() => 'applied', error => error.name))); await expect(binding.receive(bytes)).rejects.toThrow('queue is full'); controllers.forEach(controller => controller.abort());
    expect(await results).toEqual(Array(256).fill('AbortError')); expect(binding.lastError).toBeNull(); const accepted = binding.receive(bytes); finish(); await accepted; expect(node.x).toBe(200);
  });
  it('pins queued guard options and refuses a stale connection before publication', async () => {
    let current = true; const { editor, binding, b, node } = setup(), finish = editor.beginInteractiveEdit(), options = { isCurrent: () => current };
    const pending = binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { width: 200 })).update, options), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    options.isCurrent = () => true; current = false; finish(); await rejected; expect(node.width).toBe(100); expect(binding.lastError).toBeNull();
  });
  it('validates candidate checkpoint and cancels admission before any publisher runs', async () => {
    const publish = vi.fn(), { binding, b, node, a } = setup({ publish }), controller = new AbortController(), before = a.update();
    await expect(binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { x: 91 })).update, { signal: controller.signal, admit: (graph, checkpoint) => {
      expect(graph.getNode(node.id)!.x).toBe(91); const check = SharedDesign.fromUpdate(checkpoint); try { expect(check.graph.getNode(node.id)!.x).toBe(91); } finally { check.dispose(); } controller.abort();
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(publish).not.toHaveBeenCalled(); expect(a.update()).toEqual(before); expect(node.x).toBe(10);
  });
  it('refuses asynchronous incoming admission and consumes its rejected promise', async () => {
    const publish = vi.fn(), { binding, b, node } = setup({ publish });
    await expect(binding.receive(b.edit('Peer', graph => graph.updateNode(node.id, { x: 100 })).update, { admit: async () => { throw new Error('Late rejection'); } })).rejects.toThrow('must be synchronous');
    expect(publish).not.toHaveBeenCalled(); expect(node.x).toBe(10);
  });
  it('rejects viewer inspector, batch, replacement and undo writes while retaining redo and peer admission', async () => {
    const { editor, binding, a, b, node, updates } = setup(); editor.updateNodeWithUndo(node.id, { x: 60 }); await tick(); editor.undoAction(); const before = serializeGraph(a.graph); binding.setReadOnly(true);
    expect(() => editor.updateNodeWithUndo(node.id, { x: 100 })).toThrow('viewer'); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.undo.canRedo).toBe(true);
    expect(() => editor.undo.beginBatch('Blocked')).toThrow('viewer'); expect(() => editor.redoAction()).toThrow('viewer'); expect(() => editor.replaceGraph(deserializeGraph(before))).toThrow('viewer');
    const count = updates.length; await binding.receive(b.edit('Peer width', graph => graph.updateNode(node.id, { width: 333 })).update); expect(node.width).toBe(333); expect(updates).toHaveLength(count);
    binding.setReadOnly(false); editor.redoAction(); expect(node).toMatchObject({ x: 60, width: 333 });
  });
  it('allows viewer page/selection/viewport navigation without artwork uploads', async () => {
    const { editor, binding, b, node, updates } = setup(); let page = ''; await binding.receive(b.edit('Page', graph => { page = graph.addPage('Peer page').id; }).update); binding.setReadOnly(true);
    editor.select([node.id]); editor.pan(30, 40); await editor.switchPage(page); expect(editor.state.currentPageId).toBe(page); expect(updates).toHaveLength(0); expect(editor.undo.canUndo).toBe(false);
  });
  it('rolls back an asynchronous action downgraded before publication and preserves the preceding redo', async () => {
    let allowed = true; const { editor, binding, a, node } = setup({ canEdit: () => allowed }); editor.updateNodeWithUndo(node.id, { x: 70 }); await tick(); editor.undoAction(); let release!: () => void;
    const work = binding.transaction('Delayed', async () => { editor.updateNodeWithUndo(node.id, { y: 700 }); await new Promise<void>(resolve => { release = resolve; }); }); allowed = false; release();
    await expect(work).rejects.toThrow('viewer'); expect(node).toMatchObject({ x: 10, y: 20 }); expect(a.graph.getNode(node.id)!.y).toBe(20); expect(editor.undo.canRedo).toBe(true); expect(binding.busy).toBe(false);
  });
  it('restores unrecorded viewer changes before flush can publish them', async () => {
    const { editor, binding, a, node, updates } = setup(); binding.setReadOnly(true); editor.graph.updateNode(node.id, { x: 900 }); expect(() => binding.flush()).toThrow('viewer'); await tick();
    expect(node.x).toBe(10); expect(a.graph.getNode(node.id)!.x).toBe(10); expect(updates).toHaveLength(0); expect(editor.undo.canUndo).toBe(false);
  });
  it('takes an accepted-only transition snapshot without admitting provisional work', async () => {
    let current = true; const { editor, binding, node } = setup({ isCurrent: () => current }); const before = binding.snapshot(); editor.undo.beginBatch('Draft'); editor.graph.updateNode(node.id, { x: 800 }); current = false;
    expect(() => binding.snapshot()).toThrow('no longer active'); const snapshot = binding.snapshot({ acceptedOnly: true }); expect(snapshot.graph).toBe(before.graph); expect(snapshot.checkpoint).toEqual(before.checkpoint); expect(snapshot.revision).toBe(before.revision);
    current = true; editor.undo.rollbackBatch(); expect(node.x).toBe(10);
  });
});
