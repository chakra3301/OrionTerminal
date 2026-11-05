import { SceneGraph } from '@open-pencil/scene-graph';

export function createNativeScratchGraph(reservedIds: Iterable<string>) {
  const graph = new SceneGraph(), document = graph.getNode(graph.rootId)!, page = graph.getPages()[0]!;
  const reserved = new Set(reservedIds);
  const privateId = (base: string) => {
    let id = base, suffix = 0;
    while (reserved.has(id)) id = `${base}:${++suffix}`;
    reserved.add(id); return id;
  };
  // Imported IDs can equal the SDK constructor's next document/page IDs.
  document.id = privateId('xdesign-native-document'); page.id = privateId('xdesign-native-page');
  document.childIds = [page.id]; page.parentId = document.id;
  graph.rootId = document.id; graph.nodes = new Map([[document.id, document], [page.id, page]]);
  graph.clearAbsPosCache(); return graph;
}
