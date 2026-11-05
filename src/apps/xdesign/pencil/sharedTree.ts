export type SharedLayer = { id: string; type: string; page: string; order: string; parents: Map<string, number> };
export function resolveSharedTree(layers: Map<string, SharedLayer>, root: string, home: string): Map<string, string | null> {
  const pages = [...layers.values()].filter(layer => layer.type === 'CANVAS').map(layer => layer.id).sort();
  const fallback = pages.includes(home) ? home : pages[0];
  if (!fallback || !layers.has(root)) throw new Error('The shared design has no root or page.');
  const candidates = new Map<string, { parent: string; counter: number }[]>(), choice = new Map<string, number>(), parents = new Map<string, string | null>();
  for (const layer of layers.values()) {
    if (layer.id === root) { parents.set(root, null); continue; }
    if (layer.type === 'CANVAS') { parents.set(layer.id, root); continue; }
    const edges = [...layer.parents].filter(([id]) => id !== root && id !== layer.id && layers.has(id)).map(([parent, counter]) => ({ parent, counter })).sort((a, b) => b.counter - a.counter || (a.parent < b.parent ? 1 : a.parent > b.parent ? -1 : 0));
    const page = pages.includes(layer.page) ? layer.page : fallback;
    edges.push({ parent: page, counter: -1 }); candidates.set(layer.id, edges); choice.set(layer.id, 0); parents.set(layer.id, edges[0]!.parent);
  }
  // A concurrent pair of individually valid moves can form a cycle. Drop the
  // greatest (move counter, layer ID) edge, then retry its previous placement.
  let retries = 0;
  const maxRetries = [...candidates.values()].reduce((sum, edges) => sum + edges.length, 0);
  while (true) {
    const settled = new Set<string>(); let loop: string[] | undefined;
    for (const id of [...layers.keys()].sort()) {
      const path: string[] = [], onPath = new Map<string, number>(); let cursor: string | null | undefined = id;
      while (cursor && !settled.has(cursor)) {
        const index = onPath.get(cursor);
        if (index !== undefined) { loop = path.slice(index); break; }
        onPath.set(cursor, path.length); path.push(cursor); cursor = parents.get(cursor);
      }
      path.forEach(id => settled.add(id)); if (loop) break;
    }
    if (!loop) return parents;
    if (++retries > maxRetries) throw new Error('The shared design hierarchy could not be resolved.');
    const latest = loop.reduce((a, b) => {
      const counterA = candidates.get(a)?.[choice.get(a) ?? 0]?.counter ?? -1, counterB = candidates.get(b)?.[choice.get(b) ?? 0]?.counter ?? -1;
      return counterB > counterA || counterA === counterB && b > a ? b : a;
    });
    const next = (choice.get(latest) ?? 0) + 1, edge = candidates.get(latest)?.[next];
    if (!edge) throw new Error('Invalid shared page hierarchy.');
    choice.set(latest, next); parents.set(latest, edge.parent);
  }
}
