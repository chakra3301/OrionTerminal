import type { SceneGraph } from '@open-pencil/scene-graph';
import { allDesignActions } from './reactExportRuntime';
import { cloneDesignSubgraph } from './graphSubset';
import { prototypeResolver, readPrototype } from './prototype';

export function resolveNativeReactScreens(source: SceneGraph, rootId: string) {
  const roots = new Set([rootId]), pending = [rootId], examined = new Set<string>();
  const resolve = prototypeResolver(source);
  while (pending.length) {
    const id = pending.shift()!, node = source.getNode(id);
    if (!node || id !== rootId && (!node.visible || node.internalOnly)) throw new Error('Restore each visible destination before native React export.');
    const graph = cloneDesignSubgraph(source, [id]);
    for (const layer of graph.nodes.values()) {
      if (examined.has(layer.id)) continue;
      examined.add(layer.id);
      if (examined.size > 20_000) throw new Error('This prototype flow exceeds 20,000 dependent layers.');
      const prototype = readPrototype(layer, resolve);
      if (prototype.issue) throw new Error(`${layer.name}: ${prototype.issue}`);
      const links = prototype.interactions?.map(interaction => interaction.navigation) ?? (prototype.link ? [prototype.link] : []);
      for (const link of links) for (const action of allDesignActions(link)) {
        if (!['navigate', 'overlay', 'swap'].includes(action.action)) continue;
        if (action.unresolved || !action.target || !source.getNode(action.target)) throw new Error(`${layer.name}: Restore this flow's destination before native React export.`);
        if (!roots.has(action.target)) {
          if (roots.size >= 128) throw new Error('A native React flow supports at most 128 reachable screens.');
          roots.add(action.target); pending.push(action.target);
        }
      }
    }
  }
  return [...roots];
}
