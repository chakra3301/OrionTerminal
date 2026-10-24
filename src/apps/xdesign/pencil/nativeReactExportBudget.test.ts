// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { fontManager } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import { assertNativeReactCodeBudget, assertNativeReactResourceBudgets, base64Length, estimateNativeReactCodeBytes, NATIVE_REACT_EXPORT_LIMITS } from './nativeReactExportBudget';
import type { NativeReactCodeBudgetInput } from './nativeReactExportBudget';
import { selectionToNativeReactArchive } from './nativeReactExport';

it('keeps the established resource boundaries and computes base64 expansion without allocating encoded copies', () => {
  expect(base64Length(0)).toBe(0); expect(base64Length(1)).toBe(4); expect(base64Length(2)).toBe(4); expect(base64Length(3)).toBe(4); expect(base64Length(4)).toBe(8);
  expect(assertNativeReactResourceBudgets(20_000, NATIVE_REACT_EXPORT_LIMITS.images, NATIVE_REACT_EXPORT_LIMITS.fonts, NATIVE_REACT_EXPORT_LIMITS.wasm)).toMatchObject({ nodeCount: 20_000, base64Bytes: base64Length(NATIVE_REACT_EXPORT_LIMITS.images) + base64Length(NATIVE_REACT_EXPORT_LIMITS.fonts) + base64Length(NATIVE_REACT_EXPORT_LIMITS.wasm) });
  expect(() => assertNativeReactResourceBudgets(20_001, 0, 0, 0)).toThrow('20,000');
  expect(() => assertNativeReactResourceBudgets(1, NATIVE_REACT_EXPORT_LIMITS.images + 1, 0, 0)).toThrow('24 MB');
  expect(() => assertNativeReactResourceBudgets(1, 0, NATIVE_REACT_EXPORT_LIMITS.fonts + 1, 0)).toThrow('64MB');
  expect(() => assertNativeReactResourceBudgets(1, 0, 0, NATIVE_REACT_EXPORT_LIMITS.wasm + 1)).toThrow('WASM');
});

const literal = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function fixture(): NativeReactCodeBudgetInput {
  return {
    componentName: 'Café_Overlay', valuesRuntime: 'const value = "λ";', designRuntime: 'function View() {}', protocol: 'type P = {}', routeRuntime: 'function route() {}', transitionRuntime: 'function transition() {}', playbackRuntime: 'function playback() {}', clientRuntime: 'class Client {}', nativeRuntime: 'function Native() {}',
    worker: 'worker<🟣>', graph: '{"source":"<shape>\u2028"}', ids: ['screen-α', 'screen-β'], rootId: 'screen-α',
    fonts: { version: 1, faces: [{ family: 'Noto', style: 'Regular', source: 'fallback' }], registrations: [{ family: 'Noto', bytes: new Uint8Array([1, 2, 3, 4]).buffer, primaryFaces: ['Noto\0Regular'], cacheFace: 'Noto\0Regular' }], cjkFallbackFamilies: ['Noto'], arabicFallbackFamilies: [] },
    wasmBytes: 5, model: { nodes: [{ name: '☃', image: 'data:image/png;base64,AA<=' }], width: 12, height: 8, byteLength: 56, prototypeVariables: { variables: [] } }, assetCredits: [{ provider: 'Stock', title: '© Owner' }],
  };
}

it('estimates the exact UTF-8 size of generated source before base64 and JSON serialization', () => {
  const input = fixture(), assetFonts = { ...input.fonts, registrations: input.fonts.registrations.map(registration => ({ ...registration, bytes: 'AAECAw==' })) };
  const assets = { worker: input.worker, wasm: 'AAAAAAA=', graph: input.graph, ids: input.ids, rootId: input.rootId, fonts: assetFonts };
  const model = { ...input.model };
  const expected = `"use client";\n\n${input.valuesRuntime}\n\n${input.designRuntime}\n\n${input.protocol}\n\n${input.routeRuntime}\n\n${input.transitionRuntime}\n\n${input.playbackRuntime}\n\n${input.clientRuntime}\n\n${input.nativeRuntime}\n\nexport const designAssetCredits = ${literal(input.assetCredits)};\nconst nativeAssets = ${literal(assets)};\nconst initialModel: NativeReactModel = ${literal(model)};\n\nexport default function ${input.componentName}(props: NativeReactProps) { return <NativeDesignView assets={nativeAssets} initialModel={initialModel} {...props}/>; }\n`;
  expect(estimateNativeReactCodeBytes(input)).toBe(new TextEncoder().encode(expected).byteLength);
  expect(assertNativeReactCodeBudget(input)).toBe(new TextEncoder().encode(expected).byteLength);
});

it('refuses a stale source lease and missing selected image before invoking renderer or archive work', async () => {
  const editor = createEditor(), page = editor.graph.getPages()[0]!, frame = editor.graph.createNode('FRAME', page.id, { width: 32, height: 24 });
  const canvasKit = null as unknown as CanvasKit;
  try {
    await expect(selectionToNativeReactArchive(editor.graph, [frame.id], canvasKit, undefined, { assertSourceCurrent() { throw new Error('source lease expired'); } })).rejects.toThrow('source lease expired');
    editor.graph.createNode('RECTANGLE', frame.id, { fills: [{ type: 'IMAGE', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 }, imageHash: 'missing-native-resource' }] });
    await expect(selectionToNativeReactArchive(editor.graph, [frame.id], canvasKit)).rejects.toThrow('Restore the image');
  } finally { editor.dispose(); }
});

it('checks cancellation and lease expiry after asynchronous font preparation before using renderer assets', async () => {
  const editor = createEditor(), frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 32, height: 24 });
  const kit = null as unknown as CanvasKit, controller = new AbortController(); controller.abort(new Error('export cancelled'));
  try {
    await expect(selectionToNativeReactArchive(editor.graph, [frame.id], kit, undefined, { signal: controller.signal })).rejects.toThrow('export cancelled');
    let checks = 0;
    await expect(selectionToNativeReactArchive(editor.graph, [frame.id], kit, undefined, { assertSourceCurrent() { if (++checks === 3) throw new Error('lease expired during font preparation'); } })).rejects.toThrow('lease expired during font preparation');
    expect(checks).toBe(3);
  } finally { editor.dispose(); }
});

it('rejects excessive unique authored font faces before loading any fonts', async () => {
  const editor = createEditor(), frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 32, height: 24 });
  for (let index = 0; index < 129; index++) editor.graph.createNode('TEXT', frame.id, { text: 'A', fontFamily: `Native test face ${index}` });
  const load = vi.spyOn(fontManager, 'loadFont');
  try {
    await expect(selectionToNativeReactArchive(editor.graph, [frame.id], null as unknown as CanvasKit)).rejects.toThrow('128 font faces');
    expect(load).not.toHaveBeenCalled();
  } finally { load.mockRestore(); editor.dispose(); }
});
