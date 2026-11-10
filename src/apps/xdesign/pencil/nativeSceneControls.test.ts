// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { createComponentProperty, bindComponentProperty } from './componentProperties';
import { installSlotSupport, createSlot } from './slots';
import { setComponentBehaviour } from './behaviour/editor';
import { cloneDesignSubgraph } from './graphSubset';
import { serializeGraph } from './document';
import { finishNativeSceneControls, prepareNativeSceneControls } from './nativeSceneControls';
import { hasNativeSceneComponent } from './nativeSceneComponents';
import { selectionToDesignModel } from './reactExport';
import { resolveDesignControl, type DesignControlSession, type DesignControlSnapshot } from './reactExportRuntime';
import { getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph';
import { exportedRangeGeometry, exportedThumbGeometry, nativeRangeGeometry, nativeThumbPosition } from './nativeControlGeometry';

let editor: Editor;
beforeEach(() => { editor = createEditor(); installSlotSupport(editor.graph); });
afterEach(() => editor.dispose());
const component = (name: string) => editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name, width: 200, height: 60, fills: [] });
const placed = (main: SceneNode, parent = editor.state.currentPageId) => editor.graph.createInstance(main.id, parent)!;
const slot = (main: SceneNode, name: string, width = 200, x = 0) => {
  const frame = editor.graph.createNode('FRAME', main.id, { name, width, height: 20, x, fills: [] }); createSlot(editor, frame); return frame;
};
function booleanControl(kind: 'checkbox' | 'radio' | 'switch' | 'toggle') {
  const main = component(kind), mark = editor.graph.createNode('RECTANGLE', main.id, { name: 'Mark', width: 12, height: 12, visible: false });
  const id = createComponentProperty(editor, main, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', id);
  setComponentBehaviour(editor, main, { kind, values: { value: 'Checked' } }); return main;
}
function prepare(node: SceneNode, snapshot: DesignControlSnapshot) {
  const graph = cloneDesignSubgraph(editor.graph, [node.id]);
  const entries = prepareNativeSceneControls(graph, [node.id], { [JSON.stringify([node.id])]: snapshot });
  return { graph, entry: entries.get(graph.getNode(node.id)!)! };
}
it.each(['checkbox', 'switch', 'toggle', 'radio'] as const)('resolves %s visibility on a private graph and retains live-composition exclusion', kind => {
  const instance = placed(booleanControl(kind)), before = serializeGraph(editor.graph);
  const { graph, entry } = prepare(instance, { value: true, state: 'focus' });
  expect(graph.getChildren(instance.id)[0]!.visible).toBe(true); expect(entry.values.value).toBe(true);
  expect(hasNativeSceneComponent(graph, graph.getNode(instance.id)!)).toBe(false);
  expect(serializeGraph(editor.graph)).toBe(before);
});
it.each(['rest', 'hover', 'pressed', 'focus', 'disabled'] as const)('resolves %s variants while preserving static axes and placement names', state => {
  const set = editor.graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Button' });
  set.componentPropertyDefinitions = [{ id: 'state', name: 'State', type: 'VARIANT', defaultValue: 'Rest', variantOptions: ['Rest', 'Hover', 'Pressed', 'Focus', 'Disabled'] }, { id: 'size', name: 'Size', type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small', 'Large'] }];
  for (const size of ['Small', 'Large']) for (const name of ['Rest', 'Hover', 'Pressed', 'Focus', 'Disabled']) editor.graph.createNode('COMPONENT', set.id, { name: `${size} ${name}`, width: 80, height: 30, componentPropertyValues: { State: name, Size: size } });
  setComponentBehaviour(editor, set, { kind: 'button', states: 'State' });
  const instance = placed(editor.graph.getChildren(set.id)[5]!); instance.name = 'Save action';
  const before = serializeGraph(editor.graph), { entry, graph } = prepare(instance, { value: '', state });
  expect(entry.main.componentPropertyValues).toEqual({ State: state[0]!.toUpperCase() + state.slice(1), Size: 'Large' });
  expect(graph.getNode(instance.id)!.name).toBe('Save action'); expect(entry.config.properties).toEqual({ State: 'Rest', Size: 'Large' });
  expect(serializeGraph(editor.graph)).toBe(before);
});
it.each(['textField', 'textarea', 'numberField'] as const)('materializes %s Unicode or stepped text without changing authoring defaults', kind => {
  const main = component('Field'), text = editor.graph.createNode('TEXT', main.id, { name: 'Value', text: '', width: 160, height: 30 });
  const id = createComponentProperty(editor, main, 'Text', 'TEXT', ''); bindComponentProperty(editor, text, 'TEXT', id);
  const filled = createComponentProperty(editor, main, 'Filled', 'BOOLEAN', 'false'); bindComponentProperty(editor, text, 'VISIBLE', filled);
  setComponentBehaviour(editor, main, { kind, values: { [kind === 'numberField' ? 'text' : 'value']: 'Text', ...(kind !== 'numberField' ? { filled: 'Filled' } : {}) }, numbers: kind === 'numberField' ? { value: { min: 0, max: 20, step: 2, default: 12 } } : undefined });
  const instance = placed(main), before = serializeGraph(editor.graph), { graph, entry } = prepare(instance, { value: kind === 'numberField' ? 13 : '你好 👩🏽‍🎨 مرحبا', state: 'focus' });
  expect(graph.getChildren(instance.id)[0]!.text).toBe(kind === 'numberField' ? '14' : '你好 👩🏽‍🎨 مرحبا');
  if (kind !== 'numberField') expect(graph.getChildren(instance.id)[0]!.visible).toBe(true);
  expect(entry.config.defaults[kind === 'numberField' ? 'text' : 'value']).toBe(''); expect(serializeGraph(editor.graph)).toBe(before);
});
it.each(['slider', 'progress'] as const)('settles %s native range and child geometry after layout, idempotently', kind => {
  const main = component(kind), track = slot(main, 'Track', 200, 10), moving = slot(main, kind === 'slider' ? 'Thumb' : 'Indicator', kind === 'slider' ? 20 : 200);
  const art = editor.graph.createNode('RECTANGLE', moving.id, { name: 'Art', width: moving.width, height: 20, horizontalConstraint: 'SCALE' });
  const range = kind === 'slider' ? slot(main, 'Range') : undefined;
  setComponentBehaviour(editor, main, { kind, parts: { track: 'Track', ...(kind === 'slider' ? { thumb: 'Thumb', range: 'Range' } : { indicator: 'Indicator' }) }, numbers: { value: { min: 0, max: 100, step: 10, default: 50 } } });
  const instance = placed(main), before = serializeGraph(editor.graph), { graph, entry } = prepare(instance, { value: 26, state: 'rest' });
  expect(entry.snapshot.value).toBe(30); expect(entry.ratio).toBe(0.3);
  if (kind === 'slider') { expect(entry.parts.get('thumb')!.x).toBe(64); expect(entry.parts.get('range')!.width).toBe(60); }
  else { expect(entry.parts.get('indicator')!.width).toBe(60); expect(graph.getChildren(entry.parts.get('indicator')!.id)[0]!.width).toBe(60); }
  entry.parts.get('track')!.width = 300; finishNativeSceneControls(graph);
  if (kind === 'slider') expect(entry.parts.get('thumb')!.x).toBe(94); else expect(entry.parts.get('indicator')!.width).toBe(90);
  const once = serializeGraph(graph); finishNativeSceneControls(graph); expect(serializeGraph(graph)).toBe(once);
  expect(art.width).toBe(kind === 'slider' ? 20 : 200); expect(track.width).toBe(200); expect(range?.width).toBe(kind === 'slider' ? 200 : undefined); expect(serializeGraph(editor.graph)).toBe(before);
});
it('moves a transformed thumb along a rotated track through a separately transformed parent', () => {
  const trackParent = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Track parent', x: 40, y: 30, width: 300, height: 160, rotation: 90, fills: [] });
  const thumbParent = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Thumb parent', x: 280, y: 70, width: 180, height: 120, rotation: -90, flipX: true, fills: [] });
  const track = editor.graph.createNode('FRAME', trackParent.id, { name: 'Track', x: 10, y: 20, width: 200, height: 8, rotation: 25, fills: [] });
  const thumb = editor.graph.createNode('FRAME', thumbParent.id, { name: 'Thumb', x: 14, y: 18, width: 24, height: 14, rotation: -15, fills: [] });
  const trackWorld = getWorldMatrix(track, editor.graph), inverseTrack = TransformMatrix.invert(trackWorld)!;
  const exported = exportedThumbGeometry(editor.graph, track, thumb);
  expect(Math.abs(exported.travel.x)).toBeGreaterThan(1);
  expect(Math.abs(exported.travel.y)).toBeGreaterThan(1);
  const placement = nativeThumbPosition(editor.graph, track, thumb, 0);
  thumb.x = placement.x; thumb.y = placement.y;
  const thumbInTrack = TransformMatrix.multiply(inverseTrack, getWorldMatrix(thumb, editor.graph));
  const points = TransformMatrix.mapPoints(thumbInTrack, [0, 0, thumb.width, 0, thumb.width, thumb.height, 0, thumb.height]);
  const xs = [points[0]!, points[2]!, points[4]!, points[6]!], ys = [points[1]!, points[3]!, points[5]!, points[7]!];
  expect(Math.min(...xs)).toBeCloseTo(0, 6);
  const transverse = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const end = nativeThumbPosition(editor.graph, track, thumb, 1);
  thumb.x = end.x; thumb.y = end.y;
  const endMatrix = TransformMatrix.multiply(inverseTrack, getWorldMatrix(thumb, editor.graph));
  const endPoints = TransformMatrix.mapPoints(endMatrix, [0, 0, thumb.width, 0, thumb.width, thumb.height, 0, thumb.height]);
  const endX = [endPoints[0]!, endPoints[2]!, endPoints[4]!, endPoints[6]!];
  const endY = [endPoints[1]!, endPoints[3]!, endPoints[5]!, endPoints[7]!];
  expect(Math.max(...endX)).toBeCloseTo(track.width, 6);
  expect(endY.reduce((sum, value) => sum + value, 0) / endY.length).toBeCloseTo(transverse, 6);
});
it('aligns slider fill geometry to the track axis across a flipped, rotated range parent', () => {
  const trackParent = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Track parent', x: 50, y: 20, width: 300, height: 160, rotation: 35, fills: [] });
  const rangeParent = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Range parent', x: 210, y: 80, width: 180, height: 120, rotation: -70, flipY: true, fills: [] });
  const track = editor.graph.createNode('FRAME', trackParent.id, { name: 'Track', x: 15, y: 25, width: 180, height: 8, rotation: -10, fills: [] });
  const range = editor.graph.createNode('FRAME', rangeParent.id, { name: 'Range', x: 20, y: 30, width: 140, height: 6, rotation: 20, fills: [] });
  const initial = { x: range.x, y: range.y, width: range.width, rotation: range.rotation, flipX: range.flipX, flipY: range.flipY };
  const trackWorld = getWorldMatrix(track, editor.graph), parentWorld = getWorldMatrix(rangeParent, editor.graph);
  const authoredOrigin = TransformMatrix.mapPoints(TransformMatrix.multiply(TransformMatrix.invert(trackWorld)!, getWorldMatrix(range, editor.graph)), [0, 0]);
  for (const ratio of [0, 0.5, 1]) {
    Object.assign(range, initial);
    const geometry = exportedRangeGeometry(editor.graph, track, range);
    nativeRangeGeometry(editor.graph, track, range, ratio);
    expect(range.width).toBe(180 * ratio);
    const [a, b, c, d] = geometry.matrix;
    const cssLocal = TransformMatrix.multiply([1, 0, geometry.left, 0, 1, geometry.top, 0, 0, 1], [a, c, 0, b, d, 0, 0, 0, 1]);
    const portableWorld = TransformMatrix.multiply(parentWorld, cssLocal), nativeWorld = getWorldMatrix(range, editor.graph);
    for (const index of [0, 1, 2, 3, 4, 5]) expect(nativeWorld[index]).toBeCloseTo(portableWorld[index]!, 6);
    const actualOrigin = TransformMatrix.mapPoints(TransformMatrix.multiply(TransformMatrix.invert(trackWorld)!, nativeWorld), [0, 0]);
    expect(actualOrigin[0]).toBeCloseTo(authoredOrigin[0]!, 6); expect(actualOrigin[1]).toBeCloseTo(authoredOrigin[1]!, 6);
    const cross = trackWorld[0]! * nativeWorld[3]! - trackWorld[3]! * nativeWorld[0]!;
    const dot = trackWorld[0]! * nativeWorld[0]! + trackWorld[3]! * nativeWorld[3]!;
    expect(cross).toBeCloseTo(0, 6); expect(dot).toBeGreaterThan(0);
  }
});
it.each(['radioGroup', 'toggleGroup', 'accordion', 'tabs'] as const)('resolves %s parent selection into nested controls and visible content', kind => {
  const main = component(kind), items = slot(main, kind === 'tabs' ? 'List' : 'Items');
  let item: SceneNode;
  if (kind === 'accordion') {
    item = component('Disclosure'); slot(item, 'Trigger'); const content = slot(item, 'Content'); editor.graph.createNode('RECTANGLE', content.id, { width: 10, height: 10 });
    setComponentBehaviour(editor, item, { kind: 'collapsible', parts: { trigger: 'Trigger', content: 'Content' } });
  } else item = booleanControl(kind === 'radioGroup' ? 'radio' : 'toggle');
  placed(item, items.id); placed(item, items.id);
  let panels: SceneNode | undefined;
  if (kind === 'tabs') { panels = slot(main, 'Panels'); editor.graph.createNode('FRAME', panels.id, { name: 'First' }); editor.graph.createNode('FRAME', panels.id, { name: 'Second' }); }
  setComponentBehaviour(editor, main, { kind, parts: kind === 'tabs' ? { list: 'List', panels: 'Panels' } : { items: 'Items' } });
  const instance = placed(main), before = serializeGraph(editor.graph), { graph, entry } = prepare(instance, { value: [1], state: 'rest' });
  const nested = graph.getChildren(entry.parts.get(kind === 'tabs' ? 'list' : 'items')!.id);
  expect(nested).toHaveLength(2);
  if (kind === 'accordion') expect(nested.map(node => graph.getChildren(node.id)[1]!.visible)).toEqual([false, true]);
  else expect(nested.map(node => graph.getChildren(node.id)[0]!.visible)).toEqual([false, true]);
  if (kind === 'tabs') expect(graph.getChildren(entry.parts.get('panels')!.id).map(node => node.visible)).toEqual([false, true]);
  expect(serializeGraph(editor.graph)).toBe(before);
});
it('keeps nested saved interaction states, parent disabled inheritance, defaults and stable duplicate-name keys', () => {
  const child = booleanControl('toggle'), main = component('Group'), items = slot(main, 'Items'); placed(child, items.id); placed(child, items.id);
  const disabled = createComponentProperty(editor, main, 'Disabled', 'BOOLEAN', 'true');
  setComponentBehaviour(editor, main, { kind: 'toggleGroup', values: { disabled: 'Disabled' }, parts: { items: 'Items' } });
  const instance = placed(main), graph = cloneDesignSubgraph(editor.graph, [instance.id]), before = serializeGraph(editor.graph);
  const parentKey = JSON.stringify([instance.id]), childKey = JSON.stringify([instance.id, ['Items', 0], ['toggle', 1]]);
  const entries = prepareNativeSceneControls(graph, [instance.id], { [parentKey]: { value: [1], state: 'rest' }, [childKey]: { value: false, state: 'pressed' } });
  const nested = [...entries.values()].filter(entry => entry.config.kind === 'toggle');
  expect(nested.map(entry => entry.key)).toEqual([JSON.stringify([instance.id, ['Items', 0], ['toggle', 0]]), childKey]);
  expect(nested.map(entry => entry.values.value)).toEqual([false, true]); expect(nested.map(entry => entry.values.disabled)).toEqual([true, true]);
  expect(nested[1]!.snapshot.state).toBe('pressed'); expect(graph.getNode(instance.id)!.componentPropertyAssignments[disabled]).toBe('true');
  expect(serializeGraph(editor.graph)).toBe(before);
});
it('chooses the first visible enabled single-selection item and starts multiple selection empty', () => {
  const item = booleanControl('radio'), disabled = createComponentProperty(editor, item, 'Disabled', 'BOOLEAN', 'false');
  setComponentBehaviour(editor, item, { kind: 'radio', values: { value: 'Checked', disabled: 'Disabled' } });
  const main = component('Radios'), items = slot(main, 'Items');
  placed(item, items.id).visible = false; placed(item, items.id).componentPropertyAssignments[disabled] = 'true'; placed(item, items.id);
  setComponentBehaviour(editor, main, { kind: 'radioGroup', parts: { items: 'Items' } });
  const instance = placed(main), graph = cloneDesignSubgraph(editor.graph, [instance.id]);
  const entries = prepareNativeSceneControls(graph, [instance.id], {});
  expect(entries.get(graph.getNode(instance.id)!)!.snapshot.value).toEqual([2]);
  const config = entries.get(graph.getNode(instance.id)!)!.config;
  expect(resolveDesignControl({ ...config, kind: 'toggleGroup' }, undefined, 'rest', '', false, 2).value).toEqual([]);
});
it('maps text and explicit unrelated assignments by property name across state variants', () => {
  const set = editor.graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Field' });
  set.componentPropertyDefinitions = [{ id: 'state', name: 'State', type: 'VARIANT', defaultValue: 'Rest', variantOptions: ['Rest', 'Focus'] }];
  const variants = ['Rest', 'Focus'].map((state, index) => {
    const main = editor.graph.createNode('COMPONENT', set.id, { name: state, width: 200, height: 50, componentPropertyValues: { State: state }, componentPropertyDefinitions: [{ id: `value-${index}`, name: 'Value', type: 'TEXT', defaultValue: '' }, { id: `label-${index}`, name: 'Label', type: 'TEXT', defaultValue: 'Label' }] });
    editor.graph.createNode('TEXT', main.id, { name: 'Value', text: '', componentPropertyReferences: [{ propertyId: `value-${index}`, field: 'TEXT' }] });
    editor.graph.createNode('TEXT', main.id, { name: 'Label', text: 'Label', componentPropertyReferences: [{ propertyId: `label-${index}`, field: 'TEXT' }] });
    return main;
  });
  setComponentBehaviour(editor, set, { kind: 'textField', states: 'State', values: { value: 'Value' } });
  const instance = placed(variants[0]!); instance.componentPropertyAssignments = { 'value-0': 'Authored', 'label-0': 'Keep override' };
  const before = serializeGraph(editor.graph), { graph, entry } = prepare(instance, { value: '你好', state: 'focus' });
  expect(entry.main.id).toBe(variants[1]!.id); expect(entry.config.defaults.value).toBe('Authored');
  expect(graph.getNode(instance.id)!.componentPropertyAssignments).toEqual({ 'value-1': '你好', 'label-1': 'Keep override' });
  expect(graph.getChildren(instance.id).map(node => node.text)).toEqual(['你好', 'Keep override']); expect(serializeGraph(editor.graph)).toBe(before);
});
it('hydrates an exported control snapshot while preserving authoring defaults', () => {
  const main = booleanControl('checkbox'), instance = placed(main), before = serializeGraph(editor.graph);
  const session: DesignControlSession = { [JSON.stringify([instance.id])]: { value: true, state: 'focus' } };
  const model = selectionToDesignModel(editor.graph, [instance.id], undefined, true, undefined, session);
  expect(model.nodes[0]!.control).toMatchObject({ playback: { value: true, state: 'focus' }, defaults: { value: false } });
  expect(serializeGraph(editor.graph)).toBe(before);
  const config = model.nodes[0]!.control!;
  expect(resolveDesignControl(config, true, 'focus').values.value).toBe(true);
});
it('deduplicates selected component descendants and keeps fresh root snapshots independent', () => {
  const first = booleanControl('checkbox'), second = booleanControl('checkbox'), before = serializeGraph(editor.graph);
  const session: DesignControlSession = { [JSON.stringify([first.id])]: { value: true, state: 'focus' }, [JSON.stringify([second.id])]: { value: false, state: 'rest' } };
  const model = selectionToDesignModel(editor.graph, [first.id, first.childIds[0]!, first.id, second.id], undefined, true, undefined, session);
  expect(model.nodes.map(node => node.id)).toEqual([first.id, second.id]);
  expect(model.nodes.map(node => node.control?.playback)).toEqual([{ value: true, state: 'focus' }, { value: false, state: 'rest' }]);
  expect(serializeGraph(editor.graph)).toBe(before);
});
it('rejects empty sets and fresh root expansion beyond the dependent layer limit', () => {
  const empty = editor.graph.createNode('COMPONENT_SET', editor.state.currentPageId); expect(() => selectionToDesignModel(editor.graph, [empty.id])).toThrow('component set is empty');
  const main = component('Large root'), template = editor.graph.createNode('RECTANGLE', main.id), children = [template.id];
  for (let index = 0; index < 10_000; index++) {
    const id = `root-limit-${index}`; children.push(id); editor.graph.nodes.set(id, { ...template, id, childIds: [] });
  }
  main.childIds = children; const before = serializeGraph(editor.graph);
  expect(() => selectionToDesignModel(editor.graph, [main.id])).toThrow('component root exceeds 20,000'); expect(serializeGraph(editor.graph)).toBe(before);
});
it('rejects damaged snapshots, missing required parts and incorrect group items before publishing', () => {
  const instance = placed(booleanControl('checkbox'));
  for (const snapshot of [{ value: Infinity, state: 'rest' }, { value: [], state: 'unknown' }, { value: 'x'.repeat(4097), state: 'focus' }, { value: [-1], state: 'rest' }]) {
    const graph = cloneDesignSubgraph(editor.graph, [instance.id]), before = serializeGraph(graph);
    expect(() => prepareNativeSceneControls(graph, [instance.id], { bad: snapshot } as DesignControlSession)).toThrow('Restore this control'); expect(serializeGraph(graph)).toBe(before);
  }
  const main = component('Broken slider'); setComponentBehaviour(editor, main, { kind: 'slider' });
  expect(() => prepare(placed(main), { value: 50, state: 'rest' })).toThrow('bindings');
  const group = component('Broken radios'), items = slot(group, 'Items'); placed(booleanControl('toggle'), items.id); setComponentBehaviour(editor, group, { kind: 'radioGroup', parts: { items: 'Items' } });
  expect(() => prepare(placed(group), { value: [0], state: 'rest' })).toThrow('Each radioGroup item');
  expect(() => prepare(instance, { value: 'true', state: 'rest' })).toThrow('saved value for this checkbox');
});
