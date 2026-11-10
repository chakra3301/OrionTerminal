import { afterEach, expect, it, vi } from 'vitest';
import { animatePrototype, animatePrototypeExit, prototypeSnapshot } from './prototypeMotion';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['left', 'right', 'top', 'bottom'] as const)('moves an incoming screen across its full %s dimension and cancels on interruption', direction => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const element = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); element.append(incoming);
  const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) }, animate = vi.fn(() => animation); Object.assign(incoming, { animate });
  const dispose = animatePrototype(element, incoming, outgoing, { action: 'back', transition: 'move-in', duration: 350, direction, easing: [0.25, 0.1, 0.25, 1] });
  expect(animate.mock.calls[0]).toEqual([[{ transform: { left: 'translateX(-100%)', right: 'translateX(100%)', top: 'translateY(-100%)', bottom: 'translateY(100%)' }[direction] }, { transform: 'translate(0,0)' }], { duration: 350, easing: 'cubic-bezier(0.25,0.1,0.25,1)', fill: 'both' }]);
  expect(outgoing.parentElement).toBe(element); dispose(); expect(animation.cancel).toHaveBeenCalledOnce(); expect(outgoing.parentElement).toBeNull();
});
it('dissolves the destination on top of the static source and removes its snapshot after completing', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const element = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); element.append(incoming);
  let finish!: () => void;
  const animation = { cancel: vi.fn(), finished: new Promise<void>(resolve => { finish = resolve; }) }, fade = { cancel: vi.fn() };
  const enter = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation), exit = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => fade); Object.assign(incoming, { animate: enter }); Object.assign(outgoing, { animate: exit });
  const dispose = animatePrototype(element, incoming, outgoing, { action: 'back', transition: 'dissolve', duration: 200, easing: 'linear' });
  expect(enter.mock.calls[0]![0]).toEqual([{ opacity: 0 }, { opacity: 1 }]); expect(exit).not.toHaveBeenCalled();
  finish(); expect(await dispose.finished).toBe(true); expect(outgoing.parentElement).toBeNull(); expect(animation.cancel).toHaveBeenCalledOnce(); expect(fade.cancel).not.toHaveBeenCalled(); dispose();
});
it('honors reduced motion, zero duration and missing browser animation support', () => {
  const element = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'), animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => {}) })); Object.assign(incoming, { animate }); element.append(outgoing);
  vi.stubGlobal('matchMedia', () => ({ matches: true })); animatePrototype(element, incoming, outgoing, { action: 'back', transition: 'slide', duration: 200 })(); expect(animate.mock.calls[0]).toEqual([[{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear', fill: 'both' }]); expect(outgoing.parentElement).toBeNull(); animate.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: false })); animatePrototype(element, incoming, undefined, { action: 'back', transition: 'dissolve', duration: 0 })(); expect(animate).not.toHaveBeenCalled();
  Reflect.deleteProperty(incoming, 'animate'); animatePrototype(element, incoming, undefined, { action: 'back', transition: 'dissolve', duration: 200 })();
});
it('creates an inert visual snapshot without duplicate identities, playback or accumulated older screens', () => {
  const source = document.createElement('div'); source.innerHTML = '<div data-xdesign-snapshot inert aria-hidden="true">previous</div><div inert><input id="field" tabindex="0" value="current"><video poster="data:image/png;base64,AA==" src="data:video/webm;base64,AA=="></video><div data-xdesign-view="">current</div></div>';
  const snapshot = prototypeSnapshot(source); expect(snapshot.hasAttribute('inert')).toBe(true); expect(snapshot.getAttribute('aria-hidden')).toBe('true');
  expect(snapshot.querySelector('video')).toBeNull(); expect(snapshot.querySelector('img')?.src).toContain('data:image/png'); expect(snapshot.querySelector('[id],[tabindex],[data-xdesign-view]')).toBeNull(); expect(snapshot.textContent).not.toContain('previous'); expect(source.querySelector('video')).not.toBeNull();
  expect(snapshot.textContent).toContain('current');
});

it('animates a closing overlay in its own dimensions, fades the background and cleans up on interruption', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div'), container = document.createElement('div'), moving = document.createElement('div'); moving.className = 'xd-prototype-overlay-frame'; container.append(moving); stage.append(container);
  const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) }, fade = { cancel: vi.fn() }, move = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation), background = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => fade); Object.assign(moving, { animate: move }); Object.assign(container, { animate: background });
  const dispose = animatePrototypeExit(container, { action: 'close', transition: 'slide', direction: 'bottom', duration: 200, easing: 'linear' });
  expect(move.mock.calls[0]).toEqual([[{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translateY(100%)', opacity: 0 }], { duration: 200, easing: 'linear', fill: 'both' }]); expect(background.mock.calls[0]?.[0]).toEqual([{ opacity: 1 }, { opacity: 0 }]); dispose(); expect(container.parentElement).toBeNull(); expect(animation.cancel).toHaveBeenCalledOnce(); expect(fade.cancel).toHaveBeenCalledOnce();
});

it('restores outgoing scroll positions after attaching the snapshot and removes live layer identities', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const source = document.createElement('div'); source.innerHTML = '<div data-xdesign-scroll="scroll" data-xdesign-layer="frame"><div data-xdesign-layer="target">Content</div></div>'; const scroll = source.firstElementChild as HTMLElement; scroll.scrollLeft = 15; scroll.scrollTop = 80;
  const snapshot = prototypeSnapshot(source), copied = snapshot.firstElementChild as HTMLElement; expect(snapshot.querySelector('[data-xdesign-scroll],[data-xdesign-layer]')).toBeNull(); expect(copied.scrollTop).toBe(0);
  const target = document.createElement('div'), incoming = document.createElement('div'); target.append(incoming); Object.assign(incoming, { animate: () => ({ cancel() {}, finished: new Promise<void>(() => {}) }) }); const cleanup = animatePrototype(target, incoming, snapshot, { action: 'back', transition: 'slide', duration: 200 }); expect([copied.scrollLeft, copied.scrollTop]).toEqual([15, 80]); cleanup(); expect(snapshot.parentElement).toBeNull(); expect(scroll.scrollTop).toBe(80);
});
it.each(['finish', 'cancel', 'reject'] as const)('settles a sequence motion job on %s and removes live source identities from snapshots', async mode => {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const source = document.createElement('div'); source.innerHTML = '<div data-xdesign-source="native-target" data-xdesign-layer="export-target">Target</div>'; const snapshot = prototypeSnapshot(source); expect(snapshot.querySelector('[data-xdesign-source],[data-xdesign-layer]')).toBeNull();
  const frame = document.createElement('div'), incoming = document.createElement('div'); frame.append(incoming); let finish!: () => void, reject!: (error: Error) => void;
  const finished = new Promise<void>((yes, no) => { finish = yes; reject = no; }), animation = { finished, cancel: vi.fn() }, fade = { cancel: vi.fn() }; Object.assign(incoming, { animate: () => animation }); Object.assign(snapshot, { animate: () => fade });
  const job = animatePrototype(frame, incoming, snapshot, { action: 'back', transition: 'dissolve', duration: 200 });
  if (mode === 'finish') finish(); else if (mode === 'reject') reject(new Error('Animation interrupted')); else job();
  expect(await job.finished).toBe(mode === 'finish'); job(); job(); expect(snapshot.parentElement).toBeNull(); expect(animation.cancel).toHaveBeenCalledOnce(); expect(fade.cancel).not.toHaveBeenCalled();
});
it.each(['screen', 'overlay exit'] as const)('waits for the %s background as well as the main animation', async mode => {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const frame = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); frame.append(incoming);
  let finish!: () => void, fadeFinish!: () => void; const animation = { cancel: vi.fn(), finished: new Promise<void>(resolve => { finish = resolve; }) }, fade = { cancel: vi.fn(), finished: new Promise<void>(resolve => { fadeFinish = resolve; }) };
  let job;
  if (mode === 'screen') { Object.assign(incoming, { animate: () => animation }); Object.assign(outgoing, { animate: () => fade }); job = animatePrototype(frame, incoming, outgoing, { action: 'back', transition: 'push', duration: 200 }); }
  else { incoming.className = 'xd-prototype-overlay-frame'; Object.assign(incoming, { animate: () => animation }); Object.assign(frame, { animate: () => fade }); document.body.append(frame); job = animatePrototypeExit(frame, { action: 'close', transition: 'slide', duration: 200 }); }
  let settled = false; void job.finished.then(() => { settled = true; }); finish(); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false); expect(animation.cancel).not.toHaveBeenCalled();
  fadeFinish(); expect(await job.finished).toBe(true); expect(animation.cancel).toHaveBeenCalledOnce(); expect(fade.cancel).toHaveBeenCalledOnce(); expect(mode === 'screen' ? outgoing.parentElement : frame.parentElement).toBeNull();
});

it('seeks every screen track, holds at the end and completes without replaying on resume', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const surface = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); surface.append(incoming);
  const animations = [incoming, outgoing].map(node => { let finish!: () => void; const animation = { currentTime: 0, pause: vi.fn(), play: vi.fn(), cancel: vi.fn(), finished: new Promise<void>(resolve => { finish = resolve; }) }; Object.assign(node, { animate: () => animation }); return { animation, finish }; });
  const job = animatePrototype(surface, incoming, outgoing, { action: 'back', transition: 'push', duration: 400 });
  let settled = false; void job.finished.then(() => { settled = true; }); job.seek(0.375); expect(animations.map(({ animation }) => animation.currentTime)).toEqual([150, 150]); expect(animations.every(({ animation }) => animation.pause.mock.calls.length === 1)).toBe(true);
  job.seek(-1); expect(animations[0]!.animation.currentTime).toBe(0); expect(() => job.seek(NaN)).toThrow('finite'); expect(job.active).toBe(true);
  job.seek(2); animations.forEach(({ finish }) => finish()); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false); expect(outgoing.parentElement).toBe(surface);
  job.resume(); expect(await job.finished).toBe(true); expect(animations.every(({ animation }) => !animation.play.mock.calls.length && animation.cancel.mock.calls.length === 1)).toBe(true); expect(job.active).toBe(false); expect(outgoing.parentElement).toBeNull(); job.pause(); job.resume(); job.seek(0.5);
});
it('observes fresh browser completion promises and retains paused times when resuming', async () => {
  const surface = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); surface.append(incoming);
  let oldFinish!: () => void, newFinish!: () => void;
  const animation = { currentTime: 0, cancel: vi.fn(), pause: vi.fn(), finished: new Promise<void>(resolve => { oldFinish = resolve; }), play: vi.fn(() => { animation.currentTime = 0; animation.finished = new Promise<void>(resolve => { newFinish = resolve; }); }) }; Object.assign(incoming, { animate: () => animation });
  const job = animatePrototype(surface, incoming, outgoing, { action: 'back', transition: 'dissolve', duration: 200 }); job.seek(0.4); oldFinish(); await Promise.resolve(); expect(job.active).toBe(true); job.resume(); expect(animation.currentTime).toBe(80); await Promise.resolve(); expect(job.active).toBe(true); newFinish(); expect(await job.finished).toBe(true);
});
it.each(['pause', 'resume', 'seek'] as const)('cleans every track and source if browser %s control fails', async control => {
  const surface = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); surface.append(incoming);
  const animation = { currentTime: 0, pause() { if (control === 'pause') throw new Error('pause failed'); }, play() { if (control === 'resume') throw new Error('resume failed'); }, cancel: vi.fn(), finished: new Promise<void>(() => {}) }; Object.assign(incoming, { animate: () => animation });
  const job = animatePrototype(surface, incoming, outgoing, { action: 'back', transition: 'dissolve', duration: 200 });
  if (control !== 'pause') job.pause(); if (control === 'seek') Object.defineProperty(animation, 'currentTime', { set() { throw new Error('seek failed'); } });
  expect(() => control === 'resume' ? job.resume() : control === 'seek' ? job.seek(0.5) : job.pause()).toThrow('failed'); expect(await job.finished).toBe(false); expect(animation.cancel).toHaveBeenCalledOnce(); expect(outgoing.parentElement).toBeNull();
});
