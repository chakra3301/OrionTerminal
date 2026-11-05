// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { prepareGraphFonts } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import JSZip from 'jszip';
import ts from 'typescript';
import bundle from 'virtual:xdesign-native-react-worker';
import { selectionToNativeReactArchive } from './nativeReactExport';
import { serializeGraph } from './graphDocument';
import { renderNativeReactModel } from './nativeReactRenderer';
import { captureNativeReactFonts, type NativeReactFontSnapshot } from './nativeReactFonts';
import { setNavigation } from './prototype';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import { placePreparedVideo } from './videoPaints';

const require = createRequire(import.meta.url), wasm = new Uint8Array(readFileSync(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')));
let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
function fixture() {
  const editor = createEditor(), graph = editor.graph;
  const frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Native Scene', width: 120, height: 80, fills: [], effects: [{ type: 'LAYER_BLUR', visible: true, radius: 2, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  graph.createNode('RECTANGLE', frame.id, { name: 'Resized gradient', x: 12, y: 12, width: 80, height: 44, horizontalConstraint: 'STRETCH', fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 }, gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] }] });
  const text = graph.createNode('TEXT', frame.id, { name: 'Transferred text', x: 14, y: 20, width: 80, height: 28, text: 'Café ABI', fontFamily: 'Inter', fontSize: 14, fontWeight: 400, styleRuns: [{ start: 5, length: 3, style: { fontWeight: 700 } }], fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] });
  const destination = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Reachable destination', width: 64, height: 48, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 } }] });
  destination.pluginData.push({ pluginId: 'orion.xdesign.asset', key: 'source', value: JSON.stringify({ provider: 'fixture-stock', sourceId: 'offline-destination', source: 'https://example.test/asset', author: 'Fixture artist' }) });
  setNavigation(editor, text, { action: 'navigate', target: destination.id, transition: 'instant', duration: 0 });
  const motionDestination = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Motion destination', width: 120, height: 80, fills: [{ type: 'SOLID', visible: true, opacity: .4, color: { r: 0, g: 0, b: 1, a: 1 } }], effects: [{ type: 'LAYER_BLUR', visible: true, radius: 5, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  graph.createNode('RECTANGLE', motionDestination.id, { name: 'Resized gradient', x: 20, y: 20, width: 80, height: 44, horizontalConstraint: 'STRETCH', fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0, a: 1 }, gradientStops: [{ position: 0, color: { r: 0, g: 1, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] }] });
  graph.createNode('TEXT', motionDestination.id, { name: 'Transferred text', x: 22, y: 28, width: 80, height: 28, text: 'Café ABI', fontFamily: 'Inter', fontSize: 18, fontWeight: 400, styleRuns: [{ start: 5, length: 3, style: { fontWeight: 700 } }], fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] });
  for (const [root, x, width, cap] of [[frame, 14, 32, 'ROUND'], [motionDestination, 26, 48, 'SQUARE']] as const) graph.createNode('LINE', root.id, { name: 'Horizontal cap motion', x, y: 70, width, height: 0, fills: [], strokeCap: cap, strokes: [{ color: { r: 1, g: .5, b: 0, a: 1 }, opacity: 1, visible: true, weight: 4, align: 'CENTER', cap }] });
  graph.createNode('ELLIPSE', frame.id, { name: 'Motion mask', x: 70, y: 10, width: 26, height: 22, isMask: true, maskType: 'ALPHA', fills: [{ type: 'SOLID', visible: true, opacity: .8, color: { r: 1, g: 0, b: 0, a: .5 } }] });
  graph.createNode('RECTANGLE', frame.id, { name: 'Masked artwork', x: 60, y: 5, width: 50, height: 40, fills: [{ type: 'SOLID', visible: true, opacity: .8, color: { r: 0, g: 1, b: 0, a: 1 } }] });
  graph.createNode('RECTANGLE', motionDestination.id, { name: 'Motion mask', x: 82, y: 18, width: 26, height: 22, isMask: true, maskType: 'LUMINANCE', fills: [{ type: 'SOLID', visible: true, opacity: .6, color: { r: 0, g: 0, b: 1, a: 1 } }] });
  graph.createNode('ELLIPSE', motionDestination.id, { name: 'Inserted vector mask', x: 76, y: 12, width: 40, height: 36, isMask: true, maskType: 'VECTOR', fills: [{ type: 'SOLID', visible: true, opacity: .5, color: { r: 0, g: 1, b: 1, a: .4 } }] });
  graph.createNode('RECTANGLE', motionDestination.id, { name: 'Masked artwork', x: 72, y: 13, width: 50, height: 40, fills: [{ type: 'SOLID', visible: true, opacity: .8, color: { r: 0, g: 1, b: 0, a: 1 } }] });
  graph.createNode('RECTANGLE', motionDestination.id, { name: 'Appearing masked child', x: 88, y: 22, width: 9, height: 9, fills: [{ type: 'SOLID', visible: true, opacity: .7, color: { r: 1, g: 1, b: 0, a: 1 } }] });
  const curve = (offset: number) => {
    const commands: [number, number[]][] = [[1, [1, 2]], [4, [4, 2 + offset, 14, 9, 22, 14 - offset]], [2, [2, 16]], [0, []]];
    const bytes = new Uint8Array(commands.reduce((length, [, numbers]) => length + 1 + numbers.length * 4, 0)), data = new DataView(bytes.buffer); let index = 0;
    for (const [command, numbers] of commands) { bytes[index++] = command; for (const number of numbers) { data.setFloat32(index, number, true); index += 4; } }
    return bytes;
  };
  for (const [root, x, y, offset] of [[frame, 72, 16, 0], [motionDestination, 84, 24, 6]] as const) graph.createNode('VECTOR', root.id, { name: 'Morphing encoded path', x, y, width: 24, height: 18, vectorNetwork: null, fillGeometry: [{ commandsBlob: curve(offset), windingRule: 'NONZERO' }], fills: [{ type: 'SOLID', visible: true, opacity: .9, color: { r: 1, g: .4, b: 0, a: 1 } }] });
  return { editor, graph, frame, text, destination, motionDestination };
}

async function executeWorker(graph: string, ids: string[], fonts: NativeReactFontSnapshot) {
  const harness = `const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');
    const context=vm.createContext({console,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance,Blob,URL,fetch:input=>{if(!String(input).startsWith('blob:'))throw Error('Network request attempted');return fetch(input);}});
    context.postMessage=message=>parentPort.postMessage(message);
    context.__source=workerData.graph;context.__ids=workerData.ids;context.__wasm=workerData.wasm;context.__fonts=JSON.stringify(workerData.fonts);
    vm.runInContext("structuredClone=value=>{const seen=new Map();const copy=item=>{if(item===null||typeof item!=='object')return item;if(seen.has(item))return seen.get(item);let result;if(item instanceof ArrayBuffer)result=item.slice(0);else if(ArrayBuffer.isView(item))result=new item.constructor(copy(item.buffer),item.byteOffset,item.length);else if(item instanceof Map){result=new Map();seen.set(item,result);for(const[key,value]of item)result.set(copy(key),copy(value));}else if(item instanceof Set){result=new Set();seen.set(item,result);for(const value of item)result.add(copy(value));}else{result=Array.isArray(item)?[]:{};seen.set(item,result);for(const[key,value]of Object.entries(item))result[key]=copy(value);}return result;};return copy(value);};",context);
    vm.runInContext("self=globalThis;atob=s=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let bits=0,value=0,out='';for(const c of s.replace(/=+$/,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('base64');value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode((value>>bits)&255);}}return out;};btoa=s=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let bits=0,value=0,out='';for(const c of s){value=(value<<8)|c.charCodeAt(0);bits+=8;while(bits>=6){bits-=6;out+=alphabet[(value>>bits)&63];}}if(bits)out+=alphabet[(value<<(6-bits))&63];while(out.length%4)out+='=';return out;};",context);
    vm.runInContext(workerData.source,context,{timeout:10000});
    parentPort.on('message',input=>{context.__input=JSON.stringify(input);vm.runInContext('self.onmessage({data:JSON.parse(__input)})',context);});
    vm.runInContext("const fonts=JSON.parse(__fonts);for(const registration of fonts.registrations)registration.bytes=Uint8Array.from(atob(registration.bytes),c=>c.charCodeAt(0)).buffer;self.onmessage({data:{type:'init',payload:{graph:__source,ids:__ids,wasm:Uint8Array.from(atob(__wasm),c=>c.charCodeAt(0)),fonts}}})",context);`;
  const worker = new Worker(harness, { eval: true, workerData: { graph, ids, wasm: Buffer.from(wasm).toString('base64'), source: bundle.source, fonts: { ...fonts, registrations: fonts.registrations.map(registration => ({ ...registration, bytes: Buffer.from(registration.bytes).toString('base64') })) } } });
  const inbox: unknown[] = [], waits: { resolve: (message: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  worker.on('message', message => { const wait = waits.shift(); if (wait) { clearTimeout(wait.timer); wait.resolve(message); } else inbox.push(message); });
  worker.on('error', error => { for (const wait of waits.splice(0)) { clearTimeout(wait.timer); wait.reject(error); } });
  const next = (): Promise<any> => inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Native worker test timed out.')), 25000); waits.push({ resolve, reject, timer }); });
  return { worker, next };
}

it('executes the actual offline worker with embedded WASM and matches native regenerated pixels', async () => {
  const f = fixture(), before = serializeGraph(f.graph);
  await prepareGraphFonts(f.graph, [f.frame.id]);
  const fonts = captureNativeReactFonts(kit, [f.text]); expect(fonts.registrations.length).toBeGreaterThanOrEqual(2);
  const transport = await executeWorker(before, [f.frame.id, f.destination.id, f.motionDestination.id], fonts);
  try {
    expect(await transport.next()).toEqual({ type: 'ready' });
    const request = { rootId: f.frame.id, rootSizes: { [f.frame.id]: { width: 210, height: 96 } } };
    transport.worker.postMessage({ type: 'render', id: 1, request });
    const output = await transport.next(); expect(output.type, output.message).toBe('model');
    const expected = await renderNativeReactModel(kit, f.graph, [f.frame.id], request);
    expect(output.model.nodes[0].image).toBe(expected.nodes[0]!.image);
    expect(output.model.nodes[0].style.width).toBe(210);
    expect(output.model.nodes[0].image.length).toBeGreaterThan(100);
    transport.worker.postMessage({ type: 'render', id: 2, request: { rootSizes: { [f.frame.id]: { width: -1 } } } });
    expect(await transport.next()).toMatchObject({ type: 'error', id: 2 });
    transport.worker.postMessage({ type: 'render', id: 3, request: { rootId: f.frame.id, rootSizes: { [f.frame.id]: { width: 160 } } } });
    expect(await transport.next()).toMatchObject({ type: 'model', id: 3 });
    const destinationRequest = { rootId: f.destination.id, controlScope: 'overlay-1' };
    transport.worker.postMessage({ type: 'render', id: 4, request: destinationRequest });
    const destination = await transport.next(); expect(destination.type, destination.message).toBe('model');
    const expectedDestination = await renderNativeReactModel(kit, f.graph, [f.destination.id], destinationRequest);
    expect(destination.model.nodes[0].image).toBe(expectedDestination.nodes[0]!.image); expect(destination.model.nodes[0].sourceId).toBe(f.destination.id);
    transport.worker.postMessage({ type: 'render', id: 5, request: { rootId: 'not-exported' } });
    expect(await transport.next()).toMatchObject({ type: 'error', id: 5, message: expect.stringContaining('not included') });
    transport.worker.postMessage({ type: 'render', id: 6, request: { rootId: f.frame.id } });
    expect(await transport.next()).toMatchObject({ type: 'model', id: 6 });
    const motion = { sessionId: 1, from: { rootId: f.frame.id, rootSizes: { [f.frame.id]: { width: 160 } } }, to: { rootId: f.motionDestination.id, rootSizes: { [f.motionDestination.id]: { width: 220 } } }, link: { action: 'navigate' as const, target: f.motionDestination.id, transition: 'smart' as const, duration: 300, easing: 'linear' as const } };
    transport.worker.postMessage({ type: 'motion-prepare', id: 7, motion });
    const prepared = await transport.next(); expect(prepared.type, prepared.message).toBe('motion-ready'); expect(prepared.motion.matched).toBeGreaterThan(2);
    const reference = await prepareNativeReactMotion(kit, f.graph, motion);
    expect(prepared.motion.initialModel.nodes[0].image).toBe(reference.motion.initialModel.nodes[0]!.image);
    transport.worker.postMessage({ type: 'motion-frame', id: 8, sessionId: 1, progress: .5 });
    const middle = await transport.next(); expect(middle.type, middle.message).toBe('model');
    expect(middle.model.nodes[0].image).toBe((await reference.frame(.5)).nodes[0]!.image); expect(middle.model.nodes[0].image).not.toBe(prepared.motion.initialModel.nodes[0].image);
    transport.worker.postMessage({ type: 'motion-frame', id: 9, sessionId: 1, progress: 1 });
    const finish = await transport.next(); expect(finish.type, finish.message).toBe('model'); expect(finish.model.nodes[0].image).toBe((await reference.frame(1)).nodes[0]!.image);
    transport.worker.postMessage({ type: 'motion-cancel', sessionId: 1 });
    transport.worker.postMessage({ type: 'motion-frame', id: 10, sessionId: 1, progress: .25 });
    expect(await transport.next()).toMatchObject({ type: 'error', id: 10, message: expect.stringContaining('cancelled') });
    transport.worker.postMessage({ type: 'motion-prepare', id: 11, motion: { ...motion, sessionId: 2 } });
    transport.worker.postMessage({ type: 'motion-cancel', sessionId: 2 });
    expect(await transport.next()).toMatchObject({ type: 'error', id: 11, message: expect.stringContaining('cancelled') });
    transport.worker.postMessage({ type: 'render', id: 12, request: { rootId: f.frame.id } });
    expect(await transport.next()).toMatchObject({ type: 'model', id: 12 });
    expect(serializeGraph(f.graph)).toBe(before);
  } finally { await transport.worker.terminate(); f.editor.dispose(); }
}, 30000);

it('creates a React-only offline archive with notices and a type-correct generated component', async () => {
  const f = fixture();
  setNavigation(f.editor, f.text, { action: 'sequence', transition: 'instant', duration: 0, actions: [
    { action: 'navigate', target: f.destination.id, transition: 'instant', duration: 0 },
    { action: 'open-url', url: 'https://example.test/native-export/23:7?source=design', newTab: false, transition: 'instant', duration: 0 },
  ] });
  const before = serializeGraph(f.graph);
  try {
    const bytes = await selectionToNativeReactArchive(f.graph, [f.frame.id], kit, wasm), zip = await JSZip.loadAsync(bytes);
    const code = await zip.file('NativeScene.tsx')!.async('string');
    expect(code).toContain('locateFile'); expect(code).toContain('NativeReactWorkerClient'); expect(code).not.toContain('virtual:xdesign');
    expect(code).toContain('Reachable destination'); expect(code).toContain('routePrototype'); expect(code).toContain('animateNativeReactView');
    expect(code).toContain('https://example.test/native-export/23:7?source=design'); expect(code).toContain('onOpenUrl'); expect(code).toContain('validateDesignUrl');
    expect(code).toContain('createNativeReactMotionPlayback'); expect(code).toContain('motion-prepare'); expect(code).not.toContain('Motion destination');
    expect(Object.keys(zip.files).filter(name => name.startsWith('licenses/') && name.endsWith('.md')).length).toBe(1);
    const file = `${process.cwd()}/src/apps/xdesign/pencil/__native-export-fixture.tsx`, options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] };
    const host = ts.createCompilerHost(options), original = host.getSourceFile;
    host.getSourceFile = (name, ...args) => name === file ? ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX) : original.call(host, name, ...args);
    const program = ts.createProgram([file], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
    const ast = program.getSourceFile(file)!;
    expect(ast.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text)).toEqual(['react']);
    const credits = ast.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => declaration.name.getText(ast) === 'designAssetCredits')!;
    expect(JSON.parse(credits.initializer!.getText(ast))).toContainEqual({ provider: 'fixture-stock', sourceId: 'offline-destination', source: 'https://example.test/asset', author: 'Fixture artist' });
    const assets = ast.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => declaration.name.getText(ast) === 'nativeAssets')!;
    expect(JSON.parse(assets.initializer!.getText(ast)).ids).toEqual([f.frame.id,f.destination.id]);
    expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
}, 30000);

it('executes overlapping fixed native/video/own-scroll layers through the actual offline worker and recovers after a retained ancestor refusal', async () => {
  const editor = createEditor(), graph = editor.graph;
  const paint = (r: number, g: number, b: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Worker ordered screen', width: 96, height: 64, clipsContent: true, fills: [paint(1, 1, 1)] }); setPrototypeScroll(editor, root, { axis: 'vertical' });
  const behind = graph.createNode('RECTANGLE', root.id, { name: 'Behind live surfaces', x: 4, y: 4, width: 64, height: 40, fills: [paint(0, 0, 1)] });
  const fixed = graph.createNode('RECTANGLE', root.id, { name: 'Fixed native', x: 8, y: 8, width: 32, height: 24, fills: [paint(1, 0, 0)] }); setScrollBehaviour(editor, fixed, 'fixed');
  const surface = kit.MakeSurface(4, 4)!; surface.getCanvas().clear(kit.Color(0, 255, 255, 1)); const poster = surface.makeImageSnapshot();
  const video = placePreparedVideo(editor, { bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), poster: poster.encodeToBytes()!, name: 'Worker fixed video', mime: 'video/mp4', width: 4, height: 4, duration: 1 }, 12, 12, root.id); poster.delete(); surface.delete();
  Object.assign(graph.getNode(video)!, { width: 24, height: 16, rotation: 90 }); setScrollBehaviour(editor, graph.getNode(video)!, 'fixed');
  const inner = graph.createNode('FRAME', root.id, { name: 'Worker fixed own scroller', x: 24, y: 16, width: 40, height: 32, clipsContent: true, fills: [paint(0, 1, 0)] }); setPrototypeScroll(editor, inner, { axis: 'vertical' }); setScrollBehaviour(editor, inner, 'fixed');
  const content = graph.createNode('RECTANGLE', inner.id, { name: 'Worker inner content', x: 4, y: 8, width: 24, height: 64, fills: [paint(1, 0, 1)] });
  const cover = graph.createNode('RECTANGLE', root.id, { name: 'Authored foreground', x: 8, y: 8, width: 64, height: 24, fills: [paint(1, 1, 0)] });
  const invalid = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Refused live ancestor', width: 64, height: 48, fills: [], effects: [{ type: 'LAYER_BLUR', visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] }); setPrototypeScroll(editor, invalid, { axis: 'vertical' });
  graph.createNode('RECTANGLE', invalid.id, { width: 24, height: 80, fills: [paint(1, 0, 0)] });
  const source = serializeGraph(graph), fonts: NativeReactFontSnapshot = { version: 1, faces: [], registrations: [], cjkFallbackFamilies: [], arabicFallbackFamilies: [] };
  const transport = await executeWorker(source, [root.id, invalid.id], fonts);
  try {
    expect(await transport.next()).toEqual({ type: 'ready' });
    let requestId = 0;
    for (const width of [96, 128]) {
      const request = { rootId: root.id, rootSizes: { [root.id]: { width, height: 64 } } };
      transport.worker.postMessage({ type: 'render', id: ++requestId, request }); const reply = await transport.next(); expect(reply.type, reply.message).toBe('model');
      const output = reply.model.nodes[0]; expect(output.style.width).toBe(width);
      expect(output.children.map((node: { sourceId: string }) => node.sourceId)).toEqual([behind.id, fixed.id, video, inner.id, cover.id]);
      expect(output.children[1]).toMatchObject({ scrollBehaviour: 'fixed', fixedStyle: { left: 8, top: 8, width: 32, height: 24 } });
      expect(output.children[2]).toMatchObject({ scrollBehaviour: 'fixed', video: { src: expect.stringMatching(/^data:video/) }, style: { width: 24, height: 16, transformOrigin: '0 0', transform: expect.stringContaining('matrix(') } }); expect(output.children[2].image).toBeUndefined();
      expect(output.children[3]).toMatchObject({ scrollBehaviour: 'fixed', scroll: { axis: 'vertical' }, clipContent: true }); expect(output.children[3].children[0].sourceId).toBe(content.id);
      const independentColors = [[output, [255, 255, 255]], [output.children[0], [0, 0, 255]], [output.children[1], [255, 0, 0]], [output.children[3], [0, 255, 0]], [output.children[3].children[0], [255, 0, 255]], [output.children[4], [255, 255, 0]]] as const;
      for (const [node, color] of independentColors) {
        const image = kit.MakeImageFromEncoded(Buffer.from(node.image.split(',')[1], 'base64'))!;
        try {
          expect([image.width(), image.height()]).toEqual([node.style.width * 2, node.style.height * 2]);
          const pixels = new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!);
          for (let offset = 0; offset < pixels.length; offset += 4) { if (pixels[offset] !== color[0] || pixels[offset + 1] !== color[1] || pixels[offset + 2] !== color[2] || pixels[offset + 3] !== 255) throw new Error(`Unexpected native worker pixel for ${node.name} at ${offset / 4}`); }
        } finally { image.delete(); }
      }
      const direct = await renderNativeReactModel(kit, graph, [root.id], request); expect(reply.model).toEqual(direct);
    }
    transport.worker.postMessage({ type: 'render', id: ++requestId, request: { rootId: invalid.id } });
    expect(await transport.next()).toMatchObject({ type: 'error', id: requestId, message: expect.stringContaining('native effects cannot be split') });
    transport.worker.postMessage({ type: 'render', id: ++requestId, request: { rootId: root.id } });
    expect(await transport.next()).toMatchObject({ type: 'model', id: requestId, model: { nodes: [{ sourceId: root.id, children: expect.arrayContaining([expect.objectContaining({ sourceId: video })]) }] } });
    expect(requestId).toBe(4); expect(serializeGraph(graph)).toBe(source);
  } finally { await transport.worker.terminate(); editor.dispose(); }
}, 30000);
