import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { allDesignActions } from './reactExportRuntime';
import { prototypeActionVariableIds, prototypeResolver, readPrototype } from './prototype';
import { emptyPrototypeSession, prototypeVariableValue, type PrototypeSession, type PrototypeVariables } from './prototypeValues';
import { reconcilePrototypeGeometry, snapshotPrototypeGeometry } from './prototypeGeometry';
export function capturePrototypeVariables(graph: SceneGraph, nodes: Iterable<SceneNode> = graph.nodes.values()): PrototypeVariables {
  const ids = new Set<string>(), collections = new Set<string>(), resolve = prototypeResolver(graph);
  for (const node of nodes) {
    Object.values(node.boundVariables).forEach(id => ids.add(id)); Object.keys(node.variableModes).forEach(id => collections.add(id));
    for (const interaction of readPrototype(node, resolve).interactions ?? []) for (const action of allDesignActions(interaction.navigation)) {
      prototypeActionVariableIds(action).forEach(id => ids.add(id)); if (action.collection) collections.add(action.collection);
    }
  }
  const pending = [...ids], variables: PrototypeVariables['variables'] = [];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id);
    if (visited.size > 4096) throw new Error('A prototype supports at most 4,096 dependent variables.');
    const variable = graph.variables.get(id); if (!variable) continue;
    variables.push({ id: variable.id, name: variable.name, type: variable.type, collectionId: variable.collectionId, valuesByMode: structuredClone(variable.valuesByMode) }); collections.add(variable.collectionId);
    for (const value of Object.values(variable.valuesByMode)) if (value && typeof value === 'object' && 'aliasId' in value) pending.push(value.aliasId);
  }
  const result = { variables, collections: [...collections].flatMap(id => { const collection = graph.variableCollections.get(id); return collection ? [{ id: collection.id, name: collection.name, defaultModeId: collection.defaultModeId, modes: structuredClone(collection.modes) }] : []; }), modes: Object.fromEntries([...graph.activeMode].filter(([id]) => collections.has(id))) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) throw new Error('These prototype variable definitions exceed 1 MB.');
  return result;
}
export function prototypeNodeModes(graph: SceneGraph, node: SceneNode): Record<string, string> {
  const modes: Record<string, string> = {}, seen = new Set<string>(); let current: SceneNode | undefined = node;
  while (current) {
    if (seen.has(current.id) || seen.size >= 128) throw new Error('This variable binding has invalid ancestry.'); seen.add(current.id);
    for (const [id, mode] of Object.entries(current.variableModes)) if (!Object.hasOwn(modes, id)) modes[id] = mode;
    current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }
  return modes;
}
export const prototypeNumberFields = new Set(['opacity', 'width', 'height', 'cornerRadius', 'fontSize', 'letterSpacing', 'lineHeight', 'itemSpacing', 'strokeWeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'counterAxisSpacing', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'rotation', 'x', 'y', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight', 'gridRowGap', 'gridColumnGap']);
const nonnegative = new Set(['width', 'height', 'cornerRadius', 'lineHeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'strokeWeight', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight', 'gridRowGap', 'gridColumnGap']);
const corners = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
const borders = ['borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight'] as const;
/** Apply only to an isolated model graph; saved definitions and layer bindings stay intact. */
export function materializePrototypeBindings(graph: SceneGraph, definitions: PrototypeVariables, session: PrototypeSession = emptyPrototypeSession(), options: { detachResolved?: boolean } = {}) {
  const originals = snapshotPrototypeGeometry(graph), explicit = new Map<string, Set<string>>();
  for (const node of graph.nodes.values()) {
    const independentCorners = node.independentCorners, independentBorders = node.independentStrokeWeights;
    const modes = prototypeNodeModes(graph, node);
    for (const [field, id] of Object.entries(node.boundVariables)) {
      const value = prototypeVariableValue(definitions, session, id, modes), paint = /^(fills|strokes)\/(\d+)\/color$/.exec(field);
      let resolved = false;
      if (paint && typeof value === 'object') {
        const paints = node[paint[1] as 'fills' | 'strokes']; const index = Number(paint[2]);
        if (!paints[index]) throw new Error(`${node.name}: this variable refers to an unavailable paint.`);
        paints[index] = { ...paints[index]!, color: { ...value } }; resolved = true;
      } else if (prototypeNumberFields.has(field) && typeof value === 'number') {
        if (!Number.isFinite(value) || field === 'opacity' && (value < 0 || value > 1) || field === 'fontSize' && value <= 0 || nonnegative.has(field) && value < 0) throw new Error(`${node.name}: this variable produces invalid ${field}.`);
        if (field === 'strokeWeight') node.strokes = node.strokes.map(stroke => ({ ...stroke, weight: value }));
        else Object.assign(node, { [field]: value });
        resolved = true;
      } else if (field === 'visible' && typeof value === 'boolean' || field === 'fontFamily' && typeof value === 'string') { Object.assign(node, { [field]: value }); resolved = true; }
      else if (paint || prototypeNumberFields.has(field) || ['visible', 'fontFamily'].includes(field)) throw new Error(`${node.name}: the ${field} binding has the wrong variable type.`);
      if (resolved && node.type === 'TEXT') node.textPicture = null;
      if (resolved) { const fields = explicit.get(node.id) ?? new Set<string>(); fields.add(field); explicit.set(node.id, fields); }
      // Native color resolution would otherwise read saved definitions over this session's values.
      if (resolved && options.detachResolved) delete node.boundVariables[field];
    }
    const fields = explicit.get(node.id);
    if (corners.some(field => fields?.has(field))) {
      if (!independentCorners || fields?.has('cornerRadius')) for (const field of corners) if (!fields?.has(field)) node[field] = node.cornerRadius;
      node.independentCorners = true;
    } else if (fields?.has('cornerRadius')) node.independentCorners = false;
    if (borders.some(field => fields?.has(field))) {
      if (!independentBorders || fields?.has('strokeWeight')) for (const field of borders) if (!fields?.has(field)) node[field] = node.strokes[0]?.weight ?? 0;
      node.independentStrokeWeights = true;
    } else if (fields?.has('strokeWeight') && independentBorders) for (const field of borders) node[field] = node.strokes[0]?.weight ?? 0;
  }
  for (const node of graph.nodes.values()) for (const axis of ['Width', 'Height']) {
    const min = node[`min${axis}` as 'minWidth' | 'minHeight'], max = node[`max${axis}` as 'maxWidth' | 'maxHeight'];
    if (min !== null && max !== null && min > max && (explicit.get(node.id)?.has(`min${axis}`) || explicit.get(node.id)?.has(`max${axis}`))) throw new Error(`${node.name}: this variable produces conflicting size limits.`);
  }
  reconcilePrototypeGeometry(graph, originals, explicit);
}
