import type { Editor } from '@open-pencil/core/editor';
import { parseOpenPencilClipboard } from '@open-pencil/core/clipboard';
import { capturePrototypeVariables } from './prototypeVariableGraph';
import { decodeBase64 } from '@open-pencil/core/bytes';
import { inflateSync } from 'fflate';
import { validPrototypeValue } from './prototypeValues';
import { mapDesignActions } from './reactExportRuntime';
import { effectiveFigmaRawNodeFields } from '@open-pencil/fig';
import { PROTOTYPE_SCROLL_BEHAVIOUR, readScrollBehaviour } from './prototypeScroll';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { PROTOTYPE_INTERACTIONS, PROTOTYPE_LINK, PROTOTYPE_PLUGIN, prototypeResolver, remapPrototypeActionVariables, readPrototype, type PrototypeResolver } from './prototype';

type Tree = SceneNode & { children?: Tree[] };
type Snapshot = NonNullable<Awaited<ReturnType<Editor['prepareCopy']>>['snapshot']>;

function descendants(roots: Tree[], graph?: SceneGraph): Tree[] {
  const result: Tree[] = [], seen = new Set<string>(), pending = roots.map(node => ({ node, depth: 0 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id); result.push(node);
    if (result.length > 20_000 || depth > 128) throw new Error('Copy or duplicate at most 20,000 dependent layers with nesting up to 128 levels.');
    pending.push(...(node.children ?? graph?.getChildren(node.id) ?? []).map(node => ({ node, depth: depth + 1 })));
  }
  return result;
}

function copiedPositioning(nodes: Tree[], graph?: SceneGraph): Map<string, string> {
  const byId = new Map(nodes.map(node => [node.id, node])), source = { getNode: (id: string) => byId.get(id) ?? graph?.getNode(id) };
  const result = new Map<string, string>();
  for (const node of nodes) {
    const parent = node.parentId && source.getNode(node.parentId);
    const native = 'scrollBehavior' in effectiveFigmaRawNodeFields(node) || parent && 'fixedChildrenDivider' in effectiveFigmaRawNodeFields(parent);
    if (!native) continue;
    const read = readScrollBehaviour(node, source);
    if (!read.issue) result.set(node.id, read.behaviour);
  }
  return result;
}
const positionData = (node: SceneNode, value: string) => [...node.pluginData.filter(entry => !(entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_SCROLL_BEHAVIOUR)), { pluginId: PROTOTYPE_PLUGIN, key: PROTOTYPE_SCROLL_BEHAVIOUR, value }];

export function normalizeClipboardPrototypes(graph: SceneGraph, snapshot: Snapshot): boolean {
  const nodes = descendants([...snapshot.nodes, ...snapshot.componentDependencies]);
  const resolve = prototypeResolver(graph, nodes);
  let hasPrototype = false;
  const positioning = copiedPositioning(nodes, graph);
  for (const node of nodes) {
    const { interactions } = readPrototype(node, resolve);
    if (positioning.has(node.id)) node.pluginData = positionData(node, positioning.get(node.id)!);
    if (interactions) node.pluginData = [...node.pluginData.filter(entry => !(entry.pluginId === PROTOTYPE_PLUGIN && [PROTOTYPE_LINK, PROTOTYPE_INTERACTIONS].includes(entry.key))), { pluginId: PROTOTYPE_PLUGIN, key: PROTOTYPE_INTERACTIONS, value: JSON.stringify(interactions) }];
    hasPrototype ||= positioning.has(node.id) || !!interactions || node.pluginData.some(entry => entry.pluginId === PROTOTYPE_PLUGIN && [PROTOTYPE_LINK, PROTOTYPE_INTERACTIONS].includes(entry.key));
  }
  const definitions = capturePrototypeVariables(graph, nodes), dependencies = snapshot.variableDependencies;
  const variables = new Map(dependencies.variables.map(variable => [variable.id, variable])), collections = new Map(dependencies.collections.map(collection => [collection.id, collection]));
  for (const variable of definitions.variables) variables.set(variable.id, structuredClone(graph.variables.get(variable.id)!));
  for (const collection of definitions.collections) collections.set(collection.id, structuredClone(graph.variableCollections.get(collection.id)!));
  snapshot.variableDependencies = { variables: [...variables.values()], collections: [...collections.values()], activeModes: [...new Map([...dependencies.activeModes, ...Object.entries(definitions.modes)])] };
  return hasPrototype || !!variables.size || !!collections.size;
}

function mapClones(graph: SceneGraph, roots: Tree[], copies: SceneNode[], sourceGraph?: SceneGraph): Map<string, string> {
  if (roots.length !== copies.length) throw new Error('The pasted screen structure could not be mapped.');
  const ids = new Map<string, string>(), pending = roots.map((source, index) => ({ source, copy: copies[index]! }));
  while (pending.length) {
    const { source, copy } = pending.pop()!;
    ids.set(source.id, copy.id);
    const before = source.children ?? sourceGraph?.getChildren(source.id) ?? [], after = graph.getChildren(copy.id);
    if (before.length !== after.length) throw new Error('The pasted screen structure could not be mapped.');
    pending.push(...before.map((source, index) => ({ source, copy: after[index]! })));
  }
  return ids;
}
function remap(editor: Editor, created: SceneNode[], ids: Map<string, string>, resolve: PrototypeResolver, allowExternal: boolean, positioning = new Map<string, string>(), variableMaps?: { variables: Map<string, string>; collections: Map<string, string>; modes: Map<string, string> }) {
  for (const [id, value] of positioning) {
    const copyId = ids.get(id), copy = copyId && editor.graph.getNode(copyId); if (!copy) continue;
    const pluginData = positionData(copy, value);
    if (JSON.stringify(pluginData) !== JSON.stringify(copy.pluginData)) editor.updateNodeWithUndo(copy.id, { pluginData }, 'Keep copied scroll positioning');
  }
  for (const node of created) {
    const { interactions } = readPrototype(node, resolve);
    if (!interactions) continue;
    const mapped = interactions.map(interaction => {
      return { ...interaction, navigation: mapDesignActions(interaction.navigation, link => { const target = link.target && ids.get(link.target); const reference = (id: string, kind: 'variables' | 'collections' | 'modes') => variableMaps?.[kind].get(id) ?? (allowExternal ? id : `missing:${id}`); return { ...remapPrototypeActionVariables(link, id => reference(id, 'variables'), id => reference(id, 'collections'), id => reference(id, 'modes')), ...(link.target ? { target: target ?? link.target, ...(!target && !allowExternal ? { unresolved: true } : {}) } : {}) }; }) };
    });
    const pluginData = [...node.pluginData.filter(entry => !(entry.pluginId === PROTOTYPE_PLUGIN && [PROTOTYPE_LINK, PROTOTYPE_INTERACTIONS].includes(entry.key))), { pluginId: PROTOTYPE_PLUGIN, key: PROTOTYPE_INTERACTIONS, value: JSON.stringify(mapped) }];
    if (JSON.stringify(pluginData) !== JSON.stringify(node.pluginData)) editor.updateNodeWithUndo(node.id, { pluginData }, 'Reconnect copied screens');
  }
}

/** Native clipboard entries own creation/deletion; only changed links add undo data. */
export function installPrototypeEditing(editor: Editor) {
  const prepareCopy = editor.prepareCopy, duplicate = editor.duplicateSelected, pasteSnapshot = editor.pasteSnapshot, pasteHTML = editor.pasteFromHTML;
  editor.prepareCopy = async (...args) => { const payload = await prepareCopy(...args); if (payload.snapshot) normalizeClipboardPrototypes(editor.graph, payload.snapshot); return payload; };
  editor.duplicateSelected = () => {
    const selected = editor.getSelectedNodes(), ids = new Set(selected.map(node => node.id));
    const roots = selected.filter(node => !node.parentId || !ids.has(node.parentId));
    const positioning = copiedPositioning(descendants(roots, editor.graph), editor.graph);
    const resolve = prototypeResolver(editor.graph), created: SceneNode[] = [];
    const remove = editor.graph.emitter.on('node:created', node => created.push(node));
    editor.undo.beginBatch('Duplicate');
    try { duplicate(); if (roots.length) remap(editor, created, mapClones(editor.graph, roots, editor.getSelectedNodes(), editor.graph), resolve, true, positioning); editor.undo.commitBatch(); }
    catch (error) { editor.undo.rollbackBatch(); throw error; }
    finally { remove(); }
  };
  const paste = async (roots: Tree[] | undefined, allowExternal: boolean, work: () => Promise<void>, dependencies?: Snapshot['variableDependencies']) => {
    const beforeVariables = new Set(editor.graph.variables.keys()), beforeCollections = new Set(editor.graph.variableCollections.keys());
    const sourceNodes = roots ? descendants(roots) : undefined, positioning = sourceNodes ? copiedPositioning(sourceNodes) : undefined;
    const resolve = sourceNodes && prototypeResolver(editor.graph, sourceNodes), created: SceneNode[] = [];
    const remove = editor.graph.emitter.on('node:created', node => created.push(node));
    editor.undo.beginBatch('Paste');
    try {
      await work();
      const ids = roots?.length ? mapClones(editor.graph, roots, editor.getSelectedNodes()) : new Map<string, string>(created.map(node => [node.id, node.id]));
      let variableMaps: { variables: Map<string, string>; collections: Map<string, string>; modes: Map<string, string> } | undefined;
      if (!allowExternal && dependencies) {
        const variables = [...editor.graph.variables.values()].filter(variable => !beforeVariables.has(variable.id)), collections = [...editor.graph.variableCollections.values()].filter(collection => !beforeCollections.has(collection.id));
        if (variables.length !== dependencies.variables.length || collections.length !== dependencies.collections.length) throw new Error('The pasted variable identities could not be mapped.');
        variableMaps = { variables: new Map(), collections: new Map(), modes: new Map() };
        for (const [index, source] of dependencies.variables.entries()) { const target = variables[index]!; if (target.name !== source.name || target.type !== source.type) throw new Error('The pasted variable identities could not be mapped.'); variableMaps.variables.set(source.id, target.id); }
        for (const [index, source] of dependencies.collections.entries()) { const target = collections[index]!; if (target.name !== source.name || target.modes.length !== source.modes.length) throw new Error('The pasted variable mode identities could not be mapped.'); variableMaps.collections.set(source.id, target.id); source.modes.forEach((mode, index) => { if (mode.name !== target.modes[index]!.name) throw new Error('The pasted variable mode identities could not be mapped.'); variableMaps!.modes.set(mode.modeId, target.modes[index]!.modeId); }); }
      }
      remap(editor, created, ids, resolve ?? prototypeResolver(editor.graph, created), allowExternal, positioning, variableMaps);
      editor.undo.commitBatch();
    } catch (error) { editor.undo.rollbackBatch(); throw error; }
    finally { remove(); }
  };
  editor.pasteSnapshot = (snapshot, ...args) => {
    descendants([...snapshot.nodes, ...snapshot.componentDependencies]);
    return paste(snapshot.nodes, snapshot.sourceRootId === editor.graph.rootId, () => pasteSnapshot(snapshot, ...args), snapshot.variableDependencies);
  };
  editor.pasteFromHTML = async (html, ...args) => {
    const own = parseOpenPencilClipboard(html), dependencies = readClipboardPrototypeVariables(html);
    if (own && dependencies) return editor.pasteSnapshot({ sourceRootId: '', nodes: own.nodes, images: own.images, componentDependencies: [], styleDefinitions: [], variableDependencies: dependencies }, ...args);
    return paste(own?.nodes, false, () => pasteHTML(html, ...args));
  };
  return () => { editor.prepareCopy = prepareCopy; editor.duplicateSelected = duplicate; editor.pasteSnapshot = pasteSnapshot; editor.pasteFromHTML = pasteHTML; };
}

export function readClipboardPrototypeVariables(html: string): Snapshot['variableDependencies'] | undefined {
  const match = html.match(/<!--\(xdesign-variables\)(.*?)\(\/xdesign-variables\)-->/s); if (!match) return;
  if (match[1]!.length > 2 * 1024 * 1024) throw new Error('This clipboard variable payload is too large.');
  const bytes = inflateSync(decodeBase64(match[1]!), { out: new Uint8Array(1024 * 1024 + 1) });
  if (bytes.byteLength > 1024 * 1024) throw new Error('This clipboard variable payload is too large.');
  const data = JSON.parse(new TextDecoder().decode(bytes)) as Snapshot['variableDependencies'];
  const id = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 256;
  if (!data || !Array.isArray(data.variables) || !Array.isArray(data.collections) || !Array.isArray(data.activeModes) || data.variables.length > 4096 || data.collections.length > 4096 || data.activeModes.length > 4096) throw new Error('This clipboard has invalid variable dependencies.');
  const variableIds = new Set<string>(), collectionIds = new Set<string>(), modes = new Set<string>();
  for (const collection of data.collections) {
    if (!collection || !id(collection.id) || collectionIds.has(collection.id) || typeof collection.name !== 'string' || collection.name.length > 4096 || !Array.isArray(collection.modes) || !collection.modes.length || collection.modes.length > 256 || !Array.isArray(collection.variableIds) || !collection.variableIds.every(id)) throw new Error('This clipboard has an invalid variable collection.');
    collectionIds.add(collection.id);
    for (const mode of collection.modes) { if (!mode || !id(mode.modeId) || modes.has(mode.modeId) || typeof mode.name !== 'string' || mode.name.length > 4096) throw new Error('This clipboard has an invalid variable mode.'); modes.add(mode.modeId); }
    if (!collection.modes.some(mode => mode.modeId === collection.defaultModeId)) throw new Error('This clipboard has an invalid default mode.');
  }
  for (const variable of data.variables) {
    if (!variable || !id(variable.id) || variableIds.has(variable.id) || !collectionIds.has(variable.collectionId) || typeof variable.name !== 'string' || variable.name.length > 4096 || !['COLOR', 'FLOAT', 'BOOLEAN', 'STRING'].includes(variable.type) || !variable.valuesByMode || typeof variable.valuesByMode !== 'object' || Array.isArray(variable.valuesByMode)) throw new Error('This clipboard has an invalid variable.');
    variableIds.add(variable.id);
    for (const [mode, value] of Object.entries(variable.valuesByMode)) if (!data.collections.find(collection => collection.id === variable.collectionId)!.modes.some(entry => entry.modeId === mode) || !(validPrototypeValue(value) || value && typeof value === 'object' && 'aliasId' in value && id(value.aliasId))) throw new Error('This clipboard has an invalid variable value.');
  }
  for (const entry of data.activeModes) if (!Array.isArray(entry) || entry.length !== 2 || !data.collections.find(collection => collection.id === entry[0])?.modes.some(mode => mode.modeId === entry[1])) throw new Error('This clipboard has an invalid active mode.');
  return data;
}
