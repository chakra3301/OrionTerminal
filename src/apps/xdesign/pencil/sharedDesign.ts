import * as Y from 'yjs';
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { deserializeGraph, serializeGraph } from './graphDocument';
import { COMMENT_KEY, COMMENT_PLUGIN, allComments } from './comments';
import { childMap, patchFields, patchSharedComments, readSharedComments, sharedMap } from './sharedComments';
import { decodeSharedValue, encodeSharedValue } from './sharedValue';
import { installSharedIds } from './sharedIds';
import { siblingOrderKeys } from './sharedOrder';
import { resolveSharedTree, type SharedLayer } from './sharedTree';

const MAX_UPDATE_BYTES = 32 * 1024 * 1024;
const MAX_SHARED_NODES = 100_000;
const scopes = ['meta', 'nodes', 'images', 'variables', 'variableCollections', 'activeMode', 'enabledLibraries', 'comments'] as const;
const graphMaps = ['variables', 'variableCollections', 'activeMode', 'enabledLibraries'] as const;
const graphFields = ['figKiwiVersion', 'figSchemaDeflated', 'documentColorSpace'] as const;
const omitted = new Set(['parentId', 'childIds', 'textPicture']);
const treeKeys = new Set(['$parents', '$page', '$order', '$deleted']);
const types = new Set(['CANVAS', 'FRAME', 'RECTANGLE', 'ROUNDED_RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE', 'STAR', 'POLYGON', 'VECTOR', 'BOOLEAN_OPERATION', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'CONNECTOR', 'SHAPE_WITH_TEXT']);
const remoteOrigin = {};
export type SharedDesignChange = { graph: SceneGraph; update: Uint8Array; label: string | null; source: 'local' | 'remote' | 'undo' | 'redo'; changed: boolean };
export type SharedDesignAdmission = (graph: SceneGraph, checkpoint: Uint8Array) => void;

function nodeFields(node: SceneNode | undefined): Record<string, unknown> {
  if (!node) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) throw new Error('Reserved shared layer field.');
    if (!omitted.has(key)) result[key] = key === 'pluginData' && node.type === 'CANVAS' ? node.pluginData.filter(entry => entry.pluginId !== COMMENT_PLUGIN || entry.key !== COMMENT_KEY) : value;
  }
  return result;
}
function assertUpdate(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.byteLength < 2 || value.byteLength > MAX_UPDATE_BYTES) throw new Error('Invalid or oversized shared design update.');
}
function pageOf(graph: SceneGraph, id: string): string {
  let node = graph.getNode(id); const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    if (node.type === 'CANVAS') return node.id;
    seen.add(node.id); node = node.parentId ? graph.getNode(node.parentId) : undefined;
  }
  return graph.getPages()[0]?.id ?? '';
}
function readString(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) throw new Error('Invalid shared design identifier.');
  return value;
}
function project(doc: Y.Doc): SceneGraph {
  for (const scope of doc.share.keys()) if (!(scopes as readonly string[]).includes(scope)) throw new Error('Unsupported shared design scope.');
  const meta = doc.getMap('meta'), root = readString(meta.get('root')), home = readString(meta.get('home'));
  if (meta.get('format') !== 1) throw new Error('Unsupported shared design format.');
  for (const key of meta.keys()) if (!['root', 'home', 'format', ...graphFields].includes(key)) throw new Error('Unsupported shared document field.');
  const nodes = doc.getMap('nodes'); if (nodes.size > MAX_SHARED_NODES) throw new Error('Too many shared design records.');
  const graph = new SceneGraph(); graph.nodes.clear(); graph.rootId = root;
  const layers = new Map<string, SharedLayer>(), deletedPages = new Map<string, { node: SceneNode; layer: SharedLayer }>();
  for (const [id, value] of [...nodes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    readString(id, 128); const record = sharedMap(value), props: Record<string, unknown> = {};
    for (const [key, value] of [...record].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (treeKeys.has(key)) continue;
      if (omitted.has(key) || key.startsWith('$') || key.length > 128) throw new Error('Unsupported shared layer field.');
      Object.defineProperty(props, key, { value: decodeSharedValue(value), enumerable: true, writable: true, configurable: true });
    }
    if (props.id !== id || !types.has(String(props.type)) || ![props.x, props.y, props.width, props.height, props.rotation].every(value => typeof value === 'number' && Number.isFinite(value)) || typeof props.internalOnly !== 'boolean' || !Array.isArray(props.pluginData)) throw new Error('Invalid shared design layer.');
    const parents = new Map<string, number>();
    for (const [id, counter] of sharedMap(record.get('$parents'))) {
      readString(id, 128); if (!Number.isSafeInteger(counter) || (counter as number) < 0) throw new Error('Invalid shared layer placement.');
      parents.set(id, counter as number);
    }
    const order = readString(record.get('$order'), 4096), page = readString(record.get('$page'), 128);
    if (!/^[!-~]+$/.test(order) || typeof record.get('$deleted') !== 'boolean') throw new Error('Invalid shared layer order or deletion.');
    const node = { ...props, parentId: null, childIds: [], textPicture: null } as unknown as SceneNode, layer = { id, type: node.type, parents, order, page };
    if (record.get('$deleted')) {
      if (node.type === 'CANVAS' && !node.internalOnly) deletedPages.set(id, { node, layer });
    } else { graph.nodes.set(id, node); layers.set(id, layer); }
  }
  // Deleting different last pages offline must still leave a deterministic page
  // on reunion. The seed page stays recoverable as a tombstoned shared record.
  if (![...graph.getAllNodes()].some(node => node.type === 'CANVAS' && !node.internalOnly)) {
    const liveHome = graph.getNode(home), recovery = liveHome?.type === 'CANVAS' ? { node: liveHome, layer: layers.get(home)! } : deletedPages.get(home) ?? [...deletedPages].sort(([a], [b]) => a < b ? -1 : 1)[0]?.[1];
    if (recovery) recovery.node.internalOnly = false;
    if (recovery) { graph.nodes.set(recovery.node.id, recovery.node); layers.set(recovery.node.id, recovery.layer); }
  }
  if (graph.getNode(root)?.type !== 'FRAME' || !nodes.has(home)) throw new Error('Invalid shared design root or seed page.');
  const resolved = resolveSharedTree(layers, root, home);
  for (const [id, parent] of resolved) {
    const node = graph.getNode(id)!; node.parentId = parent; if (parent) graph.getNode(parent)!.childIds.push(id);
  }
  for (const node of graph.nodes.values()) node.childIds.sort((a, b) => {
    const keyA = layers.get(a)!.order, keyB = layers.get(b)!.order;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  for (const field of graphFields) (graph as unknown as Record<string, unknown>)[field] = decodeSharedValue(meta.get(field));
  if (!['srgb', 'display-p3'].includes(graph.documentColorSpace)) throw new Error('Invalid shared document color space.');
  for (const field of graphMaps) {
    const target = new Map<string, unknown>();
    for (const [key, value] of [...doc.getMap(field)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { readString(key); target.set(key, decodeSharedValue(value)); }
    (graph as unknown as Record<string, unknown>)[field] = target;
  }
  graph.images.clear();
  for (const [key, value] of [...doc.getMap('images')].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    readString(key); if (!(value instanceof Uint8Array) || value.byteLength > 16 * 1024 * 1024) throw new Error('Invalid shared image resource.');
    graph.images.set(key, new Uint8Array(value));
  }
  const page = graph.getPages()[0]; if (!page) throw new Error('The shared design has no visible page.');
  for (const collection of graph.variableCollections.values()) collection.variableIds = [...graph.variables.values()].filter(variable => variable.collectionId === collection.id).map(variable => variable.id).sort();
  readSharedComments(doc.getMap('comments'), graph, graph.getNode(home)?.type === 'CANVAS' && !graph.getNode(home)!.internalOnly ? home : page.id);
  return deserializeGraph(serializeGraph(graph), true);
}
function patchGraph(doc: Y.Doc, before: SceneGraph | null, after: SceneGraph): void {
  const nodes = doc.getMap('nodes'), meta = doc.getMap('meta');
  if (!before) { meta.set('format', 1); meta.set('root', after.rootId); meta.set('home', after.getPages()[0]?.id); }
  else if (before.rootId !== after.rootId) throw new Error('The shared document root cannot change.');
  let counter = 0;
  for (const record of nodes.values()) for (const placement of sharedMap(sharedMap(record).get('$parents')).values()) counter = Math.max(counter, placement as number);
  for (const id of before?.nodes.keys() ?? []) if (!after.nodes.has(id)) childMap(nodes, id).set('$deleted', true);
  for (const [id, node] of after.nodes) {
    const old = before?.getNode(id), record = childMap(nodes, id);
    if (old?.type === 'CANVAS' && node.type !== 'CANVAS') throw new Error('A shared page cannot change its layer type.');
    patchFields(record, nodeFields(old), nodeFields(node));
    if (!old) record.set('$deleted', false);
    const parents = childMap(record, '$parents');
    if (!old || old.parentId !== node.parentId) {
      if (node.parentId) parents.set(node.parentId, before ? ++counter : 0);
      if (before && !Number.isSafeInteger(counter)) throw new Error('The shared placement counter is exhausted.');
    }
    const page = pageOf(after, id);
    if (!old || pageOf(before!, id) !== page) record.set('$page', page);
    if (!record.has('$order')) record.set('$order', 'O');
  }
  let orderSequence = 0;
  for (const node of after.nodes.values()) {
    if (before && encodeSharedValue(before.getNode(node.id)?.childIds) === encodeSharedValue(node.childIds)) continue;
    const keys = siblingOrderKeys(node.childIds.map(id => before?.getNode(id)?.parentId === node.id ? childMap(nodes, id).get('$order') as string : undefined), { suffix: () => `${doc.clientID.toString(36)}.${++orderSequence}` });
    node.childIds.forEach((id, index) => { const record = childMap(nodes, id); if (record.get('$order') !== keys[index]) record.set('$order', keys[index]); });
  }
  for (const field of graphFields) {
    const value = encodeSharedValue(after[field]);
    if (!before || encodeSharedValue(before[field]) !== value) meta.set(field, value);
  }
  for (const field of graphMaps) {
    const target = doc.getMap(field), old = before?.[field] as Map<string, unknown> | undefined, next = after[field] as Map<string, unknown>;
    for (const key of old?.keys() ?? []) if (!next.has(key)) target.delete(key);
    for (const [key, value] of next) {
      const encoded = encodeSharedValue(value); if (!old?.has(key) || encodeSharedValue(old.get(key)) !== encoded) target.set(key, encoded);
    }
  }
  const images = doc.getMap('images');
  for (const key of before?.images.keys() ?? []) if (!after.images.has(key)) images.delete(key);
  for (const [key, bytes] of after.images) {
    const old = before?.images.get(key);
    if (!old || old.byteLength !== bytes.byteLength || bytes.some((byte, index) => byte !== old[index])) images.set(key, new Uint8Array(bytes));
  }
  patchSharedComments(doc.getMap('comments'), before, after);
}
function cloneDoc(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc({ gc: false }); scopes.forEach(scope => copy.getMap(scope));
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc)); copy.clientID = doc.clientID; return copy;
}

export class SharedDesign {
  private readonly doc: Y.Doc;
  private readonly origin = {};
  private readonly history: Y.UndoManager;
  private closed = false;
  private coalesceKey: string | undefined;
  private constructor(doc: Y.Doc) {
    this.doc = doc;
    this.history = new Y.UndoManager(scopes.map(scope => doc.getMap(scope)), { trackedOrigins: new Set([this.origin]), captureTimeout: Infinity });
  }
  static fromGraph(graph: SceneGraph): SharedDesign {
    const source = deserializeGraph(serializeGraph(graph), true); allComments(source);
    const doc = new Y.Doc({ gc: false }); scopes.forEach(scope => doc.getMap(scope));
    try { doc.transact(() => patchGraph(doc, null, source)); project(doc); assertUpdate(Y.encodeStateAsUpdate(doc)); return new SharedDesign(doc); }
    catch (error) { doc.destroy(); throw error; }
  }
  static fromUpdate(update: Uint8Array): SharedDesign {
    assertUpdate(update); const doc = new Y.Doc({ gc: false }); scopes.forEach(scope => doc.getMap(scope));
    try { Y.applyUpdate(doc, new Uint8Array(update), remoteOrigin); project(doc); return new SharedDesign(doc); }
    catch (error) { doc.destroy(); throw error; }
  }
  private assertOpen(): void { if (this.closed) throw new Error('This shared design session is closed.'); }
  get graph(): SceneGraph { this.assertOpen(); return project(this.doc); }
  get canUndo(): boolean { return !this.closed && this.history.canUndo(); }
  get canRedo(): boolean { return !this.closed && this.history.canRedo(); }
  get peerId(): number { this.assertOpen(); return this.doc.clientID; }
  historyKey(direction: 'undo' | 'redo'): string | undefined {
    this.assertOpen(); return (direction === 'undo' ? this.history.undoStack : this.history.redoStack).at(-1)?.meta.get('key') as string | undefined;
  }
  clearHistory(): void { this.assertOpen(); this.history.clear(); this.history.stopCapturing(); this.coalesceKey = undefined; }
  stateVector(): Uint8Array { this.assertOpen(); return Y.encodeStateVector(this.doc); }
  update(stateVector?: Uint8Array): Uint8Array {
    this.assertOpen(); if (stateVector && (!(stateVector instanceof Uint8Array) || stateVector.byteLength < 1 || stateVector.byteLength > 1024 * 1024)) throw new Error('Invalid shared design state vector.');
    const update = Y.encodeStateAsUpdate(this.doc, stateVector); assertUpdate(update); return update;
  }
  commit(before: SceneGraph, after: SceneGraph, label: string, admit?: SharedDesignAdmission, coalesceKey?: string): SharedDesignChange {
    this.assertOpen();
    if (!label.trim() || label.length > 256) throw new Error('Invalid shared edit label.');
    if (before.rootId !== this.doc.getMap('meta').get('root')) throw new Error('The edit belongs to a different shared design.');
    const source = deserializeGraph(serializeGraph(before), true), destination = deserializeGraph(serializeGraph(after), true), candidate = cloneDoc(this.doc), vector = this.stateVector();
    try {
      let changed = false; candidate.on('afterTransaction', (transaction: Y.Transaction) => { changed ||= transaction.changed.size > 0; });
      candidate.transact(() => patchGraph(candidate, source, destination));
      const graph = project(candidate), update = Y.encodeStateAsUpdate(candidate, vector); assertUpdate(update);
      if (admit) admit(graph, Y.encodeStateAsUpdate(candidate));
      if (!changed) {
        return { graph, update, label, source: 'local', changed };
      }
      const previous = this.history.undoStack.at(-1);
      if (!coalesceKey || coalesceKey !== this.coalesceKey) this.history.stopCapturing();
      this.doc.transact(() => Y.applyUpdate(this.doc, update), this.origin);
      this.coalesceKey = coalesceKey;
      const item = this.history.undoStack.at(-1);
      if (item) { if (item !== previous || coalesceKey) item.meta.set('label', label); item.meta.set('key', coalesceKey); }
      return { graph, update, label, source: 'local', changed };
    } finally { candidate.destroy(); }
  }
  edit(label: string, work: (draft: SceneGraph) => void, admit?: SharedDesignAdmission): SharedDesignChange {
    const before = this.graph, draft = deserializeGraph(serializeGraph(before), true), restoreIds = installSharedIds(draft, () => this.doc.clientID);
    try {
      const result: unknown = work(draft);
      if (result && typeof result === 'object' && 'then' in result) throw new Error('Shared graph edits must finish synchronously.');
      return this.commit(before, draft, label, admit);
    } finally { restoreIds(); }
  }
  receive(update: Uint8Array, admit?: SharedDesignAdmission): SharedDesignChange {
    this.assertOpen(); assertUpdate(update); const candidate = cloneDoc(this.doc), bytes = new Uint8Array(update);
    try {
      Y.applyUpdate(candidate, bytes, remoteOrigin); const graph = project(candidate), before = this.doc.getMap('meta'), after = candidate.getMap('meta');
      if (['root', 'home', 'format'].some(key => before.get(key) !== after.get(key))) throw new Error('The shared document identity cannot change.');
      for (const [id, value] of this.doc.getMap('nodes')) {
        const old = sharedMap(value), next = candidate.getMap('nodes').get(id);
        if (decodeSharedValue(old.get('type')) === 'CANVAS' && next && decodeSharedValue(sharedMap(next).get('type')) !== 'CANVAS') throw new Error('A shared page cannot change its layer type.');
      }
      if (admit) admit(graph, Y.encodeStateAsUpdate(candidate)); Y.applyUpdate(this.doc, bytes, remoteOrigin);
      return { graph, update: bytes, label: null, source: 'remote', changed: true };
    } finally { candidate.destroy(); }
  }
  private replay(direction: 'undo' | 'redo', admit?: SharedDesignAdmission, one = false): SharedDesignChange | null {
    this.assertOpen(); const stack = direction === 'undo' ? this.history.undoStack : this.history.redoStack, label = stack.at(-1)?.meta.get('label') as string | undefined;
    if (!stack.length) return null;
    const key = stack.at(-1)?.meta.get('key'), held = one ? stack.splice(0, stack.length - 1) : [], vector = this.stateVector();
    this.history.stopCapturing(); this.coalesceKey = undefined;
    let item: ReturnType<Y.UndoManager['undo']>;
    try { item = this.history[direction](); } finally { stack.unshift(...held); }
    if (!item) return one ? { graph: this.graph, update: this.update(vector), label: label ?? null, source: direction, changed: false } : null;
    try {
      const graph = this.graph; if (admit) admit(graph, this.update());
      const opposite = direction === 'undo' ? this.history.redoStack : this.history.undoStack;
      opposite.at(-1)?.meta.set('label', label); opposite.at(-1)?.meta.set('key', key);
      return { graph, update: this.update(vector), label: label ?? null, source: direction, changed: true };
    }
    catch (error) { this.history[direction === 'undo' ? 'redo' : 'undo'](); stack.at(-1)?.meta.set('label', label); stack.at(-1)?.meta.set('key', key); throw error; }
  }
  undo(admit?: SharedDesignAdmission): SharedDesignChange | null { return this.replay('undo', admit); }
  redo(admit?: SharedDesignAdmission): SharedDesignChange | null { return this.replay('redo', admit); }
  undoOne(admit?: SharedDesignAdmission): SharedDesignChange | null { return this.replay('undo', admit, true); }
  redoOne(admit?: SharedDesignAdmission): SharedDesignChange | null { return this.replay('redo', admit, true); }
  dispose(): void { if (this.closed) return; this.closed = true; this.history.destroy(); this.doc.destroy(); }
}
