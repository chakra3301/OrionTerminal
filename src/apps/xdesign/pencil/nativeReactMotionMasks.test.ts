import { expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { serializeGraph } from './graphDocument';
import { getNativeMotionMask, inheritNativeMotionMasks, setNativeMotionMask } from './nativeReactMotionMasks';

function mask(editor: ReturnType<typeof createEditor>, name = 'Mask') {
  return editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name, isMask: true, maskType: 'ALPHA', width: 10, height: 10 });
}

it('keeps cloned endpoint snapshots outside serialized scene data and clamps bounded progress', () => {
  const editor = createEditor();
  try {
    const sampled = mask(editor, 'Sampled'), from = structuredClone(sampled), to = structuredClone(sampled);
    from.name = 'From'; to.name = 'To';
    const before = serializeGraph(editor.graph);
    setNativeMotionMask(editor.graph, sampled.id, from, to, 4);
    from.name = 'mutated caller'; to.x = 99;
    const first = getNativeMotionMask(editor.graph, sampled.id)!;
    expect(first.progress).toBe(1); expect(first.from.name).toBe('From'); expect(first.to.x).toBe(sampled.x);
    (first.from as SceneNode).name = 'mutated reader';
    expect(getNativeMotionMask(editor.graph, sampled.id)!.from.name).toBe('From');
    expect(serializeGraph(editor.graph)).toBe(before);
    expect(() => setNativeMotionMask(editor.graph, sampled.id, sampled, sampled, 101)).toThrow(/finite and within/);
    expect(() => setNativeMotionMask(editor.graph, sampled.id, sampled, sampled, Number.NaN)).toThrow(/finite and within/);
    expect(() => setNativeMotionMask(editor.graph, 'missing', sampled, sampled, .5)).toThrow(/sampled mask/);
  } finally { editor.dispose(); }
});

it('inherits only retained masks and copies only their referenced image bytes', () => {
  const source = createEditor(), target = createEditor();
  try {
    const sampled = mask(source), from = structuredClone(sampled), to = structuredClone(sampled);
    const bytes = new Uint8Array([4, 8, 15, 16, 23, 42]);
    from.fills = [{ type: 'IMAGE', visible: true, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, imageHash: 'mask-source-image', imageScaleMode: 'FILL' }];
    to.fills = structuredClone(from.fills);
    source.graph.images.set('mask-source-image', bytes);
    setNativeMotionMask(source.graph, sampled.id, from, to, .25);
    target.graph.nodes.set(sampled.id, structuredClone(sampled));
    const unrelated = mask(source, 'Not retained');
    setNativeMotionMask(source.graph, unrelated.id, unrelated, unrelated, .5);
    inheritNativeMotionMasks(source.graph, target.graph);
    expect(getNativeMotionMask(target.graph, sampled.id)?.progress).toBe(.25);
    expect(getNativeMotionMask(target.graph, unrelated.id)).toBeUndefined();
    expect(target.graph.images.get('mask-source-image')).toEqual(bytes);
    expect(target.graph.images.get('mask-source-image')).not.toBe(bytes);
  } finally { source.dispose(); target.dispose(); }
});

it('fails image inheritance before changing target resources when a required mask source is absent', () => {
  const source = createEditor(), target = createEditor();
  try {
    const sampled = mask(source), from = structuredClone(sampled);
    from.fills = [{ type: 'IMAGE', visible: true, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, imageHash: 'missing-mask-image', imageScaleMode: 'FILL' }];
    setNativeMotionMask(source.graph, sampled.id, from, from, .5);
    target.graph.nodes.set(sampled.id, structuredClone(sampled));
    const before = new Map(target.graph.images);
    expect(() => inheritNativeMotionMasks(source.graph, target.graph)).toThrow(/Restore image resource missing-mask-image/);
    expect(target.graph.images).toEqual(before);
    expect(getNativeMotionMask(target.graph, sampled.id)).toBeUndefined();
  } finally { source.dispose(); target.dispose(); }
});

it('enforces the 128-mask and 4 MB snapshot limits without replacing prior state', () => {
  const editor = createEditor();
  try {
    const first = mask(editor); setNativeMotionMask(editor.graph, first.id, first, first, .4);
    for (let index = 1; index < 128; index++) {
      const node = mask(editor, `Mask ${index}`); setNativeMotionMask(editor.graph, node.id, node, node, .4);
    }
    const overflow = mask(editor, 'Overflow');
    expect(() => setNativeMotionMask(editor.graph, overflow.id, overflow, overflow, .5)).toThrow(/128 masks/);
    expect(getNativeMotionMask(editor.graph, first.id)?.progress).toBe(.4);
    const huge = mask(editor, 'x'.repeat(2_100_000));
    expect(() => setNativeMotionMask(editor.graph, first.id, huge, huge, .5)).toThrow(/4 MB/);
    expect(getNativeMotionMask(editor.graph, first.id)?.progress).toBe(.4);
    expect(getNativeMotionMask(editor.graph, huge.id)).toBeUndefined();
  } finally { editor.dispose(); }
});
