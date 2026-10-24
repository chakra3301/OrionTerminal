// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { createNativeReactMotionAppearance } from './nativeReactMotionAppearance';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });

const solid = (r: number, g: number, b: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
const shadow = (type: 'DROP_SHADOW' | 'INNER_SHADOW', color: { r: number; g: number; b: number; a: number }, radius: number) => ({ type, visible: true, color, radius, spread: 0, offset: { x: 2, y: 2 } });

it('tweens changed native stacks on one moving child and matches an independently authored midpoint', () => {
  const from = createEditor(), to = createEditor(), expected = createEditor();
  try {
    const make = (editor: ReturnType<typeof createEditor>, x: number, width: number, strokes: SceneNode['strokes'], effects: SceneNode['effects']) => {
      const root = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 96, height: 72, fills: [] });
      const group = editor.graph.createNode('FRAME', root.id, { x: 4, y: 4, width: 80, height: 56, fills: [] });
      const child = editor.graph.createNode('RECTANGLE', group.id, { name: 'One card', x, y: 12, width, height: 28, fills: [solid(.15, .45, .9)], strokes, effects });
      return { root, group, child };
    };
    const a = make(from, 8, 26,
      [{ visible: true, opacity: 1, color: { r: .9, g: .1, b: .1, a: 1 }, weight: 4, align: 'INSIDE' }],
      [shadow('DROP_SHADOW', { r: 0, g: 0, b: 0, a: .6 }, 6)]);
    const b = make(to, 34, 38,
      [
        { visible: true, opacity: 1, color: { r: .1, g: .2, b: .9, a: 1 }, weight: 4, align: 'INSIDE' },
        { visible: true, opacity: .8, color: { r: .1, g: .8, b: .3, a: 1 }, weight: 2, align: 'OUTSIDE' },
      ],
      [shadow('DROP_SHADOW', { r: 0, g: 0, b: 0, a: .3 }, 10), { type: 'LAYER_BLUR', visible: true, color: { r: 0, g: 0, b: 0, a: 1 }, radius: 4, spread: 0, offset: { x: 0, y: 0 } }]);
    const sample = createNativeReactMotionAppearance(a.child, b.child);
    expect(sample).toBeDefined();
    expect(a.group.childIds).toEqual([a.child.id]);
    a.child.x = 21; a.child.width = 32;
    const middle = sample!(.5);
    a.child.strokes = middle.strokes; a.child.effects = middle.effects;
    const midpoint = renderNativeSceneImage(kit, from.graph, a.root, true);
    const reference = make(expected, 21, 32,
      [
        { visible: true, opacity: 1, color: { r: .5, g: .15, b: .5, a: 1 }, weight: 4, align: 'INSIDE' },
        { visible: true, opacity: .4, color: { r: .1, g: .8, b: .3, a: .5 }, weight: 1, align: 'OUTSIDE' },
      ],
      [shadow('DROP_SHADOW', { r: 0, g: 0, b: 0, a: .45 }, 8), { type: 'LAYER_BLUR', visible: true, color: { r: 0, g: 0, b: 0, a: .5 }, radius: 2, spread: 0, offset: { x: 0, y: 0 } }]);
    expect(renderNativeSceneImage(kit, expected.graph, reference.root, true).bytes).toEqual(midpoint.bytes);
    expect(a.group.childIds).toHaveLength(1);
    expect(sample!(0).strokes).toHaveLength(1);
    expect(sample!(1).strokes).toHaveLength(2);
    expect(sample!(1).effects[1]!.type).toBe('LAYER_BLUR');
  } finally { from.dispose(); to.dispose(); expected.dispose(); }
});

it('fails closed for external backdrop blur and globally changed independent border styles', () => {
  const a = createEditor(), b = createEditor();
  try {
    const node = (editor: ReturnType<typeof createEditor>, extra: Record<string, unknown> = {}) => editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 20, height: 20, fills: [solid(.2, .3, .4)], ...extra });
    const source = node(a), backdrop = node(b, { effects: [{ type: 'BACKGROUND_BLUR', visible: true, color: { r: 0, g: 0, b: 0, a: 1 }, radius: 4, spread: 0, offset: { x: 0, y: 0 } }] });
    expect(createNativeReactMotionAppearance(source, backdrop)).toBeUndefined();
    const changedStyle = node(b, { strokeCap: 'ROUND' });
    expect(createNativeReactMotionAppearance(source, changedStyle)).toBeUndefined();
  } finally { a.dispose(); b.dispose(); }
});
