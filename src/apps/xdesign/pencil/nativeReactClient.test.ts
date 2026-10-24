import { afterEach, expect, it, vi } from 'vitest';
import { NativeReactWorkerClient, type NativeReactWorker } from './nativeReactClient';
import type { NativeReactInit, NativeReactOutput } from './nativeReactProtocol';

const payload = (): NativeReactInit => ({ wasm: new Uint8Array(8), graph: '{}', ids: ['root'], fonts: {} });
function fixture() {
  const worker: NativeReactWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() }, release = vi.fn();
  const client = new NativeReactWorkerClient(worker, payload(), release, 100);
  const send = (data: NativeReactOutput) => worker.onmessage?.({ data } as MessageEvent<NativeReactOutput>);
  return { worker, client, release, send };
}
afterEach(() => vi.useRealTimers());

it('bounds pending renders, discards stale models and snapshots mutable requests', async () => {
  const f = fixture(), request = { rootSizes: { root: { width: 100 } } };
  const first = f.client.render(request); request.rootSizes.root.width = 900;
  f.send({ type: 'ready' });
  expect(f.worker.postMessage).toHaveBeenLastCalledWith({ type: 'render', id: 1, request: { rootSizes: { root: { width: 100 } } } });
  const second = f.client.render({ rootSizes: { root: { width: 200 } } }), third = f.client.render({ rootSizes: { root: { width: 300 } } });
  await expect(second).resolves.toBeUndefined();
  f.send({ type: 'model', id: 1, model: { nodes: [], width: 100, height: 80 } });
  await expect(first).resolves.toBeUndefined();
  expect(f.worker.postMessage).toHaveBeenLastCalledWith({ type: 'render', id: 3, request: { rootSizes: { root: { width: 300 } } } });
  f.send({ type: 'model', id: 2, model: { nodes: [], width: 200, height: 80 } });
  f.send({ type: 'model', id: 3, model: { nodes: [], width: 300, height: 80 } });
  await expect(third).resolves.toMatchObject({ width: 300 }); f.client.dispose();
  expect(f.worker.terminate).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
});

it('allows correction after a render error and rejects outstanding work on shutdown', async () => {
  const f = fixture(); f.send({ type: 'ready' });
  const invalid = f.client.render(); f.send({ type: 'error', id: 1, message: 'Missing font' });
  await expect(invalid).rejects.toThrow('Missing font');
  const corrected = f.client.render(), pending = f.client.render();
  const failed = expect(corrected).rejects.toThrow('closed'), queued = expect(pending).rejects.toThrow('closed');
  f.client.dispose(); f.client.dispose(); await failed; await queued;
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});

it('terminates and releases assets on boot failure, transport failure and timeout', async () => {
  vi.useFakeTimers();
  for (const type of ['boot', 'transport', 'timeout']) {
    const f = fixture(), next = f.client.render(), rejected = expect(next).rejects.toThrow();
    if (type === 'boot') f.send({ type: 'error', message: 'Invalid WASM' });
    if (type === 'transport') f.worker.onmessageerror?.({} as MessageEvent);
    if (type === 'timeout') await vi.advanceTimersByTimeAsync(101);
    await rejected; expect(f.worker.terminate).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
  }
});

it('captures motion preparation, coalesces frames and cancels a session without publishing its late model', async () => {
  const f = fixture(); f.send({ type: 'ready' });
  const request = { sessionId: 1, from: { rootId: 'root' }, to: { rootId: 'next' }, link: { action: 'navigate' as const, target: 'next', transition: 'smart' as const, duration: 300 } };
  const prepared = f.client.prepareMotion(request); request.to.rootId = 'changed';
  expect(f.worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'motion-prepare', motion: expect.objectContaining({ to: { rootId: 'next' } }) }));
  f.send({ type: 'motion-ready', id: 1, motion: { sessionId: 1, matched: 2, from: { width: 100, height: 80 }, to: { width: 100, height: 80 }, movements: {}, initialModel: { nodes: [], width: 100, height: 80 } } });
  await expect(prepared).resolves.toMatchObject({ sessionId: 1 });
  const active = f.client.motionFrame(1, .25), replaced = f.client.motionFrame(1, .5), latest = f.client.motionFrame(1, .75);
  await expect(replaced).resolves.toBeUndefined();
  f.client.cancelMotion(1); await expect(active).resolves.toBeUndefined(); await expect(latest).resolves.toBeUndefined();
  expect(f.worker.postMessage).toHaveBeenLastCalledWith({ type: 'motion-cancel', sessionId: 1 });
  const next = f.client.render();
  f.send({ type: 'model', id: 2, model: { nodes: [], width: 200, height: 80 } });
  expect(f.worker.postMessage).toHaveBeenLastCalledWith({ type: 'render', id: 5, request: {} });
  f.send({ type: 'model', id: 5, model: { nodes: [], width: 100, height: 80 } });
  await expect(next).resolves.toMatchObject({ width: 100 }); f.client.dispose();
});

it('rejects the wrong motion response kind and keeps the worker usable for a corrected request', async () => {
  const f = fixture(); f.send({ type: 'ready' });
  const prepared = f.client.prepareMotion({ sessionId: 1, from: { rootId: 'root' }, to: { rootId: 'root' }, link: { action: 'back', transition: 'smart', duration: 300 } });
  f.send({ type: 'model', id: 1, model: { nodes: [], width: 100, height: 80 } });
  await expect(prepared).rejects.toThrow('unexpected response');
  const corrected = f.client.render(); f.send({ type: 'model', id: 2, model: { nodes: [], width: 120, height: 80 } });
  await expect(corrected).resolves.toMatchObject({ width: 120 }); f.client.dispose();
});
