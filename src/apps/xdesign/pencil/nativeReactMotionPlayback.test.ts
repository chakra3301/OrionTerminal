import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeReactMotionPlayback } from './nativeReactMotionPlayback';
import { designEase, designSpringDuration, type DesignNavigation } from './reactExportRuntime';
import type { NativeReactModel } from './nativeReactProtocol';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const model = (width = 100) => ({ nodes: [], width, height: 100 }) as NativeReactModel;
const navigation = (duration = 300, easing: DesignNavigation['easing'] = 'linear'): DesignNavigation => ({ action: 'navigate', target: 'next', transition: 'slide', duration, easing });

describe('native React source-backed motion playback', () => {
  let callbacks: Map<number, FrameRequestCallback>, nextFrame: number, now: number;
  beforeEach(() => {
    callbacks = new Map(); nextFrame = 0; now = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const tick = (time: number) => { now = time; const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback(time)); };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('keeps only the newest pending scrub frame while a worker render is active', async () => {
    const jobs: Deferred<NativeReactModel | undefined>[] = [], rendered: number[] = [], applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(), paused: true, render: progress => { rendered.push(progress); const job = deferred<NativeReactModel | undefined>(); jobs.push(job); return job.promise; }, apply: (_value, progress) => applied.push(progress) });
    playback.scrub(.2); playback.scrub(.4); playback.scrub(.8);
    expect(rendered).toEqual([0]);
    jobs[0]!.resolve(model()); await flush();
    expect(rendered).toEqual([0, .8]);
    jobs[1]!.resolve(model()); await flush();
    expect(applied).toEqual([.8]);
    playback.dispose(); await expect(playback.finished).resolves.toBe(false);
  });

  it('applies coherent intermediate autoplay models when worker renders lag behind RAF samples', async () => {
    const jobs: Array<{ progress: number; result: Deferred<NativeReactModel | undefined> }> = [], applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(100), render: progress => { const result = deferred<NativeReactModel | undefined>(); jobs.push({ progress, result }); return result.promise; }, apply: (_value, progress) => applied.push(progress) });
    tick(20); jobs[0]!.result.resolve(model()); await flush();
    expect(applied).toEqual([0]); expect(jobs[1]!.progress).toBeCloseTo(.2);
    tick(40); jobs[1]!.result.resolve(model()); await flush();
    expect(applied).toEqual([0, .2]); expect(jobs[2]!.progress).toBeCloseTo(.4);
    tick(100); jobs[2]!.result.resolve(model()); await flush();
    expect(jobs[3]!.progress).toBe(1); jobs[3]!.result.resolve(model()); await flush();
    expect(applied).toEqual([0, .2, .4, 1]);
    await expect(playback.finished).resolves.toBe(true);
  });

  it('remembers release before preparation and finishes only after the exact endpoint model applies', async () => {
    const jobs: Deferred<NativeReactModel | undefined>[] = [], applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(), render: () => { const job = deferred<NativeReactModel | undefined>(); jobs.push(job); return job.promise; }, apply: (_value, progress) => applied.push(progress) });
    const released = playback.settle(1, 0);
    tick(300);
    expect(jobs).toHaveLength(1);
    jobs[0]!.resolve(model()); await flush();
    expect(jobs).toHaveLength(2);
    expect(applied).toEqual([]);
    jobs[1]!.resolve(model()); await flush();
    await expect(released).resolves.toBe(true);
    await expect(playback.finished).resolves.toBe(true);
    expect(applied).toEqual([1]);
    expect(playback.active).toBe(false);
  });

  it('applies seek with authored easing, scrub with raw progress, and supports either ordering', async () => {
    const applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(400, 'ease-in'), paused: true, render: async () => model(), apply: (_value, progress) => applied.push(progress) });
    await flush();
    playback.seek(.5); await flush();
    expect(applied.at(-1)).toBeCloseTo(designEase(.5, 'ease-in', 400));
    playback.scrub(.25); await flush(); expect(applied.at(-1)).toBe(.25);
    playback.seek(.75); await flush(); expect(applied.at(-1)).toBeCloseTo(designEase(.75, 'ease-in', 400));
    playback.dispose(); await expect(playback.finished).resolves.toBe(false);
  });

  it('preserves bounded spring overshoot in rendered native samples', async () => {
    const spring = { type: 'spring' as const, mass: 1, stiffness: 100, damping: 15, initialVelocity: 100 }, applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(300, spring), render: async () => model(), apply: (_value, progress) => applied.push(progress) });
    tick(30); await flush();
    expect(applied.at(-1)).toBeGreaterThan(1);
    playback.dispose();
  });

  it('keeps a confirmed endpoint-zero session alive for owner rollback', async () => {
    const applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(), paused: true, render: async () => model(), apply: (_value, progress) => applied.push(progress) });
    await flush();
    await expect(playback.settle(0)).resolves.toBe(true);
    expect(applied.at(-1)).toBe(0);
    expect(playback.active).toBe(true);
    playback.dispose(); await expect(playback.finished).resolves.toBe(false);
  });

  it('normalizes spring release velocity, pauses scheduling, and resumes toward the exact endpoint', async () => {
    const spring = { type: 'spring' as const, mass: 1, stiffness: 100, damping: 15, initialVelocity: 0 }, releaseSpring = { ...spring, initialVelocity: 2 / .6 }, releaseDuration = designSpringDuration(releaseSpring), applied: number[] = [];
    const playback = createNativeReactMotionPlayback({ link: navigation(300, spring), paused: true, render: async () => model(), apply: (_value, progress) => applied.push(progress) });
    await flush(); playback.scrub(.4); await flush();
    const released = playback.settle(1, 2);
    expect(callbacks.size).toBe(1);
    tick(16); await flush();
    expect(applied.at(-1)).toBeCloseTo(.4 + .6 * designEase(16 / releaseDuration, releaseSpring, releaseDuration));
    playback.pause(); expect(callbacks.size).toBe(0);
    playback.resume();
    tick(now + 10_000); await flush(); await expect(released).resolves.toBe(true);
    expect(applied.at(-1)).toBe(1);
    await expect(playback.finished).resolves.toBe(true);
  });

  it('ignores stale frames after cancellation and fails on a missing current frame', async () => {
    const old = deferred<NativeReactModel | undefined>(), applied = vi.fn(), onError = vi.fn();
    const playback = createNativeReactMotionPlayback({ link: navigation(), paused: true, render: () => old.promise, apply: applied, onError });
    playback.scrub(.5); playback.dispose(); old.resolve(model()); await flush();
    expect(applied).not.toHaveBeenCalled(); await expect(playback.finished).resolves.toBe(false);

    const missing = createNativeReactMotionPlayback({ link: navigation(), paused: true, render: async () => undefined, apply: vi.fn(), onError });
    await flush(); await expect(missing.finished).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('superseded'));

    const failed = deferred<NativeReactModel | undefined>(), rejected = createNativeReactMotionPlayback({ link: navigation(), paused: true, render: () => failed.promise, apply: vi.fn(), onError });
    failed.reject(new Error('worker failed')); await flush();
    await expect(rejected.finished).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith('Error: worker failed');
  });
});
