import { componentPropertyDefinitions, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { behaviourOwner, behaviourProperties, missingBindings, readBehaviour, type Behaviour } from './behaviour/model';
import type { ComponentPropertyDefinition } from './behaviour/types';
import { behaviourContract } from './behaviour/kinds';
import { mainSlotComponent, slotPropertyId } from './slots';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import { reconcilePrototypeGeometry, snapshotPrototypeGeometry } from './prototypeGeometry';
import { resolveDesignControl, type DesignControl, type DesignControlSession, type DesignControlSnapshot, type DesignValue } from './reactExportRuntime';
import { nativeRangeGeometry, nativeThumbPosition } from './nativeControlGeometry';

type ControlConfig = Omit<DesignControl, 'variants'>;
export type NativeControlDescriptor = { config: ControlConfig; main: SceneNode; owner: SceneNode; behaviour: Behaviour; properties: Map<string, ComponentPropertyDefinition> };
export type PreparedNativeControl = NativeControlDescriptor & { key: string; snapshot: DesignControlSnapshot; values: Record<string, DesignValue>; selected: Set<number>; ratio: number; parts: Map<string, SceneNode> };
const prepared = new WeakMap<SceneGraph, Map<SceneNode, PreparedNativeControl>>();
const hosted = new WeakSet<SceneGraph>();
export const preparedNativeControl = (graph: SceneGraph, node: SceneNode) => prepared.get(graph)?.get(node);
export const hasNativeControlHost = (graph: SceneGraph, node: SceneNode) => hosted.has(graph) && !!preparedNativeControl(graph, node);
export const enableNativeControlHost = (graph: SceneGraph) => hosted.add(graph);

export function describeNativeControl(graph: SceneGraph, node: SceneNode): NativeControlDescriptor | undefined {
  const main = mainSlotComponent(graph, node), owner = main && behaviourOwner(graph, main), behaviour = owner && readBehaviour(owner);
  if (!main || !owner || !behaviour) return;
  const missing = missingBindings(graph, owner, behaviour);
  if (missing.length) throw new Error(`Complete ${owner.name}'s behavior bindings first: ${missing.join(', ')}.`);
  const properties = new Map(behaviourProperties(graph, owner).map(definition => [definition.id, definition]));
  const config: ControlConfig = { kind: behaviour.kind, defaults: {}, booleans: {}, numbers: structuredClone(behaviour.numbers), properties: { ...main.componentPropertyValues } };
  const valueFor = (id: string) => {
    const definition = properties.get(id)!;
    return definition.type === 'VARIANT' ? main.componentPropertyValues[definition.name] ?? definition.defaultValue : node.componentPropertyAssignments[id] ?? definition.defaultValue;
  };
  for (const [key, binding] of Object.entries(behaviour.booleans)) {
    const definition = properties.get(binding.propertyId)!;
    config.defaults[key] = definition.type === 'BOOLEAN' ? valueFor(binding.propertyId) === 'true' : valueFor(binding.propertyId) === binding.on;
    config.booleans[key] = { name: definition.name, on: binding.on, off: binding.off, variant: definition.type === 'VARIANT' };
  }
  for (const [key, binding] of Object.entries(behaviour.texts)) config.defaults[key] = valueFor(binding.propertyId);
  for (const [key, settings] of Object.entries(behaviour.numbers)) config.defaults[key] = settings.default;
  if (behaviour.states) { const { propertyId, ...states } = behaviour.states; config.states = { name: properties.get(propertyId)!.name, ...states }; }
  return { config, main, owner, behaviour, properties };
}

function correspondingDefinition(definitions: readonly ComponentPropertyDefinition[], original: ComponentPropertyDefinition) {
  const exact = definitions.find(definition => definition.id === original.id);
  if (exact?.type === original.type) return exact;
  const matches = definitions.filter(definition => definition.name === original.name && definition.type === original.type);
  if (matches.length > 1) throw new Error(`Give ${original.name} a unique component property before presenting this control.`);
  return matches[0];
}

function controlParts(graph: SceneGraph, node: SceneNode, descriptor: NativeControlDescriptor) {
  const definitions = componentPropertyDefinitions(graph, node) as ComponentPropertyDefinition[];
  const bindings = new Map(Object.entries(descriptor.behaviour.parts).map(([name, id]) => [correspondingDefinition(definitions, descriptor.properties.get(id)!)?.id, name]));
  const parts = new Map<string, SceneNode>();
  const visit = (child: SceneNode) => {
    const id = slotPropertyId(child), name = id && bindings.get(id);
    if (name) {
      if (parts.has(name)) throw new Error(`Bind one distinct ${name} part before presenting this control.`);
      parts.set(name, child);
    }
    if (child.type !== 'INSTANCE') graph.getChildren(child.id).forEach(visit);
  };
  graph.getChildren(node.id).forEach(visit);
  for (const part of behaviourContract(descriptor.config.kind as Behaviour['kind']).parts) if (part.required && !parts.has(part.id)) throw new Error(`Restore the ${part.id} part in this control variant before presenting.`);
  return parts;
}

function validateSession(session: DesignControlSession) {
  const entries = Object.entries(session);
  if (entries.length > 20_000) throw new Error('Presentation controls support at most 20,000 saved states.');
  let bytes = 0;
  for (const [key, snapshot] of entries) {
    if (key.length > 4096 || !snapshot || !['rest', 'hover', 'pressed', 'focus', 'disabled'].includes(snapshot.state)) throw new Error('Restore this control’s saved interaction state before presenting.');
    const value = snapshot.value;
    if (!(typeof value === 'boolean' || typeof value === 'string' && value.length <= 4096 || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.length <= 20_000 && value.every(item => Number.isSafeInteger(item) && item >= 0))) throw new Error('Restore this control’s saved value before presenting.');
    bytes += key.length * 2 + (typeof value === 'string' ? value.length * 2 : Array.isArray(value) ? value.length * 8 : 8);
    if (bytes > 4 * 1024 * 1024) throw new Error('Presentation control states exceed 4 MB.');
  }
}

/** Resolve a snapshot on a private graph; only an explicit publication host permits composition. */
export function prepareNativeSceneControls(graph: SceneGraph, ids: readonly string[], session: DesignControlSession, rootKeys: ReadonlyMap<string, string> = new Map()) {
  validateSession(session);
  prepareNativeSceneComponents(graph, ids);
  const entries = new Map<SceneNode, PreparedNativeControl>();
  prepared.set(graph, entries);
  let count = 0;
  const visit = (node: SceneNode, root: string, path: readonly (readonly [string, number])[], lineage: Set<string>, depth: number, inherited?: { value: boolean; disabled: boolean }) => {
    if (depth > 128 || ++count > 20_000) throw new Error('Presentation controls support at most 20,000 layers and 128 nesting levels.');
    let nextLineage = lineage, entry: PreparedNativeControl | undefined;
    if (node.type === 'INSTANCE') {
      const descriptor = describeNativeControl(graph, node);
      if (descriptor) {
        if (lineage.has(descriptor.owner.id)) throw new Error('A recursive interactive component cannot be presented.');
        nextLineage = new Set(lineage).add(descriptor.owner.id);
        const key = JSON.stringify([root, ...path]);
        if (key.length > 4096) throw new Error('This control’s identity exceeds 4,096 characters.');
        const saved = Object.hasOwn(session, key) ? session[key] : undefined;
        if (saved) {
          const kind = descriptor.config.kind, value = saved.value;
          const valid = ['radioGroup', 'toggleGroup', 'accordion', 'tabs'].includes(kind) ? Array.isArray(value)
            : ['checkbox', 'switch', 'toggle', 'radio', 'collapsible'].includes(kind) ? typeof value === 'boolean'
            : ['textField', 'textarea'].includes(kind) ? typeof value === 'string'
            : ['slider', 'progress', 'numberField'].includes(kind) ? (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value))
            : !Array.isArray(value);
          if (!valid) throw new Error(`Restore the saved value for this ${kind} before presenting.`);
        }
        let parts = controlParts(graph, node, descriptor);
        const items = graph.getChildren(parts.get(descriptor.config.kind === 'tabs' ? 'list' : 'items')?.id ?? '');
        const first = items.findIndex(child => child.visible && describeNativeControl(graph, child)?.config.defaults.disabled !== true);
        const resolved = resolveDesignControl(descriptor.config, inherited?.value ?? saved?.value, saved?.state, node.name, inherited?.disabled, first);
        const dynamic = new Set([...Object.values(descriptor.config.booleans).filter(binding => binding.variant).map(binding => binding.name), ...(descriptor.config.states ? [descriptor.config.states.name] : [])]);
        const candidates = descriptor.owner.type === 'COMPONENT_SET' ? graph.getChildren(descriptor.owner.id).filter(candidate => candidate.type === 'COMPONENT' && Object.entries(descriptor.config.properties).every(([key, value]) => dynamic.has(key) || candidate.componentPropertyValues[key] === value)) : [descriptor.main];
        if (candidates.length > 128) throw new Error('Present controls with at most 128 live variants.');
        const candidate = candidates.find(candidate => Object.entries(resolved.desired).every(([key, value]) => candidate.componentPropertyValues[key] === value)) ?? descriptor.main;
        if (candidate.id !== descriptor.main.id) {
          const pending = [...candidate.childIds]; let added = 0;
          while (pending.length) { const child = graph.getNode(pending.pop()!)!; added++; pending.push(...child.childIds); }
          if (graph.nodes.size + added > 20_000) throw new Error('Export a smaller selection; this control swap exceeds 20,000 dependent layers.');
          const definitions = componentPropertyDefinitions(graph, node) as ComponentPropertyDefinition[];
          const assignments = { ...node.componentPropertyAssignments }, name = node.name;
          graph.swapInstanceComponent(node.id, candidate.id);
          node.name = name;
          const replacements = componentPropertyDefinitions(graph, node) as ComponentPropertyDefinition[];
          node.componentPropertyAssignments = Object.fromEntries(Object.entries(assignments).map(([id, value]) => {
            const definition = definitions.find(definition => definition.id === id);
            return [definition ? correspondingDefinition(replacements, definition)?.id ?? id : id, value];
          }));
          parts = controlParts(graph, node, descriptor);
        }
        const definitions = componentPropertyDefinitions(graph, node) as ComponentPropertyDefinition[];
        for (const [key, binding] of Object.entries(descriptor.behaviour.booleans)) {
          const definition = correspondingDefinition(definitions, descriptor.properties.get(binding.propertyId)!);
          if (!definition) throw new Error(`Restore ${key}'s property in this control variant before presenting.`);
          if (definition.type === 'BOOLEAN') node.componentPropertyAssignments[definition.id] = String(!!resolved.values[key]);
        }
        for (const [key, binding] of Object.entries(descriptor.behaviour.texts)) {
          const definition = correspondingDefinition(definitions, descriptor.properties.get(binding.propertyId)!);
          if (!definition) throw new Error(`Restore ${key}'s property in this control variant before presenting.`);
          node.componentPropertyAssignments[definition.id] = String(resolved.values[key] ?? '');
        }
        prepareNativeSceneComponents(graph, [node.id]);
        const expected = ({ radioGroup: 'radio', toggleGroup: 'toggle', accordion: 'collapsible' } as Record<string, string>)[descriptor.config.kind];
        if (expected && graph.getChildren(parts.get('items')?.id ?? '').some(child => describeNativeControl(graph, child)?.config.kind !== expected)) throw new Error(`Each ${descriptor.config.kind} item must behave as ${expected}.`);
        entry = { ...descriptor, main: candidate, key, snapshot: { value: resolved.value, state: saved?.state ?? 'rest' }, values: resolved.values, selected: resolved.selected, ratio: resolved.ratio, parts };
        entries.set(node, entry);
      }
    }
    const walk = (parent: SceneNode, parentPath: readonly (readonly [string, number])[], parentDepth: number) => {
      const names = new Map<string, number>();
      graph.getChildren(parent.id).forEach((child, index) => {
        const occurrence = names.get(child.name) ?? 0; names.set(child.name, occurrence + 1);
        const childPath = [...parentPath, [child.name, occurrence] as const];
        const groupItems = entry && parent.id === entry.parts.get(entry.config.kind === 'tabs' ? 'list' : 'items')?.id;
        if (groupItems) visit(child, root, childPath, nextLineage, parentDepth + 1, { value: entry!.selected.has(index), disabled: entry!.values.disabled === true });
        else if (child.type === 'INSTANCE') visit(child, root, childPath, nextLineage, parentDepth + 1);
        else {
          if (parentDepth + 1 > 128 || ++count > 20_000) throw new Error('Presentation controls support at most 20,000 layers and 128 nesting levels.');
          walk(child, childPath, parentDepth + 1);
        }
      });
    };
    walk(node, path, depth);
  };
  const selected = new Set(ids);
  for (const id of selected) {
    const root = graph.getNode(id)!;
    let ancestor = root.parentId, covered = false;
    while (ancestor) { if (selected.has(ancestor)) covered = true; ancestor = graph.getNode(ancestor)?.parentId ?? null; }
    if (!covered) visit(root, rootKeys.get(id) ?? id, [], new Set(), 0);
  }
  prepareNativeSceneComponents(graph, ids);
  finishNativeSceneControls(graph);
  return entries;
}

/** Run again after native layout so semantic boxes and native paths share the final dimensions. */
export function finishNativeSceneControls(graph: SceneGraph) {
  const entries = prepared.get(graph);
  if (!entries) return;
  const originals = snapshotPrototypeGeometry(graph), explicit = new Map<string, Set<string>>();
  for (const entry of entries.values()) {
    const content = entry.parts.get('content');
    if (entry.config.kind === 'collapsible' && content && entry.values.open !== true) content.visible = false;
    const panels = entry.parts.get('panels');
    if (entry.config.kind === 'tabs' && panels) graph.getChildren(panels.id).forEach((child, index) => { if (!entry.selected.has(index)) child.visible = false; });
    const track = entry.parts.get('track'), thumb = entry.parts.get('thumb');
    if (entry.config.kind === 'slider' && track && thumb) {
      const position = nativeThumbPosition(graph, track, thumb, entry.ratio);
      thumb.x = position.x; thumb.y = position.y; explicit.set(thumb.id, new Set(['x', 'y']));
    }
    const range = entry.parts.get(entry.config.kind === 'progress' ? 'indicator' : 'range');
    if (['slider', 'progress'].includes(entry.config.kind) && track && range) {
      if (entry.config.kind === 'slider' || entry.config.kind === 'progress') {
        nativeRangeGeometry(graph, track, range, entry.ratio); explicit.set(range.id, new Set(['x', 'y', 'width']));
      } else { range.width = track.width * entry.ratio; explicit.set(range.id, new Set(['width'])); }
    }
  }
  reconcilePrototypeGeometry(graph, originals, explicit);
}
