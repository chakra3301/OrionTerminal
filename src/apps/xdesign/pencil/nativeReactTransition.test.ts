import { afterEach, expect, it, vi } from 'vitest';
import { animateNativeReactExit, animateNativeReactView, snapshotNativeReactView } from './nativeReactTransition';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function animated(element: HTMLElement) {
  let resolve!: () => void, reject!: () => void;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('cancelled')); });
  const animation = { finished, cancel: vi.fn(reject) };
  const animate = vi.fn((_frames: Keyframe[] | PropertyIndexedKeyframes, _options?: KeyframeAnimationOptions) => animation as unknown as Animation);
  Object.defineProperty(element, 'animate', { configurable: true, value: animate });
  return { animate, animation, resolve };
}

it('captures inert occurrence snapshots with scroll offsets and bounded current video pixels', () => {
  const source = document.createElement('div'); source.innerHTML = '<div id="scroll" data-xdesign-scroll="root" data-xdesign-layer="root" tabindex="0"><video style="width:20px" poster="data:image/png;base64,AA=="></video></div>';
  source.querySelector<HTMLElement>('div')!.scrollTop = 42;
  const video = source.querySelector('video')!;
  Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 4, configurable: true }, videoHeight: { value: 3, configurable: true } });
  const draw = vi.fn(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
  const copy = snapshotNativeReactView(source);
  expect(copy.hasAttribute('inert')).toBe(true); expect(copy.getAttribute('aria-hidden')).toBe('true'); expect(copy.style.pointerEvents).toBe('none');
  expect(copy.querySelector('[data-native-scroll-snapshot]')?.getAttribute('data-native-scroll-snapshot')).toBe('{"x":0,"y":42}');
  expect(copy.querySelector('[id],[tabindex],[data-xdesign-scroll],[data-xdesign-layer]')).toBeNull();
  expect(copy.querySelector('video')).toBeNull(); expect(copy.querySelector('canvas')?.width).toBe(4); expect(draw).toHaveBeenCalledWith(video, 0, 0);
  expect(source.querySelector('video')).toBe(video); expect(source.querySelector('#scroll')).not.toBeNull();
  Object.defineProperties(video, { videoWidth: { value: 4000 }, videoHeight: { value: 3000 } });
  expect(() => snapshotNativeReactView(source)).toThrow('eight million');
});

it('owns push spring animation cleanup and settles interrupted publication as false', async () => {
  const parent = document.createElement('div'), incoming = document.createElement('div'), outgoing = document.createElement('div'); parent.append(incoming); document.body.append(parent);
  const a = animated(incoming), b = animated(outgoing);
  const job = animateNativeReactView(incoming, outgoing, { action: 'navigate', transition: 'push', direction: 'left', duration: 300, easing: { type: 'spring', mass: 1, stiffness: 100, damping: 12 } });
  expect(outgoing.parentElement).toBe(parent);
  expect(a.animate.mock.calls[0]?.[0]).toHaveLength(73);
  expect(a.animate.mock.calls[0]?.[1]).toMatchObject({ duration: 300, easing: 'linear' });
  job.dispose(); expect(await job.finished).toBe(false); expect(a.animation.cancel).toHaveBeenCalledTimes(1); expect(b.animation.cancel).toHaveBeenCalledTimes(1); expect(outgoing.isConnected).toBe(false);
});

it('finishes and removes overlay exit snapshots while honoring reduced motion', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const outgoing = document.createElement('div'); document.body.append(outgoing); const animation = animated(outgoing);
  const job = animateNativeReactExit(outgoing, { action: 'close', transition: 'slide-out', direction: 'right', duration: 800, easing: 'ease-in' });
  expect(animation.animate.mock.calls[0]?.[0]).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  expect(animation.animate.mock.calls[0]?.[1]).toMatchObject({ duration: 200, easing: 'linear' });
  animation.resolve(); expect(await job.finished).toBe(true); expect(outgoing.isConnected).toBe(false);
});
