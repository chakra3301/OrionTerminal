import { afterEach, expect, it, vi } from 'vitest';
import { animatePrototype, animatePrototypeExit } from './prototypeMotion';
import { designSpringDuration, type DesignNavigation, type DesignSpring } from './reactExportRuntime';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div');
  stage.style.width = '320px'; stage.style.height = '240px'; incoming.style.width = '100px'; incoming.style.zIndex = '1'; outgoing.style.width = '200px'; stage.append(incoming); document.body.append(stage);
  const enter = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn(), finished: new Promise<void>(() => {}) })), exit = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn(), finished: new Promise<void>(() => {}) }));
  Object.assign(incoming, { animate: enter }); Object.assign(outgoing, { animate: exit });
  return { stage, incoming, outgoing, enter, exit };
}
const transitions = ['move-in', 'move-out', 'push', 'slide', 'slide-out'] as const;
const directions = ['left', 'right', 'top', 'bottom'] as const;
it.each(transitions.flatMap(transition => directions.map(direction => ({ transition, direction }))))('plays the spatial contract of $transition/$direction with coherent stage distances', ({ transition, direction }) => {
  const { stage, incoming, outgoing, enter, exit } = setup(), job = animatePrototype(stage, incoming, outgoing, { action: 'back', transition, direction, duration: 400, easing: 'linear' });
  const vertical = ['top', 'bottom'].includes(direction), distance = (vertical ? 240 : 320) * (['top', 'left'].includes(direction) ? -1 : 1), translation = (value: number) => value ? `translate${vertical ? 'Y' : 'X'}(${value}px)` : 'translate(0,0)';
  const out = transition === 'move-out' || transition === 'slide-out';
  expect(stage.firstElementChild).toBe(out ? incoming : outgoing);
  expect(outgoing.style.zIndex).toBe(out ? '2' : '0');
  if (transition === 'move-out') expect(enter).not.toHaveBeenCalled();
  else expect(enter.mock.calls[0]![0]).toEqual([{ transform: translation(distance * (out ? -0.25 : 1)), ...(transition === 'slide-out' ? { opacity: 0 } : {}) }, { transform: translation(0), ...(transition === 'slide-out' ? { opacity: 1 } : {}) }]);
  if (transition === 'move-in') expect(exit).not.toHaveBeenCalled();
  else expect(exit.mock.calls[0]![0]).toEqual([{ transform: translation(0), ...(transition === 'slide' ? { opacity: 1 } : {}) }, { transform: translation(distance * (transition === 'slide' ? -0.25 : transition === 'push' ? -1 : 1)), ...(transition === 'slide' ? { opacity: 0 } : {}) }]);
  for (const call of [...enter.mock.calls, ...exit.mock.calls]) expect(call[1]).toEqual({ duration: 400, easing: 'linear', fill: 'both' });
  job(); expect(outgoing.parentElement).toBeNull(); expect(incoming.parentElement).toBe(stage);
});
it('retains existing presentation transforms and alpha instead of overwriting them', () => {
  const { stage, incoming, outgoing, enter, exit } = setup(); incoming.style.transform = 'scale(0.5) rotate(10deg)'; outgoing.style.transform = 'scale(0.5)'; incoming.style.opacity = '0.6'; outgoing.style.opacity = '0.4';
  const job = animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'slide-out', direction: 'left', duration: 350 });
  expect(enter.mock.calls[0]![0]).toEqual([{ transform: 'translateX(80px) scale(0.5) rotate(10deg)', opacity: 0 }, { transform: 'translate(0,0) scale(0.5) rotate(10deg)', opacity: 0.6 }]);
  expect(exit.mock.calls[0]![0]).toEqual([{ transform: 'translate(0,0) scale(0.5)' }, { transform: 'translateX(-320px) scale(0.5)' }]); job();
  const dissolve = animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'dissolve', duration: 200 });
  expect(enter.mock.calls[1]![0]).toEqual([{ opacity: 0 }, { opacity: 0.6 }]); dissolve();
  incoming.style.opacity = '0'; animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'dissolve', duration: 200 })(); expect(enter.mock.calls[2]![0]).toEqual([{ opacity: 0 }, { opacity: 0 }]);
});
it('samples the actual spring, overshoots directionally, settles exactly and shares its clock between tracks', () => {
  const { stage, incoming, outgoing, enter, exit } = setup(), easing: DesignSpring = { type: 'spring', mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 }, duration = designSpringDuration(easing);
  const job = animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'push', direction: 'right', duration: 0, easing }), frames = enter.mock.calls[0]![0], outgoingFrames = exit.mock.calls[0]![0];
  expect(frames.length).toBe(Math.ceil(duration * 0.24) + 1); expect(frames.length).toBeLessThanOrEqual(2401); expect(outgoingFrames).toHaveLength(frames.length);
  expect(enter.mock.calls[0]![1]).toEqual({ duration, easing: 'linear', fill: 'both' });
  expect(frames[0]).toEqual({ transform: 'translateX(320px)', offset: 0 }); expect(frames.at(-1)).toEqual({ transform: 'translate(0,0)', offset: 1 });
  expect(frames.some(frame => String(frame.transform).startsWith('translateX(-'))).toBe(true);
  expect(outgoingFrames.some(frame => Number.parseFloat(String(frame.transform).slice(11)) < -320)).toBe(true); job();
});
it.each(['push', 'move-out', 'slide-out'] as const)('reduces $0 to a short single fade while retaining explicit Instant', transition => {
  const { stage, incoming, outgoing, enter, exit } = setup(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  animatePrototype(stage, incoming, outgoing, { action: 'back', transition, duration: 900, easing: { type: 'spring', mass: 1, stiffness: 100, damping: 10 } })();
  expect(enter.mock.calls[0]).toEqual([[{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear', fill: 'both' }]); expect(exit).not.toHaveBeenCalled();
  animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'instant', duration: 900 })(); expect(enter).toHaveBeenCalledOnce();
});
it('fades the closing overlay once and cleans up partial animation failures', async () => {
  const { stage, incoming, outgoing } = setup(); incoming.className = 'xd-prototype-overlay-frame'; let finish!: () => void;
  const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(resolve => { finish = resolve; }) })); Object.assign(stage, { animate });
  const closing = animatePrototypeExit(stage, { action: 'close', transition: 'dissolve', duration: 200 }); expect(animate).toHaveBeenCalledOnce(); expect((incoming.animate as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); finish(); expect(await closing.finished).toBe(true); expect(stage.parentElement).toBeNull();
  const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) }; Object.assign(incoming, { animate: () => animation }); Object.assign(outgoing, { animate: () => { throw new Error('WAAPI setup failed'); } }); stage.append(incoming);
  expect(() => animatePrototype(stage, incoming, outgoing, { action: 'back', transition: 'push', duration: 200 })).toThrow('WAAPI setup failed'); expect(animation.cancel).toHaveBeenCalledOnce(); expect(outgoing.parentElement).toBeNull();
});
it('refuses unbounded springs before mounting an outgoing snapshot', () => {
  const { stage, incoming, outgoing, enter } = setup(); const navigation: DesignNavigation = { action: 'back', transition: 'push', duration: 200, easing: { type: 'spring', mass: 1, stiffness: 100, damping: 0.01 } };
  expect(() => animatePrototype(stage, incoming, outgoing, navigation)).toThrow('ten seconds'); expect(outgoing.parentElement).toBeNull(); expect(enter).not.toHaveBeenCalled();
});
