import { act } from 'react';
import { deflateSync } from 'node:zlib';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FILTERS, type PhotoAction } from './controls';
import { adjustmentDefaults } from './adjustmentSettings';
import { PhotoActionDialog } from './PhotoActionDialog';
import { usePhotoWorkspace } from './runtime';
import type { PhotoDocument, PhotoState } from './types';
import type { PhotoPreviewRegion } from './commandPreview';

const native = vi.hoisted(() => ({ enabled: false, run: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./runtime', async original => ({ ...await original<typeof import('./runtime')>(), runPhotoCommand: native.run }));
const photo: PhotoDocument = { id: 'photo', version: 'v1', name: 'Image', width: 400, height: 200, previewWidth: 400, previewHeight: 200, bundlePath: '', previewPath: 'original.png', originalPath: null };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); native.enabled = false; native.run.mockReset().mockResolvedValue({}); native.invoke.mockReset().mockResolvedValue({ width: 400, height: 200, png: 'AA==' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  usePhotoWorkspace.setState({ projectId: 'project', busy: false, error: null, state: null }); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const action = (id: string) => FILTERS.find(item => item.id === `filter.blurGallery.${id}`)!;
const render = (item: PhotoAction, document = photo) => act(async () => root.render(<PhotoActionDialog action={item} adjustment={false} document={document} onClose={vi.fn()}/>));
const key = (label: string, name: string, shiftKey = false) => act(async () => host.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!;
const click = (text: string) => act(async () => button(text).click());
const previewBox = () => [...host.querySelectorAll('.xd-ps-dialog-buttons label')].find(label => label.textContent === 'Preview')!.querySelector('input')!;
const preview = async () => { if (previewBox().checked) await act(async () => previewBox().click()); await act(async () => previewBox().click()); };
const showOriginal = () => act(async () => { if (previewBox().checked) previewBox().click(); });
const submit = () => act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const pointer = (element: Element, type: string, x: number, y: number) => act(async () => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: 1 }); element.dispatchEvent(event); });

it.each([
  ['fieldBlur', 'Field Blur 1 center', 'ArrowRight', { centerX: .5025 }],
  ['irisBlur', 'Iris Blur 1 horizontal radius', 'ArrowRight', { radiusX: .355 }],
  ['spinBlur', 'Spin angle 1', 'ArrowUp', { blurAngle: 16 }],
  ['pathBlur', 'Path 1 point 1', 'ArrowDown', { startY: .505 }],
  ['tiltShift', 'Tilt-Shift focus width', 'ArrowDown', { focus: .105 }],
] as const)('publishes precise on-image %s edits through the same preview and Apply parameters', async (id, handle, arrow, patch) => {
  const item = action(id), original = structuredClone(item); await render(item); await key(handle, arrow);
  expect(host.querySelector('form')!.checkValidity()).toBe(true); await preview();
  const expected = { ...adjustmentDefaults(item, 'RGB'), ...patch };
  expect(native.invoke).toHaveBeenCalledWith('xdesign_photo_command_preview', expect.objectContaining({ projectId: 'project', photoId: 'photo', version: 'v1', command: item.id, params: expected }));
  expect(host.querySelector('svg image')!.getAttribute('href')).toBe('blob:preview');
  await showOriginal();
  expect(host.querySelector('svg image')!.getAttribute('href')).toBe('original.png');
  await submit(); expect(native.run).toHaveBeenCalledWith(item.id, expected); expect(item).toEqual(original); expect(photo.version).toBe('v1');
});

it('uses selection operation bounds rather than an offset active layer and applies multi-pin metadata exactly', async () => {
  usePhotoWorkspace.setState({ state: { name: 'Image', width: 400, height: 200, mode: 'RGB', depth: 8, resolution: 72, activeLayer: 3, hasSelection: true, selectionBounds: [100, 50, 200, 100], layers: [{ id: 3, name: 'Offset', kind: 'Pixels', visible: true, opacity: 1, fill: 1, blend: 'Normal', clipped: false, hasMask: false, bounds: [10, 20, 30, 40] }], canUndo: false, canRedo: false } });
  const pins = [{ x: .5, y: .5, blur: 15, note: 'first' }, { x: .9, y: .1, blur: 50, note: 'second' }], item = { ...action('fieldBlur'), defaults: { pins } };
  await render(item); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  const marker = host.querySelector('[aria-label="Field Blur 1 center"] circle:last-child')!;
  expect(marker.getAttribute('cx')).toBe('200'); expect(marker.getAttribute('cy')).toBe('100');
  await pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); await pointer(svg, 'pointerup', 220, 110);
  expect(host.querySelector('form')!.checkValidity()).toBe(true); await submit();
  expect(native.run).toHaveBeenCalledWith(item.id, expect.objectContaining({ pins: [{ ...pins[0], x: .6, y: .6 }, pins[1]] })); expect(item.defaults.pins).toEqual(pins);
});

it('requires explicit repair for empty or mixed-malformed imported geometry and retains it until that choice', async () => {
  const pins = [{ x: .2, y: .3, blur: 10 }, { x: 'bad' }], item = { ...action('fieldBlur'), defaults: { pins } };
  await render(item); expect(button('OK').disabled).toBe(true); await preview(); expect(native.invoke).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await submit(); expect(native.run).not.toHaveBeenCalled(); expect(item.defaults.pins).toEqual(pins);
  await click('Use single field blur pins'); expect(button('OK').disabled).toBe(false); await submit();
  expect(native.run).toHaveBeenCalledWith(item.id, adjustmentDefaults(action('fieldBlur'), 'RGB')); expect(item.defaults.pins).toEqual(pins);
});

it('coalesces a moved path while a preview is pending and shows the older pixels until the moved path renders', async () => {
  native.enabled = true; vi.useFakeTimers(); let finish: ((value: { width: number; height: number; png: string }) => void) | undefined;
  native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ width: 400, height: 200, png: 'AA==' });
  await render(action('pathBlur')); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(native.invoke).toHaveBeenCalledOnce();
  await key('Path 1 point 1', 'ArrowRight'); await act(async () => finish!({ width: 400, height: 200, png: 'AA==' }));
  expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(host.querySelector('svg image')!.getAttribute('href')).toBe('blob:preview');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(native.invoke).toHaveBeenLastCalledWith('xdesign_photo_command_preview', expect.objectContaining({ params: expect.objectContaining({ startX: .2025 }) }));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2); expect(host.querySelector('svg image')!.getAttribute('href')).toBe('blob:preview'); expect(native.run).not.toHaveBeenCalled();
});

it('abandons source-replaced and busy gestures before further parameter publication', async () => {
  await render(action('fieldBlur')); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  await pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); await render(action('fieldBlur'), { ...photo, version: 'v2' });
  await pointer(svg, 'pointermove', 240, 120); expect(host.querySelector<HTMLInputElement>('[aria-label="Filter Center X"]')!.value).toBe('0.5');
  await pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); await act(async () => usePhotoWorkspace.setState({ busy: true }));
  await pointer(svg, 'pointermove', 240, 120); await key('Field Blur 1 center', 'ArrowRight');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Filter Center X"]')!.value).toBe('0.5'); expect(button('OK').disabled).toBe(true); expect(native.run).not.toHaveBeenCalled();
});

it('adds selection-independent pins through a zoomed preview without serializing view state into the filter', async () => {
  const item = action('fieldBlur'); await render(item); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click());
  await act(async () => svg.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 140, button: 0, bubbles: true, cancelable: true })));
  const expected = { ...adjustmentDefaults(item, 'RGB'), pins: [{ x: .5, y: .5, blur: 15 }, { x: .625, y: .6, blur: 15 }] };
  await click('Pan preview'); await pointer(svg, 'pointerdown', 200, 100); await pointer(svg, 'pointerup', 240, 120);
  await preview(); expect(native.invoke).toHaveBeenLastCalledWith('xdesign_photo_command_preview', expect.objectContaining({ params: expected }));
  await submit(); expect(native.run).toHaveBeenCalledWith(item.id, expected); expect(photo.version).toBe('v1');
});

it('adds/removes path vertices with precise shared Preview/Apply payloads and blocks topology changes while busy', async () => {
  const item = action('pathBlur'); await render(item); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  await act(async () => svg.dispatchEvent(new MouseEvent('dblclick', { clientX: 200, clientY: 100, button: 0, bubbles: true, cancelable: true })));
  expect(host.querySelector('form')!.checkValidity()).toBe(true); await preview();
  const params = native.invoke.mock.calls.at(-1)![1].params;
  expect(params.paths[0]).toMatchObject({ points: [[.2, .5], [.5, .5], [.8, .5]], speed: 50, taper: 0 });
  await act(async () => usePhotoWorkspace.setState({ busy: true }));
  await act(async () => svg.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 100, button: 0, bubbles: true, cancelable: true }))); await key('Path 1 point 2', 'Delete');
  await act(async () => usePhotoWorkspace.setState({ busy: false })); await submit(); expect(native.run).toHaveBeenCalledWith(item.id, params);
});

it('shows native detail tiles at high zoom, switches cached originals, coalesces a pan and keeps Apply viewport-free', async () => {
  vi.useFakeTimers(); const item = action('fieldBlur'), large = { ...photo, width: 4096, height: 2048 };
  let sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:detail-${++sequence}`);
  native.invoke.mockImplementation(async (_command, request) => ({ width: 2048, height: 1024, png: 'AA==',
    ...(request.regions?.length ? { tiles: request.regions.map((region: { width: number; height: number; scale: number }) => ({ ...region, pixelWidth: Math.ceil(region.width / region.scale), pixelHeight: Math.ceil(region.height / region.scale), png: 'AQ==' })), originalTiles: request.regions.map((region: { width: number; height: number; scale: number }) => ({ ...region, pixelWidth: Math.ceil(region.width / region.scale), pixelHeight: Math.ceil(region.height / region.scale), png: 'Ag==' })) } : {}) }));
  await render(item, large); const svg = host.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click(); });
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click(); });
  await preview();
  const params = native.invoke.mock.calls[0]![1].params;
  expect(native.invoke.mock.calls[0]![1].regions).toEqual([{ x: 1536, y: 768, width: 512, height: 512, scale: 1 }, { x: 2048, y: 768, width: 512, height: 512, scale: 1 }]);
  const images = () => [...host.querySelectorAll('[data-preview-detail]')].map(image => image.getAttribute('href'));
  expect(images()).toEqual(['blob:detail-2', 'blob:detail-3']);
  await showOriginal();
  expect(images()).toEqual(['blob:detail-4', 'blob:detail-5']); expect(native.invoke).toHaveBeenCalledOnce();
  await click('Pan preview'); await pointer(svg, 'pointerdown', 400, 200); await pointer(svg, 'pointerup', 440, 200);
  expect(images()).toEqual([]); expect(host.querySelector('svg image')!.getAttribute('href')).toBe('original.png');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.invoke.mock.calls[1]![1].params).toEqual(params);
  const visible = native.invoke.mock.calls[1]![1].regions;
  expect(visible[0].x).toBeLessThan(1536); expect(images()).toHaveLength(visible.length);
  expect(visible.reduce((pixels: number, region: { width: number; height: number }) => pixels + region.width * region.height, 0)).toBeGreaterThanOrEqual(1024 * 512);
  await click('Fit image');
  expect(images()).toEqual([]); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(native.invoke).toHaveBeenCalledTimes(2);
  await submit(); expect(native.run).toHaveBeenCalledWith(item.id, params); expect(params).not.toHaveProperty('regions'); expect(large.version).toBe('v1');
});

function png(width: number, height: number, blue: boolean) {
  const chunk = (name: string, data: Buffer) => { const typed = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff; for (const byte of typed) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } const frame = Buffer.alloc(data.length + 12); frame.writeUInt32BE(data.length); typed.copy(frame, 4); frame.writeUInt32BE((crc ^ 0xffffffff) >>> 0, frame.length - 4); return frame; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = y * (width * 4 + 1) + 1 + x * 4; pixels[at + (blue ? 2 : 0)] = 255; pixels[at + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

function smartState(document = photo): PhotoState {
  return { name: 'Smart', width: document.width, height: document.height, mode: 'RGB', depth: 8, resolution: 72, activeLayer: 3, hasSelection: true, selectionBounds: [20, 30, 100, 50], layers: [{ id: 3, name: 'Source', kind: 'smart', visible: true, opacity: 1, fill: 1, blend: 'Normal', clipped: false, hasMask: false, bounds: [9, 7, 90, 40], smartObject: { source: 'linked', name: 'source.pcraft', hasFilterMask: true }, smartFiltersEnabled: false }], canUndo: false, canRedo: false, viewKey: 'native-view' };
}
function smartReply(document = photo, regions: PhotoPreviewRegion[] = [], mode: 'source' | 'cache' = 'source', fresh = false) {
  const factor = Math.max(1, Math.ceil(Math.max(document.width, document.height) / 2048)), width = Math.ceil(document.width / factor), height = Math.ceil(document.height / factor);
  const tile = (region: PhotoPreviewRegion, blue: boolean) => ({ ...region, pixelWidth: Math.ceil(region.width / region.scale), pixelHeight: Math.ceil(region.height / region.scale), png: png(Math.ceil(region.width / region.scale), Math.ceil(region.height / region.scale), blue) });
  return { width, height, png: png(width, height, false), result: { blurEdit: { input: { png: png(width, height, !fresh), width: document.width, height: document.height, pixelWidth: width, pixelHeight: height }, mode, bounds: mode === 'source' ? [0, 0, document.width, document.height] : [20, 30, 100, 50], stackEnabled: false, filterVisible: true, ...(regions.length ? { inputTiles: regions.map(region => tile(region, !fresh)) } : {}) } }, ...(regions.length ? { tiles: regions.map(region => tile(region, false)), originalTiles: regions.map(region => tile(region, false)) } : {}) };
}
function measureSmart() {
  const svg = host.querySelector('svg')!; svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  const captured = new Set<number>(); svg.setPointerCapture = vi.fn(id => { captured.add(id); }); svg.hasPointerCapture = id => captured.has(id); svg.releasePointerCapture = vi.fn(id => { captured.delete(id); }); return svg;
}
const smartNumber = (label: string, value: string) => act(async () => { const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });

it.each((['source', 'cache'] as const).flatMap(mode => ['fieldBlur', 'irisBlur', 'spinBlur', 'pathBlur', 'tiltShift'].map(family => ({ mode, family }))))('uses authoritative $mode bounds for ordinary Smart $family', async ({ mode, family }) => {
    await act(async () => root.render(null)); usePhotoWorkspace.setState({ state: smartState() }); native.invoke.mockClear(); native.run.mockClear(); const response = smartReply(photo, [], mode); native.invoke.mockResolvedValue(response);
    const item = action(family), source = structuredClone(item); await render(item); expect(host.querySelector('svg')).toBeNull(); await preview(); const svg = measureSmart();
    expect(svg.querySelector('image')!.getAttribute('href')).toBe(`data:image/png;base64,${response.result.blurEdit.input.png}`);
    const label = family === 'pathBlur' ? 'Path 1 point 1' : family === 'tiltShift' ? 'Tilt-Shift 1 center' : `${family === 'fieldBlur' ? 'Field Blur' : family === 'irisBlur' ? 'Iris Blur' : 'Spin Blur'} 1 center`;
    const centerX = family === 'pathBlur' ? mode === 'source' ? 80 : 40 : mode === 'source' ? 200 : 70, centerY = mode === 'source' ? 100 : 55;
    const marker = svg.querySelector(`[aria-label="${label}"] circle:last-child`)!; expect(Number(marker.getAttribute('cx'))).toBeCloseTo(centerX, 10); expect(Number(marker.getAttribute('cy'))).toBeCloseTo(centerY, 10);
    await pointer(svg.querySelector(`[aria-label="${label}"]`)!, 'pointerdown', centerX, centerY); await pointer(svg, 'pointermove', centerX + 4, centerY + 2); await pointer(svg, 'pointermove', centerX + 8, centerY + 4); await pointer(svg, 'pointerup', centerX + 10, centerY + 5);
    await key(label, 'ArrowRight'); await preview(); const sent = native.invoke.mock.lastCall![1], expectedX = (family === 'pathBlur' ? .2 : .5) + (mode === 'source' ? 11 / 400 : 11 / 100), expectedY = .5 + (mode === 'source' ? 5 / 200 : 5 / 50);
    expect(sent.params[family === 'pathBlur' ? 'startX' : 'centerX']).toBeCloseTo(expectedX, 12); expect(sent.params[family === 'pathBlur' ? 'startY' : 'centerY']).toBeCloseTo(expectedY, 12);
    expect(sent.viewKey).toBe('native-view'); expect(sent).not.toHaveProperty('ordinarySmartBlur'); expect(sent.params).not.toHaveProperty('blurEdit');
    const full = host.querySelector<HTMLImageElement>('img[alt="Full image preview"]')!; expect(full.getAttribute('src')).toBe('blob:preview'); await showOriginal(); expect(full.getAttribute('src')).toBe('original.png'); expect(svg.querySelector('image')!.getAttribute('href')).toBe(`data:image/png;base64,${response.result.blurEdit.input.png}`);
    await submit(); expect(native.run).toHaveBeenCalledWith(item.id, sent.params); expect(item).toEqual(source); expect(host.textContent).toContain(mode === 'source' ? 'Geometry shows all prior filters enabled' : 'Geometry uses cached Smart Object pixels'); if (mode === 'cache') expect(host.textContent).not.toContain('full image preview keeps the stack visibility');
});

it.each(['mode', 'bounds', 'source bounds', 'dimensions', 'pixels', 'png'] as const)('does not use malformed native %s as a Smart geometry frame and permits retry', async kind => {
  usePhotoWorkspace.setState({ state: smartState() }); const response = smartReply();
  if (kind === 'mode') (response.result.blurEdit as { mode: string }).mode = 'unknown'; if (kind === 'bounds') response.result.blurEdit.bounds[2] = -1; if (kind === 'source bounds') response.result.blurEdit.bounds = [20, 30, 100, 50]; if (kind === 'dimensions') response.result.blurEdit.input.width++; if (kind === 'pixels') response.result.blurEdit.input.pixelWidth--; if (kind === 'png') response.result.blurEdit.input.png = 'AA==';
  native.invoke.mockResolvedValueOnce(response).mockResolvedValue(smartReply()); await render(action('fieldBlur')); await preview(); expect(host.querySelector('svg')).toBeNull(); expect(button('OK').disabled).toBe(false); await preview(); expect(host.querySelector('svg image')!.getAttribute('href')).toContain('data:image/png;base64,');
});

it.each(['raster', 'mask', 'alpha', 'quickMask', 'explicit mask', 'explicit alpha'] as const)('keeps the ordinary %s target independent of Smart source input', async target => {
  const state = smartState(); let item = action('fieldBlur');
  if (target === 'raster') delete state.layers[0]!.smartObject;
  if (target === 'mask') { state.layers[0]!.hasMask = true; state.layerMaskView = { layer: 3, mode: 'gray' }; }
  if (target === 'alpha') state.channels = { alpha: [], target: { kind: 'alpha', index: 0 } };
  if (target === 'quickMask') state.quickMask = true;
  if (target === 'explicit mask') item = { ...item, defaults: { ...item.defaults, target: 'mask' } };
  if (target === 'explicit alpha') item = { ...item, defaults: { ...item.defaults, target: { channel: 0 } } };
  usePhotoWorkspace.setState({ state }); await render(item); expect(host.querySelector('svg')).not.toBeNull(); expect(host.querySelector('img[alt="Full image preview"]')).toBeNull(); await preview(); expect(native.invoke.mock.lastCall![1]).not.toHaveProperty('ordinarySmartBlur'); expect(host.textContent).not.toContain('Preview the Smart Object input'); await submit(); expect(native.run).toHaveBeenCalledWith(item.id, adjustmentDefaults(item, 'RGB'));
});

it.each(['project', 'document', 'version', 'layer', 'view', 'selection', 'target'] as const)('expires captured Smart %s context, releases its gesture and rejects old Preview/Apply', async change => {
  const state = smartState(), close = vi.fn(); usePhotoWorkspace.setState({ state }); native.invoke.mockResolvedValue(smartReply()); const renderCurrent = (document = photo) => act(async () => root.render(<PhotoActionDialog action={action('fieldBlur')} adjustment={false} document={document} onClose={close}/>)); await renderCurrent(); await preview(); const svg = measureSmart(); await pointer(svg.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100);
  if (change === 'project') await act(async () => usePhotoWorkspace.setState({ projectId: 'other' })); else if (change === 'document') await renderCurrent({ ...photo, id: 'other' }); else if (change === 'version') await renderCurrent({ ...photo, version: 'v2' }); else await act(async () => usePhotoWorkspace.setState({ state: { ...state, ...(change === 'layer' ? { activeLayer: 8 } : change === 'view' ? { viewKey: 'other' } : change === 'selection' ? { selectionBounds: [10, 20, 80, 40] as [number, number, number, number] } : { channels: { alpha: [], target: { kind: 'alpha' as const, index: 0 } } }) } }));
  expect(svg.releasePointerCapture).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalled(); await pointer(svg, 'pointermove', 240, 120); await submit(); expect(native.run).not.toHaveBeenCalled(); expect(previewBox().disabled).toBe(true); expect(button('OK').disabled).toBe(true);
});

it('keeps numeric Smart Apply available above sixteen megapixels and enforces whole-form validity', async () => {
  const large = { ...photo, width: 6000, height: 3000 }; usePhotoWorkspace.setState({ state: smartState(large) }); await render(action('fieldBlur'), large); expect(host.querySelector('svg')).toBeNull(); expect(previewBox().disabled).toBe(true); expect(button('OK').disabled).toBe(false); await smartNumber('Filter Blur', 'bad'); await submit(); expect(native.run).not.toHaveBeenCalled(); await smartNumber('Filter Blur', '21.5'); await submit(); expect(native.run).toHaveBeenCalledWith('filter.blurGallery.fieldBlur', expect.objectContaining({ blur: 21.5 })); expect(native.invoke).not.toHaveBeenCalled();
});

it('submits Smart numeric settings once, permits failed retry and cancels without a command', async () => {
  usePhotoWorkspace.setState({ state: smartState() }); const close = vi.fn(); await act(async () => root.render(<PhotoActionDialog action={action('fieldBlur')} adjustment={false} document={photo} onClose={close}/>)); native.run.mockRejectedValueOnce(new Error('retry')); await smartNumber('Filter Blur', '21.5'); await submit(); expect(host.textContent).toContain('retry'); let finish!: (value: unknown) => void; native.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); expect(native.run).toHaveBeenCalledTimes(2); expect(native.run).toHaveBeenLastCalledWith('filter.blurGallery.fieldBlur', expect.objectContaining({ blur: 21.5 })); await act(async () => finish({})); expect(close).toHaveBeenCalledOnce(); await act(async () => root.render(null)); await render(action('fieldBlur')); await click('Cancel'); expect(native.run).toHaveBeenCalledTimes(2);
});

it('retains sharp input details, zoom and pan across fresh Smart pixels while expiring old-image gestures', async () => {
  vi.useFakeTimers(); const large = { ...photo, width: 3000, height: 2000 }; usePhotoWorkspace.setState({ state: smartState(large) }); let fresh = false, sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:smart-${++sequence}`); native.invoke.mockImplementation(async (_id, args) => smartReply(large, args.regions ?? [], 'source', fresh));
  await render(action('fieldBlur'), large); await preview(); const svg = measureSmart(); for (let i = 0; i < 3; i++) await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click()); await act(async () => vi.advanceTimersByTime(300));
  await click('Pan preview'); await pointer(svg, 'pointerdown', 200, 100); await pointer(svg, 'pointermove', 180, 90); await pointer(svg, 'pointerup', 160, 80); await smartNumber('Filter Blur', '31.25'); await preview(); const viewBox = svg.getAttribute('viewBox'), regions = structuredClone(native.invoke.mock.lastCall![1].regions); expect(regions.length).toBeGreaterThan(0); expect(native.invoke.mock.lastCall![1].params.blur).toBe(31.25);
  await click('Pan preview'); await pointer(svg.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); fresh = true; await preview(); const tiles = [...svg.querySelectorAll('[data-preview-detail]')].map(node => node.getAttribute('href')); expect(tiles.length).toBe(regions.length); expect(svg.getAttribute('viewBox')).toBe(viewBox); expect(host.querySelector('[aria-label="Blur preview zoom"]')!.textContent).toBe('8× fit'); expect(svg.releasePointerCapture).toHaveBeenCalledTimes(2); expect(host.querySelector('svg')).toBe(svg); expect(svg.querySelector('image')!.getAttribute('href')).toBe(`data:image/png;base64,${smartReply(large, [], 'source', true).result.blurEdit.input.png}`);
  await act(async () => vi.advanceTimersByTime(1000)); expect([...svg.querySelectorAll('[data-preview-detail]')].map(node => node.getAttribute('href'))).toEqual(tiles); await pointer(svg, 'pointermove', 300, 160); await submit(); expect(native.run.mock.lastCall![1]).toMatchObject({ blur: 31.25, centerX: .5, centerY: .5 }); expect(native.run.mock.lastCall![1]).not.toHaveProperty('regions'); await act(async () => root.render(null)); const allocated = vi.mocked(URL.createObjectURL).mock.results.filter(result => result.type === 'return').map(result => result.value); expect(new Set(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url))).toEqual(new Set(allocated));
});

it('resets the Smart viewport and input details on a source/cache frame switch even with identical input pixels', async () => {
  vi.useFakeTimers(); const large = { ...photo, width: 3000, height: 2000 }; usePhotoWorkspace.setState({ state: smartState(large) }); let mode: 'source' | 'cache' = 'source'; native.invoke.mockImplementation(async (_id, args) => smartReply(large, args.regions ?? [], mode)); await render(action('fieldBlur'), large); await preview(); const svg = measureSmart(); for (let i = 0; i < 3; i++) await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click()); await act(async () => vi.advanceTimersByTime(300)); const oldTiles = [...svg.querySelectorAll('[data-preview-detail]')].map(node => node.getAttribute('href')); expect(oldTiles.length).toBeGreaterThan(0); await pointer(svg.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); mode = 'cache'; await preview(); expect(svg.releasePointerCapture).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-label="Blur preview zoom"]')!.textContent).toBe('1× fit'); expect(svg.querySelectorAll('[data-preview-detail]')).toHaveLength(0); for (const url of oldTiles) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url); await pointer(svg, 'pointermove', 240, 120); const requests = native.invoke.mock.calls.length; for (let i = 0; i < 3; i++) await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!.click()); await act(async () => vi.advanceTimersByTime(300)); expect(native.invoke).toHaveBeenCalledTimes(requests + 1); expect(svg.querySelectorAll('[data-preview-detail]').length).toBeGreaterThan(0); expect(host.querySelector('[aria-label="Blur preview zoom"]')!.textContent).toBe('8× fit'); await submit(); expect(native.run.mock.lastCall![1]).toMatchObject({ centerX: .5, centerY: .5 });
});

it('rejects a deferred old Smart input and does not close a replacement context after a late Apply', async () => {
  const state = smartState(), close = vi.fn(); usePhotoWorkspace.setState({ state }); let finishPreview!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finishPreview = resolve; })); const renderCurrent = (document = photo) => act(async () => root.render(<PhotoActionDialog action={action('fieldBlur')} adjustment={false} document={document} onClose={close}/>)); await renderCurrent(); await preview(); await renderCurrent({ ...photo, version: 'v2' }); await act(async () => finishPreview(smartReply())); expect(host.querySelector('svg')).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(native.run).not.toHaveBeenCalled();
  await act(async () => root.render(null)); close.mockClear(); await renderCurrent(); let finishApply!: (value: unknown) => void; native.run.mockImplementationOnce(() => new Promise(resolve => { finishApply = resolve; })); await submit(); await renderCurrent({ ...photo, version: 'v2' }); const closes = close.mock.calls.length; await act(async () => finishApply({})); expect(close).toHaveBeenCalledTimes(closes); expect(native.run).toHaveBeenCalledOnce();
});

it('retains unknown ordinary Smart pin metadata through geometry, numeric preview and Apply', async () => {
  usePhotoWorkspace.setState({ state: smartState() }); native.invoke.mockResolvedValue(smartReply()); const item = { ...action('fieldBlur'), defaults: { ...action('fieldBlur').defaults, vendor: { keep: [1, 2] }, pins: [{ x: .5, y: .5, blur: 15, vendor: 'pin' }, { x: .8, y: .3, blur: 9, vendor: 'other' }] } }, before = structuredClone(item); await render(item); await preview(); await key('Field Blur 1 center', 'ArrowRight'); await preview(); const params = native.invoke.mock.lastCall![1].params; expect(params).toMatchObject({ vendor: { keep: [1, 2] }, pins: [{ x: .5025, y: .5, blur: 15, vendor: 'pin' }, { x: .8, y: .3, blur: 9, vendor: 'other' }] }); await submit(); expect(native.run).toHaveBeenCalledWith(item.id, params); expect(item).toEqual(before);
});

it('preserves native off-canvas cache selection bounds instead of clipping or substituting the document', async () => {
  usePhotoWorkspace.setState({ state: smartState() }); const response = smartReply(photo, [], 'cache'); response.result.blurEdit.bounds = [-20, -10, 120, 80]; native.invoke.mockResolvedValue(response); await render(action('fieldBlur')); await preview(); const svg = measureSmart(), marker = svg.querySelector('[aria-label="Field Blur 1 center"] circle:last-child')!; expect(marker.getAttribute('cx')).toBe('40'); expect(marker.getAttribute('cy')).toBe('30'); const outline = svg.querySelector('.xd-photo-blur-selection')!; expect(outline.getAttribute('x')).toBe('-20'); expect(outline.getAttribute('y')).toBe('-10'); expect(outline.getAttribute('width')).toBe('120'); await key('Field Blur 1 center', 'ArrowRight'); await submit(); expect(native.run.mock.lastCall![1].centerX).toBeCloseTo(.5 + 1 / 120, 12); expect(native.run.mock.lastCall![1].centerY).toBe(.5);
});

it('refreshes native stack visibility metadata without expiring a gesture when the source pixels and frame are unchanged', async () => {
  usePhotoWorkspace.setState({ state: smartState() }); const first = smartReply(), next = smartReply(); next.result.blurEdit.stackEnabled = true; native.invoke.mockResolvedValueOnce(first).mockResolvedValueOnce(next); await render(action('fieldBlur')); await preview(); expect(host.textContent).toContain('Geometry shows all prior filters enabled'); const svg = measureSmart(); await pointer(svg.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100); await preview(); expect(host.querySelector('svg')).toBe(svg); expect(svg.releasePointerCapture).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Geometry shows all prior filters enabled'); await pointer(svg, 'pointerup', 200, 100); await submit(); expect(host.textContent).not.toContain('Geometry shows all prior filters enabled'); expect(native.run).toHaveBeenCalledWith('filter.blurGallery.fieldBlur', adjustmentDefaults(action('fieldBlur'), 'RGB'));
});
