// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { cloneDesignSubgraph } from './graphSubset';
import { prepareNativeSceneComponents, hasNativeSceneComponent } from './nativeSceneComponents';
import { installSlotSupport, createSlot, claimSlotContent } from './slots';
import { setComponentBehaviour } from './behaviour/editor';
import { serializeGraph } from './document';

let editor: Editor;
beforeEach(() => { editor = createEditor(); installSlotSupport(editor.graph); });
afterEach(() => editor.dispose());
const component = (name: string) => editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name, width: 60, height: 40 });
const instance = (main: SceneNode, parentId = editor.state.currentPageId) => editor.graph.createInstance(main.id, parentId)!;
function fixture() {
  const main = component('Card');
  main.componentPropertyDefinitions = [{ id: 'title', name: 'Title', type: 'TEXT', defaultValue: 'Default' }, { id: 'visible', name: 'Visible', type: 'BOOLEAN', defaultValue: 'true' }];
  editor.graph.createNode('TEXT', main.id, { name: 'Title', text: 'Default', componentPropertyReferences: [{ propertyId: 'title', field: 'TEXT' }, { propertyId: 'visible', field: 'VISIBLE' }] });
  return { main, placed: instance(main) };
}
it('materializes stale explicit text/boolean assignments privately and preserves unassigned realized overrides', () => {
  const { main, placed } = fixture(), unassigned = instance(main);
  placed.componentPropertyAssignments = { title: 'Assigned', visible: 'false' };
  editor.graph.getChildren(unassigned.id)[0]!.text = 'Realized override';
  const before = serializeGraph(editor.graph), graph = cloneDesignSubgraph(editor.graph, [placed.id, unassigned.id]);
  prepareNativeSceneComponents(graph, [placed.id, unassigned.id, graph.getChildren(placed.id)[0]!.id, placed.id]);
  expect(graph.getChildren(placed.id)[0]).toMatchObject({ text: 'Assigned', visible: false });
  expect(graph.getChildren(unassigned.id)[0]!.text).toBe('Realized override');
  expect(hasNativeSceneComponent(graph, graph.getNode(placed.id)!)).toBe(true);
  expect(hasNativeSceneComponent(graph, graph.getChildren(placed.id)[0]!)).toBe(true);
  expect(serializeGraph(editor.graph)).toBe(before);
});
it.each(['id', 'key', 'library', 'source'] as const)('includes an assigned %s swap dependency and resolves its own nested properties after the swap', alias => {
  const old = component('Old'), replacement = component('Replacement'), owner = component('Owner');
  replacement.componentKey = 'replacement-key'; replacement.sourceLibraryKey = 'replacement-library'; replacement.source.id = 'replacement-source';
  replacement.componentPropertyDefinitions = [{ id: 'nested-title', name: 'Nested title', type: 'TEXT', defaultValue: 'Nested' }];
  editor.graph.createNode('TEXT', replacement.id, { text: 'Nested', componentPropertyReferences: [{ propertyId: 'nested-title', field: 'TEXT' }] });
  const nested = instance(old, owner.id);
  nested.componentPropertyReferences = [{ propertyId: 'swap', field: 'INSTANCE_SWAP' }];
  nested.componentPropertyAssignments = { 'nested-title': 'Swapped title' };
  owner.componentPropertyDefinitions = [{ id: 'swap', name: 'Swap', type: 'INSTANCE_SWAP', defaultValue: old.id }];
  const placed = instance(owner);
  placed.componentPropertyAssignments = { swap: { id: replacement.id, key: replacement.componentKey, library: replacement.sourceLibraryKey, source: replacement.source.id }[alias] };
  const before = serializeGraph(editor.graph), graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  expect(graph.getNode(replacement.id)).toBeTruthy();
  prepareNativeSceneComponents(graph, [placed.id]);
  const swapped = graph.getChildren(placed.id)[0]!;
  expect(swapped.componentId).toBe(replacement.id); expect(graph.getChildren(swapped.id)[0]!.text).toBe('Swapped title');
  expect(hasNativeSceneComponent(graph, swapped)).toBe(true); expect(serializeGraph(editor.graph)).toBe(before);
});
it('copies unassigned swap defaults without resetting the realized nested instance', () => {
  const owner = component('Owner'), original = component('Original'), defaultMain = component('Default');
  const nested = instance(original, owner.id);
  nested.componentPropertyReferences = [{ propertyId: 'swap', field: 'INSTANCE_SWAP' }];
  owner.componentPropertyDefinitions = [{ id: 'swap', name: 'Swap', type: 'INSTANCE_SWAP', defaultValue: defaultMain.id }];
  const placed = instance(owner), graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  expect(graph.getNode(defaultMain.id)).toBeTruthy(); prepareNativeSceneComponents(graph, [placed.id]);
  expect(graph.getChildren(placed.id)[0]!.componentId).toBe(original.id);
});
it('preserves assigned custom slot content through same-target swaps and repeated preparation', () => {
  const owner = component('Owner'), content = component('Content');
  const frame = editor.graph.createNode('FRAME', content.id, { name: 'Slot' }); createSlot(editor, frame);
  const nested = instance(content, owner.id); nested.componentPropertyReferences = [{ propertyId: 'swap', field: 'INSTANCE_SWAP' }];
  owner.componentPropertyDefinitions = [{ id: 'swap', name: 'Swap', type: 'INSTANCE_SWAP', defaultValue: content.id }];
  const placed = instance(owner), live = editor.graph.getChildren(placed.id)[0]!, slot = editor.graph.getChildren(live.id)[0]!;
  claimSlotContent(editor.graph, slot); editor.graph.createNode('TEXT', slot.id, { name: 'Custom', text: 'Keep me' }); placed.componentPropertyAssignments = { swap: content.id };
  const before = serializeGraph(editor.graph), graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  prepareNativeSceneComponents(graph, [placed.id]); const once = serializeGraph(graph); prepareNativeSceneComponents(graph, [placed.id]);
  expect(serializeGraph(graph)).toBe(once); expect([...graph.nodes.values()].some(node => node.text === 'Keep me')).toBe(true); expect(serializeGraph(editor.graph)).toBe(before);
});
it('keeps interactive controls and unrelated property references ineligible for static composition', () => {
  const main = component('Button'); setComponentBehaviour(editor, main, { kind: 'button' });
  const placed = instance(main), orphan = editor.graph.createNode('TEXT', editor.state.currentPageId, { componentPropertyReferences: [{ propertyId: 'title', field: 'TEXT' }] });
  const graph = cloneDesignSubgraph(editor.graph, [placed.id, orphan.id]); prepareNativeSceneComponents(graph, [placed.id, orphan.id]);
  expect(hasNativeSceneComponent(graph, graph.getNode(placed.id)!)).toBe(false); expect(hasNativeSceneComponent(graph, graph.getNode(orphan.id)!)).toBe(false);
  graph.getNode(orphan.id)!.componentPropertyReferences[0]!.field = 'UNKNOWN' as never;
  prepareNativeSceneComponents(graph, [orphan.id]); expect(hasNativeSceneComponent(graph, graph.getNode(orphan.id)!)).toBe(false);
});
it('rejects missing assigned components, invalid booleans and damaged trees before native capture', () => {
  const { placed, main } = fixture();
  main.componentPropertyDefinitions.push({ id: 'swap', name: 'Missing swap', type: 'INSTANCE_SWAP', defaultValue: 'missing' }); placed.componentPropertyAssignments = { swap: 'missing' };
  let graph = cloneDesignSubgraph(editor.graph, [placed.id]); expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow('Restore the component assigned');
  placed.componentPropertyAssignments = { visible: 'invalid' }; graph = cloneDesignSubgraph(editor.graph, [placed.id]); expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow('Restore the boolean');
  graph = cloneDesignSubgraph(editor.graph, [placed.id]); graph.getChildren(placed.id)[0]!.childIds = [placed.id]; expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow(/recursive|misplaced/);
});
it('rejects recursive ancestry during dependency copying instead of hanging', () => {
  const { placed } = fixture(), graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  graph.getNode(placed.id)!.parentId = placed.id;
  expect(() => cloneDesignSubgraph(graph, [placed.id])).toThrow('recursive layer ancestry');
  const parent = placed.parentId;
  try {
    placed.parentId = placed.id;
    expect(() => cloneDesignSubgraph(editor.graph, [placed.id])).toThrow('recursive layer ancestry');
  } finally { placed.parentId = parent; }
});
it('rejects duplicated child references before applying an explicit property', () => {
  const { placed } = fixture(), graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  const owner = graph.getNode(placed.id)!, child = graph.getChildren(placed.id)[0]!;
  owner.childIds.push(child.id); owner.componentPropertyAssignments = { title: 'Must not apply' };
  expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow('duplicated');
  expect(child.text).toBe('Default');
});
it('bounds deep and oversized component forests before SDK swapping', () => {
  const { placed } = fixture();
  let graph = cloneDesignSubgraph(editor.graph, [placed.id]), parent = graph.getChildren(placed.id)[0]!;
  for (let index = 0; index < 129; index++) parent = graph.createNode('FRAME', parent.id);
  expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow('overly deep');
  graph = cloneDesignSubgraph(editor.graph, [placed.id]);
  const template = graph.getChildren(placed.id)[0]!, root = graph.getNode(graph.rootId)!;
  const children: string[] = [];
  for (let index = graph.nodes.size; index <= 20_000; index++) {
    const id = `bounded-test-${index}`; children.push(id);
    graph.nodes.set(id, { ...template, id, type: 'RECTANGLE', parentId: root.id, childIds: [] });
  }
  root.childIds.push(...children);
  expect(() => prepareNativeSceneComponents(graph, [placed.id])).toThrow('20,000');
});
