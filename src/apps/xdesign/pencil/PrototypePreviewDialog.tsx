import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useDesignDialog } from '../useDesignDialog';
import { beginXDesignActivity } from '../runtimeActivity';
import { initializeCanvasKit, usePencilWorkspace } from './runtime';
import { prepareDesignModelFonts, selectionToDesignModel, type DesignModel } from './reactExport';
import { DesignView, allDesignActions, openDesignUrl, playDesignMedia, rememberDesignMedia, createDesignMediaState, type DesignMediaMutation, type DesignUrlOpener, type DesignMediaState, type DesignMediaSnapshot, executeDesignActions, designScrollTo, transferDesignScroll, type DesignScrollJob, type DesignReversibleJob, type DesignDragJob, type DesignDragSample, type DesignValue, type DesignControlSession, type DesignControlSnapshot, type DesignNode } from './reactExportRuntime';
import { capturePrototypeVariables } from './prototypeVariableGraph';
import { emptyPrototypeSession, type PrototypeSession } from './prototypeValues';
import { routePrototype, prototypeScreens, prototypeStart, type PrototypeRoute, type DesignNavigation, type DesignPoint, type DesignTrigger } from './prototype';
import { animatePrototype, animatePrototypeExit, prototypeSnapshot, restorePrototypeSnapshot, type PrototypeMotion } from './prototypeMotion';
import { captureSmartLayers } from './prototypeSmartSnapshot';
import { overlayPosition, readPrototypeOverlay } from './prototypeOverlay';
import { NativePaintContext, nativeSourcesFor, type PrototypePaintSources } from './prototypeNativePaint';

const instant: DesignNavigation = { action: 'navigate', transition: 'instant', duration: 0 };
type Prepared = { route: PrototypeRoute; models: Map<string, DesignModel>; revision: number; scrollRevision: number; variableRevision: number; controls: DesignControlSession };
type MediaCheckpoint = Map<string, DesignMediaSnapshot>;
type Held = { media: MediaCheckpoint; sourceLayerId: string; sourceRouteKey: string; route: PrototypeRoute; positions: Record<string, DesignPoint>; history: Map<string, Record<string, DesignPoint>>; prepared: Prepared; controls: DesignControlSession; session: PrototypeSession; values: Record<string, DesignValue>; focusStack: (HTMLElement | null)[]; focus?: HTMLElement; focusId?: string; close: (restore: boolean) => void };
type Visual = { media?: MediaCheckpoint; kind: 'screen' | 'overlay' | 'close'; link: DesignNavigation; snapshot?: HTMLElement; position?: DesignPoint; focusStack: (HTMLElement | null)[]; surface?: HTMLElement; restore?: () => void };
type DragState = { route: PrototypeRoute; prepared: Prepared; error?: string; settling?: PrototypeMotion | DesignScrollJob; apply: (job: PrototypeMotion | DesignScrollJob) => void; restore: () => void; discard: () => void };
function controlCheckpoint(prepared: Prepared, current: DesignControlSession, layerId: string) {
  const result = structuredClone(current);
  const visit = (node: DesignNode) => {
    const config = node.control;
    if (config?.native && node.id === layerId && result[config.native.key]) result[config.native.key]!.state = config.playback?.state ?? 'rest';
    node.children.forEach(visit); config?.variants.forEach(variant => visit(variant.tree));
  };
  for (const model of prepared.models.values()) model.nodes.forEach(visit);
  return result;
}
function controlRootKey(key: string) {
  try {
    const root: unknown = JSON.parse(key)[0];
    return typeof root === 'string' ? root : undefined;
  } catch { return; }
}
function overlayModelKey(overlay: PrototypeRoute['overlays'][number], index: number) {
  return JSON.stringify(['overlay', overlay.instanceId ?? `legacy:${index}:${overlay.screen}`, overlay.screen]);
}
function overlayScope(overlay: PrototypeRoute['overlays'][number], index: number) { return overlay.instanceId ?? `legacy:${index}:${overlay.screen}`; }
function routeOccurrenceKey(route?: PrototypeRoute) { return route ? JSON.stringify([route.screen, route.history, route.overlays.map((overlay, index) => [overlayScope(overlay, index), overlay.screen])]) : ''; }
function cachedOverlayScope(key: string) {
  try { const parts = JSON.parse(key) as unknown[]; return parts[0] === 'overlay' && typeof parts[1] === 'string' ? parts[1] : undefined; } catch { return; }
}
function overlayAuthoredLayerId(id: string, scope: string) {
  const slash = id.indexOf('/'), rootText = slash < 0 ? id : id.slice(0, slash);
  try {
    const root = JSON.parse(rootText) as unknown[];
    if (root[0] !== 'overlay' || root[1] !== scope || typeof root[2] !== 'string') return;
    return { screen: root[2], layerId: `${root[2]}${slash < 0 ? '' : id.slice(slash)}` };
  } catch { return; }
}
function belongsToOverlayScope(id: string, scope: string) {
  try {
    const segment = id.split('/')[0]!;
    const direct = JSON.parse(segment) as unknown[];
    if (direct[0] === 'overlay' && direct[1] === scope) return true;
  } catch { /* control keys wrap the root in their first array entry */ }
  try {
    const parts = JSON.parse(id) as unknown[];
    if (typeof parts[0] !== 'string') return false;
    const root = JSON.parse(parts[0]) as unknown[];
    return root[0] === 'overlay' && root[1] === scope;
  } catch { return false; }
}
export function PrototypePreviewDialog({ close, onOpenUrl }: { close: () => void; onOpenUrl?: DesignUrlOpener }) {
  // The OS chooses browser tab placement; never navigate Orion's own WebView.
  const urlOpener = onOpenUrl ?? (isTauri() ? (url: string) => openUrl(url) : undefined);
  const editor = usePencilWorkspace(state => state.editor)!;
  const pageId = useRef(editor.state.currentPageId).current;
  const screens = useRef(prototypeScreens(editor.graph, pageId)).current;
  const initial = useRef(prototypeStart(editor.graph, pageId)).current;
  const initialRoute = useRef(initial ? { screen: initial, history: [], overlays: [] } as PrototypeRoute : undefined).current;
  const occurrence = useRef(0);
  const preparationPlayback = useRef<MediaCheckpoint | undefined>(undefined);
  const mediaOwners = useRef(new Map<string, DesignMediaState>()), mediaRestore = useRef<MediaCheckpoint | undefined>(undefined);
  const mediaOwner = (key: string) => { let owner = mediaOwners.current.get(key); if (!owner) { owner = createDesignMediaState(); mediaOwners.current.set(key, owner); } return owner; };
  const captureMedia = (): MediaCheckpoint => new Map([...mediaOwners.current].map(([key, owner]) => [key, owner.capture()]));
  const beginPreparation = () => { preparationPlayback.current ??= captureMedia(); };
  const resumePreparationPlayback = () => { const checkpoint = preparationPlayback.current; preparationPlayback.current = undefined; if (checkpoint) for (const [key, snapshot] of checkpoint) mediaOwner(key).restorePlayback(snapshot); };
  const restoreMedia = (checkpoint: MediaCheckpoint) => { for (const [key, snapshot] of checkpoint) mediaOwner(key).restore(snapshot); };

  const [request, setRequest] = useState(initialRoute), [presented, setPresented] = useState<Prepared>();
  const sequenceEpoch = useRef(0), mounted = useRef(true), pendingStep = useRef<((completed: boolean) => void) | undefined>(undefined), motion = useRef<PrototypeMotion | DesignScrollJob | undefined>(undefined);
  const dragState = useRef<DragState | undefined>(undefined), [dragRunning, setDragRunning] = useState(false);
  const holds = useRef<Held[]>([]), pendingRestore = useRef<Held | undefined>(undefined), pendingFocusId = useRef<string | undefined>(undefined);
  const discardHolds = () => { const entries = [...holds.current]; holds.current = []; entries.forEach(held => held.close(false)); };
  const discardHoldForLayer = (layerId: string) => { const routeKey = routeOccurrenceKey(route.current.value); [...holds.current].filter(held => held.sourceLayerId === layerId && held.sourceRouteKey === routeKey).forEach(held => held.close(false)); };
  const [sequenceRunning, setSequenceRunning] = useState(false);
  const [definitions] = useState(() => capturePrototypeVariables(editor.graph)), variableSession = useRef<PrototypeSession>(emptyPrototypeSession()), [variableRevision, setVariableRevision] = useState(0);
  const controlSession = useRef<DesignControlSession>({}), [controlRevision, setControlRevision] = useState(0);
  const cancelSequence = (preserveMotion = false, preserveDrag = false) => { if (!preserveDrag) dragState.current?.discard(); sequenceEpoch.current++; const current = motion.current; if (preserveMotion && current && 'pause' in current && current.active) current.pause(); else { current?.(); motion.current = undefined; } pendingStep.current?.(false); pendingStep.current = undefined; if (mounted.current) setSequenceRunning(false); };
  const scrollPositions = useRef<Record<string, DesignPoint>>({}), scrollRevision = useRef(0);
  const route = useRef({ value: initialRoute, ready: false }), autoRoutes = useRef<number[]>([]);
  const frame = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), pendingVisual = useRef<Visual | undefined>(undefined);
  const overlayFrames = useRef(new Map<number, HTMLDivElement>()), overlayContents = useRef(new Map<number, HTMLDivElement>());
  const returnFocus = useRef<(HTMLElement | null)[]>([]), pendingFocus = useRef<HTMLElement | null>(null);
  const clearPendingVisual = () => { pendingVisual.current?.restore?.(); pendingVisual.current?.snapshot?.remove(); pendingVisual.current = undefined; };
  const captureVisual = (surface: HTMLElement | null | undefined): HTMLElement | undefined => {
    const stopMotion = () => { motion.current?.(); motion.current = undefined; pendingStep.current?.(false); pendingStep.current = undefined; };
    if (!surface) { stopMotion(); clearPendingVisual(); return; }
    const current = motion.current; if (current && 'pause' in current) current.pause();
    const pending = pendingVisual.current, snapshot = pending?.surface === surface && pending.snapshot ? pending.snapshot.cloneNode(true) as HTMLElement : prototypeSnapshot(surface, !!pending || !!current && 'active' in current && current.active);
    clearPendingVisual(); stopMotion(); return snapshot;
  };
  const stageVisual = (visual: Visual, surface: HTMLElement | null | undefined) => {
    visual.media = preparationPlayback.current ?? visual.media; pendingVisual.current = visual; if (!surface || !visual.snapshot) return;
    const visibility = surface.style.visibility, snapshot = visual.snapshot;
    visual.surface = surface; visual.restore = () => { if (surface.style.visibility === 'hidden') surface.style.visibility = visibility; };
    snapshot.style.visibility = 'visible'; snapshot.style.zIndex = String(Math.max(1, ...[...surface.children].map(child => Number.parseInt(getComputedStyle(child).zIndex) || 0)) + 1);
    surface.style.visibility = 'hidden'; surface.append(snapshot); restorePrototypeSnapshot(snapshot);
  };
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [automatic, setAutomatic] = useState(true);
  const [values, setValues] = useState<Record<string, DesignValue>>({}), [revision, setRevision] = useState(0), [status, setStatus] = useState('');
  const dispose = () => { discardHolds(); cancelSequence(); clearPendingVisual(); close(); };
  const dialog = useDesignDialog<HTMLDivElement>(() => route.current.value?.overlays.length ? navigate({ ...instant, action: 'close' }) : dispose(), false, { focusRoot: () => route.current.value?.overlays.length ? overlayFrames.current.get(route.current.value.overlays.length - 1) ?? null : null });
  const stage = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const cache = useRef(new Map<string, DesignModel>()), closeRef = useRef(close); closeRef.current = close;
  const knownOverlayScopes = useRef(new Set<string>());
  const scrollHistory = useRef(new Map<string, Record<string, DesignPoint>>());
  const pruneOverlayScopes = (prospective?: PrototypeRoute, remember = true) => {
    const keep = new Set([
      ...(prospective?.overlays ?? route.current.value?.overlays ?? []).map(overlayScope),
      ...holds.current.flatMap(held => held.route.overlays.map(overlayScope)),
      ...(pendingRestore.current?.route.overlays.map(overlayScope) ?? []),
      ...(dragState.current?.route.overlays.map(overlayScope) ?? []),
    ]);
    const discard = [...knownOverlayScopes.current].filter(scope => !keep.has(scope));
    if (!discard.length) return;
    const belongs = (id: string) => discard.some(scope => belongsToOverlayScope(id, scope));
    controlSession.current = Object.fromEntries(Object.entries(controlSession.current).filter(([id]) => !belongs(id)));
    if (mounted.current) setValues(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !belongs(id))));
    for (const id of Object.keys(scrollPositions.current)) if (belongs(id)) {
      const point = scrollPositions.current[id];
      for (const scope of remember ? discard : []) {
        const authored = overlayAuthoredLayerId(id, scope); if (!authored || !point) continue;
        const saved = scrollHistory.current.get(authored.screen) ?? {};
        saved[authored.layerId] = { ...point }; scrollHistory.current.set(authored.screen, saved);
      }
      delete scrollPositions.current[id];
    }
    for (const [key] of cache.current) if (discard.includes(cachedOverlayScope(key) ?? '')) cache.current.delete(key);
    for (const key of mediaOwners.current.keys()) if (discard.includes(cachedOverlayScope(key) ?? '')) mediaOwners.current.delete(key);
    discard.forEach(scope => knownOverlayScopes.current.delete(scope));
  };
  const model = presented?.models.get(presented.route.screen);
  const scale = model && viewport.width && viewport.height ? Math.min(1, viewport.width / model.width, viewport.height / model.height) : 1;
  const positions = presented?.route.overlays.map((overlay, index) => overlayPosition(readPrototypeOverlay(editor.graph.getNode(overlay.screen)!).settings, model!, presented.models.get(overlayModelKey(overlay, index))!, overlay.origin, overlay.offset)) ?? [];
  useEffect(() => beginXDesignActivity('page-preview', 'Close presentation before switching projects.'), []);
  useEffect(() => {
    const resume = () => { const current = motion.current; if (!dragState.current && route.current.ready && !pendingVisual.current && !document.hidden && current && 'resume' in current) current.resume(); };
    document.addEventListener('pointerup', resume); document.addEventListener('touchend', resume); document.addEventListener('keyup', resume);
    return () => { document.removeEventListener('pointerup', resume); document.removeEventListener('touchend', resume); document.removeEventListener('keyup', resume); };
  }, []);
  useEffect(() => { mounted.current = true; const hidden = () => { if (document.hidden) cancelSequence(); }; document.addEventListener('visibilitychange', hidden); return () => { mounted.current = false; discardHolds(); cancelSequence(); document.removeEventListener('visibilitychange', hidden); }; }, []);
  useEffect(() => {
    const changed = () => { discardHolds(); cancelSequence(); closeRef.current(); };
    const listeners = [editor.graph.emitter.on('node:updated', changed), editor.graph.emitter.on('node:created', changed), editor.graph.emitter.on('node:deleted', changed), editor.graph.emitter.on('node:reparented', changed), editor.graph.emitter.on('node:reordered', changed)];
    const workspace = dialog.current?.closest('.xd-pencil');
    const roots = [...(workspace?.children ?? [])].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.contains(dialog.current));
    const previous = roots.map(node => [node, node.getAttribute('inert')] as const);
    roots.forEach(node => node.setAttribute('inert', ''));
    return () => { mounted.current = false; discardHolds(); cancelSequence(); listeners.forEach(remove => remove()); previous.forEach(([node, value]) => value === null ? node.removeAttribute('inert') : node.setAttribute('inert', value)); cache.current.clear(); clearPendingVisual(); };
  }, [editor, dialog]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const update = () => setViewport({ width: Math.max(0, element.clientWidth - 48), height: Math.max(0, element.clientHeight - 48) });
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    const targetRoute = route.current.value ?? request;
    const failedDestinationPending = !!request && !!targetRoute && request !== targetRoute;
    const controlOnly = !!presented && presented.route === targetRoute && presented.revision === revision && presented.variableRevision === variableRevision && route.current.ready && !pendingVisual.current;
    if (!controlOnly) { beginPreparation(); setLoading(true); route.current.ready = false; }
    if (!failedDestinationPending) setError('');
    const desiredVariables = variableSession.current, desiredControls = controlSession.current;
    const current = () => active && variableSession.current === desiredVariables && controlSession.current === desiredControls && route.current.value === targetRoute;
    const variables = structuredClone(desiredVariables), controls = structuredClone(desiredControls), link = pendingVisual.current?.link;
    if (!targetRoute) { setError('Add a frame to this page to create a screen.'); setLoading(false); resumePreparationPlayback(); return; }
    const resetOverlay = targetRoute.overlays.at(-1), resetModelKey = link?.resetInteractiveComponents ? resetOverlay ? overlayModelKey(resetOverlay, targetRoute.overlays.length - 1) : targetRoute.screen : undefined;
    if (link?.resetInteractiveComponents) {
      const top = resetOverlay, destination = top ? JSON.stringify(['overlay', overlayScope(top, targetRoute.overlays.length - 1), top.screen]) : targetRoute.screen;
      for (const key of Object.keys(controls)) if (controlRootKey(key) === destination) delete controls[key];
    }
    const prepare = async () => {
      const models = new Map<string, DesignModel>();
      const instances: { id: string; key: string; scope?: string }[] = [{ id: targetRoute.screen, key: targetRoute.screen }, ...targetRoute.overlays.map((overlay, index) => ({ id: overlay.screen, key: overlayModelKey(overlay, index), scope: overlay.instanceId ?? `legacy:${index}:${overlay.screen}` }))];
      targetRoute.overlays.forEach((overlay, index) => knownOverlayScopes.current.add(overlayScope(overlay, index)));
      for (const { id, key, scope } of instances) {
        let next = key === resetModelKey ? undefined : cache.current.get(key);
        if (!next) {
          const ck = editor.renderer?.ck ?? await initializeCanvasKit();
          if (!current()) return;
          if (ck) { if (scope) await prepareDesignModelFonts(editor.graph, [id], variables, controls, scope); else await prepareDesignModelFonts(editor.graph, [id], variables, controls); if (!current()) return; }
          next = scope ? selectionToDesignModel(editor.graph, [id], ck, true, variables, controls, true, scope) : selectionToDesignModel(editor.graph, [id], ck, true, variables, controls, true);
          if (!(next.width > 0 && next.height > 0)) throw new Error('Give this screen a positive width and height before presenting.');
          if (!current()) return;
        }
        models.set(key, next);
        const scrollAction = pendingVisual.current?.link;
        if (scope && !scrollAction?.preserveScroll && !scrollAction?.resetScroll && !presented?.route.overlays.some((overlay, index) => overlay.screen === id && overlayScope(overlay, index) !== scope)) {
          const saved = scrollHistory.current.get(id);
          if (saved) {
            const seed = (node: DesignNode) => {
              if (node.scroll && scrollPositions.current[node.id] === undefined) {
                const authored = overlayAuthoredLayerId(node.id, scope);
                const point = authored && saved[authored.layerId];
                if (point) scrollPositions.current[node.id] = { ...point };
              }
              node.children.forEach(seed); node.control?.variants.forEach(variant => seed(variant.tree));
            };
            next.nodes.forEach(seed);
          }
        }
        if ([...models.values()].reduce((bytes, model) => bytes + model.byteLength, 0) > 32 * 1024 * 1024) throw new Error('These screens and overlays exceed 32 MB; reduce their embedded assets.');
      }
      if (!current()) return;
      const candidateCache = new Map(cache.current);
      for (const [id, next] of models) candidateCache.set(id, next);
      const retainedBytes = () => [...new Set([...candidateCache.values(), ...models.values(), ...(presented?.models.values() ?? []), ...(pendingRestore.current?.prepared.models.values() ?? []), ...(dragState.current?.prepared.models.values() ?? []), ...holds.current.flatMap(held => [...held.prepared.models.values()])])].reduce((bytes, model) => bytes + model.byteLength, 0);
      while (candidateCache.size > 4 || retainedBytes() > 32 * 1024 * 1024) {
        const id = [...candidateCache.keys()].find(id => !models.has(id)) ?? candidateCache.keys().next().value;
        if (id === undefined) break; candidateCache.delete(id);
      }
      if (retainedBytes() > 32 * 1024 * 1024) throw new Error('Temporary interactions and current screens exceed 32 MB; reduce their embedded assets.');
      if (link && presented && ['navigate', 'overlay', 'swap'].includes(link.action)) {
        const fromOverlay = presented.route.overlays.at(-1), toOverlay = targetRoute.overlays.at(-1);
        const from = presented.models.get(fromOverlay ? overlayModelKey(fromOverlay, presented.route.overlays.length - 1) : presented.route.screen);
        const to = models.get(toOverlay ? overlayModelKey(toOverlay, targetRoute.overlays.length - 1) : targetRoute.screen);
        if (from && to) transferDesignScroll(from.nodes, to.nodes, scrollPositions.current, link);
      }
      if (!current()) return;
      preparationPlayback.current = undefined; pendingRestore.current = undefined; route.current = { value: targetRoute, ready: true };
      if (link?.resetInteractiveComponents) controlSession.current = controls;
      cache.current = candidateCache;
      pruneOverlayScopes(targetRoute);
      if (link?.resetScroll) targetRoute.overlays.forEach(overlay => scrollHistory.current.delete(overlay.screen));
      setPresented({ route: targetRoute, models, revision, scrollRevision: ++scrollRevision.current, variableRevision, controls: structuredClone(controlSession.current) }); setLoading(false);
    };
    void prepare().catch(error => { if (current()) { if (controlOnly && presented) controlSession.current = structuredClone(presented.controls); if (dragState.current) dragState.current.error = String(error); if (pendingVisual.current) returnFocus.current = pendingVisual.current.focusStack; resumePreparationPlayback(); clearPendingVisual(); pendingFocus.current = null; setError(String(error)); pendingStep.current?.(false); pendingStep.current = undefined; setLoading(false); const fallback = pendingRestore.current; pendingRestore.current = undefined; if (fallback) { mediaRestore.current = fallback.media; controlSession.current = structuredClone(fallback.prepared.controls); variableSession.current = structuredClone(fallback.session); setValues(fallback.values); setPresented({ ...fallback.prepared, scrollRevision: ++scrollRevision.current }); route.current = { value: fallback.route, ready: true }; } else route.current = { value: presented?.route ?? request, ready: !!presented }; pruneOverlayScopes(route.current.value); } });
    return () => { active = false; };
  }, [editor, request, revision, variableRevision, controlRevision]);
  const previousPresentation = useRef<Prepared | undefined>(undefined);
  useLayoutEffect(() => {
    if (!presented) return;
    if (mediaRestore.current) { const checkpoint = mediaRestore.current; mediaRestore.current = undefined; restoreMedia(checkpoint); }
    const previous = previousPresentation.current; previousPresentation.current = presented;
    const visual = pendingVisual.current; pendingVisual.current = undefined; visual?.restore?.();
    let cleanup: PrototypeMotion | undefined, failed = false;
    try {
      if (visual?.kind === 'close' && visual.snapshot && frame.current) {
        visual.snapshot.classList.add('xd-prototype-exiting'); frame.current.append(visual.snapshot); cleanup = animatePrototypeExit(visual.snapshot, visual.link);
      } else {
        const overlay = visual?.kind === 'overlay', index = presented.route.overlays.length - 1;
        const surface = overlay ? overlayFrames.current.get(index) : frame.current, incoming = overlay ? overlayContents.current.get(index) : content.current;
        if (overlay && surface && visual?.snapshot && visual.position) { visual.snapshot.style.left = `${visual.position.x - Number.parseFloat(surface.style.left)}px`; visual.snapshot.style.top = `${visual.position.y - Number.parseFloat(surface.style.top)}px`; }
        const paintSources = [...(previous?.models.values() ?? []), ...presented.models.values()].map(nativeSourcesFor).filter((source): source is PrototypePaintSources => !!source);
        if (surface && incoming) cleanup = animatePrototype(surface, incoming, visual?.snapshot, visual?.link ?? instant, new NativePaintContext(paintSources));
        else visual?.snapshot?.remove();
      }
    } catch (error) { failed = true; visual?.snapshot?.remove(); setError(String(error)); }
    const step = pendingStep.current; pendingStep.current = undefined; motion.current = cleanup;
    if (cleanup && visual) dragState.current?.apply(cleanup);
    if (!failed && visual?.link.resetVideoPosition) {
      const index = presented.route.overlays.length - 1, overlay = presented.route.overlays[index];
      const key = overlay ? overlayModelKey(overlay, index) : presented.route.screen;
      mediaOwner(key).reset(visual.media?.get(key));
    }
    const complete = (success: boolean) => {
      if (!success && visual?.media && mounted.current && previousPresentation.current === presented) restoreMedia(visual.media);
      step?.(success);
    };
    if (cleanup && visual) void cleanup.finished.then(complete); else complete(!failed);
    if (!visual && previous?.route === presented.route && previous.revision === presented.revision && !pendingFocusId.current && document.activeElement && dialog.current?.contains(document.activeElement) && document.activeElement !== document.body) return cleanup;
    const focusId = pendingFocusId.current; pendingFocusId.current = undefined;
    const restore = pendingFocus.current?.isConnected ? pendingFocus.current : focusId ? [...(dialog.current?.querySelectorAll<HTMLElement>('[data-xdesign-layer]') ?? [])].find(node => node.getAttribute('data-xdesign-layer') === focusId) : undefined; pendingFocus.current = null;
    const top = overlayFrames.current.get(presented.route.overlays.length - 1);
    if (restore?.isConnected && !restore.closest('[inert],[hidden],:disabled')) { if (focusId && !restore.hasAttribute('tabindex')) restore.tabIndex = -1; restore.focus(); }
    else if (top) (top.querySelector<HTMLElement>('[data-xdesign-view]') ?? top).focus();
    else title.current?.focus();
    return cleanup;
  }, [presented]);
  const allowTrigger = (trigger?: DesignTrigger) => {
    if (!trigger || !['delay', 'media-hit', 'media-end'].includes(trigger.type)) { autoRoutes.current = []; return true; }
    const now = Date.now(); autoRoutes.current = [...autoRoutes.current.filter(time => now - time < 1000), now];
    if (autoRoutes.current.length > 20) { setAutomatic(false); setStatus('Automatic navigation paused: this flow loops too quickly.'); return false; }
    return true;
  };
  const navigate = (link: DesignNavigation, layerId?: string, trigger?: DesignTrigger, origin: DesignPoint = { x: 0, y: 0 }, inSequence = false): Promise<boolean> => {
    if (link.action === 'open-url') { const epoch = sequenceEpoch.current; return openDesignUrl(link, urlOpener).catch(error => { if (mounted.current && epoch === sequenceEpoch.current) setError(String(error)); return false; }); }
    if (link.action === 'media') { const current = route.current.value, epoch = sequenceEpoch.current; const key = current?.overlays.length ? overlayModelKey(current.overlays.at(-1)!,current.overlays.length-1) : current?.screen; return playDesignMedia(link,key ? mediaOwners.current.get(key) : undefined).catch(error => { if (mounted.current && epoch === sequenceEpoch.current) setError(String(error)); return false; }); }
    if (!inSequence) { discardHolds(); cancelSequence(true); }
    const current = route.current.value; if (!current || !route.current.ready && layerId) return Promise.resolve(false);
    try {
      if (link.action === 'scroll') { setError(''); setStatus('Scrolled to destination.'); return Promise.resolve(true); }
      const parentPosition = positions.at(-1) ?? { x: 0, y: 0 };
      const next = routePrototype(current, link, new Set(screens.map(screen => screen.id)), { x: origin.x + parentPosition.x, y: origin.y + parentPosition.y }, ['overlay', 'swap'].includes(link.action) ? `overlay-${++occurrence.current}` : undefined);
      if (JSON.stringify(next) === JSON.stringify(current) && !link.resetScroll && !link.preserveScroll && !link.resetInteractiveComponents && !link.resetVideoPosition) { const currentMotion = motion.current; if (currentMotion && 'resume' in currentMotion) currentMotion.resume(); if (!layerId) { setError(''); if (request !== current) setRequest(current); } return Promise.resolve(true); }
      const destination = next.overlays.at(-1)?.screen;
      if (destination) { const overlay = readPrototypeOverlay(editor.graph.getNode(destination)!); if (overlay.issue) throw new Error(overlay.issue); }
      if (!inSequence && !allowTrigger(trigger)) return Promise.resolve(false);
      current.overlays.forEach((overlay, index) => knownOverlayScopes.current.add(overlayScope(overlay, index)));
      const kind = link.action === 'close' ? 'close' : link.action === 'overlay' || link.action === 'swap' && current.overlays.length ? 'overlay' : 'screen';
      const old = kind === 'close' ? overlayFrames.current.get(current.overlays.length - 1)?.parentElement : kind === 'overlay' && link.action === 'swap' ? overlayFrames.current.get(current.overlays.length - 1) : kind === 'screen' ? frame.current : undefined;
      const snapshot = captureVisual(old); stageVisual({ media: captureMedia(), kind, link, snapshot, ...(kind === 'overlay' && old ? { position: { x: Number.parseFloat(old.style.left) || 0, y: Number.parseFloat(old.style.top) || 0 } } : {}), focusStack: [...returnFocus.current] }, old);
      if (link.action === 'overlay') returnFocus.current.push(document.activeElement as HTMLElement | null);
      else if (link.action === 'close') pendingFocus.current = returnFocus.current.pop() ?? null;
      else if (kind === 'screen') { returnFocus.current = []; pendingFocus.current = null; }
      route.current = { value: next, ready: false }; beginPreparation(); setLoading(true); setRequest(next); setStatus('');
      return new Promise(resolve => { pendingStep.current = resolve; });
    } catch (error) { const currentMotion = motion.current; if (currentMotion && 'resume' in currentMotion) currentMotion.resume(); setError(String(error)); return Promise.resolve(false); }
  };
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  const runSequence = (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint, temporary = false, dragging = false, beginMutation?: (media?: DesignMediaMutation) => void) => {
    const hasUrl = allDesignActions(link).some(action => ['open-url','media'].includes(action.action));
    if (hasUrl) sequenceEpoch.current++; else cancelSequence(true, dragging);
    if (!allowTrigger(trigger)) return false;
    let began = false;
    const beginAction = () => { if (!began) { began = true; beginMutation?.(); } if (!temporary && !['delay', 'media-hit', 'media-end'].includes(trigger.type)) discardHoldForLayer(layerId); };
    if (!hasUrl) beginAction();
    let mutated = !hasUrl;
    const epoch = sequenceEpoch.current; setSequenceRunning(true); setError('');
    const run = () => executeDesignActions(link, definitions, () => variableSession.current, async next => {
      if (hasUrl) { beginAction(); mutated = true; }
      const previous = variableSession.current; variableSession.current = next; cache.current.clear();
      route.current.ready = false; beginPreparation(); setLoading(true); setVariableRevision(value => value + 1);
      const completed = await new Promise<boolean>(resolve => { pendingStep.current = resolve; });
      if (!completed && epoch === sequenceEpoch.current) { variableSession.current = previous; cache.current.clear(); }
      return completed;
    }, async action => {
      if (action.action === 'open-url') return navigateRef.current(action, layerId, trigger, origin, true);
      if (action.action === 'media') { const current = route.current.value; const key = current?.overlays.length ? overlayModelKey(current.overlays.at(-1)!,current.overlays.length-1) : current?.screen; return playDesignMedia(action,key ? mediaOwners.current.get(key) : undefined,change => beginMutation?.(change)); }
      if (hasUrl) { beginAction(); mutated = true; }
      if (!temporary && ['navigate', 'back', 'overlay', 'close', 'swap'].includes(action.action)) discardHolds();
      if (action.action === 'scroll') {
        const current = route.current.value, container = current?.overlays.length ? overlayFrames.current.get(current.overlays.length - 1) : content.current;
        const view = container?.querySelector<HTMLElement>('[data-xdesign-view]'); if (!view) throw new Error('The scrolling screen is not ready.');
        const job = designScrollTo(view, action, !!dragState.current); motion.current = job; dragState.current?.apply(job); return job.finished;
      }
      return navigateRef.current(action, layerId, trigger, origin, true);
    }, () => mounted.current && epoch === sequenceEpoch.current && !document.hidden);
    return run().catch(error => { if (mounted.current && epoch === sequenceEpoch.current) { if (dragState.current) dragState.current.error = String(error); setError(String(error)); } return false; }).finally(() => { if (mounted.current && epoch === sequenceEpoch.current) { setSequenceRunning(false); if (mutated) motion.current = undefined; } });
  };
  const drag = (link: DesignNavigation, layerId: string, origin: DesignPoint): DesignDragJob | undefined => {
    if (!route.current.value || !route.current.ready || !presented) return;
    const deferred = allDesignActions(link).some(action => ['open-url','media'].includes(action.action));
    const mediaChanges = new Map<DesignMediaState,DesignMediaSnapshot>();
    let started = !deferred;
    const previousDrag = dragState.current, ownEpoch = sequenceEpoch.current + 1;
    if (started) { previousDrag?.discard(); discardHolds(); }
    const current = route.current.value, surface = current.overlays.length ? overlayFrames.current.get(current.overlays.length - 1) : frame.current;
    const key = surface ? captureSmartLayers(surface).find(state => state.element.getAttribute('data-xdesign-layer') === layerId)?.key : undefined;
    const extent = { x: surface?.clientWidth || Number.parseFloat(surface?.style.width ?? '') || 320, y: surface?.clientHeight || Number.parseFloat(surface?.style.height ?? '') || 480 };
    const saved = { media: captureMedia(), route: structuredClone(current), prepared: presented, positions: { ...scrollPositions.current }, history: new Map([...scrollHistory.current].map(([id, entries]) => [id, structuredClone(entries)])), session: structuredClone(variableSession.current), controls: controlCheckpoint(presented, controlSession.current, layerId), values: structuredClone(values), focus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined, focusStack: [...returnFocus.current] };
    let ended = false, done = false, released = false, target: 0 | 1 | undefined, sample: DesignDragSample = { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }, fallback: DesignPoint | undefined, applying: PrototypeMotion | DesignScrollJob | undefined, finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const close = (prune = true) => { if (ended) return; ended = true; if (dragState.current === state) dragState.current = undefined; if (started && mounted.current) setDragRunning(false); finish(); if (started && prune) pruneOverlayScopes(); };
    const restore = () => {
      if (!started) { if (!ended) { if (sequenceEpoch.current === ownEpoch) { sequenceEpoch.current++; if (mounted.current) setSequenceRunning(false); } for (const [owner,snapshot] of mediaChanges) owner.restoreTransport(snapshot); close(false); } return; }
      if (ended) return; close(false); cancelSequence(); clearPendingVisual(); pendingRestore.current = undefined;
      preparationPlayback.current = undefined; mediaRestore.current = saved.media; variableSession.current = saved.session; controlSession.current = saved.controls; scrollPositions.current = { ...saved.positions }; scrollHistory.current = new Map([...saved.history].map(([id, entries]) => [id, structuredClone(entries)])); returnFocus.current = [...saved.focusStack]; pendingFocus.current = saved.focus ?? null; pendingFocusId.current = saved.focus?.closest('[data-xdesign-layer]')?.getAttribute('data-xdesign-layer') ?? undefined;
      cache.current.clear();
      route.current = { value: saved.route, ready: true }; pruneOverlayScopes(saved.route, false); setRequest(saved.route); setPresented({ ...saved.prepared, route: saved.route, scrollRevision: ++scrollRevision.current }); setValues(saved.values); setVariableRevision(value => value + 1); setLoading(false); setStatus('Drag returned to its starting state.');
    };
    const metrics = (job?: PrototypeMotion | DesignScrollJob) => {
      const movement = job && 'movement' in job ? job.movement?.(key) : undefined;
      if (!fallback && (sample.offset.x || sample.offset.y)) fallback = Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x) * extent.x, y: 0 } : { x: 0, y: Math.sign(sample.offset.y) * extent.y };
      const vector = movement && Math.hypot(movement.x, movement.y) >= 1 ? movement : fallback ?? { x: extent.x, y: 0 }, length = vector.x ** 2 + vector.y ** 2;
      return { progress: Math.max(0, Math.min(1, (sample.offset.x * vector.x + sample.offset.y * vector.y) / length)), velocity: (sample.velocity.x * vector.x + sample.velocity.y * vector.y) / length };
    };
    const apply = (job: PrototypeMotion | DesignScrollJob) => {
      if (ended || typeof job.scrub !== 'function') return;
      try {
        const point = metrics(job); if (applying !== job) { applying = job; job.scrub(released && target === 1 ? 0 : point.progress); } else if (!released) job.scrub(point.progress);
        if (!released || target !== undefined && applying === job && state.settling === job) return;
        target ??= point.progress + point.velocity * 0.15 >= 0.5 ? 1 : 0; state.settling = job;
        void job.settle?.(target, point.velocity).then(completed => { if (ended) return; if (!completed || target === 0) restore(); else if (done) close(); }).catch(reason => { if (!ended) { restore(); setStatus(`Drag canceled: ${String(reason)}`); } });
      } catch (reason) { restore(); setStatus(`Drag canceled: ${String(reason)}`); }
    };
    const state: DragState = { route: saved.route, prepared: saved.prepared, apply, restore, discard: close };
    const begin = () => { if (started || ended) return; previousDrag?.discard(); discardHolds(); started = true; dragState.current = state; setDragRunning(true); };
    if (started) { dragState.current = state; setDragRunning(true); }
    const update = (next: DesignDragSample) => { if (ended || released) return; sample = next; const job = motion.current; if (job && job === applying) apply(job); };
    const release = (next: DesignDragSample) => {
      if (ended || released) return; sample = next; released = true;
      const job = motion.current; if (job && job === applying) apply(job);
      else if (done) { const point = metrics(); target = point.progress + point.velocity * 0.15 >= 0.5 ? 1 : 0; if (target) close(); else restore(); }
    };
    void Promise.resolve(runSequence(link, layerId, { type: 'drag' }, origin, false, true, change => { if (change) rememberDesignMedia(mediaChanges,change); else begin(); })).then(completed => {
      if (ended) return; done = true;
      if (!started) { if (!completed) restore(); else close(false); return; }
      if (!completed) { const reason = state.error; restore(); if (reason) setStatus(`Drag canceled: ${reason}`); } else if (released) { if (target === undefined) { const point = metrics(); target = point.progress + point.velocity * 0.15 >= 0.5 ? 1 : 0; } if (target) close(); else restore(); }
    });
    return Object.assign(restore, { finished, update, release });
  };
  const reversible = (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint): DesignReversibleJob | undefined => {
    if (!route.current.value || !route.current.ready || !presented) return;
    if (holds.current.length >= 8) { setError('Use at most eight simultaneous temporary interactions.'); return; }
    const mediaChanges = new Map<DesignMediaState,DesignMediaSnapshot>();
    let ended = false, started = !allDesignActions(link).some(action => ['open-url','media'].includes(action.action)), settle!: () => void; const finished = new Promise<void>(resolve => { settle = resolve; });
    const ownEpoch = sequenceEpoch.current + 1;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const held: Held = { media: captureMedia(), sourceLayerId: layerId, sourceRouteKey: routeOccurrenceKey(route.current.value), route: structuredClone(route.current.value), positions: { ...scrollPositions.current }, history: new Map([...scrollHistory.current].map(([id, entries]) => [id, structuredClone(entries)])), prepared: presented, controls: controlCheckpoint(presented, controlSession.current, layerId), session: structuredClone(variableSession.current), values: structuredClone(values), focusStack: [...returnFocus.current], focus: focused, focusId: focused?.closest('[data-xdesign-layer]')?.getAttribute('data-xdesign-layer') ?? undefined, close: restore => {
      if (ended) return; ended = true; const index = holds.current.indexOf(held);
      if (index >= 0) { const descendants = holds.current.splice(index); descendants.filter(entry => entry !== held).forEach(entry => entry.close(false)); }
      settle(); if (!started) { if (sequenceEpoch.current === ownEpoch) { sequenceEpoch.current++; if (mounted.current) setSequenceRunning(false); } if (restore) for (const [owner,snapshot] of mediaChanges) owner.restoreTransport(snapshot); return; } if (!restore || !mounted.current) { pruneOverlayScopes(); return; }
      cancelSequence(true);
      preparationPlayback.current = undefined; mediaRestore.current = held.media; controlSession.current = held.controls; variableSession.current = held.session; setValues(held.values); cache.current.clear();
      const current = route.current.value; scrollPositions.current = { ...held.positions }; scrollHistory.current = new Map([...held.history].map(([id, entries]) => [id, structuredClone(entries)])); returnFocus.current = [...held.focusStack]; pendingFocus.current = held.focus ?? null; pendingFocusId.current = held.focusId;
      const reverse = { ...link, resetInteractiveComponents: undefined, resetVideoPosition: undefined, transition: link.action === 'sequence' || link.action === 'conditional' ? 'instant' as const : link.transition === 'move-in' ? 'move-out' as const : link.transition === 'move-out' ? 'move-in' as const : link.transition === 'slide' ? 'slide-out' as const : link.transition === 'slide-out' ? 'slide' as const : link.transition, duration: link.duration, ...(link.direction || link.transition === 'push' ? { direction: link.transition === 'push' ? ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const)[link.direction ?? 'right'] : link.direction } : {}) };
      const sameBase = current?.screen === held.route.screen;
      const kind = sameBase && (current?.overlays.length ?? 0) > held.route.overlays.length ? 'close' : sameBase && held.route.overlays.length ? 'overlay' : 'screen';
      const old = kind === 'close' ? overlayFrames.current.get((current?.overlays.length ?? 1) - 1)?.parentElement : kind === 'overlay' ? overlayFrames.current.get((current?.overlays.length ?? 1) - 1) : frame.current;
      const snapshot = captureVisual(old); stageVisual({ media: captureMedia(), kind, link: reverse, snapshot, ...(kind === 'overlay' && old ? { position: { x: Number.parseFloat(old.style.left) || 0, y: Number.parseFloat(old.style.top) || 0 } } : {}), focusStack: [...returnFocus.current] }, old);
      pendingRestore.current = held; route.current = { value: held.route, ready: false }; pruneOverlayScopes(held.route, false); setRequest(held.route); setVariableRevision(value => value + 1); beginPreparation(); setLoading(true); setStatus('Temporary navigation restored.');
    } };
    holds.current.push(held); void runSequence(link, layerId, trigger, origin, true, false, change => { if (change) rememberDesignMedia(mediaChanges,change); else started = true; });
    return Object.assign(() => held.close(true), { finished });
  };
  const activeRoute = route.current.value ?? request, topName = activeRoute?.overlays.at(-1)?.screen ?? activeRoute?.screen;
  const updateControl = (key: string, snapshot: DesignControlSnapshot) => {
    if (!mounted.current || !route.current.ready) return;
    const previous = controlSession.current[key];
    if (previous?.state === snapshot.state && JSON.stringify(previous.value) === JSON.stringify(snapshot.value)) return;
    controlSession.current = { ...controlSession.current, [key]: structuredClone(snapshot) }; cache.current.clear(); setControlRevision(value => value + 1);
  };
  const viewProps = { onOpenUrl: urlOpener, automatic: automatic && !sequenceRunning && !dragRunning, values, controlSession: controlSession.current, onControlState: updateControl, onSequence: runSequence, onReversible: reversible, onDrag: drag, onSequenceCancel: (reason?: 'pointer' | 'activate' | 'scroll' | 'cancel' | 'url' | 'media') => { if (reason === 'url' || reason === 'media') { sequenceEpoch.current++; setSequenceRunning(false); } else cancelSequence(reason === 'pointer' || reason === 'activate'); }, scrollPositions: scrollPositions.current, scrollRevision: presented?.scrollRevision, onScrollPositionChange: (id: string, point: DesignPoint) => { scrollPositions.current[id] = point; }, onPrototypeError: setError, onValueChange: (id: string, value: DesignValue) => setValues(previous => ({ ...previous, [id]: value })), onAction: (id: string) => setStatus(`Activated ${id}`), onNavigate: navigate };
  return <div className="xd-project-dialog-scrim"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Page presentation" className="xd-project-dialog xd-prototype-preview">
    <header><h2 ref={title} tabIndex={-1}>{screens.find(candidate => candidate.id === topName)?.name ?? 'Present'}</h2><div><button disabled={!activeRoute?.history.length || loading} onClick={() => navigate({ ...instant, action: 'back' })}>Back</button>{!!activeRoute?.overlays.length && <button disabled={loading} onClick={() => navigate({ ...instant, action: 'close' })}>Close overlay</button>}{sequenceRunning && <button onClick={() => { cancelSequence(); setStatus('Action sequence stopped.'); }}>Stop actions</button>}<button onClick={() => { discardHolds(); pendingRestore.current = undefined; pendingFocusId.current = undefined; cancelSequence(); clearPendingVisual(); pendingFocus.current = null; returnFocus.current = []; autoRoutes.current = []; route.current = { value: initialRoute, ready: false }; setRequest(initialRoute); scrollPositions.current = {}; scrollHistory.current.clear(); variableSession.current = emptyPrototypeSession(); controlSession.current = {}; cache.current.clear(); setValues({}); setAutomatic(true); setRevision(value => value + 1); setStatus(''); }}>Restart</button><button aria-pressed={!automatic} onClick={() => { setAutomatic(value => !value); autoRoutes.current = []; setStatus(automatic ? 'Automatic navigation paused.' : 'Automatic navigation resumed.'); }}>{automatic ? 'Pause timers' : 'Resume timers'}</button><button onClick={dispose}>Close presentation</button></div></header>
    <label className="xd-prototype-screen-picker">Screen<select aria-label="Presented screen" value={activeRoute?.screen ?? ''} onChange={event => navigate({ ...instant, target: event.target.value })}>{screens.map(screen => <option key={screen.id} value={screen.id}>{screen.name}</option>)}</select><span>{model ? `${Math.round(scale * 100)}%` : ''}</span></label>
    <div ref={stage} className="xd-prototype-stage" aria-busy={loading}>{model && presented && <div ref={frame} className="xd-prototype-screen" data-transition={pendingVisual.current?.link.transition ?? 'instant'} style={{ width: model.width * scale, height: model.height * scale }}>
      <div ref={content} className="xd-prototype-content" inert={loading || !!presented.route.overlays.length || dragRunning} aria-hidden={!!presented.route.overlays.length || undefined}><div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}><DesignView key={`${presented.route.screen}/${presented.revision}`} disabled={loading || !!presented.route.overlays.length} nodes={model.nodes} width={model.width} height={model.height} {...viewProps} mediaState={mediaOwner(presented.route.screen)} /></div></div>
      {presented.route.overlays.map((overlay, index) => {
        const next = presented.models.get(overlayModelKey(overlay, index))!, settings = readPrototypeOverlay(editor.graph.getNode(overlay.screen)!).settings, inactive = loading || index !== presented.route.overlays.length - 1;
        return <div key={overlay.instanceId ?? `${overlay.screen}:${index}`} className="xd-prototype-overlay" inert={inactive || dragRunning} aria-hidden={inactive || undefined} style={{ zIndex: index + 2, background: settings.background ? `rgba(${settings.background.r * 255},${settings.background.g * 255},${settings.background.b * 255},${settings.background.a})` : undefined }} onClick={event => { if (event.target === event.currentTarget && settings.closeOutside && !inactive) navigate({ ...instant, action: 'close' }); }}>
          <div ref={node => { if (node) overlayFrames.current.set(index, node); else overlayFrames.current.delete(index); }} className="xd-prototype-overlay-frame" role="dialog" aria-modal={inactive ? undefined : true} aria-label={screens.find(screen => screen.id === overlay.screen)?.name ?? 'Overlay'} style={{ left: positions[index]!.x * scale, top: positions[index]!.y * scale, width: next.width * scale, height: next.height * scale }}>
            <div ref={node => { if (node) overlayContents.current.set(index, node); else overlayContents.current.delete(index); }} className="xd-prototype-content"><div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}><DesignView key={`${overlay.instanceId ?? `${overlay.screen}:${index}`}/${presented.revision}`} disabled={inactive} nodes={next.nodes} width={next.width} height={next.height} {...viewProps} mediaState={mediaOwner(overlayModelKey(overlay, index))} /></div></div>
          </div>
        </div>;
      })}
    </div>}{loading && <p role="status">Preparing screen…</p>}</div>
    {error && <p role="alert">{error}</p>}<footer aria-live="polite">{status || 'Interact with this screen or choose a screen. Focus the screen to use its shortcuts. Escape closes the top overlay, then presentation.'}</footer>
    {!!presented && [...presented.models.values()].some(model => model.prototypeIssues.length) && <details><summary>Prototype interactions that cannot play</summary><ul>{[...new Set([...presented.models.values()].flatMap(model => model.prototypeIssues))].map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
  </div></div>;
}
