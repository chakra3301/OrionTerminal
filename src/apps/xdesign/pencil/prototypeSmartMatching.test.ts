import { expect, it } from 'vitest';
import { smartLayerPairs } from './prototypeSmartMatching';
import type { DesignNode, DesignMotion } from './reactExportRuntime';
const metadata: DesignMotion = { version: 1, root: false, type: 'RECTANGLE', shape: 'rectangle', shadow: false, width: 100, height: 100, local: [1, 0, 0, 1, 0, 0], radii: [0, 0, 0, 0], paints: [] };
const layer = (name: string, children: DesignNode[] = [], motion = metadata): DesignNode => ({ id: crypto.randomUUID(), name, visible: true, style: {}, children, motion });
it('matches across independent identities and different screen names, retaining destination stacking and unique-name reorder', () => {
  const first = layer('Home', [layer('Status'), layer('Card'), layer('Button')]), second = layer('Details', [layer('Button'), layer('Card'), layer('Status')]), result = smartLayerPairs(first, second);
  expect(result.reason).toBe('match'); expect(result.children.map(pair => [pair.from?.name, pair.to?.name, pair.reason])).toEqual([['Button', 'Button', 'match'], ['Card', 'Card', 'match'], ['Status', 'Status', 'match']]);
  expect(result.children[0]?.from?.id).toBe(first.children[2]!.id); expect(result.children[0]?.to?.id).toBe(second.children[0]!.id);
});
it('pairs duplicate names by visible sibling order and handles Unicode and delimiter-containing names without key collisions', () => {
  const first = layer('A', [layer('カード/1'), layer('カード/1'), { ...layer('カード/1'), visible: false }, layer('a","0')]), second = layer('B', [layer('カード/1'), layer('a","0'), layer('カード/1')]);
  const pairs = smartLayerPairs(first, second).children; expect(pairs).toHaveLength(3); expect(pairs.map(pair => pair.from?.id)).toEqual([first.children[0]!.id, first.children[3]!.id, first.children[1]!.id]);
});
it('never matches same-named children across a renamed or missing parent hierarchy', () => {
  const first = layer('A', [layer('Old group', [layer('Item')]), layer('Stable', [layer('Item')])]), second = layer('B', [layer('New group', [layer('Item')]), layer('Stable', [layer('Item')])]);
  const pairs = smartLayerPairs(first, second).children; expect(pairs.map(pair => pair.reason)).toEqual(['new', 'match', 'removed']); expect(pairs[0]!.children).toEqual([]); expect(pairs[1]!.children[0]!.reason).toBe('match'); expect(pairs[2]!.children).toEqual([]);
});
it.each(['shape', 'shadow', 'type', 'metadata'] as const)('makes an unsupported %s subtree indivisible for dissolve fallback', reason => {
  const old = layer('Parent', [layer('Child')]), next = layer('Parent', [layer('Child')], reason === 'shape' ? { ...metadata, shape: 'changed geometry' } : reason === 'shadow' ? { ...metadata, shadow: true } : reason === 'type' ? { ...metadata, type: 'ELLIPSE' } : metadata); if (reason === 'metadata') delete next.motion;
  expect(smartLayerPairs(old, next)).toMatchObject({ reason, children: [] });
});
it('bounds entire input trees even when a root would dissolve, and rejects shared/cyclic and excessive nesting', () => {
  const cyclic = layer('Cycle'); cyclic.children.push(cyclic); expect(() => smartLayerPairs(cyclic, layer('Other'))).toThrow('acyclic');
  const repeated = layer('Repeated'), shared = layer('Shared', [repeated, repeated]); expect(() => smartLayerPairs(shared, layer('Other'))).toThrow('acyclic');
  const deep = layer('Root'); let node = deep; for (let i = 0; i < 129; i++) { const child = layer('Nested'); node.children.push(child); node = child; } expect(() => smartLayerPairs(deep, layer('Other'))).toThrow('128 levels');
  const large = layer('Large', Array.from({ length: 20000 }, () => layer('Item'))); expect(() => smartLayerPairs(large, layer('Other', [], { ...metadata, type: 'FRAME' }))).toThrow('20,000 layers');
});
