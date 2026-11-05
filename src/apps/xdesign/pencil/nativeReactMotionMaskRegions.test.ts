import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { serializeGraph } from './graphDocument';
import { getNativeMotionMaskRegion, inheritNativeMotionMaskRegions, setNativeMotionMaskRegion } from './nativeReactMotionMaskRegions';

function mask(editor: ReturnType<typeof createEditor>, name = 'Mask') {
  return editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name, isMask: true, maskType: 'ALPHA', width: 10, height: 10 });
}

function snapshot(editor: ReturnType<typeof createEditor>, name = 'Mask') {
  const root = mask(editor, name);
  editor.graph.createNode('RECTANGLE', root.id, { name: 'Mask child', width: 5, height: 5 });
  return { rootId: root.id, nodes: [structuredClone(root), ...root.childIds.map(id => structuredClone(editor.graph.getNode(id)!))] };
}

it('owns endpoint chains, clamps progress, and keeps motion metadata outside serialized graph data', () => {
  const editor = createEditor();
  try {
    const target = mask(editor, 'Sampled'), from = snapshot(editor, 'From'), to = snapshot(editor, 'To');
    const before = serializeGraph(editor.graph);
    setNativeMotionMaskRegion(editor.graph, target.id, [from], [to], .25);
    from.nodes[0]!.name = 'mutated caller';
    const first = getNativeMotionMaskRegion(editor.graph, target.id)!;
    expect(first.progress).toBe(.25);
    expect(first.from[0]!.nodes[0]!.name).toBe('From');
    (first.from[0]!.nodes[0] as SceneNode).name = 'mutated reader';
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.from[0]!.nodes[0]!.name).toBe('From');
    setNativeMotionMaskRegion(editor.graph, target.id, [], [to], 100);
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.progress).toBe(1);
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.from).toEqual([]);
    setNativeMotionMaskRegion(editor.graph, target.id, [from], [], -100);
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.progress).toBe(0);
    expect(serializeGraph(editor.graph)).toBe(before);
    expect(() => setNativeMotionMaskRegion(editor.graph, target.id, [from], [], Number.NaN)).toThrow(/finite/);
    expect(() => setNativeMotionMaskRegion(editor.graph, target.id, [from], [], 101)).toThrow(/finite/);
    expect(() => setNativeMotionMaskRegion(editor.graph, 'missing', [], [], .5)).toThrow(/sampled mask/);
    const ordinary = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Not a mask' });
    expect(() => setNativeMotionMaskRegion(editor.graph, ordinary.id, [], [], .5)).toThrow(/sampled mask/);
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.progress).toBe(0);
  } finally { editor.dispose(); }
});

it('rejects incomplete, duplicate, cyclic, unsupported, and repeated-root endpoint chains transactionally', () => {
  const editor = createEditor();
  try {
    const target = mask(editor, 'Sampled'), good = snapshot(editor, 'Good');
    setNativeMotionMaskRegion(editor.graph, target.id, [good], [], .4);
    const duplicate = structuredClone(good); duplicate.nodes.push(structuredClone(duplicate.nodes[0]!));
    const disconnected = structuredClone(good); disconnected.nodes.push({ ...structuredClone(disconnected.nodes[0]!), id: 'orphan', childIds: [], parentId: 'missing' });
    const cyclic = structuredClone(good); cyclic.nodes[1]!.childIds.push(cyclic.rootId); cyclic.nodes[0]!.parentId = cyclic.nodes[1]!.id;
    const unsupported = structuredClone(good); unsupported.nodes[0]!.maskType = 'LUMINANCE_ALPHA' as SceneNode['maskType'];
    for (const invalid of [duplicate, disconnected, cyclic, unsupported]) {
      expect(() => setNativeMotionMaskRegion(editor.graph, target.id, [invalid], [], .8)).toThrow();
      expect(getNativeMotionMaskRegion(editor.graph, target.id)!.progress).toBe(.4);
    }
    expect(() => setNativeMotionMaskRegion(editor.graph, target.id, [good, structuredClone(good)], [], .8)).toThrow(/repeat/);
    expect(getNativeMotionMaskRegion(editor.graph, target.id)!.progress).toBe(.4);
  } finally { editor.dispose(); }
});

it('inherits only still-valid mask targets and transactionally copies referenced image resources', () => {
  const source = createEditor(), target = createEditor();
  try {
    const sampled = mask(source), endpoint = snapshot(source);
    const fill = { type: 'IMAGE' as const, visible: true, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, imageHash: 'mask-region-image', imageScaleMode: 'FILL' as const };
    endpoint.nodes[0]!.fills = [structuredClone(fill)];
    endpoint.nodes[1]!.fillGeometry = [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([1, 2, 3]), fills: [structuredClone(fill)] }];
    endpoint.nodes[1]!.strokeGeometry = [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([4, 5]), fills: [structuredClone(fill)] }];
    endpoint.nodes[1]!.textDecorationFills = [structuredClone(fill)];
    endpoint.nodes[1]!.styleRuns = [{ start: 0, length: 1, style: { fills: [structuredClone(fill)] } }];
    source.graph.images.set('mask-region-image', new Uint8Array([3, 1, 4, 1, 5]));
    setNativeMotionMaskRegion(source.graph, sampled.id, [endpoint], [], .5);
    target.graph.nodes.set(sampled.id, structuredClone(sampled));
    inheritNativeMotionMaskRegions(source.graph, target.graph);
    expect(getNativeMotionMaskRegion(target.graph, sampled.id)?.progress).toBe(.5);
    expect(target.graph.images.get('mask-region-image')).toEqual(new Uint8Array([3, 1, 4, 1, 5]));
    expect(target.graph.images.get('mask-region-image')).not.toBe(source.graph.images.get('mask-region-image'));

    const missingSource = createEditor(), missingTarget = createEditor();
    try {
      const missingMask = mask(missingSource), missingSnapshot = snapshot(missingSource);
      missingSnapshot.nodes[1]!.fills = [structuredClone(fill), { ...structuredClone(fill), imageHash: 'absent-image' }];
      missingSource.graph.images.set('mask-region-image', new Uint8Array([9]));
      setNativeMotionMaskRegion(missingSource.graph, missingMask.id, [missingSnapshot], [], .5);
      missingTarget.graph.nodes.set(missingMask.id, structuredClone(missingMask));
      const before = new Map(missingTarget.graph.images);
      expect(() => inheritNativeMotionMaskRegions(missingSource.graph, missingTarget.graph)).toThrow(/absent-image/);
      expect(missingTarget.graph.images).toEqual(before);
      expect(getNativeMotionMaskRegion(missingTarget.graph, missingMask.id)).toBeUndefined();
    } finally { missingSource.dispose(); missingTarget.dispose(); }

    target.graph.getNode(sampled.id)!.isMask = false;
    const noLongerMask = createEditor();
    try {
      noLongerMask.graph.nodes.set(sampled.id, structuredClone(target.graph.getNode(sampled.id)!));
      inheritNativeMotionMaskRegions(source.graph, noLongerMask.graph);
      expect(getNativeMotionMaskRegion(noLongerMask.graph, sampled.id)).toBeUndefined();
    } finally { noLongerMask.dispose(); }
  } finally { source.dispose(); target.dispose(); }
});

it('enforces aggregate region and serialized-state budgets without replacing earlier entries', () => {
  const editor = createEditor();
  try {
    const first = mask(editor, 'First');
    setNativeMotionMaskRegion(editor.graph, first.id, [snapshot(editor, 'Endpoint')], [], .3);
    for (let i = 1; i < 128; i++) {
      const node = mask(editor, `Mask ${i}`);
      setNativeMotionMaskRegion(editor.graph, node.id, [], [], .2);
    }
    const overflow = mask(editor, 'Overflow');
    expect(() => setNativeMotionMaskRegion(editor.graph, overflow.id, [], [], .8)).toThrow(/128 regions/);
    expect(getNativeMotionMaskRegion(editor.graph, first.id)?.progress).toBe(.3);
    const huge = snapshot(editor, 'x'.repeat(4*1024*1024));
    expect(() => setNativeMotionMaskRegion(editor.graph, first.id, [huge], [], .8)).toThrow(/4 MB/);
    expect(getNativeMotionMaskRegion(editor.graph, first.id)?.progress).toBe(.3);
  } finally { editor.dispose(); }
});
