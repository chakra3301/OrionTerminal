import { afterEach, expect, it, vi } from 'vitest';
import { animatePrototype, prototypeSnapshot } from './prototypeMotion';
import { designEase, type DesignMotion, type DesignNavigation } from './reactExportRuntime';
import type { NativePaintContext } from './prototypeNativePaint';
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });
const descriptor: DesignMotion = { version: 1, root: true, type: 'RECTANGLE', shape: 'box', shadow: false, width: 100, height: 100, local: [1, 0, 0, 1, 0, 0], radii: [0, 0, 0, 0], paints: [] };
function scene(easing: DesignNavigation['easing'] = 'linear', fail = false, shadow = false) {
  const surface = document.createElement('div'), incoming = document.createElement('div'), source = document.createElement('div'), from = document.createElement('div'), to = document.createElement('div');
  for (const element of [from, to]) { element.setAttribute('data-xdesign-motion', JSON.stringify({ ...descriptor, shadow, name: 'Box' })); Object.assign(element.style, { width: '100px', height: '100px' }); } source.append(from); incoming.append(to); surface.append(incoming); document.body.append(surface); const snapshot = prototypeSnapshot(source), original = to.innerHTML;
  const callbacks = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++sequence, callback); return sequence; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); }); vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const animations: { frames: Keyframe[]; options: KeyframeAnimationOptions; currentTime: number; finish: () => void; cancel: ReturnType<typeof vi.fn>; effect: { setKeyframes: ReturnType<typeof vi.fn>; updateTiming: ReturnType<typeof vi.fn> } }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (frames: Keyframe[], options: KeyframeAnimationOptions) { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), animation = { frames, options, currentTime: 0, finish, finished, cancel: vi.fn(), pause: vi.fn(), play: vi.fn(), effect: { setKeyframes: vi.fn(), updateTiming: vi.fn() } }; animations.push(animation); return animation; } });
  const values: number[] = [], dispose = vi.fn(), context = { plan: () => ({ attach: (paint: HTMLElement) => ({ track: { element: paint, frame: () => ({}), apply: (p: number) => { if (fail && p > .8) throw new Error('paint failed'); values.push(p); paint.dataset.position = String(p); } }, dispose }) }) } as unknown as NativePaintContext;
  const motion = animatePrototype(surface, incoming, snapshot, { action: 'back', transition: 'smart', duration: 200, easing }, context);
  const tick = (time: number) => { animations.forEach(animation => { animation.currentTime = time; }); const pending = [...callbacks]; callbacks.clear(); pending.forEach(([, callback]) => callback(time)); };
  return { motion, values, callbacks, animations, tick, dispose, snapshot, to, original };
}
it.each(['linear', 'ease-in-out', 'spring'] as const)('shares %s timeline progress across native paint, pause/seek/resume and linear scrub', mode => {
  const easing = mode === 'spring' ? { type: 'spring' as const, mass: 1, stiffness: 100, damping: 15 } : mode, f = scene(easing), duration = Number(f.animations[0]!.options.duration);
  expect(f.animations[0]!.frames).toEqual([{}, {}]); f.tick(duration * .25); expect(f.values.at(-1)).toBeCloseTo(designEase(.25, easing, duration));
  f.motion.pause(); expect(f.callbacks.size).toBe(0); f.motion.seek(.5); expect(f.values.at(-1)).toBeCloseTo(designEase(.5, easing, duration)); f.motion.resume(); expect(f.callbacks.size).toBe(1);
  f.motion.scrub(.4); expect(f.values.at(-1)).toBe(.4); expect(f.callbacks.size).toBe(0); f.motion(); expect(f.dispose).toHaveBeenCalledOnce(); expect(f.to.innerHTML).toBe(f.original); expect(f.snapshot.parentElement).toBeNull();
});
it('releases with spring velocity, returns to the source endpoint and supports another linear scrub without stale release timing', async () => {
  const f = scene({ type: 'spring', mass: 1, stiffness: 100, damping: 15 }); f.motion.scrub(.4); const release = f.motion.settle(0, -.5), duration = Number(f.animations.at(-1)!.options.duration); expect(f.values.at(-1)).toBe(.4);
  f.tick(duration / 4); const expected = .4 - .4 * designEase(.25, { type: 'spring', mass: 1, stiffness: 100, damping: 15, initialVelocity: 1.25 }, duration); expect(f.values.at(-1)).toBeCloseTo(expected);
  f.animations.at(-1)!.finish(); expect(await release).toBe(true); expect(f.values.at(-1)).toBe(0); expect(f.motion.active).toBe(true); expect(f.callbacks.size).toBe(0);
  f.motion.scrub(.6); expect(f.values.at(-1)).toBe(.6); expect(f.animations.at(-1)!.effect.updateTiming).toHaveBeenCalledWith({ duration: f.animations[0]!.options.duration, easing: 'linear' }); f.motion(); expect(await f.motion.finished).toBe(false); expect(f.dispose).toHaveBeenCalledOnce();
});
it('cancels animation clocks and paint resources if an asynchronous native frame fails', async () => {
  const f = scene('linear', true); f.tick(190); expect(await f.motion.finished).toBe(false); expect(f.callbacks.size).toBe(0); expect(f.animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true); expect(f.dispose).toHaveBeenCalledOnce(); expect(f.to.innerHTML).toBe(f.original); expect(f.snapshot.parentElement).toBeNull();
});
it('permits isolated numeric shadows when a native paint plan exists', () => {
  const f = scene('linear', false, true); expect(f.values).toEqual([0]); f.motion.seek(.5); expect(f.values.at(-1)).toBe(.5); f.motion(); expect(f.dispose).toHaveBeenCalledOnce();
});
it('copies native canvas pixels into an inert interrupted snapshot before disposal', () => {
  const source = document.createElement('div'), layer = document.createElement('div'), paint = document.createElement('div'), canvas = document.createElement('canvas'); layer.setAttribute('data-xdesign-motion', JSON.stringify({ ...descriptor, name: 'Box' })); paint.setAttribute('data-xdesign-motion-paint', ''); paint.setAttribute('data-xdesign-native-paint', '{"version":1}'); canvas.setAttribute('data-xdesign-native-raster', ''); Object.assign(canvas, { toDataURL: vi.fn(() => 'data:image/png;base64,AA==') }); paint.append(canvas); layer.append(paint); source.append(layer); document.body.append(source);
  const snapshot = prototypeSnapshot(source, true); expect(canvas.toDataURL).toHaveBeenCalledWith('image/png'); expect(source.querySelector('canvas')).toBe(canvas); expect(snapshot.querySelector('canvas')).toBeNull(); expect(snapshot.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA=='); expect(snapshot.querySelector('[data-xdesign-native-paint]')?.getAttribute('data-xdesign-native-paint')).toBe('{"version":1}'); expect(snapshot.hasAttribute('inert')).toBe(true);
});
