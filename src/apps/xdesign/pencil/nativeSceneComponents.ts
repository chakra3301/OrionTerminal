import { componentPropertyDefinitions, resolveComponentPropertyValue, setInstanceOverride, type ComponentPropertyDefinition, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { behaviourOwner, behaviourProperties, readBehaviour } from './behaviour/model';
import { mainSlotComponent } from './slots';

const prepared = new WeakMap<SceneGraph, WeakSet<SceneNode>>();
const propertyPrepared = new WeakMap<SceneGraph, WeakSet<SceneNode>>();
const fieldTypes: Record<string, string> = { TEXT: 'TEXT', VISIBLE: 'BOOLEAN', INSTANCE_SWAP: 'INSTANCE_SWAP', SLOT_CONTENT: 'SLOT' };
export const hasNativeSceneComponent = (graph: SceneGraph, node: SceneNode) => prepared.get(graph)?.has(node) ?? false;
export const hasNativeComponentProperties = (graph: SceneGraph, node: SceneNode) => propertyPrepared.get(graph)?.has(node) ?? false;

function validateTrees(graph: SceneGraph) {
  const heights = new Map<string, number>(), visiting = new Set<string>();
  const visit = (node: SceneNode, depth: number): number => {
    if (depth > 128 || visiting.has(node.id)) throw new Error('This component has a recursive or overly deep layer tree.');
    const cached = heights.get(node.id);
    if (cached !== undefined) return cached;
    if (new Set(node.childIds).size !== node.childIds.length) throw new Error('Restore this component’s missing, duplicated or misplaced layers before exporting.');
    visiting.add(node.id);
    let height = 0;
    for (const id of node.childIds) {
      const child = graph.getNode(id);
      if (!child || child.parentId !== node.id) throw new Error('Restore this component’s missing, duplicated or misplaced layers before exporting.');
      height = Math.max(height, visit(child, depth + 1) + 1);
    }
    if (height > 128) throw new Error('This component has a recursive or overly deep layer tree.');
    visiting.delete(node.id); heights.set(node.id, height);
    if (heights.size > 20_000) throw new Error('Component export supports at most 20,000 dependent layers.');
    return height;
  };
  for (const node of graph.nodes.values()) visit(node, 0);
}

function templateDefinitions(graph: SceneGraph, node: SceneNode) {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined;
  return [...(parent?.type === 'COMPONENT_SET' ? parent.componentPropertyDefinitions : []), ...node.componentPropertyDefinitions];
}

// Expanded references preserve source identity across swaps and custom slots;
// the SDK's positional target lookup can point into a different swapped subtree.
function propertyTargets(graph: SceneGraph, owner: SceneNode, definition: ComponentPropertyDefinition) {
  const targets: SceneNode[] = [];
  const visit = (node: SceneNode, depth: number) => {
    if (depth > 128) throw new Error('This component has an overly deep property tree.');
    if (node.componentPropertyReferences.some(ref => ref.propertyId === definition.id && fieldTypes[String(ref.field)] === definition.type)) targets.push(node);
    if (node.type === 'INSTANCE' && componentPropertyDefinitions(graph, node).some(def => def.id === definition.id)) return;
    for (const child of graph.getChildren(node.id)) visit(child, depth + 1);
  };
  for (const child of graph.getChildren(owner.id)) visit(child, 0);
  return targets;
}

/** Prepare only a private export graph. Unassigned realized overrides remain intact. */
export function prepareNativeSceneComponents(graph: SceneGraph, ids: readonly string[]) {
  validateTrees(graph);
  const ready = prepared.get(graph) ?? new WeakSet<SceneNode>();
  prepared.set(graph, ready);
  const propertyReady = propertyPrepared.get(graph) ?? new WeakSet<SceneNode>();
  propertyPrepared.set(graph, propertyReady);
  let count = 0;
  const visit = (node: SceneNode, inherited: Map<string, ComponentPropertyDefinition>, lineage: Set<string>, depth: number) => {
    if (depth > 128 || ++count > 20_000) throw new Error('Component export supports at most 20,000 layers and 128 nesting levels.');
    ready.delete(node);
    propertyReady.delete(node);
    const referencesReady = node.componentPropertyReferences.every(ref => {
      const type = fieldTypes[String(ref.field)];
      return !!type && inherited.get(ref.propertyId)?.type === type && (type !== 'TEXT' || node.type === 'TEXT') && (type !== 'INSTANCE_SWAP' || node.type === 'INSTANCE');
    });
    let definitions = inherited, nestedLineage = lineage, instanceReady = true, interactive = false;
    if (node.type === 'INSTANCE') {
      const main = mainSlotComponent(graph, node);
      const own = componentPropertyDefinitions(graph, node);
      instanceReady = !!main;
      const owner = main && behaviourOwner(graph, main), behaviour = owner && readBehaviour(owner);
      interactive = !!behaviour;
      const semanticBooleans = new Set<string>();
      if (owner && behaviour) {
        const all = behaviourProperties(graph, owner);
        for (const binding of Object.values(behaviour.booleans)) {
          const original = all.find(definition => definition.id === binding.propertyId);
          const definition = own.find(definition => definition.type === 'BOOLEAN' && (definition.id === original?.id || definition.name === original?.name));
          if (definition) semanticBooleans.add(definition.id);
        }
      }
      if (main) {
        if (lineage.has(main.id)) throw new Error('This component has a recursive instance dependency.');
        nestedLineage = new Set(lineage).add(main.id);
        const assignments = Object.entries(node.componentPropertyAssignments).map(([id, value]) => ({ definition: own.find(def => def.id === id), value }));
        assignments.sort((a, b) => Number(b.definition?.type === 'INSTANCE_SWAP') - Number(a.definition?.type === 'INSTANCE_SWAP'));
        for (const { definition, value } of assignments) {
          if (!definition) { instanceReady = false; continue; }
          if (definition.type === 'VARIANT' || String(definition.type) === 'SLOT') continue;
          if (definition.type === 'BOOLEAN' && !['true', 'false'].includes(value)) throw new Error(`Restore the boolean assigned to ${definition.name} before exporting.`);
          const target = definition.type === 'INSTANCE_SWAP' ? resolveComponentPropertyValue(graph, value) : null;
          if (definition.type === 'INSTANCE_SWAP' && !target) throw new Error(`Restore the component assigned to ${definition.name} before exporting.`);
          const targets = propertyTargets(graph, node, definition);
          // A behavior can consume a Boolean solely for accessibility or disabled state.
          if (!targets.length && !semanticBooleans.has(definition.id)) instanceReady = false;
          for (const child of targets) {
            if (target && child.type === 'INSTANCE') {
              if (child.componentId !== target.id) {
                const pending = [...target.childIds]; let added = 0;
                while (pending.length) { const descendant = graph.getNode(pending.pop()!)!; added++; pending.push(...descendant.childIds); }
                if (graph.nodes.size + added > 20_000) throw new Error('Export a smaller selection; this component swap exceeds 20,000 dependent layers.');
                graph.swapInstanceComponent(child.id, target.id);
              }
              setInstanceOverride(node.instanceOverrides, node.id, child.id, 'componentId', target.id);
            } else if (definition.type === 'TEXT' && child.type === 'TEXT') {
              graph.updateNode(child.id, { text: value });
              setInstanceOverride(node.instanceOverrides, node.id, child.id, 'text', value);
            } else if (definition.type === 'BOOLEAN') {
              graph.updateNode(child.id, { visible: value === 'true' });
              setInstanceOverride(node.instanceOverrides, node.id, child.id, 'visible', value === 'true');
            }
          }
        }
        definitions = new Map([...inherited, ...own.map(def => [def.id, def] as const)]);
      }
    } else if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      definitions = new Map([...inherited, ...templateDefinitions(graph, node).map(def => [def.id, def] as const)]);
    }
    if (instanceReady && referencesReady) { propertyReady.add(node); if (!interactive) ready.add(node); }
    for (const child of graph.getChildren(node.id)) visit(child, definitions, nestedLineage, depth + 1);
  };
  const selected = new Set(ids);
  for (const id of selected) {
    const root = graph.getNode(id);
    if (!root) throw new Error('A selected component is missing.');
    let ancestor = root.parentId, covered = false;
    const ancestry = new Set([id]);
    while (ancestor) {
      if (ancestry.has(ancestor) || ancestry.size > 128) throw new Error('This component has recursive or overly deep ancestry.');
      ancestry.add(ancestor);
      if (selected.has(ancestor)) covered = true;
      ancestor = graph.getNode(ancestor)?.parentId ?? null;
    }
    if (covered) continue;
    visit(root, new Map(), new Set(), 0);
  }
  validateTrees(graph);
}
