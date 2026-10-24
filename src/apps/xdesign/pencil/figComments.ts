import { parseFigBuffer } from '@open-pencil/fig';
import { getInstanceOverride, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { COMMENT_KEY, COMMENT_PLUGIN, allComments, commentTarget, readPageComments } from './comments';
import { encodeFigArchive } from './figArchive';

const MARKER = 'orion.xdesign.comment-export';
export function prepareFigComments(graph: SceneGraph): ((bytes: Uint8Array) => Uint8Array) | null {
  if (!allComments(graph).length) return null;
  const pages = graph.getPages().filter(page => readPageComments(page).length);
  const marked = new Set<string>();
  const targets = new Map<string, { root: SceneNode; path: SceneNode[] }>();
  const canonicalSource = (node: SceneNode): SceneNode => {
    const seen = new Set<string>(); let source = node;
    while (!seen.has(source.id) && seen.size < 64) {
      seen.add(source.id); let owner = source.parentId ? graph.getNode(source.parentId) : undefined;
      while (owner && owner.type !== 'INSTANCE') owner = owner.parentId ? graph.getNode(owner.parentId) : undefined;
      if (!owner) return source;
      const mapped = getInstanceOverride(owner.instanceOverrides, owner.id, source.id, 'sourceComponentId'), next = graph.getNode(typeof mapped === 'string' ? mapped : source.componentId ?? '');
      if (!next) break; source = next;
    }
    throw new Error('An instance comment path has no canonical component identity.');
  };
  const mark = (node: SceneNode) => { if (marked.has(node.id)) return; marked.add(node.id); graph.updateNode(node.id, { pluginData: [...node.pluginData.filter(entry => entry.pluginId !== MARKER), { pluginId: MARKER, key: 'id', value: node.id }] }); };
  for (const page of pages) { mark(page); for (const thread of readPageComments(page)) {
    const target = commentTarget(graph, thread.anchor); if (!target) continue;
    const ancestors: SceneNode[] = []; let current = target.parentId ? graph.getNode(target.parentId) : undefined;
    while (current) { if (current.type === 'INSTANCE') ancestors.unshift(current); current = current.parentId ? graph.getNode(current.parentId) : undefined; }
    if (!ancestors.length) { mark(target); targets.set(thread.id, { root: target, path: [] }); continue; }
    const root = ancestors[0]!, path: SceneNode[] = []; mark(root);
    for (const [index, child] of [...ancestors.slice(1), target].entries()) {
      const owner = ancestors[index]!, mapped = getInstanceOverride(owner.instanceOverrides, owner.id, child.id, 'sourceComponentId'), source = graph.getNode(typeof mapped === 'string' ? mapped : child.componentId ?? '');
      if (!source) throw new Error('An instance comment target has no portable component identity.');
      const canonical = canonicalSource(source); mark(canonical); path.push(canonical);
    }
    if (path.length > 64) throw new Error('Comment targets support at most 64 nested instances.');
    targets.set(thread.id, { root, path });
  } }
  return bytes => {
    const parsed = parseFigBuffer(bytes), records = new Map(parsed.nodeChanges.flatMap(record => (record.pluginData ?? []).filter(entry => entry.pluginID === MARKER && entry.key === 'id').map(entry => [entry.value, record] as const)));
    // Published 0.15.1 omits page plugin data; preserve finalized prototype data
    // while recovering page identity in its verified native export order.
    const canvases = parsed.nodeChanges.filter(record => record.type === 'CANVAS');
    for (const [index, page] of graph.getPages(true).entries()) {
      const canvas = canvases[index];
      if (!canvas || canvas.name !== page.name || !!canvas.internalOnly !== !!page.internalOnly) throw new Error('The exported comment page identities could not be mapped.');
      records.set(page.id, canvas);
      const entries = canvas.pluginData ?? [];
      canvas.pluginData = [...entries, ...page.pluginData.filter(entry => entry.pluginId !== MARKER && !entries.some(existing => existing.pluginID === entry.pluginId && existing.key === entry.key)).map(entry => ({ pluginID: entry.pluginId, key: entry.key, value: entry.value }))];
    }
    for (const page of pages) {
      const record = records.get(page.id); if (!record) throw new Error('A comment page could not be exported.');
      const threads = readPageComments(page).map(thread => {
        if (!thread.anchor.nodeId) return thread;
        const target = targets.get(thread.id), guid = target && records.get(target.root.id)?.guid;
        const { instancePath: _oldPath, ...anchor } = thread.anchor;
        if (target && !guid) throw new Error('A comment target could not be exported.');
        const path = target?.path.map(node => { const child = records.get(node.id)?.guid; if (!child) throw new Error('An instance comment path could not be exported.'); return `${child.sessionID}:${child.localID}`; });
        return { ...thread, anchor: { ...anchor, ...(guid ? { nodeId: `${guid.sessionID}:${guid.localID}`, format: 'fig' as const, ...(path?.length ? { instancePath: path } : {}) } : { format: 'missing' as const }) } };
      });
      record.pluginData = [...(record.pluginData ?? []).filter(entry => !(entry.pluginID === COMMENT_PLUGIN && entry.key === COMMENT_KEY)), { pluginID: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads }) }];
    }
    for (const record of parsed.nodeChanges) record.pluginData = record.pluginData?.filter(entry => entry.pluginID !== MARKER);
    return encodeFigArchive(parsed);
  };
}
