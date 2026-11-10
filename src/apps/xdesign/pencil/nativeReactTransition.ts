import { designEase, isDesignSpring, type DesignNavigation } from './reactExportRuntime';

export function snapshotNativeReactView(element: HTMLElement) {
  const sourceScroll = [...element.querySelectorAll<HTMLElement>('[data-xdesign-scroll]')], snapshot = element.cloneNode(true) as HTMLElement;
  sourceScroll.forEach((source, index) => {
    const target = snapshot.querySelectorAll<HTMLElement>('[data-xdesign-scroll]')[index];
    if (target) target.dataset.nativeScrollSnapshot = JSON.stringify({ x: source.scrollLeft, y: source.scrollTop });
  });
  const sourceVideos = [...element.querySelectorAll('video')], copiedVideos = [...snapshot.querySelectorAll('video')];
  let pixels = 0;
  sourceVideos.forEach((source, index) => {
    const target = copiedVideos[index]; if (!target) return;
    if (source.readyState >= 2 && source.videoWidth && source.videoHeight) {
      pixels += source.videoWidth * source.videoHeight;
      if (pixels > 8_000_000) throw new Error('This transition exceeds eight million live video pixels.');
      const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('This browser cannot capture the current video frame.');
      context.drawImage(source, 0, 0); canvas.style.cssText = target.style.cssText; target.replaceWith(canvas);
    } else { const image = document.createElement('img'); image.src = source.poster; image.alt = ''; image.style.cssText = target.style.cssText; target.replaceWith(image); }
  });
  for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute('id'); node.removeAttribute('tabindex'); node.removeAttribute('data-xdesign-view'); node.removeAttribute('data-xdesign-layer'); node.removeAttribute('data-xdesign-scroll');
  }
  snapshot.setAttribute('aria-hidden', 'true'); snapshot.setAttribute('inert', '');
  Object.assign(snapshot.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
  return snapshot;
}

export function animateNativeReactView(incoming: HTMLElement, outgoing: HTMLElement | undefined, authored: DesignNavigation) {
  if (authored.transition === 'smart' || authored.matchLayers) throw new Error('This native export needs source-backed layer interpolation for Smart Animate and matched-layer transitions.');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const link: DesignNavigation = reduced ? { ...authored, transition: 'dissolve', easing: 'linear', duration: Math.min(200, authored.duration) } : authored;
  const animations: Animation[] = [];
  let closed = false;
  const dispose = () => { if (closed) return; closed = true; animations.forEach(animation => animation.cancel()); outgoing?.remove(); };
  if (link.transition === 'instant' || !link.duration || !incoming.animate) { dispose(); return { dispose, finished: Promise.resolve(true) }; }
  if (outgoing && incoming.parentElement) {
    incoming.parentElement.append(outgoing);
    for (const node of outgoing.querySelectorAll<HTMLElement>('[data-native-scroll-snapshot]')) { const position = JSON.parse(node.dataset.nativeScrollSnapshot!) as { x: number; y: number }; node.scrollLeft = position.x; node.scrollTop = position.y; }
  }
  const dx = link.direction === 'left' ? -1 : link.direction === 'top' || link.direction === 'bottom' ? 0 : 1;
  const dy = link.direction === 'top' ? -1 : link.direction === 'bottom' ? 1 : 0;
  const frames = (sample: (progress: number) => Keyframe) => {
    if (!isDesignSpring(link.easing)) return [sample(0), sample(1)];
    const count = Math.max(2, Math.ceil(link.duration * .24));
    return Array.from({ length: count + 1 }, (_, index) => ({ ...sample(designEase(index / count, link.easing, link.duration)), offset: index / count }));
  };
  const options: KeyframeAnimationOptions = { duration: link.duration, easing: isDesignSpring(link.easing) ? 'linear' : Array.isArray(link.easing) ? `cubic-bezier(${link.easing.join(',')})` : link.easing ?? 'ease-out', fill: 'both' };
  const play = (element: HTMLElement, sample: (progress: number) => Keyframe) => animations.push(element.animate(frames(sample), options));
  if (link.transition === 'dissolve') { play(incoming, progress => ({ opacity: Math.min(1, Math.max(0, progress)) })); if (outgoing) play(outgoing, progress => ({ opacity: Math.min(1, Math.max(0, 1 - progress)) })); }
  else {
    const out = link.transition === 'slide-out';
    if (link.transition !== 'move-out') play(incoming, progress => ({ transform: `translate(${dx * 100 * (out ? -.25 : 1) * (1 - progress)}%,${dy * 100 * (out ? -.25 : 1) * (1 - progress)}%)`, ...(out ? { opacity: Math.min(1, Math.max(0, progress)) } : {}) }));
    if (outgoing && link.transition !== 'move-in') { const distance = link.transition === 'slide' ? -.25 : link.transition === 'push' ? -1 : 1; play(outgoing, progress => ({ transform: `translate(${dx * 100 * distance * progress}%,${dy * 100 * distance * progress}%)`, ...(link.transition === 'slide' ? { opacity: Math.min(1, Math.max(0, 1 - progress)) } : {}) })); }
  }
  const finished = Promise.all(animations.map(animation => animation.finished)).then(() => !closed, () => false).finally(dispose);
  return { dispose, finished };
}

export function animateNativeReactExit(outgoing: HTMLElement, authored: DesignNavigation) {
  if (authored.transition === 'smart' || authored.matchLayers) throw new Error('This native export needs source-backed layer interpolation for Smart Animate and matched-layer transitions.');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const link: DesignNavigation = reduced ? { ...authored, transition: 'dissolve', easing: 'linear', duration: Math.min(200, authored.duration) } : authored;
  let closed = false, animation: Animation | undefined;
  const dispose = () => { if (closed) return; closed = true; animation?.cancel(); outgoing.remove(); };
  if (link.transition === 'instant' || !link.duration || !outgoing.animate) { dispose(); return { dispose, finished: Promise.resolve(true) }; }
  const dx = link.direction === 'left' ? -1 : link.direction === 'top' || link.direction === 'bottom' ? 0 : 1;
  const dy = link.direction === 'top' ? -1 : link.direction === 'bottom' ? 1 : 0;
  const sample = (progress: number): Keyframe => link.transition === 'dissolve' ? { opacity: Math.min(1, Math.max(0, 1 - progress)) }
    : { transform: `translate(${dx * 100 * progress}%,${dy * 100 * progress}%)`, ...(['slide', 'slide-out'].includes(link.transition) ? { opacity: Math.min(1, Math.max(0, 1 - progress)) } : {}) };
  const spring = isDesignSpring(link.easing), count = Math.max(2, Math.ceil(link.duration * .24));
  const frames = spring ? Array.from({ length: count + 1 }, (_, index) => ({ ...sample(designEase(index / count, link.easing, link.duration)), offset: index / count })) : [sample(0), sample(1)];
  animation = outgoing.animate(frames, { duration: link.duration, easing: isDesignSpring(link.easing) ? 'linear' : Array.isArray(link.easing) ? `cubic-bezier(${link.easing.join(',')})` : link.easing ?? 'ease-out', fill: 'both' });
  const finished = animation.finished.then(() => !closed, () => false).finally(dispose);
  return { dispose, finished };
}
