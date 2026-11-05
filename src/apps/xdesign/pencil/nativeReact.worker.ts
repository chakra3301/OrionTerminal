import CanvasKitInit from 'canvaskit-wasm';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { fontManager } from '@open-pencil/core/text';
import { deserializeGraph } from './graphDocument';
import { installNativeReactFonts, type NativeReactFontSnapshot } from './nativeReactFonts';
import { renderNativeReactModel } from './nativeReactRenderer';
import type { NativeReactInit, NativeReactInput, NativeReactMotionEndpoint, NativeReactOutput, NativeReactRequest } from './nativeReactProtocol';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { designSpringDuration, isDesignSpring } from './reactExportRuntime';

const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<NativeReactInput>) => void) | null; postMessage(message: NativeReactOutput): void };
let kit: CanvasKit | undefined, graph: SceneGraph | undefined, ids: string[] = [];
let initialized = false, failed = false, pending = Promise.resolve();
let motion: Awaited<ReturnType<typeof prepareNativeReactMotion>> | undefined, motionSession = 0, cancelledMotion = 0;
const report = (error: unknown, id?: number) => worker.postMessage({ type: 'error', id, message: String(error instanceof Error ? error.message : error).slice(0, 2000) });

async function initialize(payload: NativeReactInit) {
  if (initialized || failed) throw new Error('This native renderer has already been initialized.');
  initialized = true;
  if (!payload || !(payload.wasm instanceof Uint8Array) || payload.wasm.byteLength > 16 * 1024 * 1024 || payload.wasm.byteLength < 8 || !Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 128) throw new Error('Invalid native renderer assets or selection.');
  const source = deserializeGraph(payload.graph, true);
  if (payload.ids.some(id => typeof id !== 'string' || !source.getNode(id))) throw new Error('The native renderer selection is missing from its source.');
  const wasmUrl = URL.createObjectURL(new Blob([payload.wasm.slice().buffer], { type: 'application/wasm' }));
  const readBlob = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    if (String(input) !== wasmUrl) return Promise.reject(new Error('Native React assets must be embedded; network requests are disabled.'));
    return readBlob(input, options);
  };
  try { kit = await CanvasKitInit({ locateFile: () => wasmUrl }); }
  finally { URL.revokeObjectURL(wasmUrl); }
  fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false });
  installNativeReactFonts(kit, payload.fonts as NativeReactFontSnapshot);
  graph = source; ids = [...payload.ids];
  worker.postMessage({ type: 'ready' });
}

worker.onmessage = event => {
  const input = event.data;
  if (input?.type === 'motion-cancel') {
    if (Number.isSafeInteger(input.sessionId) && input.sessionId > 0) { cancelledMotion = Math.max(cancelledMotion, input.sessionId); if (motionSession <= cancelledMotion) motion = undefined; }
    return;
  }
  pending = pending.then(async () => {
    if (!input || !['init', 'render', 'motion-prepare', 'motion-frame'].includes(input.type)) throw new Error('Invalid native renderer message.');
    if (input.type === 'init') { await initialize(input.payload); return; }
    if (!Number.isSafeInteger(input.id) || input.id < 1 || !kit || !graph || failed) throw new Error('The native renderer is unavailable.');
    if (input.type === 'motion-frame') {
      if (!motion || input.sessionId !== motionSession || input.sessionId <= cancelledMotion) throw new Error('This native motion session was cancelled or replaced.');
      if (!Number.isFinite(input.progress) || Math.abs(input.progress) > 100) throw new Error('Native motion progress must be finite and within -100 to 100.');
      const plan = motion, model = await plan.frame(input.progress);
      if (motion !== plan || input.sessionId <= cancelledMotion) throw new Error('This native motion frame was cancelled.');
      worker.postMessage({ type: 'model', id: input.id, model }); return;
    }
    const validate = (request: NativeReactRequest) => {
      if (request?.rootId !== undefined && !ids.includes(request.rootId)) throw new Error('This screen was not included in the native export.');
      if (request?.controlScope !== undefined && (typeof request.controlScope !== 'string' || !request.controlScope.length || request.controlScope.length > 128)) throw new Error('Invalid native screen occurrence.');
    };
    if (input.type === 'motion-prepare') {
      const request = input.motion;
      if (!request || !Number.isSafeInteger(request.sessionId) || request.sessionId < 1 || !request.link || !['smart', 'dissolve', 'slide', 'slide-out', 'move-in', 'move-out', 'push', 'instant'].includes(request.link.transition) || !Number.isFinite(request.link.duration) || request.link.duration < 0 || request.link.duration > 10000) throw new Error('Invalid native motion session or transition.');
      if (isDesignSpring(request.link.easing)) designSpringDuration(request.link.easing);
      const endpoint = (state: NativeReactMotionEndpoint) => {
        if (!state || typeof state.rootId !== 'string') throw new Error('A native motion endpoint needs its included base screen.');
        validate(state);
        if (state.overlays !== undefined && (!Array.isArray(state.overlays) || state.overlays.length > 8)) throw new Error('Native motion supports at most eight overlays.');
        for (const overlay of state.overlays ?? []) { validate(overlay); if (!overlay.controlScope || !overlay.origin || !overlay.offset || ![overlay.origin.x, overlay.origin.y, overlay.offset.x, overlay.offset.y].every(Number.isFinite)) throw new Error('Invalid native motion overlay occurrence.'); }
        if (state.scrollPositions && (Object.keys(state.scrollPositions).length > 20_000 || Object.values(state.scrollPositions).some(point => !point || ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)))) throw new Error('Invalid native motion scroll positions.');
      };
      endpoint(request.from); endpoint(request.to);
      motion = undefined; motionSession = request.sessionId;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (request.sessionId <= cancelledMotion) throw new Error('This native motion preparation was cancelled.');
      const prepared = await prepareNativeReactMotion(kit, graph, request);
      if (request.sessionId <= cancelledMotion || motionSession !== request.sessionId) throw new Error('This native motion preparation was cancelled.');
      motion = prepared; worker.postMessage({ type: 'motion-ready', id: input.id, motion: prepared.motion }); return;
    }
    validate(input.request);
    const model = await renderNativeReactModel(kit, graph, input.request?.rootId ? [input.request.rootId] : ids, input.request);
    worker.postMessage({ type: 'model', id: input.id, model });
  }).catch(error => { if (input?.type === 'init') failed = true; report(error, input && 'id' in input ? input.id : undefined); });
};
