// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { fontManager, FontManager } from '@open-pencil/core/text';
import type { CanvasKit } from 'canvaskit-wasm';
import { captureNativeReactFonts, installNativeReactFonts } from './nativeReactFonts';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });

it('captures actual public provider registrations and reinstalls primary faces, supplemental bytes, run styles, sources, and fallbacks', async () => {
  const family = 'OrionTransferFixture', regularBytes = await fontManager.fetchBundledFont('/Inter-Regular.ttf'), boldBytes = await fontManager.fetchBundledFont('/Inter-Bold.ttf');
  expect(regularBytes).toBeInstanceOf(ArrayBuffer); expect(boldBytes).toBeInstanceOf(ArrayBuffer);
  fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false });
  fontManager.markLoaded(family, 'Regular', regularBytes!, 'registered');
  fontManager.markLoaded(family, 'Bold', boldBytes!, 'local');
  fontManager.markLoaded(family, 'Regular', boldBytes!, 'registered');
  fontManager.setCJKFallbackFamily(family); fontManager.setArabicFallbackFamily(family);
  const editor = createEditor(), node = editor.graph.createNode('TEXT', editor.state.currentPageId, {
    name: 'Font transfer', text: 'AB', fontFamily: family, fontWeight: 400,
    styleRuns: [{ start: 1, length: 1, style: { fontFamily: family, fontWeight: 700 } }],
  });
  let installed: ReturnType<typeof installNativeReactFonts> | undefined;
  try {
    const snapshot = captureNativeReactFonts(kit, [node]);
    expect(snapshot.faces).toEqual(expect.arrayContaining([
      { family, style: 'Regular', source: 'registered' },
      { family, style: 'Bold', source: 'local' },
    ]));
    expect(snapshot.cjkFallbackFamilies).toContain(family); expect(snapshot.arabicFallbackFamilies).toContain(family);
    const regularKey = `${family}\0Regular`, boldKey = `${family}\0Bold`;
    expect(snapshot.registrations.map(registration => registration.primaryFaces)).toEqual([[regularKey, boldKey], []]);
    expect(snapshot.registrations.map(registration => registration.cacheFace)).toEqual([regularKey, regularKey]);
    expect(snapshot.registrations.map(registration => registration.family)).toEqual([family, family]);
    expect(snapshot.registrations.map(registration => [...new Uint8Array(registration.bytes)])).toEqual([
      [...new Uint8Array(boldBytes!)], [...new Uint8Array(regularBytes!)],
    ]);

    installed = installNativeReactFonts(kit, snapshot);
    expect(fontManager.loadedFontSource(family, 'Regular')).toBe('registered');
    expect(fontManager.loadedFontSource(family, 'Bold')).toBe('local');
    expect(fontManager.loadedData(family, 'Regular')).not.toBeNull();
    expect([...new Uint8Array(fontManager.loadedData(family, 'Regular')!)]).toEqual([...new Uint8Array(boldBytes!)]);
    expect(Array.from({ length: installed.provider.countFamilies() }, (_, index) => installed!.provider.getFamilyName(index))).toContain(family);
    const laterProvider = kit.TypefaceFontProvider.Make()!, laterCalls: { family: string; bytes: ArrayBuffer }[] = [], register = laterProvider.registerFont;
    laterProvider.registerFont = (bytes, registeredFamily) => { const copy = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset, bytes.byteLength).slice(); laterCalls.push({ family: registeredFamily, bytes: copy.buffer }); register.call(laterProvider, bytes, registeredFamily); };
    try {
      fontManager.attachProvider(kit, laterProvider);
      expect(laterCalls.map(call => call.family)).toEqual([family, family]);
      expect(laterCalls.map(call => [...new Uint8Array(call.bytes)])).toEqual([
        [...new Uint8Array(boldBytes!)], [...new Uint8Array(regularBytes!)],
      ]);
      const laterSurface = kit.MakeSurface(16, 16)!; let laterRenderer: InstanceType<typeof import('@open-pencil/core/canvas').SkiaRenderer> | undefined;
      try { laterRenderer = new (await import('@open-pencil/core/canvas')).SkiaRenderer(kit, laterSurface); laterRenderer.fontProvider = laterProvider; laterRenderer.fontsLoaded = true; laterRenderer.fontGeneration = fontManager.generation(); expect(laterRenderer.nodeFontReadiness(node)).toBe('ready'); }
      finally { laterRenderer?.destroy(); if (!laterSurface.isDeleted()) laterSurface.delete(); }
    } finally { fontManager.detachProvider(laterProvider); if (!laterProvider.isDeleted()) laterProvider.delete(); }
    const workerManager = new FontManager(), freshInstall = installNativeReactFonts(kit, snapshot, workerManager), freshProvider = kit.TypefaceFontProvider.Make()!, freshCalls: { family: string; bytes: ArrayBuffer }[] = [], freshRegister = freshProvider.registerFont;
    freshProvider.registerFont = (bytes, registeredFamily) => { const copy = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset, bytes.byteLength).slice(); freshCalls.push({ family: registeredFamily, bytes: copy.buffer }); freshRegister.call(freshProvider, bytes, registeredFamily); };
    try {
      workerManager.attachProvider(kit, freshProvider);
      expect(freshCalls.map(call => call.family)).toEqual([family, family]);
      expect(freshCalls.map(call => [...new Uint8Array(call.bytes)])).toEqual([
        [...new Uint8Array(boldBytes!)], [...new Uint8Array(regularBytes!)],
      ]);
      const freshSurface = kit.MakeSurface(16, 16)!; let freshRenderer: InstanceType<typeof import('@open-pencil/core/canvas').SkiaRenderer> | undefined;
      try { freshRenderer = new (await import('@open-pencil/core/canvas')).SkiaRenderer(kit, freshSurface); freshRenderer.fontProvider = freshProvider; freshRenderer.fontsLoaded = true; freshRenderer.fontGeneration = workerManager.generation(); expect(freshRenderer.nodeFontReadiness(node)).toBe('ready'); }
      finally { freshRenderer?.destroy(); if (!freshSurface.isDeleted()) freshSurface.delete(); }
    } finally { workerManager.detachProvider(freshProvider); if (!freshProvider.isDeleted()) freshProvider.delete(); freshInstall.dispose(); }
    const surface = kit.MakeSurface(16, 16)!; let renderer: InstanceType<typeof import('@open-pencil/core/canvas').SkiaRenderer> | undefined;
    try {
      renderer = new (await import('@open-pencil/core/canvas')).SkiaRenderer(kit, surface);
      renderer.fontProvider = installed.provider; renderer.fontsLoaded = true; renderer.fontGeneration = fontManager.generation();
      expect(renderer.nodeFontReadiness(node)).toBe('ready');
    } finally { renderer?.destroy(); if (!surface.isDeleted()) surface.delete(); }
  } finally { installed?.dispose(); editor.dispose(); }
});

it('rejects missing required bytes before allocating or attaching a provider', () => {
  const editor = createEditor(), node = editor.graph.createNode('TEXT', editor.state.currentPageId, { text: 'Offline', fontFamily: 'MissingOfflineFace' });
  try { expect(() => captureNativeReactFonts(kit, [node])).toThrow('Load MissingOfflineFace Regular'); }
  finally { editor.dispose(); }
});
