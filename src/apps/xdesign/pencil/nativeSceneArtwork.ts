import type { SkiaRenderer } from '@open-pencil/core/canvas';
import { getNodeLocalMatrix, getWorldMatrix, TransformMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { nodeVisualBounds } from '@open-pencil/scene-graph/geometry';
import { fontManager } from '@open-pencil/core/text';
import type { CanvasKit, Image, MallocObj, Surface, TypefaceFontProvider } from 'canvaskit-wasm';
import { cloneDesignSubgraph } from './graphSubset';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';
import { nativeAppearance } from './prototypeNativeAppearance';
import { readPrototypeScroll, readScrollBehaviour } from './prototypeScroll';
import { attachNativeSceneFonts, nativeSceneFaceIssue, nativeSceneTextNodes } from './nativeSceneFonts';
import { hasNativeSceneLayout } from './nativeSceneLayout';
import { nativeMaskAlphaPath } from './nativeMaskPath';
import { hasNativeComponentProperties, hasNativeSceneComponent } from './nativeSceneComponents';
import { hasNativeControlHost } from './nativeSceneControls';
import { alignedNativeMotionBounds, blendNativeMotionImages, hasNativeMotionComposite, inheritNativeMotionComposites, materializeNativeMotionComposites, type MotionCompositeBounds } from './nativeReactMotionComposite';
import { getNativeMotionMask } from './nativeReactMotionMasks';
import { getNativeMotionMaskRegion, type NativeMotionRegionChain } from './nativeReactMotionMaskRegions';
import { createNativeScratchGraph } from './nativeScratchGraph';

export type NativeMaskRegion = { masks: string[]; children: string[]; path: string };
const white = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } };
const maskOwnFields = ['type', 'maskType', 'maskIsOutline', 'fills', 'strokes', 'effects', 'strokeCap', 'strokeJoin', 'strokeMiterLimit', 'dashPattern', 'independentStrokeWeights', 'borderTopWeight', 'borderRightWeight', 'borderBottomWeight', 'borderLeftWeight', 'cornerRadius', 'independentCorners', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing', 'clipsContent', 'booleanOperation', 'pointCount', 'starInnerRadius', 'arcData', 'vectorNetwork', 'fillGeometry', 'strokeGeometry'] as const;

function prepareNativeMaskSource(kit: CanvasKit, graph: SceneGraph, mask: SceneNode, snapshot?: SceneNode) {
  const capture = cloneDesignSubgraph(graph, [mask.id]), isolated = capture.getNode(mask.id)!;
  inheritNativeMotionComposites(graph, capture);
  if (snapshot) for (const field of maskOwnFields) Object.assign(isolated, { [field]: structuredClone(snapshot[field]) });
  isolated.isMask = false;
  const vector = isolated.maskType === 'VECTOR', materialized = new Set<string>();
  const normalize = (scene: SceneGraph, node: SceneNode) => {
    if (materialized.has(node.id)) return;
    const fills = (paints: SceneNode['fills']) => vector ? paints.some(fill => fill.visible) ? [white] : [] : paints.map(fill => fill.type === 'SOLID' && fill.color ? { ...fill, opacity: fill.opacity * fill.color.a, color: { ...fill.color, a: 1 } } : fill);
    node.fills = fills(node.fills);
    node.strokes = node.strokes.map(stroke => ({ ...stroke, opacity: vector ? 1 : stroke.opacity * stroke.color.a, color: { ...stroke.color, a: 1 } }));
    for (const geometry of node.fillGeometry) if (geometry.fills) geometry.fills = fills(geometry.fills);
    for (const run of node.styleRuns) if (run.style.fills) run.style.fills = fills(run.style.fills);
    if (vector) { node.effects = []; node.opacity = 1; node.blendMode = 'NORMAL'; }
    for (const child of scene.getChildren(node.id)) normalize(scene, child);
  };
  const size = { width: isolated.width, height: isolated.height }, mixedRoot = hasNativeMotionComposite(capture, isolated.id);
  materializeNativeMotionComposites(kit, capture, isolated.id, sceneBounds, (scene, node, bounds) => captureNativeSceneImage(kit, scene, node, bounds, true), undefined, false, normalize, materialized);
  // SDK setAlphaf replaces solid colour alpha; each native mask variant needs the product.
  normalize(capture, isolated);
  const painted = motionPaintRoot(capture, isolated, size, mixedRoot);
  return { graph: capture, root: painted, maskType: snapshot?.maskType ?? mask.maskType };
}

const layerBlur = (node: SceneNode) => node.effects.find(effect => effect.visible && ['LAYER_BLUR', 'FOREGROUND_BLUR'].includes(effect.type));
export function nativeSceneArtworkPlan(graph: SceneGraph, root: SceneNode, force = false): { needed: boolean; issue?: string } {
  if (root.isMask && root.visible) return { needed: true, issue: 'Select the mask’s containing group to preserve its masked layers.' };
  if (!force && (!root.childIds.length || !layerBlur(root) && !graph.getChildren(root.id).some(child => child.visible && !child.internalOnly && child.isMask))) return { needed: false };
  if (!(root.width > 0 && root.height > 0)) return { needed: true, issue: 'Group effects need a nonempty layer box.' };
  if (!['NORMAL', 'PASS_THROUGH'].includes(root.blendMode) || root.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR')) return { needed: true, issue: 'This group effect needs the external scene backdrop.' };
  const pending = [{ node: root, depth: 0 }], seen = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 128 || seen.has(node.id)) throw new Error('This composed artwork has a recursive or overly deep layer tree.');
    seen.add(node.id);
    if (seen.size > 20_000) throw new Error('Composed artwork supports at most 20,000 layers.');
    if (Object.keys(node.boundVariables).length) return { needed: true, issue: 'Group effects with variable-bound artwork need dynamic scene composition.' };
    if (node !== root && (!node.visible || node.internalOnly)) continue;
    const scroll = readPrototypeScroll(node), positioning = readScrollBehaviour(node, graph);
    let issue: string | undefined;
    if (node.type === 'TEXT' && nativeSceneFaceIssue(node)) issue = 'text fonts that are loading or unavailable';
    if ((node.type === 'INSTANCE' || node.componentPropertyReferences.length) && !hasNativeSceneComponent(graph, node) && !(hasNativeComponentProperties(graph, node) && hasNativeControlHost(graph, node))) issue = 'component controls and properties';
    else if (node.fills.some(fill => fill.visible && fill.type === 'VIDEO')) issue = 'live video';
    else if ((node.layoutMode !== 'NONE' || node.layoutGrow) && !hasNativeSceneLayout(graph)) issue = 'responsive layout';
    else if (scroll.issue || scroll.settings.axis !== 'none' || positioning.issue || positioning.behaviour !== 'scroll') issue = 'scrolling and fixed layers';
    if (issue) return { needed: true, issue: `Group effects with ${issue} need dynamic scene composition.` };
    for (const fill of node.fills) if (fill.visible && fill.type === 'IMAGE' && (!fill.imageHash || !graph.images.has(fill.imageHash))) throw new Error(`Restore the image used by ${node.name} before exporting.`);
    pending.push(...graph.getChildren(node.id).map(child => ({ node: child, depth: depth + 1 })));
  }
  return { needed: true };
}

// Ancestor blur expands the children's combined pixels, including overflow and rotated grandchildren.
function sceneBounds(graph: SceneGraph, root: SceneNode, children?: readonly SceneNode[]) {
  const base = TransformMatrix.invert(getWorldMatrix(root, graph));
  if (!base) throw new Error('This composed artwork has an invalid scene transform.');
  let minX = children ? Infinity : 0, minY = children ? Infinity : 0, maxX = children ? -Infinity : root.width, maxY = children ? -Infinity : root.height;
  const visit = (node: SceneNode, paddingX: number, paddingY: number) => {
    if (!node.visible || node.internalOnly) return;
    const matrix = TransformMatrix.multiply(base, getWorldMatrix(node, graph)), blur = layerBlur(node);
    if (blur) { paddingX += 2 * blur.radius * (Math.abs(matrix[0]!) + Math.abs(matrix[1]!)); paddingY += 2 * blur.radius * (Math.abs(matrix[3]!) + Math.abs(matrix[4]!)); }
    const appearance = nativeAppearance(node), strokes = appearance.independent ? appearance.strokes.map(stroke => ({ ...stroke, weight: Math.max(stroke.weight, ...appearance.borders) })) : appearance.strokes;
    const own = nodeVisualBounds({ ...node, rotation: 0, flipX: false, flipY: false, strokes, effects: appearance.effects.filter(effect => !['LAYER_BLUR', 'FOREGROUND_BLUR'].includes(effect.type)) }, () => ({ x: 0, y: 0 }));
    if (node.type === 'LINE') {
      const length = Math.hypot(node.width, node.height);
      const extra = length ? Math.max(0, ...strokes.filter(stroke => stroke.visible && (stroke.cap ?? node.strokeCap) === 'SQUARE').map(stroke => stroke.weight / 2 * ((Math.abs(node.width) + Math.abs(node.height)) / length - 1))) : 0;
      own.minX -= extra; own.minY -= extra; own.maxX += extra; own.maxY += extra;
    }
    for (const [x, y] of [[own.minX, own.minY], [own.maxX, own.minY], [own.maxX, own.maxY], [own.minX, own.maxY]]) {
      const point = TransformMatrix.mapPoint(matrix, { x: x!, y: y! });
      minX = Math.min(minX, point.x - paddingX); minY = Math.min(minY, point.y - paddingY); maxX = Math.max(maxX, point.x + paddingX); maxY = Math.max(maxY, point.y + paddingY);
    }
    for (const child of graph.getChildren(node.id)) visit(child, paddingX, paddingY);
  };
  if (children) for (const child of children) visit(child, 0, 0);
  else visit(root, 0, 0);
  if (children && minX === Infinity) return { minX: 0, minY: 0, width: 1, height: 1 };
  if (children) { maxX = Math.max(maxX, minX + 1); maxY = Math.max(maxY, minY + 1); }
  if (![minX, minY, maxX, maxY, maxX - minX, maxY - minY].every(Number.isFinite) || !(maxX > minX && maxY > minY)) throw new Error('This composed artwork has invalid expanded bounds.');
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export function renderNativeSceneImage(kit: CanvasKit, source: SceneGraph, sourceRoot: SceneNode, force = false) {
  const plan = nativeSceneArtworkPlan(source, sourceRoot, force);
  if (!plan.needed || plan.issue) throw new Error(plan.issue ?? 'Choose a group with a layer blur to compose its artwork.');
  return renderPreparedNativeSceneImage(kit, source, sourceRoot);
}

function placeNativeMatrix(node: SceneNode, matrix: ReturnType<typeof getNodeLocalMatrix>) {
  node.flipX = false; node.flipY = matrix[0]! * matrix[4]! - matrix[1]! * matrix[3]! < 0;
  node.rotation = Math.atan2((node.flipY ? -1 : 1) * matrix[3]!, matrix[0]!) * 180 / Math.PI;
  const zero = getNodeLocalMatrix(node, { x: 0, y: 0 });
  node.x = matrix[2]! - zero[2]!; node.y = matrix[5]! - zero[5]!;
}

function maskRegionEndpoint(source: SceneGraph, parent: SceneNode, chain: NativeMotionRegionChain, renderRoot: SceneNode) {
  const graph = createNativeScratchGraph([...source.nodes.keys(), ...chain.flatMap(snapshot => snapshot.nodes.map(node => node.id))]), page = graph.getPages()[0]!, root = structuredClone(parent);
  Object.assign(root,{ parentId:page.id,x:0,y:0,rotation:0,flipX:false,flipY:false,opacity:1,childIds:[],fills:[],strokes:[],effects:[],clipsContent:false,layoutMode:'NONE',blendMode:'NORMAL',isMask:false,internalOnly:false });
  graph.nodes.set(root.id,root);page.childIds=[root.id];graph.images=new Map(source.images);graph.documentColorSpace=source.documentColorSpace;
  for (const snapshot of chain) {
    for (const raw of snapshot.nodes) {
      if (graph.nodes.has(raw.id)) throw new Error('A native mask-region endpoint has colliding layer IDs.');
      const node=structuredClone(raw);if(node.id===snapshot.rootId)node.parentId=root.id;
      graph.nodes.set(node.id,node);
    }
    root.childIds.push(snapshot.rootId);
  }
  const wrapper = graph.createNode('FRAME', page.id, { width: renderRoot.width, height: renderRoot.height, fills: [], clipsContent: false });
  root.parentId = wrapper.id; wrapper.childIds = [root.id]; page.childIds = [wrapper.id];
  const base = TransformMatrix.invert(getWorldMatrix(renderRoot, source));
  if (!base) throw new Error('This composed artwork has an invalid scene transform.');
  placeNativeMatrix(root, TransformMatrix.multiply(base, getWorldMatrix(parent, source)));
  graph.clearAbsPosCache();return {graph,root:wrapper,parent:root};
}

function captureNativeMaskRegion(kit: CanvasKit, graph: SceneGraph, mask: SceneNode, budget: { pixels: number }, renderRoot: SceneNode, outputBounds: MotionCompositeBounds, rasterScale: number) {
  const mix=getNativeMotionMaskRegion(graph,mask.id)!,parent=mask.parentId&&graph.getNode(mask.parentId);
  if(!parent)throw new Error('A native mask-region coverage plane needs its sampled parent.');
  const from=maskRegionEndpoint(graph,parent,mix.from,renderRoot),to=maskRegionEndpoint(graph,parent,mix.to,renderRoot);
  for (const endpoint of [from,to]) {
    const issue=nativeSceneArtworkPlan(endpoint.graph,endpoint.root,true).issue;
    if(issue)throw new Error(`This mask-region transition needs isolated native coverage: ${issue}`);
  }
  const children = graph.getChildren(parent.id), index = children.findIndex(child => child.id === mask.id), affected: SceneNode[] = [];
  for (let i = index + 1; i < children.length; i++) {
    const child = children[i]!;
    if (child.visible && !child.internalOnly && child.isMask) break;
    if (child.visible && !child.internalOnly) affected.push(child);
  }
  // Empty chains are identity coverage over the affected children, including transparent hit boxes.
  const scene = sceneBounds(graph, renderRoot, affected);
  const fromBounds = mix.from.length ? sceneBounds(from.graph, from.root, from.graph.getChildren(from.parent.id)) : scene;
  const toBounds = mix.to.length ? sceneBounds(to.graph, to.root, to.graph.getChildren(to.parent.id)) : scene;
  const union = alignedNativeMotionBounds(alignedNativeMotionBounds(fromBounds, toBounds, false), scene, false);
  const grid = 2 * rasterScale, minX = outputBounds.minX + Math.floor((union.minX - outputBounds.minX) * grid) / grid, minY = outputBounds.minY + Math.floor((union.minY - outputBounds.minY) * grid) / grid;
  const bounds = { minX, minY, width: outputBounds.minX + Math.ceil((union.minX + union.width - outputBounds.minX) * grid) / grid - minX, height: outputBounds.minY + Math.ceil((union.minY + union.height - outputBounds.minY) * grid) / grid - minY };
  const scale=Math.min(rasterScale,2048/Math.max(bounds.width,bounds.height));
  budget.pixels+=3*Math.max(1,Math.min(4096,Math.ceil(bounds.width*scale*2)))*Math.max(1,Math.min(4096,Math.ceil(bounds.height*scale*2)));
  if(budget.pixels>16*1024*1024)throw new Error('Native mask-region motion exceeds 16 megapixels of coverage per frame.');
  const capture=(endpoint:ReturnType<typeof maskRegionEndpoint>)=>{
    const base = TransformMatrix.invert(getWorldMatrix(endpoint.parent, endpoint.graph));
    if (!base) throw new Error('This composed artwork has an invalid scene transform.');
    const corners = [[bounds.minX,bounds.minY],[bounds.minX+bounds.width,bounds.minY],[bounds.minX+bounds.width,bounds.minY+bounds.height],[bounds.minX,bounds.minY+bounds.height]].map(([x,y])=>TransformMatrix.mapPoint(base,{x:x!,y:y!}));
    const x = Math.min(...corners.map(point=>point.x)), y = Math.min(...corners.map(point=>point.y));
    const logicalX = affected.length ? Math.min(...affected.map(child=>child.x)) : 0, logicalY = affected.length ? Math.min(...affected.map(child=>child.y)) : 0;
    const logicalWidth = affected.length ? Math.max(...affected.map(child=>child.x+child.width))-logicalX : 1, logicalHeight = affected.length ? Math.max(...affected.map(child=>child.y+child.height))-logicalY : 1;
    const width = Math.max(...corners.map(point=>point.x))-x, height = Math.max(...corners.map(point=>point.y))-y;
    // Paint spans the crop; its logical box must preserve the semantic children's native mask-layer bounds.
    endpoint.graph.createNode('VECTOR',endpoint.parent.id,{x:logicalX,y:logicalY,width:logicalWidth,height:logicalHeight,fills:[white],vectorNetwork:{vertices:[{x:x-logicalX,y:y-logicalY},{x:x+width-logicalX,y:y-logicalY},{x:x+width-logicalX,y:y+height-logicalY},{x:x-logicalX,y:y+height-logicalY}],segments:[0,1,2,3].map(start=>({start,end:(start+1)%4,tangentStart:{x:0,y:0},tangentEnd:{x:0,y:0}})),regions:[{windingRule:'NONZERO',loops:[[0,1,2,3]]}]}});
    return renderPreparedNativeSceneImage(kit,endpoint.graph,endpoint.root,bounds,true,scale);
  };
  const a=capture(from),b=capture(to);
  return {...a,bytes:blendNativeMotionImages(kit,a,b,mix.progress)};
}

function renderPreparedNativeSceneImage(kit: CanvasKit, source: SceneGraph, sourceRoot: SceneNode, bounds?: MotionCompositeBounds, supersampled = false, rasterScale?: number) {
  const graph = cloneDesignSubgraph(source, [sourceRoot.id]), root = graph.getNode(sourceRoot.id)!;
  inheritNativeMotionComposites(source, graph);
  Object.assign(root, { x: 0, y: 0, rotation: 0, opacity: 1, visible: true, flipX: false, flipY: false }); graph.clearAbsPosCache();
  const groups = new Map<string, NativeMaskRegion[]>(), masks: SceneNode[] = [];
  const collect = (parent: SceneNode, insideMask = false) => {
    if (!parent.visible || parent.internalOnly) return;
    const children = graph.getChildren(parent.id), regions: NativeMaskRegion[] = [];
    for (let i = 0; i < children.length;) {
      if (!children[i]!.visible || children[i]!.internalOnly || !children[i]!.isMask) { collect(children[i++]!, insideMask); continue; }
      const region: NativeMaskRegion = { masks: [], children: [], path: '' };
      while (i < children.length && children[i]!.visible && !children[i]!.internalOnly && children[i]!.isMask) {
        const mask = children[i++]!; collect(mask, true); masks.push(mask); region.masks.push(mask.id);
      }
      while (i < children.length && !(children[i]!.visible && !children[i]!.internalOnly && children[i]!.isMask)) { const child = children[i++]!; collect(child, insideMask); if (child.visible && !child.internalOnly) region.children.push(child.id); }
      regions.push(region);
    }
    if (regions.length && !insideMask) groups.set(parent.id, regions);
  };
  collect(root);
  const outputBounds = bounds ?? sceneBounds(graph, root), outputScale = rasterScale ?? Math.min(2, 2048 / Math.max(outputBounds.width, outputBounds.height));
  if (masks.length > 128) throw new Error('This scene exceeds the 128 native mask allowance.');
  let maskBytes = 0, hitPixels = 0, hitBytes = 0, motionMaskPixels = 0;
  const regionBudget = { pixels:0 };
  for (const mask of masks) {
    const transform = getNodeLocalMatrix(mask), mix = getNativeMotionMask(graph, mask.id), mixing = !!mix && mix.progress > 0 && mix.progress < 1, combined = !!getNativeMotionMaskRegion(graph,mask.id);
    let artwork: ReturnType<typeof captureNativeSceneImage>, outputType: SceneNode['maskType'], opacity: number;
    if (combined) {
      artwork=captureNativeMaskRegion(kit,graph,mask,regionBudget,root,outputBounds,outputScale);outputType='ALPHA';opacity=1;
    } else if (mixing) {
      const from = prepareNativeMaskSource(kit, graph, mask, mix.from), to = prepareNativeMaskSource(kit, graph, mask, mix.to), bounds = alignedNativeMotionBounds(sceneBounds(from.graph, from.root), sceneBounds(to.graph, to.root), false);
      const scale = Math.min(2, 2048 / Math.max(bounds.width, bounds.height));
      motionMaskPixels += 4 * Math.max(1, Math.min(2048, Math.ceil(bounds.width * scale))) * Math.max(1, Math.min(2048, Math.ceil(bounds.height * scale)));
      if (motionMaskPixels > 16 * 1024 * 1024) throw new Error('Native mask motion exceeds 16 megapixels of coverage per frame.');
      const a = captureNativeSceneImage(kit, from.graph, from.root, bounds), b = captureNativeSceneImage(kit, to.graph, to.root, bounds);
      artwork = { ...a, bytes: blendNativeMotionImages(kit, a, b, mix.progress, { from: { opacity: from.maskType === 'VECTOR' ? 1 : mask.opacity, luminance: from.maskType === 'LUMINANCE' }, to: { opacity: to.maskType === 'VECTOR' ? 1 : mask.opacity, luminance: to.maskType === 'LUMINANCE' } }) };
      outputType = 'ALPHA'; opacity = 1;
    } else {
      const endpoint = mix ? mix.progress <= 0 ? mix.from : mix.to : undefined, capture = prepareNativeMaskSource(kit, graph, mask, endpoint);
      artwork = captureNativeSceneImage(kit, capture.graph, capture.root); outputType = capture.maskType; opacity = outputType === 'VECTOR' ? 1 : mask.opacity;
    }
    maskBytes += artwork.bytes.byteLength;
    if (maskBytes > 24 * 1024 * 1024) throw new Error('This scene exceeds the 24 MB native mask source allowance.');
    const hash = `orion.presentation-mask/${mask.id}`;
    if (graph.images.has(hash)) throw new Error('A native mask resource identity is already in use.');
    graph.images.set(hash, artwork.bytes);
    Object.assign(mask, { type: 'RECTANGLE', maskType: outputType, width: artwork.width / artwork.scale, height: artwork.height / artwork.scale, childIds: [], fills: [{ type: 'IMAGE', visible: true, opacity, imageHash: hash, imageScaleMode: 'FILL' }], strokes: [], effects: [], cornerRadius: 0, independentCorners: false, independentStrokeWeights: false, opacity: 1, clipsContent: false, blendMode: 'NORMAL', layoutMode: 'NONE' });
    if (combined) {
      const parent = graph.getNode(mask.parentId!)!, base = TransformMatrix.invert(getWorldMatrix(parent, graph));
      if (!base) throw new Error('This composed artwork has an invalid scene transform.');
      placeNativeMatrix(mask, TransformMatrix.multiply(base, TransformMatrix.multiply(getWorldMatrix(root,graph), [1,0,artwork.bounds.minX,0,1,artwork.bounds.minY,0,0,1])));
    } else {
      const zero = getNodeLocalMatrix(mask, { x: 0, y: 0 });
      mask.x = transform[2]! + transform[0]! * artwork.bounds.minX + transform[1]! * artwork.bounds.minY - zero[2]!;
      mask.y = transform[5]! + transform[3]! * artwork.bounds.minX + transform[4]! * artwork.bounds.minY - zero[5]!;
    }
    graph.clearAbsPosCache();
  }
  if (!supersampled) for (const [id, regions] of groups) {
    for (const region of regions) {
      if (!region.children.length) continue;
      const capture = cloneDesignSubgraph(graph, [id]), isolated = capture.getNode(id)!;
      Object.assign(isolated, { fills: [], strokes: [], effects: [], childIds: [...region.masks] }); capture.clearAbsPosCache();
      const box = sceneBounds(capture, isolated), covering = capture.createNode('RECTANGLE', isolated.id, { x: box.minX, y: box.minY, width: box.width, height: box.height, fills: [white] });
      isolated.childIds = [...region.masks, covering.id];
      const artwork = captureNativeSceneHitPath(kit, capture, isolated);
      hitPixels += artwork.width * artwork.height;
      if (hitPixels > 16 * 1024 * 1024) throw new Error('This scene exceeds the 16-megapixel native mask hit-region allowance.');
      region.path = artwork.path;
      hitBytes += region.path.length;
      if (hitBytes > 8 * 1024 * 1024) throw new Error('This scene exceeds the 8 MB native mask hit-region allowance.');
    }
  }
  const size = { width: root.width, height: root.height }, mixedRoot = hasNativeMotionComposite(graph, root.id);
  materializeNativeMotionComposites(kit, graph, root.id, sceneBounds, (scene, node, aligned) => captureNativeSceneImage(kit, scene, node, aligned, true));
  const artwork = captureNativeSceneImage(kit, graph, motionPaintRoot(graph, root, size, mixedRoot), bounds, supersampled, rasterScale);
  return { ...artwork, maskRegions: groups };
}

/** Capture one layer's own native pixels so DOM scrolling/fixed/video surfaces can keep live ancestry. */
export function renderNativeReactLayer(kit: CanvasKit, source: SceneGraph, nodeId: string) {
  const authored = source.getNode(nodeId);
  if (!authored) throw new Error('Restore this native layer before capturing its artwork.');
  const graph = createNativeScratchGraph(source.nodes.keys()), page = graph.getPages()[0]!, root = structuredClone(authored);
  if (root.isMask) throw new Error('Render the containing static mask region as a native scene.');
  if (root.fills.some(fill => fill.visible && fill.type === 'VIDEO')) throw new Error('Live video surfaces must stay outside native layer artwork.');
  if (Object.keys(root.boundVariables).length) throw new Error('Resolve this layer’s prototype variables before capturing native artwork.');
  root.childIds = [];
  root.parentId = page.id;
  if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(root.type)) { root.type = 'FRAME'; root.componentId = null; }
  graph.nodes.set(root.id, root); page.childIds = [root.id];
  graph.images = new Map(source.images); graph.documentColorSpace = source.documentColorSpace;
  inheritNativeMotionComposites(source, graph);
  graph.clearAbsPosCache();
  const size = { width: root.width, height: root.height }, mixedRoot = hasNativeMotionComposite(graph, root.id);
  Object.assign(root, { x: 0, y: 0, rotation: 0, opacity: 1, visible: true, flipX: false, flipY: false }); graph.clearAbsPosCache();
  materializeNativeMotionComposites(kit, graph, root.id, sceneBounds, (scene, node, aligned) => captureNativeSceneImage(kit, scene, node, aligned, true), undefined, true);
  return { nodeId, ...captureNativeSceneImage(kit, graph, motionPaintRoot(graph, root, size, mixedRoot)) };
}

function motionPaintRoot(graph: SceneGraph, node: SceneNode, size: { width: number; height: number }, mixed: boolean) {
  if (!mixed) return node;
  const wrapper = graph.createNode('FRAME', node.parentId!, { name: 'Native appearance bounds', ...size, fills: [], clipsContent: false });
  wrapper.childIds = [node.id]; node.parentId = wrapper.id; graph.clearAbsPosCache();
  return wrapper;
}

/** Capture one static mask run in its parent coordinate space for a synthetic React mask wrapper. */
export function renderNativeSceneRegion(kit: CanvasKit, source: SceneGraph, parentId: string, members: readonly string[]) {
  const graph = cloneDesignSubgraph(source, [parentId]), parent = graph.getNode(parentId);
  inheritNativeMotionComposites(source, graph);
  if (!parent || !members.length) throw new Error('Choose a nonempty native mask region.');
  const selected = new Set(members);
  if (selected.size !== members.length || members.some(id => !graph.getNode(id) || graph.getNode(id)!.parentId !== parentId)) throw new Error('A native mask region must contain distinct direct children of its parent.');
  const children = graph.getChildren(parentId), positions = members.map(id => children.findIndex(child => child.id === id));
  if (positions.some((position, index) => position < 0 || index > 0 && position !== positions[index - 1]! + 1)) throw new Error('A native mask region must be a contiguous authored sibling run.');
  let painted = false;
  if (!graph.getNode(members[0]!)!.isMask) throw new Error('A native mask region must start with its masks, followed by masked children.');
  for (const id of members) {
    const node = graph.getNode(id)!;
    if (node.isMask && node.visible && !node.internalOnly) { if (painted) throw new Error('Keep consecutive masks before their masked children.'); }
    else painted = true;
  }
  const pending = [...members], seen = new Set<string>();
  while (pending.length) {
    const node = source.getNode(pending.pop()!)!;
    if (seen.has(node.id) || seen.size >= 20_000) throw new Error('This native mask region exceeds its layer allowance or contains a cycle.');
    seen.add(node.id); if (!node.visible || node.internalOnly) continue;
    const scrolling = readPrototypeScroll(node), positioning = readScrollBehaviour(node, source);
    if (Object.keys(node.boundVariables).length || scrolling.issue || scrolling.settings.axis !== 'none' || positioning.issue || positioning.behaviour !== 'scroll' || node.fills.some(fill => fill.visible && fill.type === 'VIDEO') || node.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR') || !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)) throw new Error('Resolve dynamic artwork and external backdrops before capturing this static mask region.');
    if ((node.layoutMode !== 'NONE' || node.layoutGrow) && !hasNativeSceneLayout(source)) throw new Error('Prepare native layout before capturing this static mask region.');
    if ((node.type === 'INSTANCE' || node.componentPropertyReferences.length) && !hasNativeSceneComponent(source, node) && !(hasNativeComponentProperties(source, node) && hasNativeControlHost(source, node))) throw new Error('Prepare native component values before capturing this static mask region.');
    pending.push(...node.childIds);
  }
  Object.assign(parent, { childIds: [...members], fills: [], strokes: [], effects: [], opacity: 1, blendMode: 'PASS_THROUGH', layoutMode: 'NONE' });
  graph.clearAbsPosCache();
  const artwork = renderPreparedNativeSceneImage(kit, graph, parent), regions = artwork.maskRegions.get(parentId) ?? [];
  const region = regions.find(item => item.masks[0] === members[0]);
  if (!region || region.masks.length + region.children.length !== members.length || [...region.masks, ...region.children].some((id, index) => id !== members[index])) throw new Error('The native renderer could not preserve the selected mask-region membership.');
  return { parentId, regionId: members[0]!, members: [...members], bytes: artwork.bytes, width: artwork.width, height: artwork.height, scale: artwork.scale, bounds: artwork.bounds, imageStyle: artwork.style, maskRegions: new Map([[parentId, [region]]]) };
}

type NativeCaptureGeometry = { style: { left: string; top: string; right: string; bottom: string; width: string; height: string }; bounds: MotionCompositeBounds; scale: number; width: number; height: number };

function captureNativeSceneImage(kit: CanvasKit, graph: SceneGraph, root: SceneNode, alignedBounds?: MotionCompositeBounds, supersampled = false, rasterScale?: number) {
  return captureNativeScene(kit, graph, root, (image, geometry) => {
    const bytes = image.encodeToBytes(kit.ImageFormat.PNG);
    if (!bytes) throw new Error(supersampled ? 'This group could not encode its supersampled scene pixels.' : 'This group could not encode its composed PNG.');
    return { ...geometry, bytes: new Uint8Array(bytes) };
  }, alignedBounds, supersampled, rasterScale);
}

function captureNativeSceneHitPath(kit: CanvasKit, graph: SceneGraph, root: SceneNode) {
  return captureNativeScene(kit, graph, root, (image, geometry) => {
    const { width, height, scale, bounds } = geometry;
    let pixels: MallocObj | undefined, failure: { reason: unknown } | undefined;
    try {
      pixels = kit.Malloc(Uint8Array, width * height);
      // Caller-owned storage avoids CanvasKit's allocating wrapper, which supports RGBA only.
      const alpha = image.readPixels(0, 0, { width, height, colorType: kit.ColorType.Alpha_8, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB }, pixels, width);
      if (!(alpha instanceof Uint8Array) || alpha.length !== width * height) throw new Error('This scene could not read its native mask hit-region pixels.');
      return { ...geometry, path: nativeMaskAlphaPath(alpha, width, height, scale, bounds.minX, bounds.minY) };
    } catch (error) { failure = { reason: error }; throw error; }
    finally { releaseNativeResources([() => { if (pixels) kit.Free(pixels); }], failure); }
  });
}

function captureNativeScene<Output>(kit: CanvasKit, graph: SceneGraph, root: SceneNode, finish: (image: Image, geometry: NativeCaptureGeometry) => Output, alignedBounds?: MotionCompositeBounds, supersampled = false, rasterScale?: number) {
  Object.assign(root, { x: 0, y: 0, rotation: 0, opacity: 1, visible: true, flipX: false, flipY: false }); graph.clearAbsPosCache();
  const bounds = alignedBounds ?? sceneBounds(graph, root), scale = Math.min(rasterScale ?? 2, 2048 / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.min(2048, Math.ceil(bounds.width * scale))), height = Math.max(1, Math.min(2048, Math.ceil(bounds.height * scale)));
  const highWidth = supersampled ? Math.max(1, Math.min(4096, Math.ceil(bounds.width * scale * 2))) : width * 2, highHeight = supersampled ? Math.max(1, Math.min(4096, Math.ceil(bounds.height * scale * 2))) : height * 2;
  const paintWidth = supersampled ? highWidth / (2 * scale) : width / scale, paintHeight = supersampled ? highHeight / (2 * scale) : height / scale;
  const imageStyle = { left: root.width > 0 ? `${100 * bounds.minX / root.width}%` : `${bounds.minX}px`, top: root.height > 0 ? `${100 * bounds.minY / root.height}%` : `${bounds.minY}px`, right: 'auto', bottom: 'auto', width: root.width > 0 ? `${100 * paintWidth / root.width}%` : `${paintWidth}px`, height: root.height > 0 ? `${100 * paintHeight / root.height}%` : `${paintHeight}px` };
  let high: Surface | null = null, low: Surface | null = null, highPixels: MallocObj | undefined, lowPixels: MallocObj | undefined, renderer: SkiaRenderer | undefined, image: Image | undefined, output: Image | undefined, provider: TypefaceFontProvider | undefined, failure: { reason: unknown } | undefined;
  try {
    highPixels = kit.Malloc(Uint8Array, highWidth * highHeight * 4);
    high = kit.MakeRasterDirectSurface({ width: highWidth, height: highHeight, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, highPixels, highWidth * 4);
    if (!high) throw new Error('This group could not allocate its supersampled scene surface.');
    if (!supersampled) {
      lowPixels = kit.Malloc(Uint8Array, width * height * 4);
      low = kit.MakeRasterDirectSurface({ width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, lowPixels, width * 4);
      if (!low) throw new Error('This group could not allocate its premultiplied scene surface.');
    }
    renderer = createNativeRenderer(kit, high); renderer.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
    attachNativeSceneFonts(renderer, kit, nativeSceneTextNodes(graph, [root.id]), value => { provider = value; });
    const canvas = high.getCanvas(); canvas.clear(kit.TRANSPARENT); canvas.scale(2 * scale, 2 * scale); canvas.translate(-bounds.minX, -bounds.minY);
    renderer.renderNode(canvas, graph, root.id, {}); high.flush();
    image = high.makeImageSnapshot();
    if (supersampled) {
      return finish(image, { style: imageStyle, bounds, scale: scale * 2, width: highWidth, height: highHeight });
    }
    const downsample = low!.getCanvas(); downsample.clear(kit.TRANSPARENT); downsample.drawImageRectOptions(image, kit.LTRBRect(0, 0, highWidth, highHeight), kit.LTRBRect(0, 0, width, height), kit.FilterMode.Linear, kit.MipmapMode.None, null); low!.flush();
    output = low!.makeImageSnapshot();
    return finish(output, { style: imageStyle, bounds, scale, width, height });
  } catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => output?.delete(), () => image?.delete(), () => renderer?.textPreparationCache.clear(), () => renderer?.labelParagraphCache.clear(), () => renderer ? destroyNativeRenderer(renderer) : high?.delete(), () => { if (provider && !provider.isDeleted()) provider.delete(); }, () => { if (provider) fontManager.detachProvider(provider); }, () => low?.delete(), () => freeNativeSurfacePixels(kit, high, highPixels), () => freeNativeSurfacePixels(kit, low, lowPixels)], failure); }
}
