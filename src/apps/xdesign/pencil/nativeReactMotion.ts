import type { CanvasKit } from 'canvaskit-wasm';
import { SceneGraph, computeImageHash, getAxisAlignedWorldBounds, getNodeLocalMatrix, getWorldMatrix, type SceneNode } from '@open-pencil/scene-graph';
import type { DesignNode, DesignPoint } from './reactExportRuntime';
import type { NativeReactModel, NativeReactMotionEndpoint, NativeReactMotionInfo, NativeReactMotionRequest } from './nativeReactProtocol';
import { cloneDesignSubgraph } from './graphSubset';
import { renderNativeReactModel } from './nativeReactRenderer';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { videoResourceHashes } from './videoPaints';

type Pane = { key: string; graph: SceneGraph; rootId: string; model: NativeReactModel; position: DesignPoint; overlay: boolean };
type Endpoint = { graph: SceneGraph; rootId: string; models: NativeReactModel[]; aliases: Map<string, string>; scroll: Map<string, DesignPoint>; width: number; height: number };
const sameBytes = (a: Uint8Array, b: Uint8Array) => a === b || a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);

async function prepareEndpoint(kit: CanvasKit, source: SceneGraph, request: NativeReactMotionEndpoint, other: NativeReactMotionEndpoint, side: 'from' | 'to', matched: boolean): Promise<Endpoint> {
  const panes: Pane[] = [], aliases = new Map<string, string>(), scroll = new Map<string, DesignPoint>();
  const instances = [{ rootId: request.rootId, key: request.rootId, controlScope: undefined as string | undefined }, ...(request.overlays ?? []).map(overlay => ({ ...overlay, key: JSON.stringify(['overlay', overlay.controlScope, overlay.rootId]) }))];
  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index]!;
    let capture: { graph: SceneGraph; rootId: string } | undefined;
    const model = await renderNativeReactModel(kit, source, [instance.rootId], { session: request.session, controls: request.controls, controlScope: instance.controlScope, ...(index === 0 && request.rootSizes ? { rootSizes: request.rootSizes } : {}) }, (graph, ids) => { capture = { graph: cloneDesignSubgraph(graph, ids), rootId: ids[0]! }; });
    if (!capture) throw new Error('The native transition could not capture its prepared endpoint.');
    const settings = model.nodes[0]?.overlay, overlay = request.overlays?.[index - 1], base = panes[0]?.model;
    const position = !overlay || !base ? { x: 0, y: 0 } : settings?.position === 'manual' ? { x: overlay.origin.x + overlay.offset.x, y: overlay.origin.y + overlay.offset.y } : {
      x: settings?.position?.endsWith('left') ? 0 : settings?.position?.endsWith('right') ? base.width - model.width : (base.width - model.width) / 2,
      y: settings?.position?.startsWith('top') ? 0 : settings?.position?.startsWith('bottom') ? base.height - model.height : (base.height - model.height) / 2,
    };
    panes.push({ ...capture, key: instance.key, model, position, overlay: index > 0 });
  }
  const base = panes[0]!.model, graph = new SceneGraph(), page = graph.getPages()[0]!;
  graph.documentColorSpace = source.documentColorSpace;
  const root = graph.createNode('FRAME', page.id, { name: 'Native route', width: base.width, height: base.height, clipsContent: false, fills: [] });
  for (let index = 0; index < panes.length; index++) {
    const pane = panes[index]!, authored = pane.graph.getNode(pane.rootId)!, prefix = `native-motion/pane${index}/`;
    const imageNames = new Map<string, string>(), media = videoResourceHashes(pane.graph.nodes.values());
    for (const [hash, bytes] of pane.graph.images) {
      const name = media.has(hash) ? hash : computeImageHash(bytes), existing = graph.images.get(name);
      if (existing && !sameBytes(existing, bytes)) throw new Error('Restore this conflicting native motion image identity.');
      graph.images.set(name, bytes); imageNames.set(hash, name);
    }
    if ([...graph.images.values()].reduce((total, bytes) => total + bytes.byteLength, 0) > 24 * 1024 * 1024) throw new Error('This native transition exceeds 24 MB of embedded media.');
    const settings = pane.model.nodes[0]?.overlay;
    const container = pane.overlay ? graph.createNode('FRAME', root.id, { name: `Overlay ${index - 1}`, width: base.width, height: base.height, clipsContent: false, fills: settings?.background ? [{ type: 'SOLID', visible: true, opacity: 1, color: { ...settings.background } }] : [] }) : root;
    const copied = new Map<string, SceneNode>();
    const copy = (node: SceneNode, parentId: string, depth: number) => {
      if (depth > 128 || graph.nodes.size >= 20_000) throw new Error('Native route motion supports at most 20,000 layers and 128 levels.');
      const clone = structuredClone(node), id = prefix + node.id;
      clone.id = id; clone.parentId = parentId; clone.childIds = node.childIds.map(child => prefix + child);
      const paints = [clone.fills, ...clone.fillGeometry.map(path => path.fills ?? []), ...clone.strokeGeometry.map(path => path.fills ?? [])].flat();
      for (const fill of paints) if (fill.imageHash && imageNames.get(fill.imageHash) !== fill.imageHash) {
        if (fill.type === 'VIDEO') throw new Error('Restore this video’s conflicting native motion resource identity.');
        fill.imageHash = imageNames.get(fill.imageHash) ?? fill.imageHash;
      }
      graph.nodes.set(id, clone); copied.set(node.id, clone);
      for (const child of pane.graph.getChildren(node.id)) copy(child, id, depth + 1);
      return clone;
    };
    const selected = copy(authored, container.id, 0), otherRoot = index === 0 ? other.rootId : other.overlays?.[index - 1]?.rootId;
    selected.name = matched || instances[index]!.rootId === otherRoot ? 'Screen' : `${side} screen`; container.childIds.push(selected.id);
    const world = getWorldMatrix(authored, pane.graph), bounds = getAxisAlignedWorldBounds(authored, pane.graph), determinant = world[0]! * world[4]! - world[1]! * world[3]!;
    if (![...world, bounds.x, bounds.y, determinant].every(Number.isFinite) || Math.abs(Math.abs(determinant) - 1) > 1e-6 || Math.abs(world[0]! * world[1]! + world[3]! * world[4]!) > 1e-6) throw new Error('Native route motion needs finite rotation/reflection transforms without scale or skew.');
    selected.flipX = false; selected.flipY = determinant < 0;
    selected.rotation = Math.atan2(world[3]! / (selected.flipY ? -1 : 1), world[0]!) * 180 / Math.PI;
    const zero = getNodeLocalMatrix(selected, { x: 0, y: 0 });
    selected.x = world[2]! - bounds.x + pane.position.x - zero[2]!; selected.y = world[5]! - bounds.y + pane.position.y - zero[5]!;
    const visit = (node: DesignNode) => {
      const sourceId = node.sourceId && copied.has(node.sourceId) ? node.sourceId : node === pane.model.nodes[0] ? pane.rootId : undefined;
      if (sourceId) {
        const id = prefix + sourceId; aliases.set(node.id, id);
        if (node.scroll && node.scroll.axis !== 'none') scroll.set(id, { ...(request.scrollPositions?.[node.id] ?? node.scroll.initial ?? { x: 0, y: 0 }) });
      }
      node.children.forEach(visit); node.control?.variants.forEach(variant => visit(variant.tree));
    };
    pane.model.nodes.forEach(visit);
  }
  graph.clearAbsPosCache();
  return { graph, rootId: root.id, models: panes.map(pane => pane.model), aliases, scroll, width: base.width, height: base.height };
}

export async function prepareNativeReactMotion(kit: CanvasKit, source: SceneGraph, request: NativeReactMotionRequest) {
  const matched = request.link.transition === 'smart' || !!request.link.matchLayers;
  const from = await prepareEndpoint(kit, source, request.from, request.to, 'from', matched), to = await prepareEndpoint(kit, source, request.to, request.from, 'to', matched);
  if ([...from.models, ...to.models].reduce((total, model) => total + (model.byteLength ?? 0), 0) > 32 * 1024 * 1024) throw new Error('This native transition exceeds 32 MB of endpoint models.');
  const graph = createNativeReactMotionGraph(from.graph, from.rootId, to.graph, to.rootId, request.link), movements: NativeReactMotionInfo['movements'] = {}, scroll = new Map<string, { from?: DesignPoint; to?: DesignPoint }>();
  for (const [layerId, preparedId] of from.aliases) { const point = graph.movement(preparedId); if (point) movements[layerId] = point; }
  for (const [endpoint, side] of [[from, 'from'], [to, 'to']] as const) for (const [preparedId, point] of endpoint.scroll) {
    const sampledId = graph.sourceNodeId(preparedId); if (sampledId) scroll.set(sampledId, { ...scroll.get(sampledId), [side]: point });
  }
  const frame = async (progress: number) => {
    const scratch = graph.sample(progress);
    for (const node of scratch.nodes.values()) {
      node.pluginData = node.pluginData.filter(entry => entry.pluginId !== 'orion.xdesign' || !['prototypeLink', 'prototypeInteractions'].includes(entry.key));
      if (node.source.fig.rawNodeFields) for (const key of ['prototypeInteractions', 'transitionNodeID', 'transitionDuration', 'transitionType']) delete node.source.fig.rawNodeFields[key];
    }
    const model = await renderNativeReactModel(kit, scratch, [graph.rootId]);
    const positions: Record<string, DesignPoint> = {};
    const visit = (node: DesignNode) => {
      const points = node.sourceId && scroll.get(node.sourceId);
      if (points && node.scroll) {
        const start = points.from ?? points.to!, end = points.to ?? points.from!;
        positions[node.id] = { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
      }
      node.children.forEach(visit);
    };
    model.nodes.forEach(visit);
    return { ...model, scrollPositions: positions };
  };
  const motion: NativeReactMotionInfo = { sessionId: request.sessionId, matched: graph.matched, from: { width: from.width, height: from.height }, to: { width: to.width, height: to.height }, movements, movement: graph.movement(), initialModel: await frame(0) };
  return { motion, frame };
}
