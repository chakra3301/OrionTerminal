import type { DesignNode } from './reactExportRuntime';
export type SmartPair = { from?: DesignNode; to?: DesignNode; reason: 'match' | 'new' | 'removed' | 'shape' | 'shadow' | 'type' | 'metadata'; children: SmartPair[] };
function validate(root: DesignNode) {
  const seen = new Set<DesignNode>(); let count = 0;
  const visit = (node: DesignNode, depth: number) => { if (depth > 128 || ++count > 20000 || seen.has(node)) throw new Error('Smart Animate supports acyclic screens with at most 20,000 layers and 128 levels.'); seen.add(node); node.children.forEach(child => visit(child, depth + 1)); };
  visit(root, 0);
}
function siblings(nodes: DesignNode[]) {
  const occurrences = new Map<string, number>();
  return nodes.filter(node => node.visible).map(node => { const occurrence = occurrences.get(node.name) ?? 0; occurrences.set(node.name, occurrence + 1); return { node, key: JSON.stringify([node.name, occurrence]) }; });
}
export function smartLayerPairs(from: DesignNode, to: DesignNode): SmartPair {
  validate(from); validate(to);
  const pair = (from?: DesignNode, to?: DesignNode): SmartPair => {
    const reason: SmartPair['reason'] = !from ? 'new' : !to ? 'removed' : !from.motion || !to.motion ? 'metadata' : from.motion.type !== to.motion.type ? 'type' : from.motion.shadow || to.motion.shadow ? 'shadow' : from.motion.shape !== to.motion.shape ? 'shape' : 'match';
    if (reason !== 'match') return { from, to, reason, children: [] };
    const old = siblings(from!.children), next = siblings(to!.children), oldByKey = new Map(old.map(entry => [entry.key, entry.node])), keys = new Set(next.map(entry => entry.key));
    // Destination order is the paint order; duplicate names pair by sibling occurrence.
    return { from, to, reason, children: [...next.map(entry => pair(oldByKey.get(entry.key), entry.node)), ...old.filter(entry => !keys.has(entry.key)).map(entry => pair(entry.node))] };
  };
  return pair(from, to);
}
