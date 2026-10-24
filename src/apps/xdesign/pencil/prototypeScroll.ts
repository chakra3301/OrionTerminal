import type { Editor } from '@open-pencil/core/editor';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { effectiveFigmaRawNodeFields } from '@open-pencil/fig';
import { PROTOTYPE_PLUGIN, setPrototypeMetadata } from './prototype';
import type { DesignNode, DesignScroll } from './reactExportRuntime';
export const PROTOTYPE_SCROLL = 'prototypeScroll', PROTOTYPE_SCROLL_BEHAVIOUR = 'prototypeScrollBehaviour';
export const scrollContainer = (node: SceneNode) => ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type);
const axes = ['none', 'horizontal', 'vertical', 'both'];
function parse(value: unknown): DesignScroll {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const data = value as DesignScroll;
  if (!axes.includes(data.axis)) throw new Error();
  if (data.initial !== undefined && (!data.initial || typeof data.initial !== 'object' || Array.isArray(data.initial) || !['x', 'y'].every(axis => typeof data.initial![axis as 'x' | 'y'] === 'number' && Number.isFinite(data.initial![axis as 'x' | 'y']) && Math.abs(data.initial![axis as 'x' | 'y']) <= 1000000))) throw new Error();
  return { axis: data.axis, ...(data.initial ? { initial: { x: data.initial.x, y: data.initial.y } } : {}) };
}
export function readPrototypeScroll(node: SceneNode): { settings: DesignScroll; issue?: string; imported?: boolean } {
  const own = node.pluginData.find(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_SCROLL), raw = effectiveFigmaRawNodeFields(node);
  try {
    if (own) { if (own.value.length > 1024) throw new Error(); return { settings: parse(JSON.parse(own.value)) }; }
    const settings = parse({ axis: String(raw.scrollDirection ?? 'NONE').toLowerCase(), ...(raw.scrollOffset !== undefined ? { initial: raw.scrollOffset } : {}) });
    return { settings, ...('scrollDirection' in raw || 'scrollOffset' in raw ? { imported: true } : {}) };
  } catch { return { settings: { axis: 'none' }, issue: own ? 'This frame has invalid scroll settings.' : 'Imported scrolling is preserved but cannot play yet.', ...(!own ? { imported: true } : {}) }; }
}
export function readScrollBehaviour(node: SceneNode, graph?: Pick<SceneGraph, 'getNode'>): { behaviour: NonNullable<DesignNode['scrollBehaviour']>; issue?: string } {
  const own = node.pluginData.find(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_SCROLL_BEHAVIOUR), raw = effectiveFigmaRawNodeFields(node);
  if (own) { if (['scroll', 'fixed', 'sticky'].includes(own.value)) return { behaviour: own.value as NonNullable<DesignNode['scrollBehaviour']> }; return { behaviour: 'scroll', issue: 'This layer has invalid scroll behavior.' }; }
  const types = { SCROLLS: 'scroll', FIXED_WHEN_CHILD_OF_SCROLLING_FRAME: 'fixed', STICKY_SCROLLS: 'sticky' } as const;
  if (raw.scrollBehavior !== undefined) {
    const behaviour = types[raw.scrollBehavior as keyof typeof types];
    if (!behaviour) return { behaviour: 'scroll', issue: 'Imported scroll behavior is preserved but cannot play yet.' };
    if (behaviour !== 'scroll') return { behaviour };
  }
  const parent = node.parentId && graph?.getNode(node.parentId), divider = parent && effectiveFigmaRawNodeFields(parent).fixedChildrenDivider;
  if (divider !== undefined && (typeof divider !== 'string' || !divider)) return { behaviour: 'scroll', issue: 'Imported fixed-layer ordering is preserved but cannot play yet.' };
  if (typeof divider === 'string' && divider) {
    if (typeof node.source.orderKey !== 'string') return { behaviour: 'scroll', issue: 'Imported fixed-layer ordering is preserved but cannot play yet.' };
    return { behaviour: node.source.orderKey! >= divider ? 'fixed' : 'scroll' };
  }
  return { behaviour: 'scroll' };
}
export function setPrototypeScroll(editor: Editor, node: SceneNode, settings: DesignScroll) {
  if (!scrollContainer(node)) throw new Error('Choose a frame or component to change scrolling.');
  let value: DesignScroll;
  try { value = parse(settings); } catch { throw new Error('Choose a valid scroll direction and starting offset.'); }
  setPrototypeMetadata(editor, node, PROTOTYPE_SCROLL, JSON.stringify(value));
}
export function setScrollBehaviour(editor: Editor, node: SceneNode, behaviour: NonNullable<DesignNode['scrollBehaviour']>) {
  if (!['scroll', 'fixed', 'sticky'].includes(behaviour)) throw new Error('Choose a valid scroll behavior.');
  const parent = node.parentId && editor.graph.getNode(node.parentId);
  if (!parent || !scrollContainer(parent)) throw new Error('Scroll positioning needs a frame or component parent.');
  setPrototypeMetadata(editor, node, PROTOTYPE_SCROLL_BEHAVIOUR, behaviour);
}
export function prototypeFrame(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node, result: SceneNode | undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id) && current.type !== 'CANVAS' && current.type !== 'SECTION') { seen.add(current.id); if (scrollContainer(current)) result = current; current = current.parentId ? graph.getNode(current.parentId) : undefined; }
  return result;
}
export function scrollTargets(graph: SceneGraph, node: SceneNode): SceneNode[] {
  const root = prototypeFrame(graph, node); if (!root) return [];
  const result: SceneNode[] = [], pending = [...graph.getChildren(root.id)].reverse(), seen = new Set<string>();
  while (pending.length) { const current = pending.pop()!; if (seen.has(current.id)) continue; seen.add(current.id); if (!current.visible || current.internalOnly || current.librarySource?.readOnly) continue; result.push(current); if (result.length > 20000) throw new Error('Scroll targets support at most 20,000 layers.'); pending.push(...graph.getChildren(current.id).reverse()); }
  return result;
}
