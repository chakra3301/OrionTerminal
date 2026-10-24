import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';

export type NativeMotionMaskSnapshot = { rootId: string; nodes: SceneNode[] };
export type NativeMotionRegionChain = NativeMotionMaskSnapshot[];
export type NativeMotionMaskRegion = { from: NativeMotionRegionChain; to: NativeMotionRegionChain; progress: number };

const regions = new WeakMap<SceneGraph, Map<string, NativeMotionMaskRegion>>();
const MASK_TYPES = new Set(['ALPHA', 'VECTOR', 'LUMINANCE']);
const MAX_REGIONS = 128;
const MAX_SNAPSHOTS = 256;
const MAX_DEPTH = 128;
const MAX_NODES = 20_000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;

function clone<T>(value: T): T {
  try { return structuredClone(value); }
  catch { throw new Error('Native mask-region state cannot be cloned.'); }
}

function imageHashes(snapshot: NativeMotionMaskSnapshot) {
  const hashes = new Set<string>();
  for (const node of snapshot.nodes) {
    const fills = [node.fills, node.textDecorationFills, ...node.fillGeometry.map(path => path.fills ?? []), ...node.strokeGeometry.map(path => path.fills ?? []), ...node.styleRuns.flatMap(run => [run.style.fills ?? [],run.style.textDecorationFills ?? []])].flat();
    for (const fill of fills) if (typeof fill.imageHash === 'string' && fill.imageHash) hashes.add(fill.imageHash);
  }
  return hashes;
}

function validateSnapshot(snapshot: NativeMotionMaskSnapshot) {
  if (!snapshot || typeof snapshot.rootId !== 'string' || !snapshot.rootId || !Array.isArray(snapshot.nodes) || !snapshot.nodes.length) throw new Error('A native mask-region snapshot needs a root and its complete layer tree.');
  if (snapshot.nodes.length > MAX_NODES) throw new Error(`A native mask-region snapshot exceeds ${MAX_NODES} nodes.`);
  const nodes = new Map<string, SceneNode>();
  for (const node of snapshot.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || nodes.has(node.id)) throw new Error('A native mask-region snapshot contains missing or duplicate layer IDs.');
    nodes.set(node.id, node);
  }
  const root = nodes.get(snapshot.rootId);
  if (!root || !root.isMask || !MASK_TYPES.has(root.maskType)) throw new Error('A native mask-region snapshot root must be an ALPHA, VECTOR, or LUMINANCE mask.');
  const parentCounts = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (!Array.isArray(node.childIds) || new Set(node.childIds).size !== node.childIds.length) throw new Error('A native mask-region snapshot contains repeated child references.');
    if (node !== root && !MASK_TYPES.has(node.maskType) && node.isMask) throw new Error('A native mask-region snapshot contains an unsupported nested mask type.');
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (!child || child.parentId !== node.id) throw new Error('A native mask-region snapshot has disconnected or inconsistent parent links.');
      parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
    }
  }
  for (const node of snapshot.nodes) if (node !== root && parentCounts.get(node.id) !== 1) throw new Error('A native mask-region snapshot contains disconnected or multiply-parented layers.');
  if (parentCounts.has(root.id)) throw new Error('A native mask-region snapshot root cannot be its own descendant.');
  const visited = new Set<string>(), stack = [{ id: root.id, depth: 0 }];
  while (stack.length) {
    const { id, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) throw new Error(`A native mask-region snapshot exceeds ${MAX_DEPTH} layer levels.`);
    if (visited.has(id)) throw new Error('A native mask-region snapshot contains a cycle.');
    visited.add(id);
    for (const childId of nodes.get(id)!.childIds) stack.push({ id: childId, depth: depth + 1 });
  }
  if (visited.size !== nodes.size) throw new Error('A native mask-region snapshot contains disconnected layers.');
}

function validateChain(chain: NativeMotionRegionChain) {
  if (!Array.isArray(chain)) throw new Error('A native mask-region chain must be an array.');
  const roots = new Set<string>();
  for (const snapshot of chain) {
    validateSnapshot(snapshot);
    if (roots.has(snapshot.rootId)) throw new Error('A native mask-region chain cannot repeat a mask root.');
    roots.add(snapshot.rootId);
  }
}

function bounded(entries: Map<string, NativeMotionMaskRegion>) {
  if (entries.size > MAX_REGIONS) throw new Error(`Native mask-region state exceeds ${MAX_REGIONS} regions.`);
  let snapshots = 0, nodes = 0;
  for (const state of entries.values()) for (const chain of [state.from, state.to]) for (const snapshot of chain) {
    snapshots++;
    nodes += snapshot.nodes.length;
  }
  if (snapshots > MAX_SNAPSHOTS) throw new Error(`Native mask-region state exceeds ${MAX_SNAPSHOTS} endpoint mask snapshots.`);
  if (nodes > MAX_NODES) throw new Error(`Native mask-region state exceeds ${MAX_NODES} total snapshot nodes.`);
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify([...entries])).byteLength; }
  catch { throw new Error('Native mask-region state is not serializable.'); }
  if (bytes > MAX_STATE_BYTES) throw new Error('Native mask-region state exceeds 4 MB.');
}

export function setNativeMotionMaskRegion(graph: SceneGraph, nodeId: string, from: NativeMotionRegionChain, to: NativeMotionRegionChain, progress: number) {
  if (!Number.isFinite(progress) || Math.abs(progress) > 100) throw new Error('Native mask-region progress must be finite and within -100 to 100.');
  if (!graph.getNode(nodeId)?.isMask) throw new Error('Native mask-region state must target a sampled mask node.');
  validateChain(from); validateChain(to);
  const previous = new Map(regions.get(graph));
  const proposed = new Map(previous); proposed.set(nodeId,{from,to,progress}); bounded(proposed);
  const nextFrom = clone(from), nextTo = clone(to);
  const next = previous;
  next.set(nodeId, { from: nextFrom, to: nextTo, progress: Math.max(0, Math.min(1, progress)) });
  bounded(next);
  regions.set(graph, next);
}

export function getNativeMotionMaskRegion(graph: SceneGraph, nodeId: string): Readonly<NativeMotionMaskRegion> | undefined {
  const state = regions.get(graph)?.get(nodeId);
  return state ? clone(state) : undefined;
}

export function inheritNativeMotionMaskRegions(source: SceneGraph, target: SceneGraph) {
  const entries = regions.get(source);
  if (!entries) return;
  const kept = new Map([...entries].filter(([id]) => target.getNode(id)?.isMask).map(([id, state]) => [id, clone(state)]));
  const required = new Set([...kept.values()].flatMap(state => [...state.from, ...state.to].flatMap(snapshot => [...imageHashes(snapshot)])));
  const missing = [...required].filter(hash => !target.images.has(hash) && !source.images.has(hash));
  if (missing.length) throw new Error(`Restore image resource ${missing[0]} used by native mask-region motion.`);
  const images = new Map(target.images);
  for (const hash of required) if (!images.has(hash)) images.set(hash, source.images.get(hash)!.slice());
  target.images = images;
  regions.set(target, kept);
}
