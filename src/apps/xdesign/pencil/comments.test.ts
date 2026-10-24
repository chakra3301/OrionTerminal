import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { addComment, allComments, COMMENT_KEY, COMMENT_PLUGIN, createCommentAnchor, deleteCommentMessage, editCommentMessage, moveComment, reactToComment, readPageComments, replyToComment, resolveComment, resolveCommentAnchor, type CommentAuthor } from './comments';
let editor: Editor;
const owner: CommentAuthor = { id: 'owner', name: 'Orion' }, reviewer: CommentAuthor = { id: 'reviewer', name: 'Reviewer' };
const point = [{ x: 140, y: 70 }];
const add = (body = 'A comment 👋') => addComment(editor, editor.state.currentPageId, createCommentAnchor(editor.graph, editor.state.currentPageId, point), owner, body);
const thread = (id: string) => allComments(editor.graph).find(thread => thread.id === id)!;
beforeEach(() => { editor = createEditor(); });
afterEach(() => editor.dispose());
describe('persistent project comments', () => {
  it('preserves Unicode, identities and unrelated metadata through project reopening and exact undo/redo', () => {
    const page = editor.graph.getNode(editor.state.currentPageId)!; page.pluginData.push({ pluginId: 'foreign', key: 'keep', value: 'original' });
    const id = add('  שלום 日本語 👩🏽‍🎨\n<script>alert(1)</script>  '), saved = serializeGraph(editor.graph), restored = deserializeGraph(saved);
    expect(allComments(restored)[0]).toEqual(thread(id)); expect(page.childIds).toHaveLength(0);
    editor.undoAction(); expect(allComments(editor.graph)).toEqual([]); expect(page.pluginData).toEqual([{ pluginId: 'foreign', key: 'keep', value: 'original' }]);
    editor.redoAction(); expect(serializeGraph(editor.graph)).toBe(saved);
  });
  it('keeps reply/edit/delete author rules, reactions and resolution as independent reversible operations', () => {
    const id = add(); replyToComment(editor, id, reviewer, 'Change the spacing'); const reply = thread(id).messages[1]!;
    expect(() => editCommentMessage(editor, id, reply.id, owner, 'no')).toThrow('author');
    expect(() => deleteCommentMessage(editor, id, reply.id, owner)).toThrow('author');
    editCommentMessage(editor, id, reply.id, reviewer, 'Use 8px'); expect(thread(id).messages[1]!.body).toBe('Use 8px');
    reactToComment(editor, id, reply.id, '👍', owner); reactToComment(editor, id, reply.id, '👍', reviewer); expect(thread(id).messages[1]!.reactions[0]!.authors).toEqual(['owner', 'reviewer']);
    reactToComment(editor, id, reply.id, '👍', owner); expect(thread(id).messages[1]!.reactions[0]!.authors).toEqual(['reviewer']);
    resolveComment(editor, id, true, owner); expect(thread(id)).toMatchObject({ resolved: true, resolvedBy: owner });
    resolveComment(editor, id, false, reviewer); expect(thread(id).resolvedBy).toBeUndefined(); editor.undoAction(); expect(thread(id).resolved).toBe(true);
    editor.redoAction(); deleteCommentMessage(editor, id, reply.id, reviewer); expect(thread(id).messages).toHaveLength(1); editor.undoAction(); expect(thread(id).messages).toHaveLength(2);
  });
  it('retains normalized region corners through nested translation, resizing, rotation and flips', () => {
    const page = editor.state.currentPageId, frame = editor.graph.createNode('FRAME', page, { x: 100, y: 50, width: 200, height: 100 }), child = editor.graph.createNode('RECTANGLE', frame.id, { x: 20, y: 10, width: 80, height: 40 });
    const anchor = createCommentAnchor(editor.graph, page, [{ x: 140, y: 70 }], child.id), id = addComment(editor, page, anchor, owner, 'Follow this');
    expect(thread(id).anchor.points).toEqual([{ x: .25, y: .25 }]);
    editor.graph.updateNode(frame.id, { x: 200 }); editor.graph.updateNode(child.id, { width: 160, height: 80 });
    expect(resolveCommentAnchor(editor.graph, thread(id)).points).toEqual([{ x: 260, y: 80 }]);
    editor.graph.updateNode(child.id, { flipX: true }); expect(resolveCommentAnchor(editor.graph, thread(id)).points).toEqual([{ x: 340, y: 80 }]);
    const region = createCommentAnchor(editor.graph, page, [{ x: 230, y: 70 }, { x: 250, y: 70 }, { x: 250, y: 90 }, { x: 230, y: 90 }], child.id);
    const regionId = addComment(editor, page, region, owner, 'Region'); editor.graph.updateNode(frame.id, { y: 100 });
    expect(resolveCommentAnchor(editor.graph, thread(regionId)).points).toEqual([{ x: 230, y: 120 }, { x: 250, y: 120 }, { x: 250, y: 140 }, { x: 230, y: 140 }]);
    editor.graph.updateNode(child.id, { rotation: 90 }); const rotated = resolveCommentAnchor(editor.graph, thread(regionId)).points; expect(rotated).toHaveLength(4); const expected = [{ x: 270, y: 220 }, { x: 270, y: 200 }, { x: 290, y: 200 }, { x: 290, y: 220 }]; rotated.forEach((point, index) => { expect(point.x).toBeCloseTo(expected[index]!.x); expect(point.y).toBeCloseTo(expected[index]!.y); });
  });
  it('attaches canvas pins to top-level frames and follows a target across pages without duplicating threads', () => {
    const page = editor.state.currentPageId, frame = editor.graph.createNode('FRAME', page, { x: 100, y: 50, width: 200, height: 100 }); editor.graph.createNode('RECTANGLE', frame.id, { x: 10, y: 10, width: 100, height: 50 });
    const id = add(); expect(thread(id).anchor.nodeId).toBe(frame.id); const second = editor.graph.createNode('CANVAS', editor.graph.rootId, { name: 'Second' }); editor.graph.reparentNode(frame.id, second.id);
    expect(resolveCommentAnchor(editor.graph, thread(id)).pageId).toBe(second.id); expect(allComments(editor.graph)).toHaveLength(1);
  });
  it('preserves deleted targets as available fallback pins and prevents source/local-ID aliasing', () => {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 100, y: 50, width: 200, height: 100 }), id = add(); editor.graph.deleteNode(node.id);
    expect(resolveCommentAnchor(editor.graph, thread(id))).toMatchObject({ points: point, missingTarget: true, target: undefined });
    const foreign = editor.graph.createNode('RECTANGLE', editor.state.currentPageId); foreign.source.id = node.id;
    expect(resolveCommentAnchor(editor.graph, thread(id)).missingTarget).toBe(true);
    const localPage = editor.graph.getNode(editor.state.currentPageId)!; const stored = structuredClone(readPageComments(localPage)); stored[0]!.anchor.format = 'fig'; localPage.pluginData = [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: stored }) }];
    expect(resolveCommentAnchor(editor.graph, thread(id)).target?.id).toBe(foreign.id);
  });
  it('moves only the original author pin with undo and deletes/restores an entire root thread', () => {
    const id = add(), anchor = createCommentAnchor(editor.graph, editor.state.currentPageId, [{ x: 400, y: 300 }]);
    expect(() => moveComment(editor, id, anchor, reviewer)).toThrow('original author'); moveComment(editor, id, anchor, owner); expect(resolveCommentAnchor(editor.graph, thread(id)).points).toEqual([{ x: 400, y: 300 }]);
    editor.undoAction(); expect(resolveCommentAnchor(editor.graph, thread(id)).points).toEqual(point); editor.redoAction();
    replyToComment(editor, id, reviewer, 'Keep this reply'); deleteCommentMessage(editor, id, thread(id).messages[0]!.id, owner); expect(allComments(editor.graph)).toEqual([]); editor.undoAction(); expect(thread(id).messages).toHaveLength(2);
  });
  it('refuses invalid/future/duplicate storage without replacing bytes, history or existing redo', () => {
    const id = add(); editor.undoAction(); const page = editor.graph.getNode(editor.state.currentPageId)!, original = page.pluginData;
    for (const value of ['{broken', JSON.stringify({ version: 2, threads: [] }), JSON.stringify({ version: 1, threads: [{ invalid: true }] })]) {
      page.pluginData = [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value }]; expect(() => add()).toThrow(); expect(page.pluginData[0]!.value).toBe(value); expect(editor.undo.canRedo).toBe(true);
    }
    page.pluginData = original; editor.redoAction(); const stored = readPageComments(page); page.pluginData = [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: [...stored, ...stored] }) }]; expect(() => replyToComment(editor, id, owner, 'No')).toThrow('Duplicate');
  });
  it('bounds body/thread data and rejects unknown nested fields before publication', () => {
    expect(() => add(' '.repeat(2))).toThrow(); expect(() => add('x'.repeat(8193))).toThrow(); const id = add(), page = editor.graph.getNode(editor.state.currentPageId)!, stored = structuredClone(readPageComments(page));
    (stored[0]!.anchor as any).unexpected = { deep: { data: true } }; page.pluginData = [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: stored }) }]; expect(() => allComments(editor.graph)).toThrow('Invalid'); expect(thread.bind(null, id)).toThrow();
  });
  it('reuses immutable parsed metadata until its serialized value changes', () => {
    const id = add(), page = editor.graph.getNode(editor.state.currentPageId)!, first = readPageComments(page); expect(readPageComments(page)).toBe(first); expect(Object.isFrozen(first[0]!.anchor.points)).toBe(true);
    replyToComment(editor, id, owner, 'Changed'); expect(readPageComments(page)).not.toBe(first); expect(first[0]!.messages).toHaveLength(1);
  });
  it('rolls back failed publication without clearing redo or mutating artwork and unrelated metadata', () => {
    const id = add(); replyToComment(editor, id, owner, 'Undo me'); editor.undoAction(); const before = serializeGraph(editor.graph), failing = vi.fn(() => { throw new Error('Save failure'); });
    expect(() => resolveComment(editor, id, true, owner, failing)).toThrow('Save failure'); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.undo.canRedo).toBe(true); editor.redoAction(); expect(thread(id).messages).toHaveLength(2);
  });
});
