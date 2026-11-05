import { expect, it, vi } from 'vitest';
import { PresetPreviewCache, type PresetPreviewRequest } from './presetPreviewCache';
const request = (preset: string, revision = 1): PresetPreviewRequest => ({ kind: 'brush', preset, revision });
function reply(width = 96) {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, 64);
  return { width: 96, height: 64, png: btoa(String.fromCharCode(...bytes)) };
}
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
it('limits native concurrency, shares duplicate requests and cancels hidden queued cards', async () => {
  const pending: ((value: ReturnType<typeof reply>) => void)[] = [];
  const invoke = vi.fn(() => new Promise<ReturnType<typeof reply>>(resolve => pending.push(resolve))), cache = new PresetPreviewCache(invoke), first = vi.fn(), second = vi.fn();
  cache.subscribe(request('A'), first); cache.subscribe(request('A'), second); cache.subscribe(request('B'), vi.fn());
  const cancel = cache.subscribe(request('C'), vi.fn()); cancel(); cache.subscribe(request('D'), vi.fn());
  await flush(); expect(invoke).toHaveBeenCalledTimes(2); pending[0]!(reply()); await flush();
  expect(first).toHaveBeenCalledWith(expect.stringContaining('data:image/png;base64,'), null); expect(second).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(3); expect(invoke.mock.calls.flat().map(value => (value as PresetPreviewRequest).preset)).not.toContain('C');
  pending[1]!(reply()); pending[2]!(reply()); await flush();
});
it('rejects invalid native dimensions, permits retry and isolates library revisions', async () => {
  const invoke = vi.fn().mockResolvedValueOnce(reply(2048)).mockResolvedValue(reply()), cache = new PresetPreviewCache(invoke), listener = vi.fn();
  cache.subscribe(request('A'), listener); await flush(); expect(listener).toHaveBeenLastCalledWith(null, expect.stringContaining('dimensions'));
  cache.subscribe(request('A'), listener); await flush(); expect(invoke).toHaveBeenCalledTimes(2);
  cache.subscribe(request('A'), listener); await flush(); expect(invoke).toHaveBeenCalledTimes(2);
  cache.subscribe(request('A', 2), listener); await flush(); expect(invoke).toHaveBeenCalledTimes(3);
});
it('bounds retained thumbnails and removes stale subscriber callbacks', async () => {
  const invoke = vi.fn().mockResolvedValue(reply()), cache = new PresetPreviewCache(invoke);
  const listener = vi.fn(), cancel = cache.subscribe(request('0'), listener); cancel(); await flush(); expect(listener).not.toHaveBeenCalled();
  for (let index = 1; index < 130; index++) { cache.subscribe(request(String(index)), vi.fn()); await flush(); }
  const count = invoke.mock.calls.length; cache.subscribe(request('129'), vi.fn()); await flush(); expect(invoke).toHaveBeenCalledTimes(count);
  cache.subscribe(request('1'), vi.fn()); await flush(); expect(invoke).toHaveBeenCalledTimes(count + 1);
});
