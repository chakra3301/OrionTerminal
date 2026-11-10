import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { nativeSceneArtworkPlan, renderNativeReactLayer, renderNativeSceneRegion } from './nativeSceneArtwork';
import { readPrototypeScroll, readScrollBehaviour, scrollContainer } from './prototypeScroll';
import { hasNativeMotionComposite } from './nativeReactMotionComposite';

export type NativeReactCompositionPart =
  | { kind: 'native-layer' | 'scene' | 'scroll' | 'fixed' | 'sticky' | 'video'; nodeId: string }
  | { kind: 'scene-region'; nodeId: string; regionId: string; members: string[] };
export type NativeReactCompositionPlan = {
  mode: 'scene' | 'layers' | 'unsupported';
  issue?: string;
  order: NativeReactCompositionPart[];
  nativeLayerIds: string[];
  sceneRootIds: string[];
  coveredNodeIds: string[];
};

const visible = (node: SceneNode) => node.visible && !node.internalOnly;
const ownVisual = (node: SceneNode) => node.type === 'TEXT' || node.fills.some(fill => fill.visible) || node.strokes.some(stroke => stroke.visible) || node.effects.some(effect => effect.visible) || node.vectorNetwork !== null || node.fillGeometry.length > 0 || node.strokeGeometry.length > 0;
const video = (node: SceneNode) => node.fills.some(fill => fill.visible && fill.type === 'VIDEO');
type NativeReactPortalKind = 'scroll' | 'fixed' | 'sticky' | 'video';

function planError(issue: string): NativeReactCompositionPlan {
  return { mode: 'unsupported', issue, order: [], nativeLayerIds: [], sceneRootIds: [], coveredNodeIds: [] };
}

function subtreeIds(graph: SceneGraph, root: SceneNode): string[] {
  const result: string[] = [], pending = [{ node: root, depth: 0 }], seen = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 128 || seen.has(node.id)) throw new Error('Native React composition supports 128 layer levels without cycles.');
    seen.add(node.id); result.push(node.id); pending.push(...graph.getChildren(node.id).map(child => ({ node: child, depth: depth + 1 })));
    if (result.length > 20_000) throw new Error('Native React composition supports at most 20,000 layers.');
  }
  return result;
}

function childBranch(graph: SceneGraph, ancestor: SceneNode, node: SceneNode) {
  let current = node;
  const seen = new Set<string>();
  while (current.parentId && current.parentId !== ancestor.id) {
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    const parent = graph.getNode(current.parentId); if (!parent) return undefined;
    current = parent;
  }
  return current.parentId === ancestor.id ? current : undefined;
}

function maskedBranches(graph: SceneGraph, parent: SceneNode): Set<string> {
  const result = new Set<string>(); let active = false;
  for (const child of graph.getChildren(parent.id)) {
    if (visible(child) && child.isMask) { active = true; continue; }
    if (active) result.add(child.id);
  }
  return result;
}

function activeScrollAncestor(graph: SceneGraph, node: SceneNode) {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined;
  if (!parent || !scrollContainer(parent)) return undefined;
  const scroll = readPrototypeScroll(parent);
  return scroll.issue || scroll.settings.axis === 'none' ? undefined : parent;
}

function dynamicKinds(graph: SceneGraph, node: SceneNode): NativeReactPortalKind[] | 'unsupported' {
  const kinds: NativeReactPortalKind[] = [];
  if (video(node)) kinds.push('video');
  if (scrollContainer(node)) {
    const scroll = readPrototypeScroll(node);
    if (scroll.issue) return 'unsupported';
    if (scroll.settings.axis !== 'none') kinds.push('scroll');
  }
  const positioning = readScrollBehaviour(node, graph);
  if (positioning.issue) return 'unsupported';
  if (positioning.behaviour !== 'scroll' && activeScrollAncestor(graph, node)) kinds.push(positioning.behaviour);
  return kinds;
}

function validatePortal(graph: SceneGraph, root: SceneNode, node: SceneNode, kind: string): string | undefined {
  if (node.isMask) return `${node.name}: a live ${kind} surface cannot itself be a mask.`;
  if (kind === 'video') {
    const fills = node.fills.filter(fill => fill.visible), fill = fills[0];
    if (node.childIds.length || fills.length !== 1 || node.strokes.some(stroke => stroke.visible) || node.effects.some(effect => effect.visible) || node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH' || fill?.imageTransform || !['FILL', 'FIT'].includes(fill?.imageScaleMode ?? 'FILL')) return `${node.name}: keep live video on a leaf layer with one Fit or Fill paint and no strokes, effects, masks or blends.`;
  }
  let current: SceneNode | undefined = node;
  while (current) {
    if (current.effects.some(effect => effect.visible)) return `${current.name}: native effects cannot be split around a live ${kind} surface.`;
    if (!['NORMAL', 'PASS_THROUGH'].includes(current.blendMode)) return `${current.name}: layer blending cannot be split around a live ${kind} surface.`;
    if (current !== node) {
      const branch = childBranch(graph, current, node);
      if (branch && maskedBranches(graph, current).has(branch.id)) return `${current.name}: a live ${kind} surface crosses a native mask region.`;
      if (current.isMask) return `${current.name}: a live ${kind} surface cannot cross an ancestor mask.`;
    }
    if (current.id === root.id) break;
    current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }
  if (!current) return `${node.name}: the live ${kind} surface is disconnected from its selected scene root.`;
  return undefined;
}

function maskRuns(graph: SceneGraph, parent: SceneNode) {
  const children = graph.getChildren(parent.id), runs: { members: string[]; hasPaintedChildren: boolean }[] = [];
  for (let index = 0; index < children.length;) {
    const first = children[index]!;
    if (!visible(first) || !first.isMask) { index++; continue; }
    const members: string[] = [];
    while (index < children.length && visible(children[index]!) && children[index]!.isMask) members.push(children[index++]!.id);
    let hasPaintedChildren = false;
    while (index < children.length && !(visible(children[index]!) && children[index]!.isMask)) {
      const child = children[index++]!;
      members.push(child.id);
      hasPaintedChildren = true;
    }
    runs.push({ members, hasPaintedChildren });
  }
  return runs;
}

/** Describe an ordered native/DOM composition without flattening live scroll, fixed or video layers. */
export function planNativeReactComposition(graph: SceneGraph, root: SceneNode): NativeReactCompositionPlan {
  const all = subtreeIds(graph, root), ids = new Set(all), dynamic = new Map<string, NativeReactPortalKind[]>();
  const shown = new Set<string>(), pending = [root];
  while (pending.length) { const node = pending.pop()!; if (node !== root && !visible(node)) continue; shown.add(node.id); pending.push(...graph.getChildren(node.id)); }
  for (const id of all) {
    const node = graph.getNode(id)!;
    if (!shown.has(id) || !visible(node)) continue;
    const kinds = dynamicKinds(graph, node);
    if (kinds === 'unsupported') return planError(`${node.name}: imported scrolling or fixed-layer behavior cannot be rendered natively yet.`);
    if (kinds.length) dynamic.set(id, kinds);
  }
  if (!dynamic.size) {
    const scene = nativeSceneArtworkPlan(graph, root, true);
    return scene.issue ? planError(scene.issue) : { mode: 'scene', order: [{ kind: 'scene', nodeId: root.id }], nativeLayerIds: [], sceneRootIds: [root.id], coveredNodeIds: subtreeIds(graph, root).filter(id => id !== root.id) };
  }
  for (const id of shown) {
    const node = graph.getNode(id)!;
    if (node.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR') || !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode) || node.fills.some(fill => fill.visible && fill.blendMode && fill.blendMode !== 'NORMAL')) return planError(`${node.name}: its backdrop-dependent pixels require complete live scene composition.`);
  }
  for (const [id, kinds] of dynamic) for (const kind of kinds) {
    const issue = validatePortal(graph, root, graph.getNode(id)!, kind);
    if (issue) return planError(issue);
  }

  const portalDescendants = new Map<string, boolean>();
  for (const id of [...all].reverse()) {
    portalDescendants.set(id, dynamic.has(id) || graph.getChildren(id).some(child => portalDescendants.get(child.id)));
  }
  const covered = new Set<string>(), sceneRoots: string[] = [], nativeLayers: string[] = [], order: NativeReactCompositionPart[] = [];
  const cover = (id: string) => { for (const child of graph.getChildren(id)) for (const descendant of subtreeIds(graph, child)) covered.add(descendant); };
  const emitScene = (node: SceneNode) => {
    const plan = nativeSceneArtworkPlan(graph, node, !!node.childIds.length && node.effects.some(effect => effect.visible));
    if (plan.issue) throw new Error(`${node.name}: ${plan.issue}`);
    if (!plan.needed) return false;
    order.push({ kind: 'scene', nodeId: node.id }); sceneRoots.push(node.id); cover(node.id); return true;
  };
  const walk = (node: SceneNode, isRoot = false): string | undefined => {
    if (!visible(node)) return undefined;
    if (!isRoot && !portalDescendants.get(node.id) && emitScene(node)) return undefined;
    const kinds = dynamic.get(node.id) ?? [];
    if (kinds.includes('video')) { for (const kind of kinds) order.push({ kind, nodeId: node.id }); return undefined; }
    if ((ownVisual(node) || hasNativeMotionComposite(graph, node.id)) && !node.isMask) { nativeLayers.push(node.id); order.push({ kind: 'native-layer', nodeId: node.id }); }
    for (const kind of kinds) order.push({ kind, nodeId: node.id });
    const children = graph.getChildren(node.id);
    for (let index = 0; index < children.length;) {
      const child = children[index]!;
      if (visible(child) && child.isMask) {
        const run = maskRuns(graph, node).find(item => item.members[0] === child.id);
        if (!run) { index++; continue; }
        if (run.hasPaintedChildren) {
          if (run.members.some(member => portalDescendants.get(member))) return `${node.name}: native mask regions cannot be split around live scroll, fixed, sticky or video content.`;
          const regionId = run.members[0]!;
          order.push({ kind: 'scene-region', nodeId: node.id, regionId, members: [...run.members] });
          for (const member of run.members) covered.add(member);
        }
        index += run.members.length; continue;
      }
      const issue = walk(child);
      if (issue) return issue;
      index++;
    }
    return undefined;
  };
  try { const issue = walk(root, true); if (issue) return planError(issue); }
  catch (error) { return planError(error instanceof Error ? error.message : 'Native React composition could not classify this layer tree.'); }
  const orderedLayers = [...new Set(nativeLayers)].filter(id => ids.has(id) && !covered.has(id));
  return { mode: 'layers', order, nativeLayerIds: orderedLayers, sceneRootIds: sceneRoots, coveredNodeIds: [...covered] };
}

/** Render native images while leaving semantic portal nodes available to the runtime. */
export function renderNativeReactComposition(kit: import('canvaskit-wasm').CanvasKit, graph: SceneGraph, root: SceneNode) {
  const plan = planNativeReactComposition(graph, root);
  if (plan.mode === 'unsupported') throw new Error(plan.issue);
  const layers = plan.mode === 'layers' ? plan.nativeLayerIds.map(nodeId => renderNativeReactLayer(kit, graph, nodeId)) : [];
  const regions = plan.mode === 'layers' ? plan.order.flatMap(part => part.kind === 'scene-region' ? [renderNativeSceneRegion(kit, graph, part.nodeId, part.members)] : []) : [];
  return { plan, layers, regions };
}
