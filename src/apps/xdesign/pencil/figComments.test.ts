import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { parseFigBuffer } from '@open-pencil/fig';
import { addComment, allComments, createCommentAnchor, materializeCommentTargets, resolveCommentAnchor, replyToComment, resolveComment } from './comments';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { exportFigImageCompatible } from './figPaintCompatibility';
import { parseFigWithSlots } from './figSlots';
import { setNavigation, setPrototypeStart, readNavigation, prototypeResolver, prototypeStart } from './prototype';
let editor: Editor;
const author = { id: 'owner', name: 'Orion' };
beforeEach(() => { editor = createEditor(); }); afterEach(() => editor.dispose());
it('preserves comment identities/messages/reactions and targets through two actual native FIG exports/imports', async () => {
  const page = editor.state.currentPageId, node = editor.graph.createNode('RECTANGLE', page, { name: 'Comment target', x: 100, y: 50, width: 200, height: 100 });
  const id = addComment(editor, page, createCommentAnchor(editor.graph, page, [{ x: 150, y: 75 }], node.id), author, 'Review שלום 👋'); replyToComment(editor, id, author, 'Reply'); resolveComment(editor, id, true, author);
  const source = serializeGraph(editor.graph), bytes = await exportFigImageCompatible(deserializeGraph(source)), records = parseFigBuffer(new Uint8Array(bytes).buffer).nodeChanges;
  expect(serializeGraph(editor.graph)).toBe(source); expect(records.some(record => record.pluginData?.some(entry => entry.pluginID === 'orion.xdesign.comment-export'))).toBe(false);
  const first = await parseFigWithSlots(new Uint8Array(bytes).buffer), thread = allComments(first)[0]!; expect(thread.id).toBe(id); expect(thread.messages.map(message => message.body)).toEqual(['Review שלום 👋', 'Reply']); expect(thread.resolvedBy).toEqual(author);
  expect(resolveCommentAnchor(first, thread)).toMatchObject({ points: [{ x: 150, y: 75 }], missingTarget: false, target: { name: 'Comment target' } });
  const target = resolveCommentAnchor(first, thread).target!; first.updateNode(target.id, { x: 200, width: 400 }); expect(resolveCommentAnchor(first, thread).points).toEqual([{ x: 300, y: 75 }]);
  const second = await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(first)))).buffer); expect(resolveCommentAnchor(second, allComments(second)[0]!).points).toEqual([{ x: 300, y: 75 }]);
});
it('exports region/canvas/deleted-target comments without changing artwork or rebinding missing targets', async () => {
  const page = editor.state.currentPageId, node = editor.graph.createNode('RECTANGLE', page, { x: 100, y: 100, width: 100, height: 100 }), points = [{ x: 110, y: 110 }, { x: 150, y: 110 }, { x: 150, y: 150 }, { x: 110, y: 150 }];
  addComment(editor, page, createCommentAnchor(editor.graph, page, points, node.id), author, 'Region'); addComment(editor, page, createCommentAnchor(editor.graph, page, [{ x: 400, y: 300 }]), author, 'Canvas'); editor.graph.deleteNode(node.id);
  const restored = await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(editor.graph)))).buffer), comments = allComments(restored); expect(comments).toHaveLength(2);
  expect(resolveCommentAnchor(restored, comments[0]!)).toMatchObject({ points, missingTarget: true }); expect(comments[0]!.anchor.format).toBe('missing'); expect(resolveCommentAnchor(restored, comments[1]!).points).toEqual([{ x: 400, y: 300 }]);
});

it('retains instance-child pins and finalized prototype/page metadata together', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, main = graph.createNode('COMPONENT', page, { name: 'Component', width: 100, height: 100 }); graph.createNode('RECTANGLE', main.id, { name: 'Template child', width: 40, height: 40 });
  const instance = graph.createInstance(main.id, page, { name: 'Instance', x: 200, y: 100 })!, child = graph.getNode(instance.childIds[0]!)!, frame = graph.createNode('FRAME', page, { name: 'Screen', width: 100, height: 100 });
  addComment(editor, page, createCommentAnchor(graph, page, [{ x: 220, y: 120 }], child.id), author, 'Nested instance review');
  graph.getNode(page)!.pluginData.push({ pluginId: 'foreign', key: 'page', value: 'Preserve this' }); setNavigation(editor, instance, { action: 'navigate', target: frame.id, transition: 'instant', duration: 0 }); setPrototypeStart(editor, frame.id);
  const restored = await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).buffer), restoredInstance = [...restored.nodes.values()].find(node => node.name === 'Instance')!;
  expect(resolveCommentAnchor(restored, allComments(restored)[0]!)).toMatchObject({ points: [{ x: 220, y: 120 }], missingTarget: false });
  const target = resolveCommentAnchor(restored, allComments(restored)[0]!).target!; expect(materializeCommentTargets(restored)).toBe(true); expect(allComments(restored)[0]!.anchor).toMatchObject({ format: 'local', nodeId: target.id }); expect(allComments(restored)[0]!.anchor.instancePath).toBeUndefined(); expect(materializeCommentTargets(restored)).toBe(false);
  expect(readNavigation(restoredInstance, prototypeResolver(restored))?.target).toBe([...restored.nodes.values()].find(node => node.name === 'Screen')!.id); expect(prototypeStart(restored, restored.getPages()[0]!.id)).toBe([...restored.nodes.values()].find(node => node.name === 'Screen')!.id);
  expect(restored.getPages()[0]!.pluginData).toContainEqual({ pluginId: 'foreign', key: 'page', value: 'Preserve this' });
});
it('keeps same-named page comments distinct and fails invalid data before exporting', async () => {
  const graph = editor.graph, first = editor.state.currentPageId, second = graph.createNode('CANVAS', graph.rootId, { name: graph.getNode(first)!.name });
  addComment(editor, first, createCommentAnchor(graph, first, [{ x: 20, y: 30 }]), author, 'First'); addComment(editor, second.id, createCommentAnchor(graph, second.id, [{ x: 40, y: 50 }]), author, 'Second');
  const restored = await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).buffer), comments = allComments(restored); expect(comments.map(thread => thread.messages[0]!.body)).toEqual(['First', 'Second']); expect(comments[0]!.ownerPageId).not.toBe(comments[1]!.ownerPageId);
  graph.getNode(first)!.pluginData[0]!.value = '{bad'; const saved = serializeGraph(graph); await expect(exportFigImageCompatible(deserializeGraph(saved))).rejects.toThrow('could not be read'); expect(serializeGraph(graph)).toBe(saved);
});
it('distinguishes repeated nested instances from the original component definition after native reopen', async () => {
  const graph = editor.graph, page = editor.state.currentPageId, inner = graph.createNode('COMPONENT', page, { name: 'Inner', width: 100, height: 100 }), leaf = graph.createNode('RECTANGLE', inner.id, { name: 'Leaf', width: 40, height: 40 });
  const outer = graph.createNode('COMPONENT', page, { name: 'Outer', width: 200, height: 100 }); graph.createInstance(inner.id, outer.id, { name: 'Left', x: 0 }); graph.createInstance(inner.id, outer.id, { name: 'Right', x: 100 });
  const placed = graph.createInstance(outer.id, page, { name: 'Placed', x: 400, y: 200 })!, right = graph.getNode(placed.childIds[1]!)!, child = graph.getNode(right.childIds[0]!)!;
  addComment(editor, page, createCommentAnchor(graph, page, [{ x: 510, y: 210 }], child.id), author, 'Right nested child'); addComment(editor, page, createCommentAnchor(graph, page, [{ x: 10, y: 10 }], leaf.id), author, 'Original definition');
  const restored = await parseFigWithSlots(new Uint8Array(await exportFigImageCompatible(deserializeGraph(serializeGraph(graph)))).buffer), threads = allComments(restored);
  expect(resolveCommentAnchor(restored, threads[0]!)).toMatchObject({ points: [{ x: 510, y: 210 }], missingTarget: false }); expect(resolveCommentAnchor(restored, threads[1]!)).toMatchObject({ points: [{ x: 10, y: 10 }], missingTarget: false });
  const nativeChild = resolveCommentAnchor(restored, threads[0]!).target!; restored.updateNode(nativeChild.id, { x: 10 }); expect(resolveCommentAnchor(restored, threads[0]!).points).toEqual([{ x: 520, y: 210 }]);
});
