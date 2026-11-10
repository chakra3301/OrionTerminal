import { afterEach, expect, it, vi } from 'vitest';
import { animatePrototype } from './prototypeMotion';
import { designSpringDuration, type DesignNavigation } from './reactExportRuntime';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function scene(link: DesignNavigation) {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const surface = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); surface.append(incoming); document.body.append(surface); incoming.style.opacity = '0.4';
  const animations: { frames: Keyframe[]; options: KeyframeAnimationOptions; currentTime: number; finished: Promise<void>; finish: () => void; pause: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; effect: { setKeyframes: ReturnType<typeof vi.fn>; updateTiming: ReturnType<typeof vi.fn> } }[] = [];
  Object.assign(incoming, { animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => { let finish!: () => void; const animation = { frames, options, currentTime: 0, finished: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish(), pause: vi.fn(), cancel: vi.fn(), effect: { setKeyframes: vi.fn(), updateTiming: vi.fn() } }; animations.push(animation); return animation; } });
  return { job: animatePrototype(surface, incoming, outgoing, link), animations, outgoing, incoming, surface };
}
it.each(['cubic', 'spring'])('scrubs geometry progress linearly rather than applying authored %s easing twice', mode => {
  const link: DesignNavigation = { action: 'back', transition: 'dissolve', duration: 300, easing: mode === 'cubic' ? [0.25, 0.1, 0.25, 1] : { type: 'spring', mass: 1, stiffness: 100, damping: 15 } }, { job, animations } = scene(link);
  job.scrub(0.4); const duration = Number(animations[0]!.options.duration); expect(animations[0]!.currentTime).toBe(duration * 0.4); expect(animations[0]!.effect.updateTiming).toHaveBeenCalledWith({ duration, easing: 'linear' }); expect(animations[0]!.effect.setKeyframes).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 0.4 }]); job.scrub(0.7); expect(animations[0]!.effect.setKeyframes).toHaveBeenCalledOnce(); job();
});
it('releases from the measured paint to the target with remaining authored duration and resolves the full job', async () => {
  const { job, animations, outgoing } = scene({ action: 'back', transition: 'dissolve', duration: 300, easing: 'ease-in-out' }); job.scrub(0.4); const release = job.settle(1); expect(animations).toHaveLength(2); expect(animations[1]!.frames).toEqual([{ opacity: '0.4' }, { opacity: 0.4 }]); expect(animations[1]!.options).toMatchObject({ duration: 180, easing: 'ease-in-out' }); animations[1]!.finish(); expect(await release).toBe(true); expect(await job.finished).toBe(true); expect(outgoing.parentElement).toBeNull(); expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
});
it('holds the returned source until its host restores the route, rather than exposing the destination during rollback', async () => {
  const { job, animations, outgoing, surface } = scene({ action: 'back', transition: 'dissolve', duration: 300, easing: 'linear' }); job.scrub(0.4); const release = job.settle(0); expect(animations[1]!.frames.at(-1)!.opacity).toBe(0); expect(animations[1]!.options.duration).toBe(120); animations[1]!.finish(); expect(await release).toBe(true); expect(job.active).toBe(true); expect(outgoing.parentElement).toBe(surface); let finished = false; void job.finished.then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false); job(); expect(await job.finished).toBe(false); expect(outgoing.parentElement).toBeNull();
});
it('fails a missing browser keyframe control without leaving source resources or pending jobs', async () => {
  const { job, animations, outgoing } = scene({ action: 'back', transition: 'dissolve', duration: 300 }); Reflect.deleteProperty(animations[0]!, 'effect'); expect(() => job.scrub(0.5)).toThrow('cannot scrub'); expect(await job.finished).toBe(false); expect(outgoing.parentElement).toBeNull();
});

it('hands normalized pointer velocity to an authored spring release without losing its starting paint', () => {
  const spring = { type: 'spring' as const, mass: 1, stiffness: 100, damping: 15 }, { job, animations, incoming } = scene({ action: 'back', transition: 'dissolve', duration: 300, easing: spring }); job.scrub(0.6); incoming.style.opacity = '0.24'; job.settle(1, 2); const released = animations[1]!, duration = designSpringDuration({ ...spring, initialVelocity: 5 }); expect(released.options.duration).toBe(duration); expect(released.frames[0]!.opacity).toBe('0.24'); const seconds = duration / (released.frames.length - 1) / 1000; expect((Number(released.frames[1]!.opacity) - 0.24) / seconds).toBeCloseTo(0.8, 1); job();
});
