import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';

type MotionMask = { from: SceneNode; to: SceneNode; progress: number };
const masks = new WeakMap<SceneGraph, Map<string, MotionMask>>();
const MASK_TYPES = new Set(['ALPHA', 'VECTOR', 'LUMINANCE']);
const MAX_MASKS = 128;
const MAX_STATE_BYTES = 4 * 1024 * 1024;

function serializedSize(entries: Map<string, MotionMask>) {
  try { return new TextEncoder().encode(JSON.stringify([...entries])).byteLength; }
  catch { throw new Error('Native mask motion state is not serializable.'); }
}

function imageHashes(node: SceneNode) {
  const fills = [
    ...node.fills,
    ...node.fillGeometry.flatMap(path => path.fills ?? []),
    ...node.strokeGeometry.flatMap(path => path.fills ?? []),
    ...node.styleRuns.flatMap(run => run.style.fills ?? []),
  ];
  return new Set(fills.flatMap(fill => fill.imageHash ? [fill.imageHash] : []));
}

export function setNativeMotionMask(graph: SceneGraph, nodeId: string, from: SceneNode, to: SceneNode, progress: number) {
  if (!Number.isFinite(progress) || Math.abs(progress) > 100) throw new Error('Native mask progress must be finite and within -100 to 100.');
  if (!graph.getNode(nodeId)?.isMask) throw new Error('Native mask motion must target a sampled mask node.');
  if (!from.isMask || !to.isMask || !MASK_TYPES.has(from.maskType) || !MASK_TYPES.has(to.maskType)) throw new Error('Native mask motion requires valid mask endpoints.');
  const next = new Map(masks.get(graph));
  next.set(nodeId, { from: structuredClone(from), to: structuredClone(to), progress: Math.max(0, Math.min(1, progress)) });
  if (next.size > MAX_MASKS) throw new Error('Native mask motion exceeds 128 masks.');
  if (serializedSize(next) > MAX_STATE_BYTES) throw new Error('Native mask motion exceeds 4 MB of endpoint state.');
  masks.set(graph, next);
}

export function getNativeMotionMask(graph: SceneGraph, nodeId: string): Readonly<MotionMask> | undefined {
  const state = masks.get(graph)?.get(nodeId);
  return state ? structuredClone(state) : undefined;
}

export function inheritNativeMotionMasks(source: SceneGraph, target: SceneGraph) {
  const entries = masks.get(source);
  if (!entries) return;
  const kept = new Map([...entries].filter(([id]) => target.getNode(id)).map(([id, state]) => [id, structuredClone(state)]));
  const required = new Set([...kept.values()].flatMap(state => [...imageHashes(state.from), ...imageHashes(state.to)]));
  const missing = [...required].filter(hash => !target.images.has(hash) && !source.images.has(hash));
  if (missing.length) throw new Error(`Restore image resource ${missing[0]} used by native mask motion.`);
  for (const hash of required) {
    if (target.images.has(hash)) continue;
    target.images.set(hash, source.images.get(hash)!.slice());
  }
  masks.set(target, kept);
}
