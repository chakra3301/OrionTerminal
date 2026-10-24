import {
  type SceneGraph,
  createInstanceOverrideState,
  getNodeLocalMatrix,
  getWorldMatrix,
  generateId,
  geometryCommandCoordCount,
  type Fill,
  type SceneNode,
} from '@open-pencil/scene-graph';
import { scaledGeometryChanges } from '@open-pencil/scene-graph/resize';
import type { DesignNavigation } from './reactExportRuntime';
import { nativeAppearance, validNativeAppearance } from './prototypeNativeAppearance';
import { createNativeReactMotionAppearance } from './nativeReactMotionAppearance';
import { nativeMotionCompositeEligible, setNativeMotionComposite } from './nativeReactMotionComposite';
import { smartRgbaAt } from './prototypeSmartColor';
import { smartInverse, smartMultiply, type SmartMatrix } from './prototypeSmartGeometry';
import { readPrototypeScroll, readScrollBehaviour } from './prototypeScroll';
import { videoResourceHashes } from './videoPaints';
import { setNativeMotionMask } from './nativeReactMotionMasks';
import { setNativeMotionMaskRegion, type NativeMotionRegionChain, type NativeMotionMaskSnapshot } from './nativeReactMotionMaskRegions';
import { interpolateNativeGeometryCommands } from './nativeReactMotionPaths';
import { createNativeScratchGraph } from './nativeScratchGraph';

type Ref = { graph: SceneGraph; node: SceneNode; key: string };
type Pair = { from?: Ref; to?: Ref; key: string; compatible: boolean; forceFade?: boolean; children: Pair[]; regions?: { from: Map<string, Ref[]>; to: Map<string, Ref[]>; masks: Pair[] } };
type Pose = { matrix: SmartMatrix; width: number; height: number };
type Plan = { root: Pair; fromRoot: string; toRoot: string; rootId: string; fromPoses: Map<string, Pose>; toPoses: Map<string, Pose>; outputIds: Map<string, string>; sourceOutputIds: Map<string, string>; matched: Map<string, Pair>; images: Map<string, Uint8Array> };
type Affine = SmartMatrix;
type Direction = { x: number; y: number; fade: boolean };

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const motionDimension = (from: number, to: number, p: number, type: SceneNode['type']) => type === 'LINE' ? Math.max(0, lerp(from, to, p)) : Math.max(.0001, lerp(from, to, p));
const typeFamily = (type: SceneNode['type']) => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(type) ? 'CONTAINER' : type;
const rgba = (a: Fill['color'], b: Fill['color'], p: number): Fill['color'] => { const [r, g, blue, alpha] = smartRgbaAt([a.r, a.g, a.b, a.a], [b.r, b.g, b.b, b.a], p); return { r, g, b: blue, a: alpha }; };
const gradientTypes = new Set(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']);
const tweenFill = (from: Fill, to: Fill, p: number): Fill | undefined => {
  if (from.type !== to.type || from.blendMode !== to.blendMode) return;
  if (from.type !== 'SOLID' && !gradientTypes.has(from.type)) return JSON.stringify(from) === JSON.stringify(to) ? structuredClone(to) : undefined;
  if ((from.gradientStops?.length ?? 0) !== (to.gradientStops?.length ?? 0)) return;
  const staticFill = (fill: Fill) => {
    const { color: _color, opacity: _opacity, gradientStops: _stops, gradientTransform: _transform, ...rest } = fill;
    return rest;
  };
  if (JSON.stringify(staticFill(from)) !== JSON.stringify(staticFill(to))) return;
  const stops = from.gradientStops?.map((stop, index) => {
    const target = to.gradientStops![index]!;
    return { position: clamp(lerp(stop.position, target.position, p)), color: rgba(stop.color, target.color, p) };
  });
  if (stops) for (let index = 1; index < stops.length; index++) stops[index]!.position = Math.max(stops[index]!.position, stops[index - 1]!.position);
  const transform = from.gradientTransform && to.gradientTransform
    ? { m00: lerp(from.gradientTransform.m00, to.gradientTransform.m00, p), m01: lerp(from.gradientTransform.m01, to.gradientTransform.m01, p), m02: lerp(from.gradientTransform.m02, to.gradientTransform.m02, p), m10: lerp(from.gradientTransform.m10, to.gradientTransform.m10, p), m11: lerp(from.gradientTransform.m11, to.gradientTransform.m11, p), m12: lerp(from.gradientTransform.m12, to.gradientTransform.m12, p) }
    : from.gradientTransform === undefined && to.gradientTransform === undefined ? undefined : null;
  if (transform === null) return;
  return { ...structuredClone(from), color: rgba(from.color, to.color, p), opacity: clamp(lerp(from.opacity, to.opacity, p)), ...(stops ? { gradientStops: stops } : {}), ...(transform ? { gradientTransform: transform } : {}) };
};

function compatibleText(from: SceneNode, to: SceneNode) {
  if (from.type !== 'TEXT' || to.type !== 'TEXT' || from.text !== to.text || from.textDirection !== to.textDirection || from.textLanguage !== to.textLanguage || from.fontFamily !== to.fontFamily || from.fontWeight !== to.fontWeight || from.italic !== to.italic || (from.lineHeight === null) !== (to.lineHeight === null) || JSON.stringify(from.fontVariations) !== JSON.stringify(to.fontVariations) || JSON.stringify(from.fontFeatures) !== JSON.stringify(to.fontFeatures) || from.styleRuns.length !== to.styleRuns.length) return false;
  for (let i = 0; i < from.styleRuns.length; i++) {
    const a = from.styleRuns[i]!, b = to.styleRuns[i]!;
    if (a.start !== b.start || a.length !== b.length) return false;
    const staticStyle = (style: StyleRun['style']) => { const { fontSize: _size, fontWeight: _weight, letterSpacing: _spacing, lineHeight: _lineHeight, ...rest } = style; return rest; };
    if (JSON.stringify(staticStyle(a.style)) !== JSON.stringify(staticStyle(b.style)) || a.style.fontFamily !== b.style.fontFamily || a.style.fontWeight !== b.style.fontWeight || a.style.italic !== b.style.italic || (a.style.lineHeight === null) !== (b.style.lineHeight === null) || JSON.stringify(a.style.fontVariations) !== JSON.stringify(b.style.fontVariations) || JSON.stringify(a.style.fontFeatures) !== JSON.stringify(b.style.fontFeatures)) return false;
  }
  return true;
}

type StyleRun = SceneNode['styleRuns'][number];
function compatibleAppearance(from: SceneNode, to: SceneNode) {
  const a = nativeAppearance(from), b = nativeAppearance(to);
  return !!createNativeReactMotionAppearance(from, to) || JSON.stringify(a) === JSON.stringify(b);
}

function compatibleFills(from: SceneNode, to: SceneNode, p?: number) {
  if (from.fills.length !== to.fills.length) return;
  const fills = from.fills.map((fill, index) => tweenFill(fill, to.fills[index]!, p ?? .5));
  return fills.every((fill): fill is Fill => !!fill) ? fills : undefined;
}

function shapeSignature(node: SceneNode) {
  const network = node.vectorNetwork && {
    vertices: node.vectorNetwork.vertices.map(({ x: _x, y: _y, cornerRadius, ...rest }) => ({ ...rest, hasCornerRadius: cornerRadius !== undefined })),
    segments: node.vectorNetwork.segments.map(segment => ({ start: segment.start, end: segment.end, tangentStartKeys: Object.keys(segment.tangentStart).sort(), tangentEndKeys: Object.keys(segment.tangentEnd).sort() })),
    regions: node.vectorNetwork.regions,
  };
  const paths = (items: SceneNode['fillGeometry']) => items.map(path => {
    const data = new DataView(path.commandsBlob.buffer, path.commandsBlob.byteOffset, path.commandsBlob.byteLength), commands: number[] = [];
    let offset = 0;
    while (offset < data.byteLength) {
      const command = data.getUint8(offset++), coordinates = geometryCommandCoordCount(command);
      if (coordinates === null || offset + coordinates * 8 > data.byteLength) return { opaque: [...path.commandsBlob], windingRule: path.windingRule, fillStyleId: path.fillStyleId };
      commands.push(command); offset += coordinates * 8;
    }
    return { commands, windingRule: path.windingRule, fillStyleId: path.fillStyleId };
  });
  return JSON.stringify({ pointCount: node.pointCount, booleanOperation: node.booleanOperation, arcData: node.arcData === null ? null : Object.keys(node.arcData).sort(), network, fillGeometry: paths(node.fillGeometry), strokeGeometry: paths(node.strokeGeometry) });
}

function compatibleGeometryFills(from: SceneNode, to: SceneNode) {
  const same = (left: SceneNode['fillGeometry'], right: SceneNode['fillGeometry']) => left.length === right.length && left.every((path, index) => {
    const a = path.fills ?? [], b = right[index]!.fills ?? [];
    return a.length === b.length && a.every((fill, fillIndex) => !!tweenFill(fill, b[fillIndex]!, .5));
  });
  return same(from.fillGeometry, to.fillGeometry) && same(from.strokeGeometry, to.strokeGeometry);
}

function siblingRefs(graph: SceneGraph, parent: SceneNode) {
  const counts = new Map<string, number>();
  return parent.childIds.flatMap(id => {
    const node = graph.getNode(id);
    if (!node || !node.visible || node.internalOnly) return [];
    const occurrence = counts.get(node.name) ?? 0; counts.set(node.name, occurrence + 1);
    return [{ graph, node, key: JSON.stringify([node.name, occurrence]) }];
  });
}

function sameMaskMembership(from: SceneGraph, a: SceneNode, to: SceneGraph, b: SceneNode) {
  const collect = (graph: SceneGraph, parent: SceneNode) => {
    const regions: { masks: string[]; children: string[] }[] = [];
    const owners = new Map<string, number>();
    let current: { masks: string[]; children: string[] } | undefined;
    for (const ref of siblingRefs(graph, parent)) {
      if (ref.node.isMask) {
        if (!current || current.children.length) { current = { masks: [], children: [] }; regions.push(current); }
        current.masks.push(ref.key);
      } else {
        owners.set(ref.key, current ? regions.length - 1 : -1);
        if (current) current.children.push(ref.key);
      }
    }
    return { regions, owners };
  };
  const left = collect(from, a), right = collect(to, b);
  if (left.regions.length !== right.regions.length || left.regions.some((region, index) => JSON.stringify(region.masks) !== JSON.stringify(right.regions[index]!.masks))) return false;
  for (const [key, region] of left.owners) {
    if (right.owners.has(key) && right.owners.get(key) !== region) return false;
  }
  return true;
}

function maskChains(graph: SceneGraph, parent: SceneNode) {
  const chains = new Map<string, Ref[]>(); let masks: Ref[] = [], painted = false;
  for (const ref of siblingRefs(graph, parent)) {
    if (ref.node.isMask) { if (painted) masks = []; masks.push(ref); painted = false; }
    else { chains.set(ref.key, [...masks]); painted = true; }
  }
  return chains;
}

function visibleTreeCount(graph: SceneGraph, root: SceneNode) {
  let count = 0; const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 128) throw new Error(`${node.name}: Smart Animate exceeds 128 visible layer levels.`);
    if (++count > 20_000) throw new Error('Smart Animate supports at most 20,000 visible layers per endpoint.');
    if (node.visible && !node.internalOnly) pending.push(...graph.getChildren(node.id).map(child => ({ node: child, depth: depth + 1 })));
  }
  return count;
}

function visibleTree(graph: SceneGraph, root: SceneNode) {
  const result: SceneNode[] = [], pending = [root];
  while (pending.length) { const node = pending.pop()!; if (!node.visible || node.internalOnly) continue; result.push(node); pending.push(...graph.getChildren(node.id)); }
  return result;
}

function tweenStructure(from: unknown, to: unknown, p: number, discretePaths = false): unknown {
  if (from instanceof Uint8Array && to instanceof Uint8Array) {
    const path = interpolateNativeGeometryCommands(from, to, p);
    if (path) return path;
    if (!discretePaths) throw new Error('Smart Animate native geometry commands need compatible finite paths within 8 MB and one million points.');
  }
  if (ArrayBuffer.isView(from) || ArrayBuffer.isView(to)) return structuredClone(p < .5 ? from : to);
  if (typeof from === 'number' && typeof to === 'number') return lerp(from, to, p);
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) return from.map((value, index) => tweenStructure(value, to[index], p, discretePaths));
  if (from && to && typeof from === 'object' && typeof to === 'object' && !Array.isArray(from) && !Array.isArray(to)) {
    const a = from as Record<string, unknown>, b = to as Record<string, unknown>;
    if (JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort())) return Object.fromEntries(Object.keys(a).map(key => [key, tweenStructure(a[key], b[key], p, discretePaths)]));
  }
  return structuredClone(p < .5 ? from : to);
}

function pairChildren(fromGraph: SceneGraph, from: SceneNode, toGraph: SceneGraph, to: SceneNode, count: { value: number }, parent: Pair): Pair[] {
  const fromChains = maskChains(fromGraph, from), toChains = maskChains(toGraph, to);
  const regions = !sameMaskMembership(fromGraph, from, toGraph, to) || [...fromChains.values(), ...toChains.values()].some(chain => chain.length > 1);
  const oldAll = siblingRefs(fromGraph, from), nextAll = siblingRefs(toGraph, to);
  if (regions) {
    const oldMasks = oldAll.filter(ref => ref.node.isMask), nextMasks = nextAll.filter(ref => ref.node.isMask), targetMasks = new Map(nextMasks.map(ref => [ref.key, ref]));
    const masks: Pair[] = oldMasks.map(ref => {
      const target = targetMasks.get(ref.key); if (target) targetMasks.delete(ref.key);
      const compatible = !!target && compatibleNode(ref.node, target.node);
      if (target && !compatible) throw new Error(`${target.node.name}: changing native mask appearance requires one composed mask region.`);
      const pair: Pair = { from: ref, ...(target ? { to: target } : {}), key: ref.key, compatible, children: [] }; count.value++;
      if (target && compatible) pair.children = pairChildren(fromGraph, ref.node, toGraph, target.node, count, pair);
      return pair;
    });
    for (const ref of targetMasks.values()) { masks.push({ to: ref, key: ref.key, compatible: false, children: [] }); count.value++; }
    parent.regions = { from: fromChains, to: toChains, masks };
  }
  const old = regions ? oldAll.filter(ref => !ref.node.isMask) : oldAll, next = regions ? nextAll.filter(ref => !ref.node.isMask) : nextAll, oldByKey = new Map(old.map(ref => [ref.key, ref]));
  const result = next.map(ref => {
    const source = oldByKey.get(ref.key); if (source) oldByKey.delete(ref.key);
    if (source && (readPrototypeScroll(source.node).settings.axis !== readPrototypeScroll(ref.node).settings.axis || readScrollBehaviour(source.node, fromGraph).behaviour !== readScrollBehaviour(ref.node, toGraph).behaviour)) throw new Error(`${ref.node.name}: changing native scroll axis or positioning during Smart Animate is unsupported.`);
    const compatible = !!source && compatibleNode(source.node, ref.node);
    if (source && !compatible && (source.node.isMask || ref.node.isMask)) throw new Error(`${ref.node.name}: changing native mask appearance requires one composed mask region.`);
    if (source && !compatible && source.node.childIds.length && ref.node.childIds.length && typeFamily(source.node.type) === 'CONTAINER' && typeFamily(ref.node.type) === 'CONTAINER') throw new Error(`${ref.node.name}: this changed group paint/effect structure needs native child-preserving interpolation.`);
    const pair: Pair = { ...(source ? { from: source } : {}), to: ref, key: ref.key, compatible, children: [] };
    count.value++;
    if (pair.compatible && source) pair.children = pairChildren(fromGraph, source.node, toGraph, ref.node, count, pair);
    return pair;
  });
  for (const source of old) if (oldByKey.has(source.key)) { result.push({ from: source, key: source.key, compatible: false, children: [] }); count.value++; }
  return result;
}

function compatibleNode(from: SceneNode, to: SceneNode) {
  if (from.isMask && to.isMask) return from.blendMode === to.blendMode && ['NORMAL', 'PASS_THROUGH'].includes(from.blendMode) && validNativeAppearance(nativeAppearance(from)) && validNativeAppearance(nativeAppearance(to)) && (from.type !== 'TEXT' && to.type !== 'TEXT' || compatibleText(from, to));
  if (from.type !== to.type && typeFamily(from.type) !== typeFamily(to.type)) return false;
  if (from.isMask !== to.isMask || from.clipsContent !== to.clipsContent) return false;
  if (typeFamily(from.type) !== 'CONTAINER' && shapeSignature(from) !== shapeSignature(to)) return false;
  if (from.type === 'TEXT' && !compatibleText(from, to)) return false;
  if ((!compatibleGeometryFills(from, to) || !compatibleFills(from, to) || !compatibleAppearance(from, to)) && !(nativeMotionCompositeEligible(from) && nativeMotionCompositeEligible(to))) return false;
  if (from.blendMode !== to.blendMode) return false;
  return true;
}

function affine(matrix: number[]): Affine {
  if (matrix.length < 6 || !matrix.slice(0, 6).every(Number.isFinite)) throw new Error('Smart Animate encountered invalid scene geometry.');
  return [matrix[0]!, matrix[3]!, matrix[1]!, matrix[4]!, matrix[2]!, matrix[5]!];
}
function multiply(a: Affine, b: Affine): Affine { return smartMultiply(a, b); }
function inverse(m: Affine): Affine { return smartInverse(m); }
function corners(m: Affine, width: number, height: number) {
  const x = [m[4], m[0] * width + m[4], m[2] * height + m[4], m[0] * width + m[2] * height + m[4]];
  const y = [m[5], m[1] * width + m[5], m[3] * height + m[5], m[1] * width + m[3] * height + m[5]];
  return { minX: Math.min(...x), minY: Math.min(...y), maxX: Math.max(...x), maxY: Math.max(...y) };
}
function poses(graph: SceneGraph, root: SceneNode) {
  const world = affine(getWorldMatrix(root, graph));
  const bounds = corners(world, root.width, root.height);
  const offset: Affine = [1, 0, 0, 1, -bounds.minX, -bounds.minY];
  const result = new Map<string, Pose>(); const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!; if (depth > 128) throw new Error(`${node.name}: Smart Animate exceeds 128 visible layer levels.`);
    if (!node.visible || node.internalOnly) continue;
    result.set(node.id, { matrix: multiply(offset, affine(getWorldMatrix(node, graph))), width: node.width, height: node.height });
    pending.push(...graph.getChildren(node.id).map(child => ({ node: child, depth: depth + 1 })));
  }
  return { poses: result, bounds: { minX: bounds.minX, minY: bounds.minY } };
}

function decompose(matrix: Affine, label: string) {
  const [a, b, c, d, x, y] = matrix, sx = Math.hypot(a, b), sy = Math.hypot(c, d), dot = a * c + b * d, determinant = a * d - b * c;
  if (!matrix.every(Number.isFinite) || sx < 1e-9 || sy < 1e-9 || Math.abs(determinant) < 1e-9) throw new Error(`${label}: singular Smart Animate transform is unsupported.`);
  if (Math.abs(sx - 1) > 1e-5 || Math.abs(sy - 1) > 1e-5 || Math.abs(dot) > 1e-5) throw new Error(`${label}: skewed or scaled Smart Animate transforms are unsupported.`);
  return { rotation: Math.atan2(b, a), reflected: determinant < 0, x, y };
}
function rotationDelta(from: number, to: number) { let turn = to - from; while (turn <= -Math.PI) turn += Math.PI * 2; while (turn > Math.PI) turn -= Math.PI * 2; return turn; }
function worldAt(from: Pose, to: Pose, p: number, label: string): Affine {
  const a = decompose(from.matrix, label), b = decompose(to.matrix, label);
  if (a.reflected !== b.reflected) throw new Error(`${label}: changing reflection during Smart Animate is unsupported.`);
  const rotation = a.rotation + rotationDelta(a.rotation, b.rotation) * p, c = Math.cos(rotation), s = Math.sin(rotation), sign = a.reflected ? -1 : 1;
  return [c, s, -s * sign, c * sign, lerp(a.x, b.x, p), lerp(a.y, b.y, p)];
}
function localForWorld(node: SceneNode, desiredWorld: Affine, parentWorld: Affine, label: string) {
  const local = multiply(inverse(parentWorld), desiredWorld), [a, b, c, d, tx, ty] = local;
  decompose(local, label);
  const sx = node.flipX ? -1 : 1, sy = node.flipY ? -1 : 1;
  if ((sx * sy < 0) !== (a * d - b * c < 0)) throw new Error(`${label}: changing reflection within its parent is unsupported.`);
  const rotation = Math.atan2(b / sy, a / sx) * 180 / Math.PI;
  node.rotation = rotation;
  const zero = affine(getNodeLocalMatrix(node, { x: 0, y: 0 }));
  node.x = tx - zero[4]; node.y = ty - zero[5];
}

function lerpFillStack(from: SceneNode, to: SceneNode, p: number): Fill[] | undefined { return compatibleFills(from, to, p); }
function lerpText(from: SceneNode, to: SceneNode, out: SceneNode, p: number) {
  if (!compatibleText(from, to)) return false;
  out.fontSize = Math.max(.0001, lerp(from.fontSize, to.fontSize, p)); out.fontWeight = lerp(from.fontWeight, to.fontWeight, p);
  out.letterSpacing = lerp(from.letterSpacing, to.letterSpacing, p);
  if (from.lineHeight !== null && to.lineHeight !== null) out.lineHeight = Math.max(0, lerp(from.lineHeight, to.lineHeight, p));
  out.styleRuns = from.styleRuns.map((run, index) => {
    const target = to.styleRuns[index]!, style = { ...structuredClone(run.style) };
    if (style.fontSize !== undefined && target.style.fontSize !== undefined) style.fontSize = Math.max(.0001, lerp(style.fontSize, target.style.fontSize, p));
    if (style.fontWeight !== undefined && target.style.fontWeight !== undefined) style.fontWeight = lerp(style.fontWeight, target.style.fontWeight, p);
    if (style.letterSpacing !== undefined && target.style.letterSpacing !== undefined) style.letterSpacing = lerp(style.letterSpacing, target.style.letterSpacing, p);
    if (style.lineHeight !== undefined && style.lineHeight !== null && target.style.lineHeight !== null && target.style.lineHeight !== undefined) style.lineHeight = Math.max(0, lerp(style.lineHeight, target.style.lineHeight, p));
    return { ...run, style };
  });
  return true;
}
function lerpRadii(from: SceneNode, to: SceneNode, out: SceneNode, p: number) {
  const oldRadii = from.independentCorners ? [from.topLeftRadius, from.topRightRadius, from.bottomRightRadius, from.bottomLeftRadius] : Array(4).fill(from.cornerRadius) as number[];
  const newRadii = to.independentCorners ? [to.topLeftRadius, to.topRightRadius, to.bottomRightRadius, to.bottomLeftRadius] : Array(4).fill(to.cornerRadius) as number[];
  const radii = oldRadii.map((value, index) => Math.max(0, lerp(value, newRadii[index]!, p)));
  out.independentCorners = true; out.topLeftRadius = radii[0]!; out.topRightRadius = radii[1]!; out.bottomRightRadius = radii[2]!; out.bottomLeftRadius = radii[3]!;
  out.cornerRadius = radii.every(value => value === radii[0]) ? radii[0]! : 0;
  out.cornerSmoothing = clamp(lerp(from.cornerSmoothing, to.cornerSmoothing, p));
}
function lerpNode(from: SceneNode, to: SceneNode, out: SceneNode, p: number, label: string, graph: SceneGraph) {
  out.width = motionDimension(from.width, to.width, p, out.type); out.height = motionDimension(from.height, to.height, p, out.type);
  out.opacity = clamp(lerp(from.opacity, to.opacity, p));
  lerpRadii(from, to, out, p);
  out.starInnerRadius = Math.max(0, lerp(from.starInnerRadius, to.starInnerRadius, p));
  out.arcData = tweenStructure(from.arcData, to.arcData, p) as SceneNode['arcData'];
  const paths = (items: SceneNode['fillGeometry']) => items.map(path => ({ ...path, fillStyleId: path.fillStyleId, fills: path.fills }));
  const geometry = (node: SceneNode) => ({ vectorNetwork: node.vectorNetwork, fillGeometry: paths(node.fillGeometry), strokeGeometry: paths(node.strokeGeometry), derivedTextGlyphs: node.derivedTextGlyphs?.map(glyph => ({ ...glyph, rotation: glyph.rotation ?? 0, scaleX: glyph.scaleX ?? 1, scaleY: glyph.scaleY ?? 1 })) ?? null, textPathData: node.textPathData, textPathBox: node.textPathBox });
  const fromScaled = geometry({ ...from, ...scaledGeometryChanges(from, from.width, from.height, out.width, out.height) });
  const toScaled = geometry({ ...to, ...scaledGeometryChanges(to, to.width, to.height, out.width, out.height) });
  const discretePaths = out.isMask && (from.type !== to.type || shapeSignature(from) !== shapeSignature(to));
  Object.assign(out, tweenStructure(fromScaled, toScaled, p, discretePaths));
  if (compatibleGeometryFills(from, to)) for (const field of ['fillGeometry', 'strokeGeometry'] as const) out[field].forEach((path, index) => {
    const a = from[field][index]!.fills, b = to[field][index]!.fills;
    if (a && b) path.fills = a.map((fill, fillIndex) => tweenFill(fill, b[fillIndex]!, p)!);
  });
  const fills = lerpFillStack(from, to, p), appearance = createNativeReactMotionAppearance(from, to);
  const identicalAppearance = JSON.stringify(nativeAppearance(from)) === JSON.stringify(nativeAppearance(to));
  const paint = appearance ? appearance(p) : identicalAppearance ? nativeAppearance(to) : undefined;
  const applyAppearance = (node: SceneNode) => {
    if (!paint) return;
    node.strokes = structuredClone(paint.strokes); node.effects = structuredClone(paint.effects);
    node.strokeCap = paint.cap; node.strokeJoin = paint.join; node.strokeMiterLimit = paint.miter; node.dashPattern = paint.dash;
    node.independentStrokeWeights = paint.independent; node.borderTopWeight = paint.borders[0]; node.borderRightWeight = paint.borders[1]; node.borderBottomWeight = paint.borders[2]; node.borderLeftWeight = paint.borders[3];
  };
  out.fills = fills ?? structuredClone(p < .5 ? from.fills : to.fills); applyAppearance(out);
  if ((!fills || !paint || !compatibleGeometryFills(from, to)) && !out.isMask) {
    const a = structuredClone(from), b = structuredClone(to);
    if (fills) { a.fills = structuredClone(fills); b.fills = structuredClone(fills); }
    if (compatibleGeometryFills(from, to)) for (const node of [a, b]) for (const field of ['fillGeometry', 'strokeGeometry'] as const) node[field] = node[field].map((path, index) => ({ ...path, fills: structuredClone(out[field][index]?.fills) }));
    applyAppearance(a); applyAppearance(b);
    setNativeMotionComposite(graph, out.id, a, b, p);
  }
  if (out.type === 'TEXT' && !lerpText(from, to, out, p)) throw new Error(`${label}: this text face or content requires a native fade.`);
}

function prepareMaskMotion(graph: SceneGraph, from: SceneNode, to: SceneNode, out: SceneNode, progress: number) {
  if (!from.isMask || !to.isMask) return;
  const sameShape = from.type === to.type && shapeSignature(from) === shapeSignature(to);
  const fills = compatibleFills(from, to, progress), appearance = createNativeReactMotionAppearance(from, to);
  const geometryFills = compatibleGeometryFills(from, to);
  if (sameShape && geometryFills && from.maskType === to.maskType && from.maskIsOutline === to.maskIsOutline && fills && appearance) return;
  if (!nativeMotionCompositeEligible({ ...from, isMask: false }) || !nativeMotionCompositeEligible({ ...to, isMask: false })) throw new Error(`${to.name}: changing native mask appearance requires one composed mask region.`);
  const snapshots = [from, to].map(endpoint => {
    const node = structuredClone(endpoint);
    Object.assign(node, scaledGeometryChanges(endpoint, endpoint.width, endpoint.height, out.width, out.height));
    node.width = out.width; node.height = out.height;
    if (sameShape) {
      for (const field of ['pointCount', 'starInnerRadius', 'arcData', 'vectorNetwork', 'cornerRadius', 'independentCorners', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing'] as const) Object.assign(node, { [field]: structuredClone(out[field]) });
      for (const field of ['fillGeometry', 'strokeGeometry'] as const) node[field] = out[field].map((path, index) => ({ ...structuredClone(path), fills: structuredClone(geometryFills ? path.fills : endpoint[field][index]?.fills) }));
    }
    if (fills) node.fills = structuredClone(fills);
    if (appearance) for (const field of ['strokes', 'effects', 'strokeCap', 'strokeJoin', 'strokeMiterLimit', 'dashPattern', 'independentStrokeWeights', 'borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight'] as const) Object.assign(node, { [field]: structuredClone(out[field]) });
    return node;
  });
  setNativeMotionMask(graph, out.id, snapshots[0]!, snapshots[1]!, progress);
}

function clearRealizedReferences(node: SceneNode) {
  if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)) node.type = 'FRAME';
  node.componentId = null; node.componentKey = null; node.sourceLibraryKey = null; node.publishId = null; node.overrideKey = null;
  node.sharedSymbolVersion = null; node.publishedVersion = null; node.componentPropertyReferences = []; node.componentPropertyDefinitions = [];
  node.componentPropertyAssignments = {}; node.componentPropertyValues = {}; node.instanceOverrides = createInstanceOverrideState(); node.variantPropSpecs = [];
  node.librarySource = null; node.isPublishable = false; node.isSymbolPublishable = false; node.symbolDescription = ''; node.symbolLinks = [];
  node.boundVariables = {}; node.variableModes = {};
  node.layoutMode = 'NONE'; node.layoutGrow = 0; node.layoutAlignSelf = 'AUTO'; node.layoutPositioning = 'ABSOLUTE';
}

function offsetDirection(link: DesignNavigation, size: { width: number; height: number }, incoming: boolean, fixed: boolean): Direction {
  const [x, y] = link.direction === 'left' ? [-size.width, 0] : link.direction === 'top' ? [0, -size.height] : link.direction === 'bottom' ? [0, size.height] : [size.width, 0];
  if (fixed || link.transition === 'smart' || link.transition === 'dissolve') return { x: 0, y: 0, fade: true };
  if (incoming) return { x: link.transition === 'move-out' ? 0 : x! * (link.transition === 'slide-out' ? -.25 : 1), y: link.transition === 'move-out' ? 0 : y! * (link.transition === 'slide-out' ? -.25 : 1), fade: link.transition === 'slide-out' };
  const factor = link.transition === 'move-in' ? 0 : link.transition === 'slide' ? -.25 : link.transition === 'push' ? -1 : 1;
  return { x: x! * factor, y: y! * factor, fade: link.transition === 'slide' };
}

function collectImageBytes(plan: Plan, fromGraph: SceneGraph, toGraph: SceneGraph) {
  const collect = (graph: SceneGraph, rootId: string) => {
    const nodes: SceneNode[] = [], pending = [graph.getNode(rootId)!];
    while (pending.length) { const node = pending.pop()!; if (!node.visible || node.internalOnly) continue; nodes.push(node); pending.push(...graph.getChildren(node.id)); }
    return nodes;
  };
  const nodes = [...collect(fromGraph, plan.fromRoot), ...collect(toGraph, plan.toRoot)];
  const hashes = new Set(nodes.flatMap(node => [...[node.fills, node.textDecorationFills, ...node.styleRuns.flatMap(run=>[run.style.fills ?? [],run.style.textDecorationFills ?? []]), ...node.fillGeometry.map(path => path.fills ?? []), ...node.strokeGeometry.map(path => path.fills ?? [])].flat().flatMap(fill => fill.imageHash ? [fill.imageHash] : []), ...videoResourceHashes([node])]));
  let bytes = 0;
  for (const hash of hashes) {
    const left = fromGraph.images.get(hash), right = toGraph.images.get(hash), resource = left ?? right;
    if (left && right && (left.byteLength !== right.byteLength || left.some((value, i) => value !== right[i]))) throw new Error(`Image resource ${hash} changed between Smart Animate endpoints.`);
    if (!resource) throw new Error(`Restore image/video resource ${hash} before Smart Animate.`);
    bytes += resource.byteLength; if (bytes > 24 * 1024 * 1024) throw new Error('Smart Animate supports at most 24 MB of endpoint images and video resources.');
    plan.images.set(hash, resource.slice());
  }
}

function markCopy(node: SceneNode, id: string, parentId: string) {
  const copy = structuredClone(node); copy.id = id; copy.parentId = parentId; copy.childIds = [];
  clearRealizedReferences(copy); return copy;
}

export type NativeReactMotionGraph = {
  rootId: string;
  matched: number;
  sample(progress: number): SceneGraph;
  movement(sourceId?: string): { x: number; y: number } | undefined;
  sourceNodeId(sourceId: string): string | undefined;
};

export function createNativeReactMotionGraph(fromGraph: SceneGraph, fromRootId: string, toGraph: SceneGraph, toRootId: string, link: DesignNavigation): NativeReactMotionGraph {
  const fromRoot = fromGraph.getNode(fromRootId), toRoot = toGraph.getNode(toRootId);
  if (!fromRoot || !toRoot) throw new Error('Smart Animate endpoint root is missing.');
  if (fromGraph.documentColorSpace !== toGraph.documentColorSpace) throw new Error('Smart Animate endpoints use different document color spaces.');
  if (typeFamily(fromRoot.type) !== typeFamily(toRoot.type) || fromRoot.clipsContent !== toRoot.clipsContent || fromRoot.isMask !== toRoot.isMask || fromRoot.blendMode !== toRoot.blendMode) throw new Error(`${toRoot.name}: Smart Animate cannot pair incompatible endpoint roots.`);
  const fromCount = visibleTreeCount(fromGraph, fromRoot), toCount = visibleTreeCount(toGraph, toRoot);
  if (fromCount + toCount - 1 > 20_000) throw new Error('Smart Animate supports at most 20,000 combined sampled layers.');
  for (const [graph, root] of [[fromGraph, fromRoot], [toGraph, toRoot]] as const) {
    for (const node of visibleTree(graph, root)) { const behavior = readScrollBehaviour(node, graph); if (behavior.issue) throw new Error(`${node.name}: ${behavior.issue}`); }
  }
  const pairCount = { value: 1 }, root: Pair = { from: { graph: fromGraph, node: fromRoot, key: '$root' }, to: { graph: toGraph, node: toRoot, key: '$root' }, key: '$root', compatible: true, children: [] };
  root.children = pairChildren(fromGraph, fromRoot, toGraph, toRoot, pairCount, root);
  if (pairCount.value > 20_000) throw new Error('Smart Animate supports at most 20,000 combined sampled layers.');
  const fromCapture = poses(fromGraph, fromRoot), toCapture = poses(toGraph, toRoot), outputIds = new Map<string, string>(), sourceOutputIds = new Map<string, string>(), matched = new Map<string, Pair>(), images = new Map<string, Uint8Array>();
  for (const [graph, capture] of [[fromGraph, fromCapture], [toGraph, toCapture]] as const) for (const [id, pose] of capture.poses) decompose(pose.matrix, graph.getNode(id)!.name);
  const reserved = new Set<string>();
  const allocate = (preferred: string) => { if (!reserved.has(preferred)) { reserved.add(preferred); return preferred; } let value = generateId(); while (reserved.has(value)) value = generateId(); reserved.add(value); return value; };
  const setOutputId = (side: 'from' | 'to', node: SceneNode, output: string) => {
    outputIds.set(`${side}\0${node.id}`, output);
    if (!sourceOutputIds.has(node.id)) sourceOutputIds.set(node.id, output);
  };
  const assignSubtree = (side: 'from' | 'to', ref: Ref) => {
    const key = `${side}\0${ref.node.id}`; if (outputIds.has(key)) return;
    const id = allocate(ref.node.id); setOutputId(side, ref.node, id);
    for (const child of ref.graph.getChildren(ref.node.id)) if (child.visible && !child.internalOnly) assignSubtree(side, { graph: ref.graph, node: child, key: child.name });
  };
  const assignIds = (pair: Pair) => {
    if (pair.compatible && pair.from && pair.to) {
      const id = allocate(pair.to.node.id); setOutputId('to', pair.to.node, id); setOutputId('from', pair.from.node, id); matched.set(pair.from.node.id, pair);
      pair.children.forEach(assignIds); pair.regions?.masks.forEach(assignIds);
    } else {
      if (pair.from) assignSubtree('from', pair.from);
      if (pair.to) assignSubtree('to', pair.to);
      // A structurally incompatible branch is sampled as two native fades.
    }
  };
  assignIds(root);
  if (!outputIds.has(`to\0${toRootId}`)) throw new Error('Smart Animate could not prepare its destination root.');
  const plan: Plan = { root, fromRoot: fromRootId, toRoot: toRootId, rootId: outputIds.get(`to\0${toRootId}`)!, fromPoses: fromCapture.poses, toPoses: toCapture.poses, outputIds, sourceOutputIds, matched, images };
  collectImageBytes(plan, fromGraph, toGraph);
  const rootPose = (p: number) => {
    const a = plan.fromPoses.get(fromRootId)!, b = plan.toPoses.get(toRootId)!, matrix = worldAt(a, b, p, toRoot.name), width = motionDimension(a.width, b.width, p, toRoot.type), height = motionDimension(a.height, b.height, p, toRoot.type), box = corners(matrix, width, height);
    matrix[4] -= box.minX; matrix[5] -= box.minY; return { matrix, width, height };
  };
  const regionOutputIds = new Map<string,string>();
  const createScratch = (progress: number) => {
    const result = createNativeScratchGraph(reserved), page = result.getPages()[0]!;
    result.documentColorSpace = toGraph.documentColorSpace; result.images = new Map([...plan.images].map(([hash, bytes]) => [hash, bytes.slice()]));
    result.variables = structuredClone(toGraph.variables); result.variableCollections = structuredClone(toGraph.variableCollections); result.activeMode = new Map(toGraph.activeMode); result.enabledLibraries = structuredClone(toGraph.enabledLibraries);
    const usedIds = new Set(result.nodes.keys());
    const uniqueId = (preferred: string) => { if (usedIds.has(preferred)) throw new Error('Smart Animate generated a colliding scene node ID.'); usedIds.add(preferred); return preferred; };
    const baseRoot = toRoot, rootId = uniqueId(plan.rootId), rootNode = markCopy(baseRoot, rootId, page.id);
    lerpNode(fromRoot, toRoot, rootNode, progress, toRoot.name, result);
    rootNode.width = motionDimension(fromRoot.width, toRoot.width, progress, rootNode.type); rootNode.height = motionDimension(fromRoot.height, toRoot.height, progress, rootNode.type);
    result.nodes.set(rootId, rootNode); page.childIds = [rootId];
    const rootWorld = rootPose(progress); localForWorld(rootNode, rootWorld.matrix, [1, 0, 0, 1, 0, 0], rootNode.name);
    const placePair = (pair: Pair, parentId: string, parentWorld: Affine): string => {
      if (pair.compatible && pair.from && pair.to) {
        const toNode = pair.to.node, fromNode = pair.from.node, id = uniqueId(plan.outputIds.get(`to\0${toNode.id}`)!), clone = markCopy(toNode, id, parentId);
        const a = plan.fromPoses.get(fromNode.id)!, b = plan.toPoses.get(toNode.id)!;
        lerpNode(fromNode, toNode, clone, progress, toNode.name, result);
        const world = pair === plan.root ? rootWorld.matrix : worldAt(a, b, progress, toNode.name);
        if (pair === plan.root) { clone.width = rootWorld.width; clone.height = rootWorld.height; }
        localForWorld(clone, world, parentWorld, toNode.name);
        const behaviorFrom = readScrollBehaviour(fromNode, pair.from.graph).behaviour, behaviorTo = readScrollBehaviour(toNode, pair.to.graph).behaviour;
        if (link.matchLayers && (behaviorFrom === 'fixed' || behaviorTo === 'fixed') && pair !== plan.root) { clone.opacity = toNode.opacity; localForWorld(clone, b.matrix, parentWorld, toNode.name); }
        result.nodes.set(id, clone);
        clone.childIds = placeChildren(pair, id, world); prepareMaskMotion(result, fromNode, toNode, clone, progress); return id;
      }
      const ref = pair.to ?? pair.from!; const incoming = !!pair.to;
      const direction = offsetDirection(link, { width: rootWorld.width, height: rootWorld.height }, incoming, !!link.matchLayers && readScrollBehaviour(ref.node, ref.graph).behaviour === 'fixed');
      const fade = direction.fade || !!pair.forceFade;
      const factor = fade ? incoming ? progress : 1 - progress : 1;
      const pose = (incoming ? plan.toPoses : plan.fromPoses).get(ref.node.id);
      const world = pose ? [...pose.matrix] as Affine : parentWorld;
      if (pose) { const distance = incoming ? 1 - progress : progress; world[4] += direction.x * distance; world[5] += direction.y * distance; }
      const refClone = cloneBranch(ref, parentId, factor, world, parentWorld, result, usedIds, plan, incoming ? 'to' : 'from');
      return refClone.id;
    };
    function placeChildren(pair: Pair, parentId: string, parentWorld: Affine): string[] {
      const children = orderChildren(pair);
      if (!pair.regions) return children.map(child => placePair(child, parentId, parentWorld));
      const hidden: string[] = [];
      for (const mask of pair.regions.masks) {
        const id = placePair(mask, parentId, parentWorld); hidden.push(id);
        result.getNode(id)!.internalOnly = true;
      }
      if (progress === 0 || progress === 1) {
        const placed = children.map(child => placePair(child,parentId,parentWorld));
        const ref = progress === 0 ? pair.from! : pair.to!, side = progress === 0 ? 'from' : 'to';
        const ordered = siblingRefs(ref.graph,ref.node).map(child => plan.outputIds.get(`${side}\0${child.node.id}`)!);
        for (const id of [...placed,...hidden]) result.getNode(id)!.internalOnly = !ordered.includes(id);
        return [...ordered,...[...placed,...hidden].filter(id => !ordered.includes(id))];
      }
      const snapshots = new Map<string, NativeMotionMaskSnapshot>();
      const snapshot = (ref: Ref, side: 'from' | 'to'): NativeMotionMaskSnapshot => {
        const key = `${side}\0${ref.node.id}`, cached = snapshots.get(key); if (cached) return cached;
        const nodes: SceneNode[] = [];
        const copy = (authored: SceneNode, parent: string) => {
          if (!nativeMotionCompositeEligible({...authored,isMask:false}) || authored.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR') || Object.keys(authored.boundVariables).length || readPrototypeScroll(authored).settings.axis !== 'none' || readScrollBehaviour(authored,ref.graph).behaviour !== 'scroll') throw new Error('This changing mask region crosses live content, unresolved variables or an external scene backdrop.');
          const id = plan.outputIds.get(`${side}\0${authored.id}`)!, sampled = result.getNode(id), node = markCopy(authored, id, parent);
          if (!id || !sampled) throw new Error('Restore this sampled mask subtree before composing region coverage.');
          Object.assign(node, scaledGeometryChanges(authored, authored.width, authored.height, sampled.width, sampled.height));
          for (const field of ['x','y','width','height','rotation','flipX','flipY','fontSize','letterSpacing','lineHeight'] as const) Object.assign(node, { [field]: sampled[field] });
          if (node.type === sampled.type && shapeSignature(node) === shapeSignature(sampled)) {
            for (const field of ['vectorNetwork','pointCount','starInnerRadius','arcData','cornerRadius','independentCorners','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','cornerSmoothing','derivedTextGlyphs','textPathData','textPathBox'] as const) Object.assign(node, { [field]: structuredClone(sampled[field]) });
            for (const field of ['fillGeometry','strokeGeometry'] as const) node[field] = sampled[field].map((path,index) => ({ ...structuredClone(path), fills: structuredClone(authored[field][index]?.fills) }));
          }
          node.internalOnly = false;
          nodes.push(node);
          node.childIds = ref.graph.getChildren(authored.id).filter(child => child.visible && !child.internalOnly).map(child => copy(child,id));
          return id;
        };
        const rootId = copy(ref.node,parentId), value = { rootId, nodes }; snapshots.set(key,value); return value;
      };
      const chain = (refs: Ref[], side: 'from' | 'to'): NativeMotionRegionChain => refs.map(ref => snapshot(ref,side));
      const output: string[] = []; let previous = '', regionIndex = 0;
      for (const child of children) {
        const id = placePair(child,parentId,parentWorld);
        const fromRefs=pair.regions.from.get(child.key) ?? [],toRefs=pair.regions.to.get(child.key) ?? [];
        const from = child.from ? chain(fromRefs,'from') : undefined;
        const to = child.to ? chain(toRefs,'to') : undefined;
        const left = from ?? to!, right = to ?? from!;
        const sourceKey=child.from ? ['from',fromRefs.map(ref=>ref.node.id)] : ['to',toRefs.map(ref=>ref.node.id)];
        const targetKey=child.to ? ['to',toRefs.map(ref=>ref.node.id)] : ['from',fromRefs.map(ref=>ref.node.id)];
        const signature=JSON.stringify([sourceKey,targetKey]);
        if (signature !== previous) {
          const parent = result.getNode(parentId)!;
          const regionKey = `${parentId}\0${regionIndex++}`;
          let maskId = regionOutputIds.get(regionKey); if (!maskId) { maskId = allocate(generateId()); regionOutputIds.set(regionKey,maskId); }
          uniqueId(maskId);
          const mask = markCopy(parent,maskId,parentId);
          Object.assign(mask,{ name:'Native combined mask coverage',type:'RECTANGLE',x:0,y:0,rotation:0,flipX:false,flipY:false,opacity:1,isMask:true,maskType:'ALPHA',maskIsOutline:false,fills:[],strokes:[],effects:[],clipsContent:false,cornerRadius:0,independentCorners:false,fillGeometry:[],strokeGeometry:[],vectorNetwork:null,blendMode:'NORMAL' });
          result.nodes.set(maskId,mask);
          setNativeMotionMaskRegion(result,mask.id,left,right,progress); output.push(mask.id); previous = signature;
        }
        output.push(id);
      }
      return [...output,...hidden];
    }
    function orderChildren(pair: Pair): Pair[] {
      const children = pair.children, target = children.filter(child => child.to), before = new Map<string, Pair[]>(), tail: Pair[] = [];
      const byOldKey = new Map(children.filter(child => child.from).map(child => [child.key, child]));
      for (const child of children.filter(item => item.from && (!item.to || !item.compatible))) {
        const sourceSiblings = siblingRefs(child.from!.graph, child.from!.node.parentId ? child.from!.graph.getNode(child.from!.node.parentId)! : child.from!.node);
        const index = sourceSiblings.findIndex(ref => ref.node.id === child.from!.node.id); let anchor: Pair | undefined;
        for (let next = index + 1; next < sourceSiblings.length; next++) { const candidate = byOldKey.get(sourceSiblings[next]!.key); if (candidate?.to && candidate.compatible) { anchor = candidate; break; } }
        const outgoing: Pair = { from: child.from, key: child.key, compatible: false, forceFade: !!child.to, children: [] };
        if (anchor) { const list = before.get(anchor.key) ?? []; list.push(outgoing); before.set(anchor.key, list); } else tail.push(outgoing);
      }
      return [...target.flatMap(child => [...(before.get(child.key) ?? []), child.from && !child.compatible
        ? { to: child.to, key: child.key, compatible: false, forceFade: true, children: [] }
        : child]), ...tail];
    }
    function cloneBranch(ref: Ref, parentId: string, factor: number, world: Affine, parentWorld: Affine, graph: SceneGraph, ids: Set<string>, _plan: Plan, side: 'from' | 'to') {
      const cloneTree = (source: SceneNode, destinationParent: string, matrix: Affine, top: boolean): SceneNode => {
        const id = plan.outputIds.get(`${side}\0${source.id}`)!; if (ids.has(id)) throw new Error('Smart Animate generated a colliding branch node ID.'); ids.add(id);
        const copy = markCopy(source, id, destinationParent); if (top) { copy.opacity = clamp(copy.opacity * factor); localForWorld(copy, matrix, parentWorld, source.name); } else copy.opacity = source.opacity;
        const children = ref.graph.getChildren(source.id).filter(child => child.visible && !child.internalOnly);
        copy.childIds = children.map(child => {
          const childCopy = cloneTree(child, id, matrix, false); graph.nodes.set(childCopy.id, childCopy); return childCopy.id;
        });
        return copy;
      };
      const rootCopy = cloneTree(ref.node, parentId, world, true); graph.nodes.set(rootCopy.id, rootCopy); return rootCopy;
    }
    const rootPair = plan.root;
    rootNode.childIds = placeChildren(rootPair, rootId, rootWorld.matrix);
    if (result.nodes.size > 20_000) throw new Error('Smart Animate supports at most 20,000 combined sampled layers.');
    result.clearAbsPosCache();
    return result;
  };
  return {
    rootId: plan.rootId,
    matched: matched.size,
    sample(progress) {
      if (!Number.isFinite(progress) || Math.abs(progress) > 100) throw new Error('Smart Animate progress must be finite and within -100 to 100.');
      const scratch = createScratch(progress);
      return scratch;
    },
    movement(sourceId) {
      const pair = sourceId ? matched.get(sourceId) : root;
      if (!pair?.from || !pair.to) return;
      const a = plan.fromPoses.get(pair.from.node.id)!, b = plan.toPoses.get(pair.to.node.id)!;
      const dx = b.matrix[4] - a.matrix[4], dy = b.matrix[5] - a.matrix[5];
      return { x: dx, y: dy };
    },
    sourceNodeId(sourceId) { return plan.sourceOutputIds.get(sourceId); },
  };
}
