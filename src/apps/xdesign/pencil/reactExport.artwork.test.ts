// @vitest-environment node
import { expect, it } from 'vitest';
import ts from 'typescript';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { setPrototypeInteractions } from './prototype';
import { serializeGraph } from './document';

it('delivers a standalone TSX module that passes strict React type checking', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('TEXT', editor.state.currentPageId, { text: 'Ready' });
    const collection = editor.graph.createCollection('Prototype'), width = editor.graph.createVariable('Width', 'FLOAT', collection.id, 100); editor.graph.bindVariable(node.id, 'width', width.id);
    setPrototypeInteractions(editor, node, [{ id: 'resize', trigger: { type: 'click' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 200 }, transition: 'instant', duration: 0 }, { action: 'back', transition: 'push', direction: 'left', duration: 300, easing: { type: 'spring', mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 } }] } }]);
    const code = selectionToReact(editor.graph, [node.id]).code, path = `${process.cwd()}/xdesign-generated-check.tsx`;
    const options: ts.CompilerOptions = { strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, types: ['react'], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] };
    const host = ts.createCompilerHost(options), read = host.readFile, exists = host.fileExists;
    host.readFile = name => name === path ? code : read(name);
    host.fileExists = name => name === path || exists(name);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
    expect(diagnostics.map(message => ts.flattenDiagnosticMessageText(message.messageText, '\n'))).toEqual([]);
  } finally { editor.dispose(); }
});

it('embeds native texture pixels in React without mutating procedural paints or variables', async () => {
  const ck = await getCanvasKit(), editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 48, height: 48,
      fills: [{ type: 'CUSTOM', customEffectId: 'orion.checker', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true, opacity: .5 }] });
    const collection = editor.graph.createCollection('Theme'), color = editor.graph.createVariable('Ink', 'COLOR', collection.id, { r: 0, g: 1, b: 0, a: 1 }); editor.graph.bindVariable(node.id, 'fills/0/color', color.id);
    const before = serializeGraph(editor.graph), { code } = selectionToReact(editor.graph, [node.id], undefined, ck);
    const data = JSON.parse(code.split('const design: DesignNode[] = ')[1]!.split(';\n\nexport default')[0]!);
    const encoded = data[0].image.split('data:image/png;base64,')[1];
    expect(encoded).toBeTruthy(); expect(serializeGraph(editor.graph)).toBe(before);
    const image = ck.MakeImageFromEncoded(new Uint8Array(Buffer.from(encoded!, 'base64')))!;
    try { expect([...image.readPixels(36, 12, { width: 1, height: 1, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB })!]).toEqual([0, 255, 0, 128]); }
    finally { image.delete(); }
  } finally { editor.dispose(); }
});

it('composes responsive blurred artwork with CanvasKit and refuses stale child geometry', async () => {
  const ck = await getCanvasKit(), editor = createEditor();
  try {
    const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Responsive composition host', width: 100, height: 80 });
    const collection = graph.createCollection('Responsive scene'), width = graph.createVariable('Width', 'FLOAT', collection.id, 100); graph.bindVariable(frame.id, 'width', width.id);
    const scene = graph.createNode('FRAME', frame.id, { name: 'Blur composition', x: 10, y: 10, width: 60, height: 50, horizontalConstraint: 'STRETCH', effects: [{ type: 'LAYER_BLUR', visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
    const child = graph.createNode('RECTANGLE', scene.id, { name: 'Composed responsive child', x: 10, y: 10, width: 20, height: 20, horizontalConstraint: 'STRETCH', fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] });
    const before = serializeGraph(graph), model = selectionToDesignModel(graph, [frame.id], ck), sceneLayer = model.nodes[0]!.children.find(node => node.name === scene.name)!, childLayer = sceneLayer.children.find(node => node.name === child.name)!;
    expect(sceneLayer.motion?.composition).toBe('scene'); expect(sceneLayer.image).toMatch(/^data:image\/png;base64,/); expect(childLayer.sceneCovered).toBe(true);
    expect(model.prototypeIssues).toEqual(expect.arrayContaining([expect.stringContaining('Responsive geometry inside a composed scene needs full-scene rendering')]));
    const encoded = sceneLayer.image!.split(',')[1]!, image = ck.MakeImageFromEncoded(new Uint8Array(Buffer.from(encoded, 'base64')))!;
    try {
      const pixels = image.readPixels(0, 0, { width: image.width(), height: image.height(), alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB });
      expect(pixels).not.toBeNull(); expect([...pixels!].some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    } finally { image.delete(); }
    expect(() => selectionToReact(graph, [frame.id], undefined, ck)).toThrow('Responsive resizing of baked artwork needs source-backed rendering');
    expect(serializeGraph(graph)).toBe(before);

    const staticFrame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Fixed composition host', width: 100, height: 80 });
    const staticScene = graph.createNode('FRAME', staticFrame.id, { name: 'Fixed blur composition', x: 10, y: 10, width: 60, height: 50, effects: [{ type: 'LAYER_BLUR', visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
    const staticChild = graph.createNode('RECTANGLE', staticScene.id, { name: 'Fixed composed child', x: 10, y: 10, width: 20, height: 20, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 } }] });
    const staticModel = selectionToDesignModel(graph, [staticFrame.id], ck), staticLayer = staticModel.nodes[0]!.children.find(node => node.name === staticScene.name)!, covered = staticLayer.children.find(node => node.name === staticChild.name)!;
    expect(staticLayer.image).toMatch(/^data:image\/png;base64,/); expect(covered.sceneCovered).toBe(true);
    expect(covered.style.backgroundColor).toBeUndefined(); expect(covered.image).toBeUndefined(); expect(covered.motion).toBeUndefined();
  } finally { editor.dispose(); }
});
