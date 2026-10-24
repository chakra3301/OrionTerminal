import JSZip from 'jszip';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { collectGraphFontRequirements, collectNodeFontFaces, fontManager, missingGraphFontScripts } from '@open-pencil/core/text';
import workerBundle from 'virtual:xdesign-native-react-worker';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import designRuntime from './reactExportRuntime.tsx?raw';
import valuesRuntime from './prototypeValues.ts?raw';
import clientRuntime from './nativeReactClient.ts?raw';
import nativeRuntime from './nativeReactRuntime.tsx?raw';
import routeRuntime from './prototypeRouteRuntime.ts?raw';
import transitionRuntime from './nativeReactTransition.ts?raw';
import playbackRuntime from './nativeReactMotionPlayback.ts?raw';
import protocol from './nativeReactProtocol.ts?raw';
import { cloneDesignSubgraph } from './graphSubset';
import { serializeGraph } from './graphDocument';
import { captureNativeReactFonts } from './nativeReactFonts';
import { renderNativeReactModel } from './nativeReactRenderer';
import { reactComponentName } from './reactExport';
import { assertNativeReactCodeBudget, assertNativeReactMinimumCodeBudget, assertNativeReactResourceBudgets } from './nativeReactExportBudget';
import { resolveNativeReactScreens } from './nativeReactScreens';
import { assetCredits as readAssetCredits } from './assetCredits';

const encode = (bytes: Uint8Array) => { const parts: string[] = []; const size = 12 * 1024; for (let i = 0; i < bytes.length; i += size) parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + size)))); return parts.join(''); };
const literal = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const withoutImports = (source: string) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export type .* from .*;\r?\n/gm, '');

export type NativeReactArchiveOptions = { signal?: AbortSignal; assertSourceCurrent?: () => void };
const checkActive = (options: NativeReactArchiveOptions) => { options.signal?.throwIfAborted(); options.assertSourceCurrent?.(); };

async function prepareArchiveFonts(graph: SceneGraph, ids: readonly string[], options: NativeReactArchiveOptions) {
  const requirements = collectGraphFontRequirements(graph, ids);
  const faces = new Map(requirements.nodes.flatMap(collectNodeFontFaces).map(face => [JSON.stringify([face.family, face.style]), face]));
  if (faces.size > 128) throw new Error('This export needs more than 128 font faces.');
  await Promise.all([...faces.values()].map(({ family, style }) => fontManager.loadFont(family, style, requirements.characters, options.signal)));
  checkActive(options);
  await fontManager.ensureFallbackPack(missingGraphFontScripts(requirements), requirements.characters, options.signal);
  checkActive(options);
}

function fontByteLength(snapshot: ReturnType<typeof captureNativeReactFonts>) {
  return snapshot.registrations.reduce((total, registration) => total + registration.bytes.byteLength, 0);
}

export async function selectionToNativeReactArchive(source: SceneGraph, ids: readonly string[], kit: CanvasKit, wasmBytes?: Uint8Array, options: NativeReactArchiveOptions = {}) {
  checkActive(options);
  if (ids.length !== 1 || !source.getNode(ids[0]!)) throw new Error('Select one frame, component or layer for a responsive native React component.');
  const rootId = ids[0]!, componentName = reactComponentName(source.getNode(rootId)!.name);
  const selectedIds = resolveNativeReactScreens(source, rootId);
  const graph = cloneDesignSubgraph(source, selectedIds);
  const imageBytes = [...graph.images.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
  assertNativeReactResourceBudgets(graph.nodes.size, imageBytes, 0, 0);
  if (wasmBytes) assertNativeReactResourceBudgets(graph.nodes.size, imageBytes, 0, wasmBytes.byteLength);
  const ownedWasmBytes = wasmBytes?.slice();
  for (const node of graph.nodes.values()) for (const fill of node.fills) if (fill.type === 'IMAGE' && fill.imageHash && !graph.images.has(fill.imageHash)) throw new Error(`Restore the image used by ${node.name} before exporting.`);
  graph.images = new Map([...graph.images].map(([hash, bytes]) => [hash, bytes.slice()]));
  checkActive(options);
  const text = [...graph.nodes.values()].filter(node => node.type === 'TEXT');
  await prepareArchiveFonts(graph, text.map(node => node.id), options);
  checkActive(options);
  const fonts = captureNativeReactFonts(kit, text);
  const response = ownedWasmBytes ? undefined : await fetch(wasmUrl, { signal: options.signal });
  if (response && !response.ok) throw new Error('The renderer WASM could not be loaded for export.');
  const wasm = ownedWasmBytes ?? new Uint8Array(await response!.arrayBuffer());
  checkActive(options);
  if (wasm.byteLength === 0) throw new Error('The renderer WASM asset is empty.');
  assertNativeReactResourceBudgets(graph.nodes.size, imageBytes, fontByteLength(fonts), wasm.byteLength);
  const designRuntimeSource = designRuntime.replace(/^import .* from '.\/prototypeValues';\n/gm, '').replace(/^export type .* from '.\/prototypeValues';\n/gm, '');
  const protocolSource = withoutImports(protocol), routeSource = withoutImports(routeRuntime), transitionSource = withoutImports(transitionRuntime), playbackSource = withoutImports(playbackRuntime), clientSource = withoutImports(clientRuntime), nativeSource = withoutImports(nativeRuntime);
  assertNativeReactMinimumCodeBudget({ componentName, valuesRuntime, designRuntime: designRuntimeSource, protocol: protocolSource, routeRuntime: routeSource, transitionRuntime: transitionSource, playbackRuntime: playbackSource, clientRuntime: clientSource, nativeRuntime: nativeSource,
    worker: workerBundle.source, ids: selectedIds, rootId, fonts, wasmBytes: wasm.byteLength });
  const initialModel = await renderNativeReactModel(kit, graph, [rootId]);
  checkActive(options);
  const assetCredits = [...new Map([...graph.nodes.values()].flatMap(readAssetCredits).map(credit => [`${credit.provider}:${credit.sourceId}`, credit])).values()];
  const graphSource = serializeGraph(graph);
  const portableModel = { nodes: initialModel.nodes, width: initialModel.width, height: initialModel.height, ...(initialModel.byteLength !== undefined ? { byteLength: initialModel.byteLength } : {}), ...(initialModel.prototypeVariables ? { prototypeVariables: initialModel.prototypeVariables } : {}) };
  assertNativeReactCodeBudget({ componentName, valuesRuntime, designRuntime: designRuntimeSource, protocol: protocolSource, routeRuntime: routeSource, transitionRuntime: transitionSource, playbackRuntime: playbackSource, clientRuntime: clientSource, nativeRuntime: nativeSource,
    worker: workerBundle.source, graph: graphSource, ids: selectedIds, rootId, fonts, wasmBytes: wasm.byteLength, model: portableModel, assetCredits });
  checkActive(options);
  const assets = { worker: workerBundle.source, wasm: encode(wasm), graph: graphSource, ids: selectedIds, rootId, fonts: {
    ...fonts, registrations: fonts.registrations.map(registration => ({ ...registration, bytes: encode(new Uint8Array(registration.bytes)) })),
  } };
  const code = `"use client";\n\n${valuesRuntime}\n\n${designRuntimeSource}\n\n${protocolSource}\n\n${routeSource}\n\n${transitionSource}\n\n${playbackSource}\n\n${clientSource}\n\n${nativeSource}\n\nexport const designAssetCredits = ${literal(assetCredits)};\nconst nativeAssets = ${literal(assets)};\nconst initialModel: NativeReactModel = ${literal(portableModel)};\n\nexport default function ${componentName}(props: NativeReactProps) { return <NativeDesignView assets={nativeAssets} initialModel={initialModel} {...props}/>; }\n`;
  checkActive(options);
  const zip = new JSZip(); zip.file(`${componentName}.tsx`, code);
  for (const notice of workerBundle.notices) zip.file(notice.name, notice.source);
  zip.file('README.txt', `Import ${componentName}.tsx into a React 19 application. It includes the selected scene and reachable prototype screens, CanvasKit renderer/WASM and byte-backed fonts; rendering does not require a network connection.\n\nUse width/height for explicit native base-screen sizing or responsive for measured host width. Variable and component control changes re-render original artwork in one worker. The host prepares navigation, back, overlays, swap and close actions before publishing their destination; repeated overlays have independent control state. Targeted video Play, Pause and Toggle actions control the mounted video in the current screen or overlay. Refused playback stops later sequence actions; held or dragged video controls restore their target on cancellation. Open link actions retain their URL and new-tab preference. By default they use browser navigation; supply onOpenUrl(url, newTab) to integrate an external handler or approve opening. Returning false or rejecting stops subsequent sequence actions without changing the current route; already opened links are external effects. It preserves ordered native artwork around supported live scroll, fixed/sticky and video surfaces. Static effects and mask regions retain native pixels; effects or masks crossing live surfaces and external backdrop-dependent composition produce explicit diagnostics. Instant, dissolve, slide, move and push transitions support authored easing/springs. Smart Animate and matched-layer transitions sample fresh native scene graphs for compatible layer geometry, solid/gradient paint, text metrics, strokes and effects; seek, spring playback and built-in drag scrubbing use the same renderer and restore route/state on rollback. Changing stroke/effect stacks retain one interpolated child tree. Discrete fill or stroke appearance changes blend aligned native renders of the same intermediate child geometry in premultiplied space. Native masks with stable sibling membership blend their alpha, vector or luminance coverage across paint, shape, topology and mask-type changes while retaining the same moving masked children. Mask membership changes, unsupported font/backdrop appearance, reflection changes, skew, scroll axis/positioning changes and external/live backdrop crossings remain explicitly unsupported. Exact endpoints publish the original interactive controls; temporary native frames are inert. Keep the included license notices and designAssetCredits with redistributed output. The browser needs Worker, WebAssembly, blob worker scripts, local blob-WASM fetch and (for responsive sizing) ResizeObserver.\n`);
  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  checkActive(options);
  return archive;
}
