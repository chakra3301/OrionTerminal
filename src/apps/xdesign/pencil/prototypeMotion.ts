import type { DesignNavigation } from './prototype';
import { designEase, designSpringDuration, isDesignSpring } from './reactExportRuntime';
import { copySmartLayerSnapshots } from './prototypeSmartSnapshot';
import { prepareSmartMotion, type SmartMotionTrack } from './prototypeSmartMotion';
import { checkCompositeSnapshotBudget, freezePrototypeComposite } from './prototypeCompositeSnapshot';
import { copySmartTextStyles } from './prototypeSmartText';
import { copyNativePaintRasters, type NativePaintContext } from './prototypeNativePaint';
export type PrototypeMotion = (() => void) & { finished: Promise<boolean>; readonly active: boolean; pause: () => void; resume: () => void; seek: (progress: number) => void; scrub: (progress: number) => void; settle: (target: 0 | 1, velocity?: number) => Promise<boolean>; movement: (key?: string) => { x: number; y: number } | undefined };
const completed = (): PrototypeMotion => Object.assign(() => {}, { finished: Promise.resolve(true), active: false, pause: () => {}, resume: () => {}, seek: () => {}, scrub: () => {}, settle: async () => true, movement: () => undefined });

export function prototypeSnapshot(element: HTMLElement, composite = false): HTMLElement {
  if (composite) checkCompositeSnapshotBudget(element);
  const snapshot = element.cloneNode(true) as HTMLElement;
  copySmartLayerSnapshots(element, snapshot);
  copySmartTextStyles(element, snapshot);
  copyNativePaintRasters(element, snapshot);
  snapshot.setAttribute('aria-hidden', 'true'); snapshot.setAttribute('inert', '');
  snapshot.setAttribute('data-xdesign-snapshot', '');
  snapshot.removeAttribute('data-transition');
  const sourceScroll = [...element.querySelectorAll<HTMLElement>('[data-xdesign-scroll]')], copiedScroll = [...snapshot.querySelectorAll<HTMLElement>('[data-xdesign-scroll]')];
  sourceScroll.forEach((node, index) => { const clone = copiedScroll[index]; if (clone) { clone.dataset.xdesignSnapshotScroll = JSON.stringify({ x: node.scrollLeft, y: node.scrollTop }); } });
  const current = [...element.querySelectorAll<HTMLElement>('.xd-prototype-content')], copied = [...snapshot.querySelectorAll<HTMLElement>('.xd-prototype-content')];
  current.forEach((node, index) => { const clone = copied[index]; if (clone) { const computed = getComputedStyle(node); clone.style.transform = computed.transform; clone.style.opacity = computed.opacity; } });
  const paints = [...element.querySelectorAll<HTMLElement>('[data-xdesign-motion-paint]')], clonedPaints = [...snapshot.querySelectorAll<HTMLElement>('[data-xdesign-motion-paint]')];
  paints.forEach((node, index) => { const clone = clonedPaints[index]; if (clone) { const style = getComputedStyle(node); clone.style.opacity = style.opacity; clone.style.transform = style.transform; clone.style.backgroundColor = style.backgroundColor; } });
  const vectors = [...element.querySelectorAll<SVGElement>('[data-xdesign-motion-paint] svg [fill]')], copiedVectors = [...snapshot.querySelectorAll<SVGElement>('[data-xdesign-motion-paint] svg [fill]')];
  vectors.forEach((node, index) => { const clone = copiedVectors[index]; if (clone) { const style = getComputedStyle(node); clone.style.fill = style.fill; clone.style.fillOpacity = style.fillOpacity; } });
  if (composite) freezePrototypeComposite(element, snapshot);
  else for (const child of snapshot.querySelectorAll('[data-xdesign-snapshot]')) child.remove();
  for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute('id'); node.removeAttribute('tabindex'); node.removeAttribute('data-xdesign-view'); node.removeAttribute('data-xdesign-layer'); node.removeAttribute('data-xdesign-source'); node.removeAttribute('data-xdesign-scroll');
  }
  for (const video of snapshot.querySelectorAll('video')) {
    const poster = document.createElement('img'); poster.src = video.poster; poster.alt = ''; poster.style.cssText = video.style.cssText; video.replaceWith(poster);
  }
  Object.assign(snapshot.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
  return snapshot;
}
export function restorePrototypeSnapshot(snapshot: HTMLElement) {
  for (const node of snapshot.querySelectorAll<HTMLElement>('[data-xdesign-snapshot-scroll]')) {
    const point = JSON.parse(node.dataset.xdesignSnapshotScroll!) as { x: number; y: number };
    node.scrollLeft = point.x; node.scrollTop = point.y;
  }
}
type MotionTrack = SmartMotionTrack;
function motionLink(link: DesignNavigation): DesignNavigation {
  const duration = isDesignSpring(link.easing) ? designSpringDuration(link.easing) : link.duration;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return { ...link, transition: 'dissolve', matchLayers: undefined, easing: 'linear', duration: Math.min(duration, 200) };
  return { ...link, duration };
}
function motionOptions(link: DesignNavigation): KeyframeAnimationOptions {
  return { duration: link.duration, easing: isDesignSpring(link.easing) ? 'linear' : Array.isArray(link.easing) ? `cubic-bezier(${link.easing.join(',')})` : link.easing ?? 'ease-out', fill: 'both' };
}
function motionFrames(track: MotionTrack, link: DesignNavigation): Keyframe[] {
  if (track.apply) return [{}, {}];
  if (!isDesignSpring(link.easing) && !track.sampled) return [track.frame(0), track.frame(1)];
  const spring = isDesignSpring(link.easing), count = Math.max(2, Math.ceil(link.duration * (spring ? 0.24 : 0.06)));
  return Array.from({ length: count + 1 }, (_, index) => ({ ...track.frame(spring ? designEase(index / count, link.easing, link.duration) : index / count), offset: index / count }));
}
function opacity(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).opacity); return Number.isFinite(value) ? value : 1;
}
function directionVector(direction: DesignNavigation['direction']) {
  return direction === 'left' ? [-1, 0] : direction === 'top' ? [0, -1] : direction === 'bottom' ? [0, 1] : [1, 0];
}
function transform(element: HTMLElement, x: number, y: number, xUnit: string, yUnit: string, base: string): string {
  const format = (value: number) => Number(value.toFixed(6));
  const translate = !x && !y ? 'translate(0,0)' : !y ? `translateX(${format(x)}${xUnit})` : !x ? `translateY(${format(y)}${yUnit})` : `translate(${format(x)}${xUnit},${format(y)}${yUnit})`;
  // Keep the existing presentation scale and authored transform under the motion.
  const authored = base || element.style.transform;
  return translate + (authored && authored !== 'none' ? ` ${authored}` : '');
}
function motionJob(tracks: MotionTrack[], link: DesignNavigation, remove: () => void, movement: (key?: string) => { x: number; y: number } | undefined = () => undefined): PrototypeMotion {
  const animations: Animation[] = [];
  let active: MotionTrack[] = [], disposed = false, paused = false, epoch = 0, playbackDuration = link.duration, gestureProgress = 0, scrubbed = false, releaseTarget: 0 | 1 | undefined, releaseResolve: ((completed: boolean) => void) | undefined, settle!: (completed: boolean) => void;
  let nativeFrame: number | undefined, nativeFrom = 0, nativeDelta = 1, nativeLink = link, nativeProgress: number | undefined;
  const stopNative = () => { if (nativeFrame !== undefined) cancelAnimationFrame(nativeFrame); nativeFrame = undefined; };
  const updateNative = (time?: number) => {
    const index = active.findIndex(track => !!track.apply); if (index === -1) return;
    const value = time ?? animations[index]?.currentTime ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('This browser returned an invalid native paint timeline.');
    const progress = nativeFrom + nativeDelta * designEase(Math.max(0, Math.min(1, value / playbackDuration)), nativeLink.easing, playbackDuration);
    if (progress === nativeProgress) return;
    for (const track of active) track.apply?.(progress); nativeProgress = progress;
  };
  const scheduleNative = () => {
    if (disposed || paused || nativeFrame !== undefined || !active.some(track => !!track.apply)) return;
    nativeFrame = requestAnimationFrame(() => { nativeFrame = undefined; if (disposed || paused) return; try { updateNative(); scheduleNative(); } catch { finish(false); } });
  };
  const finished = new Promise<boolean>(resolve => { settle = resolve; });
  const finish = (value: boolean) => { if (disposed) return; disposed = true; epoch++; stopNative(); animations.forEach(animation => animation.cancel()); remove(); releaseResolve?.(value); releaseResolve = undefined; settle(value); };
  const observe = () => { const current = ++epoch; void Promise.all(animations.map(animation => animation.finished)).then(() => {
    if (paused || current !== epoch) return;
    if (releaseTarget === 0) { try { updateNative(playbackDuration); paused = true; stopNative(); animations.forEach(animation => animation.pause()); releaseResolve?.(true); releaseResolve = undefined; } catch { finish(false); } }
    else finish(true);
  }, () => { if (current === epoch) finish(false); }); };
  const budget = (next: DesignNavigation) => {
    const count = active.reduce((count, track) => count + (!track.apply && (isDesignSpring(next.easing) || track.sampled) ? Math.max(2, Math.ceil(next.duration * (isDesignSpring(next.easing) ? 0.24 : 0.06))) + 1 : 2), 0);
    if (count > 262144) throw new Error('This prototype transition exceeds the 262,144-keyframe motion allowance. Reduce its moving layers or duration.');
  };
  try {
    active = tracks.filter(track => typeof track.element.animate === 'function' && (!!track.apply || !track.sampled || JSON.stringify(track.frame(0)) !== JSON.stringify(track.frame(1)) || JSON.stringify(track.frame(0.5)) !== JSON.stringify(track.frame(1)))); budget(link);
    for (const track of active) animations.push(track.element.animate(motionFrames(track, link), motionOptions(link)));
    updateNative(0); scheduleNative();
  } catch (error) { finish(false); throw error; }
  if (!animations.length) finish(true); else observe();
  const pause = () => { if (disposed || paused) return; paused = true; epoch++; stopNative(); try { animations.forEach(animation => { if (typeof animation.pause === 'function') animation.pause(); }); updateNative(); } catch (error) { finish(false); throw error; } };
  const resume = () => {
    if (disposed || !paused) return;
      if (animations.every(animation => typeof animation.currentTime === 'number' && animation.currentTime >= playbackDuration)) { finish(true); return; }
    paused = false;
    try { animations.forEach(animation => { const time = animation.currentTime; if (typeof animation.play === 'function') animation.play(); if (typeof time === 'number') animation.currentTime = time; }); updateNative(); scheduleNative(); observe(); } catch (error) { finish(false); throw error; }
  };
  const seek = (progress: number) => { if (!Number.isFinite(progress)) throw new Error('Choose a finite prototype timeline position.'); if (disposed) return; pause(); try { for (const animation of animations) animation.currentTime = Math.max(0, Math.min(1, progress)) * playbackDuration; updateNative(); } catch (error) { finish(false); throw error; } };
  const scrub = (progress: number) => {
    if (!Number.isFinite(progress)) throw new Error('Choose a finite prototype drag position.'); if (disposed) return; pause();
    try {
      if (!scrubbed) {
        const linear = { ...link, easing: 'linear' as const }; budget(linear);
        animations.forEach((animation, index) => { const effect = animation.effect as KeyframeEffect | null; if (!effect || typeof effect.setKeyframes !== 'function') throw new Error('This browser cannot scrub prototype animations.'); effect.setKeyframes(motionFrames(active[index]!, linear)); effect.updateTiming({ duration: link.duration, easing: 'linear' }); });
        playbackDuration = link.duration; scrubbed = true;
        nativeLink = linear; nativeFrom = 0; nativeDelta = 1;
      }
      gestureProgress = Math.max(0, Math.min(1, progress)); for (const animation of animations) animation.currentTime = gestureProgress * playbackDuration; updateNative();
    } catch (error) { finish(false); throw error; }
  };
  const release = (target: 0 | 1, velocity = 0): Promise<boolean> => {
    if (![0, 1].includes(target) || !Number.isFinite(velocity)) throw new Error('Choose a finite drag release and endpoint.'); if (disposed) return Promise.resolve(false);
    pause(); releaseResolve?.(false); releaseResolve = undefined; releaseTarget = target;
    const delta = target - gestureProgress;
    if (!delta) { if (target === 1) finish(true); return Promise.resolve(true); }
    try {
      const easing = isDesignSpring(link.easing) ? { ...link.easing, initialVelocity: Math.max(-100, Math.min(100, velocity / delta)) } : link.easing;
      const next = { ...link, easing, duration: isDesignSpring(easing) ? designSpringDuration(easing) : Math.max(1, Math.round(link.duration * Math.abs(delta))) }; budget(next);
      const initial = active.map(track => {
        const frame = { ...track.frame(gestureProgress) }, style = getComputedStyle(track.element);
        for (const property of Object.keys(frame)) { const value = style.getPropertyValue(property.replace(/[A-Z]/g, character => '-' + character.toLowerCase())); if (value) (frame as Record<string, unknown>)[property] = value; }
        return frame;
      });
      const frames = active.map((track, index) => motionFrames({ ...track, frame: p => p === 0 ? initial[index]! : track.frame(gestureProgress + delta * p) }, next));
      epoch++; animations.forEach(animation => animation.cancel()); animations.length = 0;
      active.forEach((track, index) => animations.push(track.element.animate(frames[index]!, motionOptions(next)))); playbackDuration = next.duration; paused = false; scrubbed = false;
      nativeLink = next; nativeFrom = gestureProgress; nativeDelta = delta; updateNative(0); scheduleNative();
      const result = new Promise<boolean>(resolve => { releaseResolve = resolve; }); observe(); return result;
    } catch (error) { finish(false); throw error; }
  };
  return Object.defineProperty(Object.assign(() => finish(false), { finished, pause, resume, seek, scrub, settle: release, movement }), 'active', { get: () => !disposed }) as PrototypeMotion;
}
export function animatePrototype(element: HTMLElement, incoming: HTMLElement, outgoing: HTMLElement | undefined, authoredLink: DesignNavigation, nativePaints?: NativePaintContext): PrototypeMotion {
  const remove = () => outgoing?.remove();
  if (authoredLink.transition === 'instant' || !incoming.animate) { remove(); return completed(); }
  const link = motionLink(authoredLink), out = ['move-out', 'slide-out'].includes(link.transition);
  if (!link.duration) { remove(); return completed(); }
  if (outgoing) {
    const incomingOrder = Number.parseInt(getComputedStyle(incoming).zIndex), order = Number.isFinite(incomingOrder) ? incomingOrder : 1;
    outgoing.style.zIndex = String(order + (out ? 1 : -1));
    if (out) element.append(outgoing); else element.prepend(outgoing); restorePrototypeSnapshot(outgoing);
  }
  if (outgoing && (link.transition === 'smart' || link.matchLayers)) {
    const smart = prepareSmartMotion(element, incoming, outgoing, link, nativePaints);
    if (smart) return motionJob(smart.tracks, link, () => { smart.restore(); remove(); }, smart.movement);
  }
  const tracks: MotionTrack[] = [], incomingAlpha = opacity(incoming);
  if (link.transition === 'dissolve' || link.transition === 'smart') tracks.push({ element: incoming, frame: p => ({ opacity: Math.min(1, Math.max(0, p)) * incomingAlpha }) });
  else {
    const [dx, dy] = directionVector(link.direction), width = element.clientWidth || Number.parseFloat(element.style.width), height = element.clientHeight || Number.parseFloat(element.style.height), xSize = width > 0 ? width : 100, ySize = height > 0 ? height : 100, xUnit = width > 0 ? 'px' : '%', yUnit = height > 0 ? 'px' : '%', incomingBase = getComputedStyle(incoming).transform;
    if (link.transition !== 'move-out') tracks.push({ element: incoming, frame: p => ({ transform: transform(incoming, dx! * xSize * (out ? -0.25 : 1) * (1 - p), dy! * ySize * (out ? -0.25 : 1) * (1 - p), xUnit, yUnit, incomingBase), ...(link.transition === 'slide-out' ? { opacity: Math.min(1, Math.max(0, p)) * incomingAlpha } : {}) }) });
    if (outgoing && link.transition !== 'move-in') {
      const outgoingBase = getComputedStyle(outgoing).transform, outgoingAlpha = opacity(outgoing), distance = link.transition === 'slide' ? -0.25 : link.transition === 'push' ? -1 : 1;
      tracks.push({ element: outgoing, frame: p => ({ transform: transform(outgoing, dx! * xSize * distance * p, dy! * ySize * distance * p, xUnit, yUnit, outgoingBase), ...(link.transition === 'slide' ? { opacity: Math.min(1, Math.max(0, 1 - p)) * outgoingAlpha } : {}) }) });
    }
  }
  const [dx, dy] = directionVector(link.direction);
  return motionJob(tracks, link, remove, () => link.transition === 'dissolve' || link.transition === 'smart' ? undefined : { x: -dx! * (element.clientWidth || Number.parseFloat(element.style.width) || 100), y: -dy! * (element.clientHeight || Number.parseFloat(element.style.height) || 100) });
}

export function animatePrototypeExit(container: HTMLElement, authoredLink: DesignNavigation): PrototypeMotion {
  restorePrototypeSnapshot(container);
  const moving = container.querySelector<HTMLElement>('.xd-prototype-overlay-frame') ?? container;
  if (authoredLink.transition === 'instant' || !moving.animate) { container.remove(); return completed(); }
  const link = motionLink(authoredLink), tracks: MotionTrack[] = [];
  if (!link.duration) { container.remove(); return completed(); }
  if (link.transition === 'dissolve') { const alpha = opacity(container); tracks.push({ element: container, frame: p => ({ opacity: Math.min(1, Math.max(0, 1 - p)) * alpha }) }); }
  else {
    const [dx, dy] = directionVector(link.direction), base = getComputedStyle(moving).transform, alpha = opacity(moving);
    tracks.push({ element: moving, frame: p => ({ transform: transform(moving, dx! * 100 * p, dy! * 100 * p, '%', '%', base), ...(link.transition === 'slide' || link.transition === 'slide-out' ? { opacity: Math.min(1, Math.max(0, 1 - p)) * alpha } : {}) }) });
    if (container !== moving) { const alpha = opacity(container); tracks.push({ element: container, frame: p => ({ opacity: Math.min(1, Math.max(0, 1 - p)) * alpha }) }); }
  }
  return motionJob(tracks, link, () => container.remove());
}
