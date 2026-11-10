import { afterEach, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor } from '@open-pencil/core/editor';
import { selectionToDesignModel } from './reactExport';
import { DesignView, designEase, type DesignMotion, type DesignNavigation } from './reactExportRuntime';
import { animatePrototype, prototypeSnapshot } from './prototypeMotion';
import { prepareSmartMotion, type SmartMotionTrack } from './prototypeSmartMotion';
import { planSmartText } from './prototypeSmartText';
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const roots: Root[] = [];
function render(component: ReactNode) { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root); act(() => root.render(component)); return { container }; }
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate); else Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });
const descriptor: DesignMotion = { version: 1, root: true, type: 'TEXT', shape: 'text', shadow: false, width: 100, height: 30, local: [1, 0, 0, 1, 0, 0], radii: [0, 0, 0, 0], paints: [] };
const link: DesignNavigation = { action: 'back', transition: 'smart', duration: 200, easing: 'linear' };
function text(values: [string, string, number][], size = 100) {
  const layer = document.createElement('span'); layer.setAttribute('data-xdesign-motion', JSON.stringify({ ...descriptor, name: 'Text', width: size })); Object.assign(layer.style, { position: 'absolute', width: `${size}px`, height: '30px', fontFamily: 'Arial', fontSize: '20px', color: 'black', whiteSpace: 'pre-wrap' });
  for (const [value, color, fontSize] of values) { const span = document.createElement('span'); span.textContent = value; Object.assign(span.style, { fontFamily: 'Arial', color, fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap' }); layer.append(span); } return layer;
}
function scene(sourceText: HTMLElement, target: HTMLElement) {
  const surface = document.createElement('div'), incoming = document.createElement('div'), source = document.createElement('div'); surface.append(incoming); incoming.append(target); source.append(sourceText); document.body.append(surface); const snapshot = prototypeSnapshot(source); surface.prepend(snapshot); return { surface, incoming, snapshot, target };
}
const paintTracks = (tracks: SmartMotionTrack[]) => tracks.filter(track => track.element.hasAttribute('data-xdesign-motion-text') || track.element.hasAttribute('data-xdesign-motion-paint'));
it('matches different run boundaries by Unicode text and interpolates colors and font sizes without duplicate glyphs', () => {
  const from = text([['A🙂', 'red', 20], ['B', 'green', 24]]), to = text([['A', 'blue', 40], ['🙂B', 'black', 48]], 200), { surface, incoming, snapshot } = scene(from, to), original = to.innerHTML;
  const prepared = prepareSmartMotion(surface, incoming, snapshot, link)!, tracks = paintTracks(prepared.tracks);
  expect(tracks.map(track => track.element.textContent)).toEqual(['A', '🙂', 'B']); expect(tracks.map(track => track.frame(0.5).fontSize)).toEqual(['30px', '34px', '36px']); expect(tracks[0]!.frame(0.5).color).toBe('rgba(127.5,0,127.5,1)');
  const box = prepared.tracks.find(track => track.element === to)!;
  expect(box.frame(0)).toMatchObject({ transform: 'matrix(1,0,0,1,0,0)', width: '100px', height: '30px' }); expect(box.frame(0.5)).toMatchObject({ transform: 'matrix(1,0,0,1,0,0)', width: '150px' }); expect(box.frame(1).width).toBe('200px');
  expect(to.querySelectorAll('[data-xdesign-motion-paint]')).toHaveLength(1); prepared.restore(); expect(to.innerHTML).toBe(original);
});
it('interpolates actual SDK text export, variable axes, spacing and decoration while preserving native data', () => {
  const editor = createEditor();
  try {
    const graph = editor.graph, page = editor.state.currentPageId;
    const nodes = [20, 40].map((fontSize, index) => graph.createNode('TEXT', page, { name: `Text${index}`, text: 'Same🙂', width: index ? 200 : 100, height: 60, fontFamily: 'Arial', fontSize, fontWeight: index ? 700 : 400, lineHeight: index ? 48 : 24, letterSpacing: index ? 4 : 0, textLanguage: 'en', fontVariations: [{ axis: 'wght', value: index ? 700 : 400 }], fills: [{ type: 'SOLID', color: { r: index ? 0 : 1, g: 0, b: index ? 1 : 0, a: 1 }, visible: true, opacity: 1 }], styleRuns: [{ start: 0, length: 6, style: { fontSize, fontFamily: 'Arial', fontWeight: index ? 700 : 400, lineHeight: index ? 48 : 24, letterSpacing: index ? 4 : 0, fontVariations: [{ axis: 'wght', value: index ? 700 : 400 }], textLanguage: 'en', textDecoration: 'UNDERLINE', textDecorationThickness: index ? 4 : 2, textUnderlineOffset: index ? 8 : 2 } }] }));
    const original = JSON.stringify([...graph.nodes]), models = nodes.map(node => selectionToDesignModel(graph, [node.id])), views = models.map(model => render(<DesignView nodes={model.nodes} width={model.width} height={model.height} />));
    const source = views[0]!.container, incoming = views[1]!.container, surface = document.createElement('div'); document.body.append(surface); surface.append(incoming); const snapshot = prototypeSnapshot(source); surface.prepend(snapshot); const prepared = prepareSmartMotion(surface, incoming, snapshot, link)!;
    const frames = paintTracks(prepared.tracks).map(track => track.frame(0.5)); expect(frames).toHaveLength(1); expect(frames[0]).toMatchObject({ fontSize: '30px', fontWeight: 550, lineHeight: '36px', letterSpacing: '2px', fontVariationSettings: '"wght" 550', textDecorationThickness: '3px', textUnderlineOffset: '5px', color: 'rgba(127.5,0,127.5,1)' });
    expect(incoming.querySelector('[data-xdesign-motion-paint]')?.textContent).toBe('Same🙂'); expect(incoming.querySelector('[data-xdesign-motion-paint]')?.getAttribute('lang')).toBe('en'); prepared.restore(); expect(JSON.stringify([...graph.nodes])).toBe(original);
  } finally { editor.dispose(); }
});
it.each(['fontFamily', 'fontFeatureSettings', 'fontStyle', 'lang', 'different text', 'split surrogate'])('keeps the crossfade for incompatible %s and restores authored spans', property => {
  const from = text([['A🙂B', 'red', 20]]), to = text([['A🙂B', 'blue', 40]]), span = to.firstElementChild as HTMLElement;
  if (property === 'different text') span.textContent = 'Another'; else if (property === 'split surrogate') { span.textContent = 'A\uD83D'; const next = span.cloneNode(false); next.textContent = '\uDE42B'; to.append(next); } else if (property === 'lang') span.lang = 'ar'; else (span.style as unknown as Record<string, string>)[property] = property === 'fontFamily' ? 'serif' : property === 'fontFeatureSettings' ? '"liga" 0' : 'italic';
  const { surface, incoming, snapshot } = scene(from, to), original = to.innerHTML, prepared = prepareSmartMotion(surface, incoming, snapshot, link)!;
  expect(paintTracks(prepared.tracks).map(track => track.frame(0.5))).toEqual([{ opacity: 0.5 }, { opacity: 0.5 }]); prepared.restore(); expect(to.innerHTML).toBe(original);
});
it('captures computed interrupted span paint and typography before retargeting', () => {
  const from = text([['Same', 'red', 20]]), to = text([['Same', 'blue', 40]]), next = text([['Same', 'green', 60]]), initial = scene(from, to), first = prepareSmartMotion(initial.surface, initial.incoming, initial.snapshot, link)!, active = paintTracks(first.tracks)[0]!.element;
  const computed = getComputedStyle;
  const animated: Record<string, string> = { color: 'rgb(120, 0, 135)', 'font-size': '29px' };
  vi.stubGlobal('getComputedStyle', (node: Element) => { const style = computed(node); if (node !== active) return style; return new Proxy(style, { get(target, property) { if (property === 'getPropertyValue') return (name: string) => animated[name] ?? target.getPropertyValue(name); return Reflect.get(target, property, target); } }); });
  const current = prototypeSnapshot(initial.incoming, true); vi.unstubAllGlobals(); first.restore(); initial.incoming.remove(); initial.snapshot.remove(); const incoming = document.createElement('div'); incoming.append(next); initial.surface.append(current, incoming);
  expect(current.querySelector<HTMLElement>('[data-xdesign-motion-paint]')?.style.fontSize).toBe('29px'); const retarget = prepareSmartMotion(initial.surface, incoming, current, link)!, track = paintTracks(retarget.tracks)[0]!;
  expect(track.frame(0)).toMatchObject({ color: 'rgb(120, 0, 135)', fontSize: '29px' }); expect(track.frame(0.5).fontSize).toBe('44.5px'); expect(next.querySelector('[data-xdesign-motion-paint]')?.textContent).toBe('Same'); retarget.restore();
});
it('rejects excessive text before mutating either DOM tree', () => {
  const from = text([['a'.repeat(1024 * 1024 + 1), 'red', 20]]), to = text([['a', 'blue', 40]]), old = from.innerHTML, next = to.innerHTML;
  expect(() => planSmartText(from, to)).toThrow('text allowance'); expect(from.innerHTML).toBe(old); expect(to.innerHTML).toBe(next);
});
it('interpolates font-only changes on plain text instead of treating identical characters and color as identical paint', () => {
  const from = text([]), to = text([]); from.textContent = to.textContent = 'Same'; to.style.fontSize = '40px';
  const { surface, incoming, snapshot } = scene(from, to), prepared = prepareSmartMotion(surface, incoming, snapshot, link)!;
  expect(paintTracks(prepared.tracks)[0]!.frame(0.5)).toMatchObject({ fontSize: '30px' }); prepared.restore(); expect(to.textContent).toBe('Same');
});
it('refuses unresolved unitless line-height changes rather than interpolating them as pixel lengths', () => {
  const from = text([['Same', 'red', 20]]), to = text([['Same', 'blue', 40]]); (from.firstElementChild as HTMLElement).style.lineHeight = '1'; (to.firstElementChild as HTMLElement).style.lineHeight = '2';
  expect(planSmartText(from, to)).toBeUndefined();
});
it('keeps resizing flow text in the crossfade instead of shifting its flex siblings during playback', () => {
  const from = text([['Same', 'red', 20]]), to = text([['Same', 'blue', 40]], 200); from.style.position = to.style.position = 'relative';
  const { surface, incoming, snapshot } = scene(from, to), original = to.innerHTML, prepared = prepareSmartMotion(surface, incoming, snapshot, link)!;
  expect(paintTracks(prepared.tracks).map(track => track.frame(0.5))).toEqual([{ opacity: 0.5 }, { opacity: 0.5 }]); expect(prepared.tracks.find(track => track.element === to)!.frame(0)).not.toHaveProperty('width'); prepared.restore(); expect(to.innerHTML).toBe(original);
});
it('compensates a resizing parent while interpolating the child text box and glyph size exactly once', () => {
  const from = text([['Same', 'red', 20]]), to = text([['Same', 'blue', 40]], 200), oldParent = document.createElement('div'), newParent = document.createElement('div');
  for (const child of [from, to]) { const value = JSON.parse(child.getAttribute('data-xdesign-motion')!); child.setAttribute('data-xdesign-motion', JSON.stringify({ ...value, root: false })); }
  for (const [parent, child, size] of [[oldParent, from, 200], [newParent, to, 400]] as const) { parent.setAttribute('data-xdesign-motion', JSON.stringify({ ...descriptor, type: 'FRAME', shape: 'box', width: size, name: 'Frame' })); Object.assign(parent.style, { position: 'absolute', width: `${size}px`, height: '30px' }); parent.append(child); }
  const { surface, incoming, snapshot } = scene(oldParent, newParent), prepared = prepareSmartMotion(surface, incoming, snapshot, link)!, parentTrack = prepared.tracks.find(track => track.element === newParent)!, childTrack = prepared.tracks.find(track => track.element === to)!;
  const xScale = (frame: Keyframe) => Number(String(frame.transform).match(/matrix\(([^,]+)/)![1]);
  expect(xScale(parentTrack.frame(0.5)) * xScale(childTrack.frame(0.5))).toBeCloseTo(1); expect(childTrack.frame(0.5).width).toBe('150px'); expect(paintTracks(prepared.tracks).find(track => track.frame(0.5).fontSize)!.frame(0.5).fontSize).toBe('30px'); prepared.restore();
});
it('samples spring color and text continuously, scrubs linearly and starts release from current computed paint', async () => {
  const from = text([['Same', 'red', 20]]), to = text([['Same', 'blue', 40]]), { surface, incoming, snapshot } = scene(from, to), original = to.innerHTML;
  const jobs: { element: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; currentTime: number; effect: { setKeyframes: ReturnType<typeof vi.fn>; updateTiming: ReturnType<typeof vi.fn> } }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), job = { element: this, frames, options, finish: () => finish(), currentTime: 0, effect: { setKeyframes: vi.fn(), updateTiming: vi.fn() }, finished, cancel: vi.fn(), pause: vi.fn(), play: vi.fn() }; jobs.push(job); return job; } });
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const spring = { type: 'spring' as const, mass: 1, stiffness: 100, damping: 15 }, motion = animatePrototype(surface, incoming, snapshot, { ...link, easing: spring }), colorJob = jobs.find(job => job.frames[0]!.color)!;
  expect(new Set(colorJob.frames.map(frame => frame.color)).size).toBeGreaterThan(10); const middle = Math.floor(colorJob.frames.length / 4), progress = designEase(middle / (colorJob.frames.length - 1), spring, Number(colorJob.options.duration)); expect(Number.parseFloat(String(colorJob.frames[middle]!.fontSize))).toBeCloseTo(20 + 20 * progress, 5);
  motion.scrub(0.5); const linear = colorJob.effect.setKeyframes.mock.calls[0]![0] as Keyframe[]; expect(linear.find(frame => frame.offset === 0.5)).toMatchObject({ color: 'rgba(127.5,0,127.5,1)', fontSize: '30px' });
  colorJob.element.style.color = 'rgb(127, 0, 128)'; colorJob.element.style.fontSize = '30px'; const initialJobs = jobs.length, released = motion.settle(1, 1), releasedColor = jobs.slice(initialJobs).find(job => job.frames[0]!.color)!; expect(releasedColor.frames[0]).toMatchObject({ color: 'rgb(127, 0, 128)', fontSize: '30px' }); expect(new Set(releasedColor.frames.map(frame => frame.color)).size).toBeGreaterThan(10);
  jobs.slice(initialJobs).forEach(job => job.finish()); expect(await released).toBe(true); expect(await motion.finished).toBe(true); expect(to.innerHTML).toBe(original); expect(snapshot.parentElement).toBeNull();
});
