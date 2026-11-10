import { parseFigBuffer } from '@open-pencil/fig';
import { importNodeChanges } from '@open-pencil/core/kiwi';
import { SceneGraph } from '@open-pencil/scene-graph';
import { prototypeGuid } from './prototype';

const fields = ['rootId', 'nodes', 'images', 'variables', 'variableCollections', 'activeMode', 'instanceIndex', 'figKiwiVersion', 'figSchemaDeflated', 'documentColorSpace', 'enabledLibraries'] as const;
export type FigGraphData = Pick<SceneGraph, typeof fields[number]>;
export const isFigMeta = (entry: { pluginId: string; key: string }) => entry.pluginId === 'open-pencil' && entry.key === 'figMeta';
export function importFigGraphData(buffer: ArrayBuffer): FigGraphData {
  const parsed = parseFigBuffer(buffer), graph = importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), { populate: 'all' });
  graph.figKiwiVersion = parsed.figKiwiVersion; graph.figSchemaDeflated = parsed.figSchemaDeflated;
  const records = new Map(parsed.nodeChanges.flatMap(node => node.guid ? [[prototypeGuid(node.guid)!, node] as const] : []));
  for (const node of graph.nodes.values()) {
    const source = node.source.id && records.get(node.source.id); if (!source) continue;
    // The pinned importer keeps modern layer interactions, but omits legacy
    // connections, flow markers, and all page prototype/plugin metadata.
    for (const [key, value] of Object.entries(source)) if (!(key in node.source.fig.rawNodeFields) && (key.startsWith('prototype') || key.startsWith('transition') || key.startsWith('overlay') || key.startsWith('scroll') || ['fixedChildrenDivider', 'connectionType', 'connectionURL', 'interactionType', 'interactionDuration', 'interactionMaintained', 'navigationType', 'destinationIsOverlay', 'easingType', 'easingFunction'].includes(key))) node.source.fig.rawNodeFields[key] = structuredClone(value);
    if (node.type === 'CANVAS') node.pluginData = (source.pluginData ?? []).map(entry => ({ pluginId: entry.pluginID, key: entry.key, value: entry.value }));
  }
  // Figma's meta.json carries the file name and canvas background; export writes it back.
  const root = graph.getNode(graph.rootId);
  if (root && parsed.metaJSON) root.pluginData = [...root.pluginData.filter(entry => !isFigMeta(entry)), { pluginId: 'open-pencil', key: 'figMeta', value: parsed.metaJSON }];
  return Object.fromEntries(fields.map(key => [key, graph[key]])) as FigGraphData;
}
export function restoreFigGraphData(data: FigGraphData): SceneGraph {
  const graph = new SceneGraph(); Object.assign(graph, data); return graph;
}
