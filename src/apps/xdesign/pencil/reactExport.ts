import { assetCredits as readAssetCredits } from "./assetCredits";
import type { AssetCredit } from "./assetService";
import { createEditor } from '@open-pencil/core/editor';
import { computeLayout } from '@open-pencil/core/layout';
import { prepareGraphFonts } from '@open-pencil/core/text';
import { renderNodesToSVG } from '@open-pencil/core/io';
import type { SkiaRenderer } from '@open-pencil/core/canvas';
import { getAxisAlignedWorldBounds, getNodeLocalMatrix, getWorldMatrix, TransformMatrix, type Mat3, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit, MallocObj, Surface } from 'canvaskit-wasm';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';
import type { CSSProperties } from 'react';
import runtimeSource from './reactExportRuntime.tsx?raw';
import valuesSource from './prototypeValues.ts?raw';
import { capturePrototypeVariables, materializePrototypeBindings, prototypeNodeModes } from './prototypeVariableGraph';
import type { PrototypeSession, PrototypeVariables } from './prototypeValues';
import { allDesignActions, mapDesignActions } from './reactExportRuntime';
import type { DesignControl, DesignControlSession, DesignNode, DesignSelectionGeometry } from './reactExportRuntime';
import { behaviourOwner, readBehaviour } from './behaviour/model';
import { mainSlotComponent, slotPropertyId } from './slots';
import { bakeProceduralPaints } from './proceduralExport';
import { renderDesignNodes } from './proceduralPaints';
import { textRuns, textStyle } from './reactExportText';

import { cloneDesignSubgraph } from './graphSubset';
import { inheritNativeMotionComposites } from './nativeReactMotionComposite';
import { prototypeResolver, readPrototype } from './prototype';
import { readPrototypeOverlay } from './prototypeOverlay';
import { readPrototypeScroll, readScrollBehaviour, scrollContainer } from './prototypeScroll';
import { installVideoPaints, videoAsset, videoDataUrl } from './videoPaints';
import { prototypeMotionMetadata } from './prototypeMotionMetadata';
import { PrototypePaintSources, nativePaintEligible, registerNativePaintSources, renderNativePaintImage } from './prototypeNativePaint';
import { artworkInsetStyle, nativeAppearance, nativeArtworkInsets } from './prototypeNativeAppearance';
import { nativeSceneArtworkPlan, renderNativeSceneImage, renderNativeReactLayer, renderNativeSceneRegion, type NativeMaskRegion } from './nativeSceneArtwork';
import { planNativeReactComposition, type NativeReactCompositionPart } from './nativeReactComposition';
import { hasNativeSceneLayout, prepareNativeSceneLayout } from './nativeSceneLayout';
import { applyNativeMaskVisibility } from './nativeMaskVisibility';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import { describeNativeControl, enableNativeControlHost, finishNativeSceneControls, preparedNativeControl, prepareNativeSceneControls } from './nativeSceneControls';
import { exportedRangeGeometry, exportedThumbGeometry } from './nativeControlGeometry';
export { cloneDesignSubgraph as cloneReactExportGraph } from './graphSubset';

const MAX_EXPORT_NODES = 20_000;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_VARIANTS = 128;
const cssMatrix = (matrix: Mat3, translation = false) => `matrix(${matrix[0]},${matrix[3]},${matrix[1]},${matrix[4]},${translation ? matrix[2] : 0},${translation ? matrix[5] : 0})`;
export function reactExportNeedsRenderer(graph: SceneGraph) {
  return [...graph.nodes.values()].some(node => node.isMask || node.type !== 'TEXT' && (node.fills.some(fill => fill.visible && fill.type !== 'SOLID') || node.fills.filter(fill => fill.visible).length > 1 || node.effects.some(effect => effect.visible) || node.independentStrokeWeights));
}
export function reactComponentName(name: string) {
  return (name.match(/[a-z][a-z0-9]*/gi) ?? []).map(word => word[0]!.toUpperCase() + word.slice(1)).join('').slice(0, 80) || 'DesignComponent';
}

function nodeStyle(node: SceneNode, parent?: SceneNode, portablePivot = false): CSSProperties {
  const flow = parent && (parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL') && node.layoutPositioning !== 'ABSOLUTE';
  const centered = portablePivot && node.type !== 'LINE';
  const style: CSSProperties = {
    position: flow ? 'relative' : 'absolute', left: flow ? undefined : node.x, top: flow ? undefined : node.y,
    width: node.width, height: node.height, flexShrink: 0, boxSizing: 'border-box', opacity: node.opacity,
    borderRadius: node.clipsContent && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type) ? node.independentCorners ? `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px` : node.cornerRadius : undefined, transform: node.rotation || node.flipX || node.flipY ? cssMatrix(getNodeLocalMatrix(node, { x: 0, y: 0 }), !centered) : undefined,
    transformOrigin: centered ? '50% 50%' : '0 0', direction: node.layoutDirection === 'AUTO' ? undefined : node.layoutDirection.toLowerCase() as 'ltr' | 'rtl',
  };
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    Object.assign(style, { display: 'flex', flexDirection: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
      flexWrap: node.layoutWrap === 'WRAP' ? 'wrap' : 'nowrap', gap: node.itemSpacing,
      justifyContent: ({ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' } as const)[node.primaryAxisAlign],
      alignItems: ({ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline', STRETCH: 'stretch' } as const)[node.counterAxisAlign],
      padding: `${node.paddingTop}px ${node.paddingRight}px ${node.paddingBottom}px ${node.paddingLeft}px` });
  }
  if (flow && node.layoutGrow) { style.flexGrow = node.layoutGrow; if (parent.layoutMode === 'HORIZONTAL') style.width = 0; else style.height = 0; }
  if (node.type === 'TEXT') {
    Object.assign(style, textStyle(node), {
      textAlign: node.textAlignHorizontal === 'JUSTIFIED' ? 'justify' : node.textAlignHorizontal.toLowerCase(), whiteSpace: 'pre-wrap',
      direction: node.textDirection === 'AUTO' ? undefined : node.textDirection.toLowerCase(),
      textTransform: node.textCase === 'UPPER' ? 'uppercase' : node.textCase === 'LOWER' ? 'lowercase' : node.textCase === 'TITLE' ? 'capitalize' : undefined });
  }
  return style;
}

function cssSolidPaint(node: SceneNode, boundContainer = false) {
  const fill = node.fills.filter(value => value.visible), radii = node.independentCorners ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] : [node.cornerRadius];
  const smoothed = node.type !== 'ELLIPSE' && node.cornerSmoothing > 0 && radii.some(radius => radius > 0);
  if (!(['FRAME', 'RECTANGLE', 'ROUNDED_RECTANGLE', 'ELLIPSE'].includes(node.type) || boundContainer && ['COMPONENT', 'INSTANCE'].includes(node.type)) || node.isMask || smoothed || radii.some(radius => !Number.isFinite(radius) || radius < 0) || node.arcData || node.vectorNetwork || node.fillGeometry.length || node.strokeGeometry.length || node.strokes.some(stroke => stroke.visible) || node.effects.some(effect => effect.visible) || node.independentStrokeWeights || node.borderTopWeight || node.borderRightWeight || node.borderBottomWeight || node.borderLeftWeight || fill.length !== 1 || fill[0]!.type !== 'SOLID' || !fill[0]!.color || fill[0]!.opacity !== 1 || fill[0]!.color.a !== 1 || fill[0]!.blendMode && fill[0]!.blendMode !== 'NORMAL' || !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)) return;
  const paint = fill[0]!, alpha = (paint.opacity ?? 1) * paint.color!.a;
  return { color: `rgba(${paint.color!.r * 255},${paint.color!.g * 255},${paint.color!.b * 255},${alpha})`, radius: node.type === 'ELLIPSE' ? '50%' : node.independentCorners ? `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px` : `${node.cornerRadius}px` };
}

export type DesignModel = { nodes: DesignNode[]; width: number; height: number; byteLength: number; prototypeIssues: string[]; assetCredits: AssetCredit[]; prototypeVariables?: PrototypeVariables };
function realizeExportRoots(graph: SceneGraph, ids: readonly string[], controlScope?: string) {
  const selected = new Set(ids), roots = [...selected].filter(id => {
    let parent = graph.getNode(id)?.parentId;
    while (parent) { if (selected.has(parent)) return false; parent = graph.getNode(parent)?.parentId; }
    return true;
  });
  const nodes = new Map<string, string>(), keys = new Map<string, string>();
  for (const id of roots) {
    const original = graph.getNode(id)!;
    const main = original.type === 'COMPONENT_SET' ? graph.getChildren(id).find(child => child.type === 'COMPONENT') : original;
    if (!main) throw new Error('This component set is empty.');
    let node = main;
    if (main.type === 'COMPONENT') {
      const pending = [...main.childIds]; let added = 1;
      while (pending.length) { const child = graph.getNode(pending.pop()!)!; added++; pending.push(...child.childIds); }
      if (graph.nodes.size + added > MAX_EXPORT_NODES) throw new Error('Export a smaller selection; this component root exceeds 20,000 dependent layers.');
      let page = original; while (page.parentId && page.type !== 'CANVAS') page = graph.getNode(page.parentId)!;
      node = graph.createInstance(main.id, page.id, { x: 0, y: 0 })!;
    }
    nodes.set(id, node.id); keys.set(node.id, controlScope ? JSON.stringify(['overlay', controlScope, id]) : id);
  }
  return { roots, nodes, keys, ids: [...nodes.values()] };
}
export async function prepareDesignModelFonts(source: SceneGraph, ids: readonly string[], session?: PrototypeSession, controls?: DesignControlSession, controlScope?: string) {
  const graph = cloneDesignSubgraph(source, ids);
  prepareNativeSceneComponents(graph, ids);
  const selection = realizeExportRoots(graph, ids, controlScope);
  prepareNativeSceneComponents(graph, selection.ids);
  if (controls) {
    materializePrototypeBindings(graph, capturePrototypeVariables(source, graph.nodes.values()), session, { detachResolved: true });
    prepareNativeSceneControls(graph, selection.ids, controls, selection.keys);
  }
  if (![...graph.nodes.values()].some(node => node.isMask || node.layoutMode !== 'NONE' || node.layoutGrow || node.childIds.length && node.effects.some(effect => effect.visible && ['LAYER_BLUR', 'FOREGROUND_BLUR'].includes(effect.type)))) return;
  if (!controls) materializePrototypeBindings(graph, capturePrototypeVariables(source, graph.nodes.values()), session, { detachResolved: true });
  await prepareGraphFonts(graph, selection.ids);
}
export function selectionToDesignModel(source: SceneGraph, ids: readonly string[], canvasKit?: CanvasKit, presentation = false, session?: PrototypeSession, controls?: DesignControlSession, controlHost = false, controlScope?: string, nativeScene = false, preparedScene?: (graph: SceneGraph, ids: readonly string[]) => void): DesignModel {
  const paintSources = presentation && canvasKit ? new PrototypePaintSources(canvasKit) : undefined;
  const prototypeIssues = new Set<string>();
  if (!ids.length) throw new Error('Select design layers to export to React.');
  const graph = cloneDesignSubgraph(source, ids);
  const resolvePrototype = prototypeResolver(source, [], graph);
  inheritNativeMotionComposites(source, graph);
  prepareNativeSceneComponents(graph, ids);
  const selection = realizeExportRoots(graph, ids, controlScope);
  prepareNativeSceneComponents(graph, selection.ids);
  const authoredGeometry = new Map([...graph.nodes.values()].map(node => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height, parentWidth: node.parentId ? graph.getNode(node.parentId)?.width ?? 0 : 0, parentHeight: node.parentId ? graph.getNode(node.parentId)?.height ?? 0 : 0 }]));
  const geometryFields = new Set(['x', 'y', 'width', 'height', 'rotation']);
  const layoutFields = new Set(['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'counterAxisSpacing', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'gridRowGap', 'gridColumnGap']);
  const geometryNodes = new Map<string, SceneNode>();
  const includeGeometryNode = (id: string) => { if (geometryNodes.has(id)) return; const node = graph.getNode(id)!; if (node.parentId) includeGeometryNode(node.parentId); geometryNodes.set(id, node); };
  if (!presentation && !nativeScene && !preparedScene) selection.roots.forEach(includeGeometryNode);
  // Constraints must start from authored rectangles, before any default mode rounds a SCALE result.
  const authoredSelectionGeometry = new Map<string, DesignSelectionGeometry>([...geometryNodes.values()].map(node => {
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined, scale = parent && ['GROUP', 'BOOLEAN_OPERATION'].includes(parent.type);
    const constrained = parent && ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'BOOLEAN_OPERATION'].includes(parent.type) && (parent.layoutMode === 'NONE' || node.layoutPositioning === 'ABSOLUTE');
    const bindings = Object.fromEntries(Object.entries(node.boundVariables).filter(([field]) => geometryFields.has(field)));
    return [node.id, { id: node.id, ...(node.parentId ? { parentId: node.parentId } : {}), x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation, flipX: node.flipX, flipY: node.flipY, line: node.type === 'LINE', ...(constrained ? { constraint: { horizontal: scale ? 'SCALE' : node.horizontalConstraint, vertical: scale ? 'SCALE' : node.verticalConstraint } } : {}), bindings, modes: Object.keys(bindings).length ? prototypeNodeModes(graph, node) : {} }];
  }));
  const geometryContexts = new Map<string, { dynamic: boolean; layout: boolean; bindings: boolean }>(), selectionGeometry = new Map<string, DesignSelectionGeometry>();
  const geometryContext = (node: SceneNode): { dynamic: boolean; layout: boolean; bindings: boolean } => {
    const cached = geometryContexts.get(node.id); if (cached) return cached;
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined, inherited = parent ? geometryContext(parent) : undefined;
    const fields = Object.keys(node.boundVariables), bindings = fields.some(field => layoutFields.has(field));
    const result = { dynamic: !!inherited?.dynamic || bindings || fields.some(field => geometryFields.has(field)), bindings: !!inherited?.bindings || bindings, layout: !!inherited?.layout || node.layoutMode === 'GRID' || node.primaryAxisSizing !== 'FIXED' || node.counterAxisSizing !== 'FIXED' || !!parent && parent.layoutMode !== 'NONE' && node.layoutPositioning !== 'ABSOLUTE' || node.layoutGrow > 0 && node.layoutPositioning !== 'ABSOLUTE' };
    geometryContexts.set(node.id, result); return result;
  };
  const includeSelectionGeometry = (id: string) => {
    if (selectionGeometry.has(id)) return;
    const geometry = authoredSelectionGeometry.get(id)!;
    if (geometry.parentId) includeSelectionGeometry(geometry.parentId);
    selectionGeometry.set(id, geometry);
  };
  const definitions = capturePrototypeVariables(source, graph.nodes.values());
  const variablePlayback = [...graph.nodes.values()].some(node => (readPrototype(node, resolvePrototype).interactions ?? []).some(interaction => allDesignActions(interaction.navigation).some(action => ['set-variable', 'set-mode'].includes(action.action))));
  materializePrototypeBindings(graph, definitions, session, { detachResolved: presentation });
  if (controls) prepareNativeSceneControls(graph, selection.ids, controls, selection.keys);
  if (presentation && canvasKit) { const layout = prepareNativeSceneLayout(canvasKit, graph, selection.ids); if (layout.issue) prototypeIssues.add(layout.issue); }
  if (controls) finishNativeSceneControls(graph);
  if (presentation && canvasKit && controls && controlHost) enableNativeControlHost(graph);
  const editor = createEditor({ graph });
  editor.undo.push = () => undefined;
  let page = graph.getNode(ids[0]!)!;
  while (page.parentId && page.type !== 'CANVAS') page = graph.getNode(page.parentId)!;
  editor.state.currentPageId = page.id;
  const procedural = [...graph.nodes.values()].some(node => node.fills.some(fill => fill.visible && ['PATTERN', 'NOISE', 'CUSTOM'].includes(fill.type)));
  if (procedural) {
    if (!canvasKit) { editor.dispose(); throw new Error('Wait for the design canvas to load before exporting its textures.'); }
    try { bakeProceduralPaints(graph, canvasKit, true); }
    catch (error) { editor.dispose(); throw error; }
  }
  let count = 0;
  const active = new Set<string>();
  const svgCache = new Map<string, { src: string; style?: CSSProperties }>();
  let renderer: SkiaRenderer | undefined;
  let rendererPixels: MallocObj | undefined;
  let rendererSurface: Surface | undefined;
  let failure: { reason: unknown } | undefined;
  const nativeScenes = new Set<string>(), nativeLayers = new Set<string>();
  const nativeRegions = new Map<string, Extract<NativeReactCompositionPart, { kind: 'scene-region' }>[]>();
  let nativeImageBytes = 0;
  const nativeImage = (bytes: Uint8Array) => {
    nativeImageBytes += 4 * Math.ceil(bytes.byteLength / 3);
    if (nativeImageBytes > MAX_EXPORT_BYTES) throw new Error('This native design exceeds 32 MB of rendered artwork; select a smaller screen.');
    let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return `data:image/png;base64,${btoa(binary)}`;
  };
  type BindingContext = { values: Map<string, string>; parts: Map<string, string> };
  const originalLayers = new WeakMap<DesignNode, SceneNode>();
  const mediaOrigins = new WeakMap<DesignNode, { id: string; template?: string; instance: boolean }>();
  const rootRotationBindings = new Set<string>();
  const measuredFrames = new Set<string>();
  const measuredFlows = new Set<string>();
  const ordinaryFlowSource = (node: SceneNode) => source.getNode(node.id)?.type === 'FRAME' && node.type === 'FRAME' && !node.isMask && !node.derivedLayout && node.source.format !== 'fig' && !node.effects.some(effect => effect.visible) && !node.strokes.some(stroke => stroke.visible) && (!node.clipsContent || node.cornerSmoothing === 0 && (node.independentCorners ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] : [node.cornerRadius]).every(radius => Number.isFinite(radius) && radius >= 0));
  const measurableFrame = (node: SceneNode, parent: SceneNode | undefined) => !presentation && !nativeScene && !preparedScene && !hasNativeSceneLayout(graph) && !selection.ids.includes(node.id) && !node.isMask && !node.derivedLayout && node.source.format !== 'fig' && source.getNode(node.id)?.type === 'FRAME' && node.type === 'FRAME' && ['NONE', 'HORIZONTAL', 'VERTICAL'].includes(node.layoutMode) && (node.layoutMode === 'NONE' || node.layoutWrap !== 'WRAP') && node.primaryAxisSizing === 'FIXED' && node.counterAxisSizing === 'FIXED' && node.layoutGrow > 0 && node.layoutPositioning !== 'ABSOLUTE' && parent?.type === 'FRAME' && ['HORIZONTAL', 'VERTICAL'].includes(parent.layoutMode) && parent.layoutWrap !== 'WRAP' && parent.primaryAxisSizing === 'FIXED' && parent.counterAxisSizing === 'FIXED' && (node.layoutMode === 'NONE' || ordinaryFlowSource(parent));
  const measuredFallbacks = new Map<string, { width: number; height: number }>();
  const prepareMeasuredFallbacks = () => {
    const candidates = [...graph.nodes.values()].filter(node => measurableFrame(node, node.parentId ? graph.getNode(node.parentId) : undefined));
    if (candidates.length) {
      const safe = new Map<string, boolean>(), checking = new Set<string>();
      const sourceLayoutAvailable = (node: SceneNode, depth = 0): boolean => {
        const known = safe.get(node.id); if (known !== undefined) return known;
        if (checking.has(node.id) || depth > 128) return false;
        checking.add(node.id);
        const available = [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width >= 0 && node.height >= 0 && !node.derivedLayout && node.source.format !== 'fig' && node.layoutMode !== 'GRID' && node.primaryAxisSizing === 'FIXED' && node.counterAxisSizing === 'FIXED' && !(node.visible && node.type === 'TEXT' && node.textAutoResize !== 'NONE') && (!['HORIZONTAL', 'VERTICAL'].includes(node.layoutMode) || graph.getChildren(node.id).filter(child => child.layoutPositioning !== 'ABSOLUTE').every(child => sourceLayoutAvailable(child, depth + 1)));
        checking.delete(node.id); safe.set(node.id, available); return available;
      };
      const parents = new Map(candidates.map(node => [node.parentId!, graph.getNode(node.parentId!)!]));
      const flowSafe = new Map<string, boolean>();
      const nativeFlowAvailable = (node: SceneNode, depth = 0): boolean => {
        const cached = flowSafe.get(node.id); if (cached !== undefined) return cached;
        if (depth > 128) return false;
        const available = readScrollBehaviour(node, graph).behaviour !== 'fixed' && (node.layoutMode === 'NONE' || ordinaryFlowSource(node) && node.layoutWrap !== 'WRAP' && graph.getChildren(node.id).filter(child => child.layoutPositioning !== 'ABSOLUTE').every(child => nativeFlowAvailable(child, depth + 1)));
        flowSafe.set(node.id, available); return available;
      };
      const availableParents = [...parents.values()].filter(node => sourceLayoutAvailable(node));
      if (availableParents.length) {
        const geometry = [...graph.nodes.values()].map(node => ({ node, x: node.x, y: node.y, width: node.width, height: node.height }));
        try {
          for (const parent of availableParents) computeLayout(graph, parent.id);
          for (const node of candidates) if (safe.get(node.parentId!) === true && (node.layoutMode === 'NONE' || nativeFlowAvailable(graph.getNode(node.parentId!)!)) && [node.width, node.height].every(value => Number.isFinite(value) && value >= 0)) measuredFallbacks.set(node.id, { width: node.width, height: node.height });
        } finally {
          // Initial layout supplies a fallback, while paint and constraint baselines stay authored.
          for (const { node, ...rect } of geometry) Object.assign(node, rect);
          graph.clearAbsPosCache();
        }
      }
    }
  };

  const measuredFlowStyle = (result: DesignNode, node: SceneNode) => {
    const primary = node.layoutMode === 'HORIZONTAL' ? 'columnGap' : 'rowGap', secondary = primary === 'columnGap' ? 'rowGap' : 'columnGap';
    Object.assign(result.style, { gap: undefined, [primary]: node.primaryAxisAlign === 'SPACE_BETWEEN' ? 0 : Math.max(0, node.itemSpacing), [secondary]: Math.max(0, node.counterAxisSpacing) });
    let direction: SceneNode | undefined = node;
    while (direction?.layoutDirection === 'AUTO') direction = direction.parentId ? graph.getNode(direction.parentId) : undefined;
    result.style.direction = direction?.layoutDirection === 'RTL' ? 'rtl' : 'ltr';
    const spacing = result.bindings?.style.gap;
    if (spacing) {
      delete result.bindings!.style.gap;
      if (node.primaryAxisAlign !== 'SPACE_BETWEEN') result.bindings!.style[primary] = spacing;
    }
  };
  const measuredFlowChildStyle = (result: DesignNode, node: SceneNode, parent: SceneNode) => {
    if (node.layoutPositioning === 'ABSOLUTE') return;
    if (result.control) {
      if (prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: Responsive child constraints need the browser-resolved size of this flex-grown layer; this React export cannot measure that size yet.`);
      return;
    }
    const cross = parent.layoutMode === 'HORIZONTAL' ? 'height' : 'width';
    const autoLayout = ['HORIZONTAL', 'VERTICAL'].includes(node.layoutMode);
    const stretch = !autoLayout && (node.layoutAlignSelf === 'STRETCH' || node.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH');
    Object.assign(result.style, { minWidth: node.minWidth ?? 0, maxWidth: node.maxWidth ?? undefined, minHeight: node.minHeight ?? 0, maxHeight: node.maxHeight ?? undefined });
    if (node.layoutAlignSelf !== 'AUTO') result.style.alignSelf = ({ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline' } as const)[node.layoutAlignSelf];
    if (stretch) {
      result.style[cross] = 'auto';
      if (result.bindings) delete result.bindings.style[cross];
    }
    if (node.layoutGrow > 0 && autoLayout) Object.assign(result.style, { flexBasis: 0, flexShrink: 1 });
    if (result.image && (stretch || node.layoutGrow > 0) && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: Responsive resizing of baked artwork needs source-backed rendering; this React export cannot update its pixels faithfully yet.`);
  };

  const variableBindingIssue = (node: SceneNode) => { if (variablePlayback && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: This variable-bound artwork or layout needs native presentation; its React binding cannot update faithfully yet.`); };
  const image = (node: SceneNode): { src: string; style?: CSSProperties } | undefined => {
    if (node.isMask && (!node.visible || node.internalOnly)) return;
    if (node.type === 'TEXT' || (!node.fills.some(fill => fill.visible) && !node.strokes.some(stroke => stroke.visible) && !node.effects.some(effect => effect.visible))) return;
    if (node.fills.some(fill => fill.visible && fill.type === 'VIDEO')) return;
    if (node.isMask || node.fills.some(fill => fill.visible && ['PATTERN', 'NOISE', 'CUSTOM'].includes(fill.type))) throw new Error('Bake procedural paints and masks before exporting this selection to React.');
    const key = JSON.stringify([node.type, node.width, node.height, node.fills, node.strokes, node.effects, node.cornerRadius, node.independentCorners,
      node.topLeftRadius, node.topRightRadius, node.bottomLeftRadius, node.bottomRightRadius, node.arcData, node.vectorNetwork, node.fillGeometry, node.strokeGeometry,
      node.pointCount, node.starInnerRadius, node.strokeCap, node.strokeJoin, node.dashPattern, node.independentStrokeWeights,
      node.borderTopWeight, node.borderRightWeight, node.borderBottomWeight, node.borderLeftWeight, node.strokeMiterLimit, node.clipsContent, !!node.childIds.length, node.blendMode]);
    const backdrop = !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode) || node.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR');
    if (!backdrop && svgCache.has(key)) return svgCache.get(key);
    const ownNative = canvasKit && nativePaintEligible(node), insets = nativeArtworkInsets({ ...nativeAppearance(node), independent: false }, node.vectorNetwork);
    for (const fill of node.fills) if (fill.visible && fill.type === 'IMAGE' && (!fill.imageHash || !graph.images.has(fill.imageHash))) throw new Error(`Restore the image used by ${node.name} before exporting.`);
    const previous = { childIds: node.childIds, rotation: node.rotation, opacity: node.opacity, visible: node.visible, flipX: node.flipX, flipY: node.flipY };
    let url: string, style: CSSProperties | undefined = node.width > 0 && node.height > 0 && Object.values(insets).some(value => value > 0) ? artworkInsetStyle(node.width, node.height, insets) : undefined;
    try {
      Object.assign(node, { childIds: [], rotation: 0, opacity: 1, visible: true, flipX: false, flipY: false }); graph.clearAbsPosCache();
      const complex = node.fills.some(fill => fill.visible && fill.type !== 'SOLID') || node.fills.filter(fill => fill.visible).length > 1 || node.effects.some(effect => effect.visible) || node.independentStrokeWeights;
      if (canvasKit && ownNative) {
        const artwork = renderNativePaintImage(canvasKit, node); style = artwork.style;
        let binary = ''; for (let start = 0; start < artwork.bytes.length; start += 8192) binary += String.fromCharCode(...artwork.bytes.subarray(start, start + 8192));
        url = `data:image/png;base64,${btoa(binary)}`;
      } else if (complex) {
        if (!canvasKit) throw new Error('Wait for the design canvas to load before exporting its artwork.');
        if (!renderer) {
          rendererPixels = canvasKit.Malloc(Uint8Array, 64 * 64 * 4);
          const surface = rendererSurface = canvasKit.MakeRasterDirectSurface({ width: 64, height: 64, colorType: canvasKit.ColorType.RGBA_8888, alphaType: canvasKit.AlphaType.Premul, colorSpace: canvasKit.ColorSpace.SRGB }, rendererPixels, 64 * 4) ?? undefined;
          if (!surface) throw new Error('This export could not allocate its native renderer surface.');
          try { renderer = createNativeRenderer(canvasKit, surface); } catch (error) { releaseNativeResources([() => surface.delete()], { reason: error }); throw error; }
        }
        renderer.invalidateAllPictures();
        const bytes = renderDesignNodes(canvasKit, renderer, graph, page.id, [node.id], { format: 'PNG', scale: Math.min(2, 2048 / Math.max(node.width, node.height)) });
        if (!bytes) throw new Error(`The artwork in ${node.name} could not be exported.`);
        let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        url = `data:image/png;base64,${btoa(binary)}`;
      } else {
        const svg = renderNodesToSVG(graph, page.id, [node.id]);
        if (!svg) throw new Error(`The artwork in ${node.name} could not be exported.`);
        url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      }
    }
    finally { Object.assign(node, previous); graph.clearAbsPosCache(); }
    const artwork = { src: url, ...(style ? { style } : {}) }; if (!backdrop) svgCache.set(key, artwork); return artwork;
  };
  const tree = (node: SceneNode, context?: BindingContext, root = false, depth = 0, sceneCovered = false, sceneMasks?: ReadonlyMap<string, NativeMaskRegion[]>): DesignNode => {
    if(depth>128)throw new Error('React export supports layer nesting up to 128 levels.');
    if (++count > MAX_EXPORT_NODES) throw new Error('This control has too many variant layers; export a smaller selection.');
    const prototype = readPrototype(node, resolvePrototype);
    if (prototype.issue && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: ${prototype.issue}`);
    if (prototype.interactions?.some(({ trigger }) => ['media-hit', 'media-end'].includes(trigger.type)) && !node.fills.some(fill => fill.visible && fill.type === 'VIDEO') && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: Media triggers need a visible video fill.`);
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined;
    const groupScale = !!parent && ['GROUP', 'BOOLEAN_OPERATION'].includes(parent.type);
    const usesConstraints = !!parent && !groupScale && (parent.layoutMode === 'NONE' || node.layoutPositioning === 'ABSOLUTE');
    const flexParent = parent?.parentId ? graph.getNode(parent.parentId) : undefined;
    const flexParentSizeUnresolved = !!parent && parent.layoutGrow > 0 && parent.layoutPositioning !== 'ABSOLUTE' && !!flexParent && ['HORIZONTAL', 'VERTICAL'].includes(flexParent.layoutMode) && (!measuredFrames.has(parent.id) || !!context);
    const authored = authoredGeometry.get(node.id);
    const constraintGeometry = !presentation && parent && authored && !flexParentSizeUnresolved && (groupScale || usesConstraints) ? {
      x: authored.x, y: authored.y, width: authored.width, height: authored.height, parentWidth: authored.parentWidth, parentHeight: authored.parentHeight,
      horizontal: node.horizontalConstraint, vertical: node.verticalConstraint, groupScale,
      explicit: { ...(node.boundVariables.x ? { left: true as const } : {}), ...(node.boundVariables.y ? { top: true as const } : {}), ...(node.boundVariables.width ? { width: true as const } : {}), ...(node.boundVariables.height ? { height: true as const } : {}) },
    } : undefined;
    const responsive = !root ? constraintGeometry : undefined;
    let responsiveAncestor = parent, parentCanResize = false;
    while (responsiveAncestor) {
      if (responsiveAncestor.boundVariables.width || responsiveAncestor.boundVariables.height || measuredFrames.has(responsiveAncestor.id)) { parentCanResize = true; break; }
      responsiveAncestor = responsiveAncestor.parentId ? graph.getNode(responsiveAncestor.parentId) : undefined;
    }
    if (!presentation && !root && flexParentSizeUnresolved && authored && (groupScale || usesConstraints) && prototypeIssues.size < 24) prototypeIssues.add(`${parent!.name}: Responsive child constraints need the browser-resolved size of this flex-grown layer; this React export cannot measure that size yet.`);
    const overlay = node.type === 'FRAME' ? readPrototypeOverlay(node) : undefined;
    if (overlay?.issue && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: ${overlay.issue}`);
    const fullNative = nativeScenes.has(node.id);
    const composition: ReturnType<typeof nativeSceneArtworkPlan> = sceneCovered || nativeScene && !fullNative ? { needed: false } : nativeSceneArtworkPlan(graph, node, fullNative);
    if (node.isMask && node.visible && !sceneCovered) throw new Error(composition.issue ?? 'Select the mask’s containing group to preserve its masked layers.');
    if (composition.issue && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: ${composition.issue}`);
    const compose = composition.needed && !composition.issue;
    // The browser must recompute portable pivots when bindings or constraints resize a layer.
    const style = nodeStyle(node, hasNativeSceneLayout(graph) ? undefined : parent, !presentation && !nativeScene && !hasNativeSceneLayout(graph) && !root && !sceneCovered && !compose);
    if (hasNativeSceneLayout(graph)) Object.assign(style, { position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height, display: undefined, flexDirection: undefined, flexWrap: undefined, gap: undefined, justifyContent: undefined, alignItems: undefined, padding: undefined });
    const result: DesignNode = { id: node.id, ...(!sceneCovered ? { motion: { ...prototypeMotionMetadata(node, root), ...(compose ? { composition: 'scene' as const } : {}) } } : { sceneCovered: true }), ...(responsive ? { responsive } : {}), ...(presentation ? { sourceId: node.id } : {}), name: node.name, visible: node.visible, style, clipContent: node.clipsContent && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type), children: [], navigation: prototype.link, interactions: prototype.interactions, ...(overlay && !overlay.issue ? { overlay: overlay.settings } : {}) };
    originalLayers.set(result, node);
    mediaOrigins.set(result, { id: node.id, ...(node.componentId ? { template: node.componentId } : {}), instance: node.type === 'INSTANCE' });
    const artwork = !sceneCovered && !compose ? paintSources?.add(node) : undefined; if (artwork) result.motion!.artwork = artwork;
    const deferredGrowBindings: ('width' | 'height')[] = [];
    const cssPaint = !presentation && !sceneCovered && !compose ? cssSolidPaint(node, !!node.boundVariables['fills/0/color'] && !!node.fills[0]?.visible) : undefined;
    if (cssPaint) Object.assign(result.style, { backgroundColor: cssPaint.color, borderRadius: cssPaint.radius });
    if (!presentation && Object.keys(node.boundVariables).length) {
      const bindings: NonNullable<DesignNode['bindings']> = { style: {}, modes: prototypeNodeModes(graph, node) };
      const fields: Record<string, keyof CSSProperties> = { opacity: 'opacity', width: 'width', height: 'height', x: 'left', y: 'top', fontFamily: 'fontFamily', fontSize: 'fontSize', letterSpacing: 'letterSpacing', lineHeight: 'lineHeight', itemSpacing: 'gap', paddingLeft: 'paddingLeft', paddingRight: 'paddingRight', paddingTop: 'paddingTop', paddingBottom: 'paddingBottom', minWidth: 'minWidth', maxWidth: 'maxWidth', minHeight: 'minHeight', maxHeight: 'maxHeight' };
      for (const [field, id] of Object.entries(node.boundVariables)) {
        if (field === 'visible') bindings.visible = id;
        else if (field === 'fills/0/color' && node.fills[0]?.visible && cssPaint) bindings.style.backgroundColor = id;
        else if ((field === 'width' || field === 'height') && node.layoutGrow) deferredGrowBindings.push(field);
        else if (fields[field] && !(node.type === 'TEXT' && node.styleRuns.length && ['fontFamily', 'fontSize', 'letterSpacing', 'lineHeight'].includes(field)) && !(node.layoutGrow && ['width', 'height'].includes(field)) && !(['x', 'y'].includes(field) && parent && parent.layoutMode !== 'NONE' && node.layoutPositioning !== 'ABSOLUTE')) bindings.style[fields[field]!] = id;
        else if (field === 'rotation' && !root && !context && selection.ids.includes(node.id) && !nativeScene && !preparedScene && !hasNativeSceneLayout(graph)) rootRotationBindings.add(node.id);
        else variableBindingIssue(node);
      }
      result.bindings = bindings;
      if (bindings.style.backgroundColor) { result.style.borderRadius = node.type === 'ELLIPSE' ? '50%' : node.independentCorners ? `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px` : node.cornerRadius; }
    }
    const scrolling = scrollContainer(node) ? readPrototypeScroll(node) : undefined, positioning = readScrollBehaviour(node, graph);
    for (const issue of [scrolling?.issue, positioning.issue]) if (issue && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: ${issue}`);
    if (scrolling && !scrolling.issue) result.scroll = scrolling.settings;
    if (!positioning.issue && positioning.behaviour !== 'scroll') result.scrollBehaviour = positioning.behaviour;
    if (positioning.behaviour === 'fixed') result.fixedStyle = { position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height, flexGrow: undefined };
    if (root) { result.style.position = 'relative'; result.style.left = 0; result.style.top = 0; result.style.transform = undefined; }
    const references = node.componentPropertyReferences;
    const textRef = references.find(ref => ref.field === 'TEXT'), visibleRef = references.find(ref => ref.field === 'VISIBLE');
    if (textRef) result.textValue = context?.values.get(textRef.propertyId);
    if (visibleRef) result.visibleValue = context?.values.get(visibleRef.propertyId);
    if (!root && node.type === 'INSTANCE') {
      const main = mainSlotComponent(graph, node), owner = main && behaviourOwner(graph, main);
      if (owner && readBehaviour(owner)) { result.control = control(node, sceneCovered, sceneMasks); return result; }
    }
    if (node.type === 'TEXT') { result.text = node.text; result.runs = textRuns(node); result.lang = node.textLanguage ?? undefined; }
    const slot = slotPropertyId(node); if (slot) result.part = context?.parts.get(slot);
    if (compose) {
      if (!canvasKit) throw new Error('Wait for the design canvas to load before exporting its group effects.');
      const artwork = renderNativeSceneImage(canvasKit, graph, node, fullNative);
      result.image = nativeImage(artwork.bytes); result.imageStyle = artwork.style;
      if (node.type === 'TEXT') result.sceneCovered = true;
      sceneMasks = artwork.maskRegions;
    } else if (!sceneCovered && nativeLayers.has(node.id)) {
      if (!canvasKit) throw new Error('Wait for the native renderer before capturing this layer.');
      const artwork = renderNativeReactLayer(canvasKit, graph, node.id);
      result.image = nativeImage(artwork.bytes); result.imageStyle = artwork.style;
      if (node.type === 'TEXT') result.sceneCovered = true;
    } else if (!sceneCovered) {
      const artworkImage = nativeScene || !presentation && result.style.backgroundColor ? undefined : image(node); result.image = artworkImage?.src; result.imageStyle = artworkImage?.style;
    }
    const artworkGeometry = responsive ?? (root && selection.ids.includes(node.id) ? constraintGeometry : undefined);
    const canResizeWidth = !!artworkGeometry && !artworkGeometry.explicit.width && (artworkGeometry.groupScale || ['STRETCH', 'SCALE'].includes(artworkGeometry.horizontal));
    const canResizeHeight = !!artworkGeometry && !artworkGeometry.explicit.height && (artworkGeometry.groupScale || ['STRETCH', 'SCALE'].includes(artworkGeometry.vertical));
    if (!presentation && result.image && ((node.boundVariables.width || node.boundVariables.height) || parentCanResize && (canResizeWidth || canResizeHeight))) {
      if (prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: Responsive resizing of baked artwork needs source-backed rendering; this React export cannot update its pixels faithfully yet.`);
    }
    if (!presentation && sceneCovered && responsive && parentCanResize && prototypeIssues.size < 24) prototypeIssues.add(`${node.name}: Responsive geometry inside a composed scene needs full-scene rendering; this React export cannot keep its artwork and hit target synchronized yet.`);
    const videoFill = node.fills.find(fill => fill.visible && fill.type === 'VIDEO');
    if (videoFill) {
      if (node.isMask || !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode) || !['FRAME', 'RECTANGLE', 'ROUNDED_RECTANGLE', 'COMPONENT', 'INSTANCE'].includes(node.type) || node.fills.filter(fill => fill.visible).length !== 1 || node.strokes.some(stroke => stroke.visible) || node.effects.some(effect => effect.visible) || videoFill.imageTransform || !['FILL', 'FIT'].includes(videoFill.imageScaleMode ?? 'FILL') || videoFill.blendMode && videoFill.blendMode !== 'NORMAL') throw new Error(`Use a single Fit or Fill video on ${node.name}, without masks, blends, strokes, effects or a paint transform, for live playback.`);
      const asset = videoAsset(node, videoFill), bytes = asset && graph.images.get(asset.videoHash), poster = asset && graph.images.get(asset.posterHash);
      if (!asset || !bytes || !poster) throw new Error(`Restore the video used by ${node.name} before playback or React export.`);
      result.video = { src: videoDataUrl(bytes, asset.mime), poster: videoDataUrl(poster, 'image/png'), autoplay: asset.autoplay, loop: asset.loop, muted: asset.muted, controls: asset.controls,
        style: { objectFit: videoFill.imageScaleMode === 'FIT' ? 'contain' : 'cover', opacity: videoFill.opacity, borderRadius: node.independentCorners ? `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px` : node.cornerRadius } };
    }
    const measuredFrame = measuredFallbacks.has(node.id) && !context && !root && !sceneCovered && !compose && !result.image && !node.effects.some(effect => effect.visible) && !node.strokes.some(stroke => stroke.visible) && (!node.clipsContent || node.cornerSmoothing === 0 && (node.independentCorners ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] : [node.cornerRadius]).every(radius => Number.isFinite(radius) && radius >= 0));
    if (measuredFrame) {
      const autoLayout = node.layoutMode !== 'NONE';
      const crossStretch = !autoLayout && (node.layoutAlignSelf === 'STRETCH' || node.layoutAlignSelf === 'AUTO' && parent!.counterAxisAlign === 'STRETCH');
      const crossAxis = parent!.layoutMode === 'HORIZONTAL' ? 'height' : 'width';
      if (!crossStretch && result.bindings && node.boundVariables[crossAxis]) result.bindings.style[crossAxis] = node.boundVariables[crossAxis];
      result.measuredFrame = measuredFallbacks.get(node.id)!; measuredFrames.add(node.id);
      if (crossStretch) result.style[crossAxis] = 'auto';
      if (node.layoutAlignSelf !== 'AUTO') result.style.alignSelf = ({ MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline' } as const)[node.layoutAlignSelf];
      Object.assign(result.style, { minWidth: node.minWidth ?? undefined, maxWidth: node.maxWidth ?? undefined, minHeight: node.minHeight ?? undefined, maxHeight: node.maxHeight ?? undefined });
      if (autoLayout) { measuredFlows.add(node.id); measuredFlowStyle(result, node); measuredFlowChildStyle(result, node, parent!); }
    }
    if (parent && measuredFlows.has(parent.id) && node.layoutPositioning !== 'ABSOLUTE' && !context && !sceneCovered && !compose && !result.image && !result.control && ordinaryFlowSource(node) && ['HORIZONTAL', 'VERTICAL'].includes(node.layoutMode) && node.layoutWrap !== 'WRAP' && node.primaryAxisSizing === 'FIXED' && node.counterAxisSizing === 'FIXED') measuredFlows.add(node.id);
    if (!measuredFrame && deferredGrowBindings.length) variableBindingIssue(node);
    const regionImages = new Map<string, { image: string; style: CSSProperties }>();
    let regions = sceneMasks?.get(node.id);
    if (!sceneCovered && nativeRegions.has(node.id)) {
      regions = [];
      for (const part of nativeRegions.get(node.id)!) {
        if (!canvasKit) throw new Error('Wait for the native renderer before capturing this mask region.');
        const artwork = renderNativeSceneRegion(canvasKit, graph, node.id, part.members), region = artwork.maskRegions.get(node.id)![0]!;
        regions.push(region); regionImages.set(part.regionId, { image: nativeImage(artwork.bytes), style: artwork.imageStyle });
      }
    }
    const starts = new Map(regions?.map(region => [region.masks[0]!, region])), members = new Set(regions?.flatMap(region => [...region.masks, ...region.children]));
    result.children = graph.getChildren(node.id).flatMap(child => {
      const region = starts.get(child.id);
      if (region) {
        if (!region.children.length) return [];
        if (++count > MAX_EXPORT_NODES) throw new Error('This control has too many variant layers; export a smaller selection.');
        const wrapper: DesignNode = { id: `${node.id}/mask/${child.id}`, name: `${child.name} mask region`, visible: !!region.path, sceneCovered: true, maskPath: region.path, style: { position: 'absolute', left: 0, top: 0, width: node.width, height: node.height }, children: region.children.map(id => tree(graph.getNode(id)!, context, false, depth+1, true, sceneMasks)) };
        const artwork = regionImages.get(region.masks[0]!); if (artwork) { wrapper.image = artwork.image; wrapper.imageStyle = artwork.style; }
        originalLayers.set(wrapper, node);
        return [wrapper];
      }
      return members.has(child.id) ? [] : [tree(child, context, false, depth+1, sceneCovered || compose, sceneMasks)];
    });
    if (!context && !sceneCovered && !compose && !presentation && !nativeScene && !preparedScene && !hasNativeSceneLayout(graph) && ['HORIZONTAL', 'VERTICAL'].includes(node.layoutMode) && (measuredFlows.has(node.id) || result.children.some(child => child.measuredFrame && originalLayers.get(child)?.layoutMode !== 'NONE'))) {
      measuredFlowStyle(result, node);
      for (const child of result.children) { const original = originalLayers.get(child); if (original) measuredFlowChildStyle(child, original, node); }
    }
    return result;
  };
  const control = (node: SceneNode, covered = false, masks?: ReadonlyMap<string, NativeMaskRegion[]>): DesignControl => {
    const playback = preparedNativeControl(graph, node);
    const descriptor = playback ?? describeNativeControl(graph, node)!;
    const { main, owner, behaviour, properties } = descriptor;
    if (active.has(owner.id)) throw new Error('A recursive interactive component cannot be exported.');
    active.add(owner.id);
    try {
      const result: DesignControl = { ...structuredClone(descriptor.config), variants: [], ...(playback ? { playback: structuredClone(playback.snapshot) } : {}) };
      if (playback && controlHost && presentation) result.native = { key: playback.key, values: structuredClone(playback.values), selected: [...playback.selected], ratio: playback.ratio };
      const dynamicNames = new Set([...Object.values(result.booleans).filter(binding => binding.variant).map(binding => binding.name), ...(result.states ? [result.states.name] : [])]);
      const candidates = owner.type === 'COMPONENT_SET' ? graph.getChildren(owner.id).filter(candidate => candidate.type === 'COMPONENT' && Object.entries(result.properties).every(([key, value]) => dynamicNames.has(key) || candidate.componentPropertyValues[key] === value)) : [main];
      const ordered = result.native ? [main] : [main, ...candidates.filter(candidate => candidate.id !== main.id)];
      if (ordered.length > MAX_VARIANTS) throw new Error('Export controls with at most 128 live variants.');
      const originalMain = main.id;
      try {
        for (const candidate of ordered) {
          if (mainSlotComponent(graph, node)?.id !== candidate.id) graph.swapInstanceComponent(node.id, candidate.id);
          const variantDefinitions = editor.getInstanceComponentPropertyDefinitions(node.id);
          const sameName = (id: string) => variantDefinitions.find(definition => definition.name === properties.get(id)?.name)?.id ?? id;
          const context: BindingContext = { values: new Map(), parts: new Map() };
          for (const [key, binding] of Object.entries(behaviour.booleans)) context.values.set(sameName(binding.propertyId), key);
          for (const [key, binding] of Object.entries(behaviour.texts)) context.values.set(sameName(binding.propertyId), key);
          for (const [key, id] of Object.entries(behaviour.parts)) context.parts.set(sameName(id), key);
          const exported = tree(node, context, true, 0, covered, masks);
          const part = (name: string) => {
            const pending = [...node.childIds]; while (pending.length) { const child = graph.getNode(pending.pop()!)!; if (context.parts.get(slotPropertyId(child) ?? '') === name) return child; if (child.type !== 'INSTANCE') pending.push(...child.childIds); } return undefined;
          };
          const track = part('track'), thumb = part('thumb');
          const geometry = track && thumb ? exportedThumbGeometry(graph, track, thumb) : undefined;
          const rangePart = part(result.kind === 'progress' ? 'indicator' : 'range'), rangeGeometry = track && rangePart ? exportedRangeGeometry(graph, track, rangePart) : undefined;
          const findText = (layer: DesignNode): DesignNode | undefined => {
            if (layer.textValue === (result.kind === 'numberField' ? 'text' : 'value') && layer.text !== undefined) return layer;
            return layer.children.filter(child => !child.control).map(findText).find(Boolean);
          };
          const target = findText(exported), inverse = TransformMatrix.invert(getWorldMatrix(node, graph));
          const position = target && inverse ? TransformMatrix.multiply(inverse, getWorldMatrix(graph.getNode(target.id)!, graph)) : undefined;
          const textTarget = target && position ? { ...target.style, position: 'absolute' as const, left: position[2], top: position[5], transform: cssMatrix(position), transformOrigin: '0 0', flexGrow: undefined } : undefined;
          result.variants.push({ properties: { ...candidate.componentPropertyValues }, tree: exported, trackWidth: track?.width, thumb: geometry, range: rangeGeometry, textTarget });
        }
      } finally { if (mainSlotComponent(graph, node)?.id !== originalMain) graph.swapInstanceComponent(node.id, originalMain); }
      // Reject misleading group output rather than silently emitting inert items.
      if (['radioGroup', 'toggleGroup', 'accordion'].includes(result.kind)) {
        const find = (node: DesignNode): DesignNode | undefined => node.part === 'items' ? node : node.children.map(find).find(Boolean);
        const expected = result.kind === 'radioGroup' ? 'radio' : result.kind === 'toggleGroup' ? 'toggle' : 'collapsible';
        for (const variant of result.variants) if (find(variant.tree)?.children.some(child => child.control?.kind !== expected)) throw new Error(`Each ${result.kind} item must behave as ${expected}.`);
      }
      return result;
    } finally { active.delete(owner.id); }
  };
  try {
    if (nativeScene) for (const id of selection.ids) {
      const plan = planNativeReactComposition(graph, graph.getNode(id)!);
      if (plan.mode === 'unsupported') throw new Error(plan.issue);
      plan.sceneRootIds.forEach(id => nativeScenes.add(id)); plan.nativeLayerIds.forEach(id => nativeLayers.add(id));
      for (const part of plan.order) if (part.kind === 'scene-region') { const parts = nativeRegions.get(part.nodeId) ?? []; parts.push(part); nativeRegions.set(part.nodeId, parts); }
    }
    preparedScene?.(graph, selection.ids);
    prepareMeasuredFallbacks();
    const roots = selection.roots;
    const placements = roots.map(id => {
      const original = graph.getNode(id)!, node = graph.getNode(selection.nodes.get(id)!)!;
      return original === node ? node : { ...original, width: node.width, height: node.height };
    });
    const bounds = placements.map(node => getAxisAlignedWorldBounds(node, graph)), matrices = placements.map(node => getWorldMatrix(node, graph));
    const minX = Math.min(...bounds.map(bounds => bounds.x)), minY = Math.min(...bounds.map(bounds => bounds.y));
    const width = Math.max(...bounds.map(bounds => bounds.x + bounds.width)) - minX, height = Math.max(...bounds.map(bounds => bounds.y + bounds.height)) - minY;
    const layerIds = new Map<string, string>();
    type MediaScope = { parent?: MediaScope; variant?: boolean; targets: Map<string, string | null> };
    const mediaRoot: MediaScope = { targets: new Map() }, mediaScopes = new WeakMap<DesignNode, MediaScope>(), mediaActualIds = new Map<string, string | null>();
    const nodes = roots.map((id, index) => {
      const node = graph.getNode(selection.nodes.get(id)!)!;
      const exported = tree(node);
      delete exported.responsive;
      if (presentation && node.id !== id) exported.sourceId = id;
      if (canvasKit) applyNativeMaskVisibility(canvasKit, graph, exported, originalLayers);
      const original = readPrototype(graph.getNode(id)!, resolvePrototype);
      if (original.interactions || original.issue || graph.getNode(id)!.pluginData.some(entry => entry.pluginId === 'orion.xdesign' && ['prototypeLink', 'prototypeInteractions'].includes(entry.key))) {
        exported.navigation = original.link; exported.interactions = original.interactions ?? [];
      }
      const positioned = !!(exported.bindings?.style.left || exported.bindings?.style.top);
      if (exported.bindings) for (const field of ['left', 'top'] as const) delete exported.bindings.style[field];
      exported.style.position = 'absolute'; exported.style.left = matrices[index]![2]! - minX; exported.style.top = matrices[index]![5]! - minY;
      exported.style.transform = cssMatrix(matrices[index]!); exported.style.transformOrigin = '0 0';
      if (!presentation && !nativeScene && !preparedScene && !hasNativeSceneLayout(graph)) {
        const placement = placements[index]!, parent = placement.parentId ? graph.getNode(placement.parentId) : undefined;
        const p = parent ? getWorldMatrix(parent, graph) : TransformMatrix.identity(), m = matrices[index]!;
        exported.selectionRoot = { width: placement.width, height: placement.height, parent: [p[0]!, p[3]!, p[1]!, p[4]!], world: [m[0]!, m[3]!, m[1]!, m[4]!, m[2]!, m[5]!], ...(placement.type === 'LINE' ? { lineReflection: [placement.flipX ? -1 : 1, placement.flipY ? -1 : 1] as [number, number] } : {}) };
        const originalParent = graph.getNode(id)!.parentId, inherited = originalParent ? geometryContext(graph.getNode(originalParent)!) : undefined;
        const ownTransform = ['x', 'y', 'rotation'].some(field => graph.getNode(id)!.boundVariables[field]);
        if (inherited?.dynamic || ownTransform) {
          if (geometryContext(graph.getNode(id)!).layout || inherited?.bindings || exported.control || selection.nodes.get(id) !== id) {
            if (prototypeIssues.size < 24) prototypeIssues.add(`${exported.name}: Variable-bound ancestor layout or realized controls need native presentation to recompute selection geometry.`);
          } else if (ownTransform && exported.image) {
            if (prototypeIssues.size < 24) prototypeIssues.add(`${exported.name}: Variable-bound root transforms of baked artwork need source-backed rendering; this React export cannot update its pixels faithfully yet.`);
          } else { includeSelectionGeometry(id); exported.selectionRoot.geometryRoot = id; }
        }
      }
      if (!exported.selectionRoot?.geometryRoot) {
        if (positioned && variablePlayback && prototypeIssues.size < 24) prototypeIssues.add(`${exported.name}: A variable-bound root position needs native presentation to recompute selection bounds.`);
        if (rootRotationBindings.has(node.id)) variableBindingIssue(node);
      }
      if (exported.motion) { const matrix = matrices[index]!; exported.motion = { ...exported.motion, root: true, local: [matrix[0]!, matrix[3]!, matrix[1]!, matrix[4]!, matrix[2]! - minX, matrix[5]! - minY] }; }
      const stableIds=(layer:DesignNode,path:string,inherited:MediaScope=mediaRoot,variant=false)=>{
        const origin = mediaOrigins.get(layer);
        const scope: MediaScope = variant || origin?.instance ? { parent: inherited, variant, targets: new Map() } : inherited;
        mediaScopes.set(layer, scope);
        if (layer.video && origin) {
          const previous = mediaActualIds.get(origin.id); mediaActualIds.set(origin.id, previous === undefined || previous === path ? path : null);
          for (let current: MediaScope | undefined = scope; current; current = current.parent) {
            for (const alias of [origin.id, origin.template].filter((id): id is string => !!id)) {
              const previous = current.targets.get(alias);
              current.targets.set(alias, previous === undefined || previous === path ? path : null);
            }
          }
        }
        layerIds.set(layer.id,path);
        layer.id=path;
        layer.children.forEach((child,index)=>stableIds(child,`${path}/${index}`,scope));
        layer.control?.variants.forEach(variant=>stableIds(variant.tree,path,scope,true));
      };
      stableIds(exported,controlScope ? `${JSON.stringify(['overlay',controlScope,id])}` : id);
      return exported;
    });
    if (selectionGeometry.size) nodes[0]!.selectionRoot!.geometry = [...selectionGeometry.values()];
    const reconnectLayerTargets = (layer: DesignNode) => {
      const map = (link: NonNullable<DesignNode['navigation']>) => {
        if (link.action !== 'scroll' && link.action !== 'media') return link;
        let target: string | null | undefined = link.target && layerIds.get(link.target);
        if (link.action === 'media') {
          target = undefined; let variantBoundary = false;
          for (let scope = mediaScopes.get(layer); scope; scope = scope.parent) {
            if (link.target && scope.targets.has(link.target)) { target = scope.targets.get(link.target); break; }
            if (scope.variant) { variantBoundary = true; break; }
          }
          let foreignVariant = false;
          if (target === undefined && variantBoundary && link.target) {
            target = mediaActualIds.get(link.target);
            if (target === undefined && mediaRoot.targets.has(link.target)) { target = null; foreignVariant = true; }
          }
          if (target === null && prototypeIssues.size < 24) prototypeIssues.add(`${layer.name}: Its video target is ${foreignVariant ? 'not available in this component variant' : 'ambiguous between component occurrences'}.`);
        }
        if (!target && !presentation && prototypeIssues.size < 24) prototypeIssues.add(`${layer.name}: Include its ${link.action === 'media' ? 'video target' : 'scroll destination'} in this export.`);
        return { ...link, ...(target ? { target } : presentation && target !== null ? {} : { unresolved: true }) };
      };
      if (layer.navigation) layer.navigation = mapDesignActions(layer.navigation, map);
      if (layer.interactions) layer.interactions = layer.interactions.map(interaction => ({ ...interaction, navigation: mapDesignActions(interaction.navigation, map) }));
      layer.children.forEach(reconnectLayerTargets); layer.control?.variants.forEach(variant => reconnectLayerTargets(variant.tree));
    };
    nodes.forEach(reconnectLayerTargets);
    if ([...graph.images.values()].reduce((total, bytes) => total + bytes.byteLength, 0) > 24 * 1024 * 1024) throw new Error('React export supports up to 24 MB of embedded images; export a smaller selection.');
    const assetCredits=[...new Map([...graph.nodes.values()].flatMap(readAssetCredits).map(credit=>[`${credit.provider}:${credit.sourceId}`,credit])).values()];
    const byteLength = new TextEncoder().encode(JSON.stringify([nodes, definitions, assetCredits])).byteLength + (paintSources?.bytes ?? 0);
    if (byteLength > MAX_EXPORT_BYTES) throw new Error('This design exceeds 32 MB; select a smaller screen or reduce its image assets.');
    const model: DesignModel = { nodes, width, height, byteLength, assetCredits, prototypeIssues: [...prototypeIssues], ...(definitions.variables.length || definitions.collections.length ? { prototypeVariables: definitions } : {}) };
    if (paintSources) registerNativePaintSources(model, paintSources); return model;
  } catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => { if (renderer) destroyNativeRenderer(renderer); }, () => { if (canvasKit) freeNativeSurfacePixels(canvasKit, rendererSurface, rendererPixels); }, () => editor.dispose()], failure); }
}

export function selectionToReact(source: SceneGraph, ids: readonly string[], name?: string, canvasKit?: CanvasKit): { componentName: string; code: string } {
  installVideoPaints();
  const { nodes, width, height, prototypeIssues, prototypeVariables, assetCredits } = selectionToDesignModel(source, ids, canvasKit);
  if (prototypeIssues.length) throw new Error(`Resolve unsupported prototype interactions before React export. ${prototypeIssues[0]}`);
  const componentName = reactComponentName(name ?? source.getNode(ids[0]!)!.name);
  const data = JSON.stringify(nodes, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const code = `"use client";\n\n${valuesSource}\n\n${runtimeSource.replace(/^import .* from '.\/prototypeValues';\n/gm, '').replace(/^export type .* from '.\/prototypeValues';\n/gm, '')}\n\nexport const designAssetCredits = ${JSON.stringify(assetCredits).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n\nconst design: DesignNode[] = ${data};\n\nexport default function ${componentName}(props: DesignProps) {\n  return <DesignView nodes={design} width={${width}} height={${height}}${prototypeVariables ? ` prototypeVariables={${JSON.stringify(prototypeVariables).replace(/</g, '\\u003c')}}` : ''} {...props} />;\n}\n`;
  if (code.length > MAX_EXPORT_BYTES || new TextEncoder().encode(code).byteLength > MAX_EXPORT_BYTES) throw new Error('This React component exceeds 32 MB; export a smaller selection or reduce its image assets.');
  return { componentName, code };
}
