import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DesignView, allDesignActions, openDesignUrl, playDesignMedia, rememberDesignMedia, createDesignMediaState, type DesignMediaMutation, type DesignMediaState, type DesignMediaSnapshot, designScrollTo, executeDesignActions, transferDesignScroll, type DesignControlSession, type DesignDragSample, type DesignNavigation, type DesignPoint, type DesignProps, type DesignReversibleJob, type DesignScrollJob, type DesignTrigger, type DesignValue } from './reactExportRuntime';
import { emptyPrototypeSession, type PrototypeSession } from './prototypeValues';
import { NativeReactWorkerClient } from './nativeReactClient';
import type { NativeReactModel, NativeReactMotionEndpoint, NativeReactMotionInfo } from './nativeReactProtocol';
import { routePrototype, type PrototypeRoute } from './prototypeRouteRuntime';
import { animateNativeReactExit, animateNativeReactView, snapshotNativeReactView } from './nativeReactTransition';
import { createNativeReactMotionPlayback, type NativeReactMotionPlayback } from './nativeReactMotionPlayback';

export type NativeReactAssets = { worker: string; wasm: string; graph: string; ids: string[]; rootId?: string; fonts: { registrations: { bytes: string }[] } };
export type NativeReactProps = DesignProps & { width?: number; height?: number; responsive?: boolean };
type Prepared = { route: PrototypeRoute; models: Map<string, NativeReactModel>; serial: number; generation?: number; rootSizes?: Record<string, { width?: number; height?: number }> };
type FocusTarget = { element: HTMLElement | null; layerId?: string; sourceId?: string };
type ScrollHistory = Map<string, Record<string, DesignPoint>>;
type HostTransition = { snapshot: HTMLElement; link: DesignNavigation; previous: Prepared; session: PrototypeSession; controls: DesignControlSession; scroll: Record<string, DesignPoint>; scrollHistory: ScrollHistory; route: PrototypeRoute; focusStack: FocusTarget[]; generation: number; incomingKey: string; exit: boolean; media: MediaCheckpoint };
type MediaCheckpoint = Map<string, DesignMediaSnapshot>;
type HeldState = { media: MediaCheckpoint; route: PrototypeRoute; prepared: Prepared; session: PrototypeSession; controls: DesignControlSession; scroll: Record<string, DesignPoint>; scrollHistory: ScrollHistory; values: Record<string, DesignValue>; focus: FocusTarget | null; focusStack: FocusTarget[] };
type Held = HeldState & { sourceLayerId: string; sourceRouteKey: string; close: (restore: boolean) => void; finished: Promise<void> };
type NativeMotionPending = { generation: number; playback: NativeReactMotionPlayback; info: NativeReactMotionInfo; sessionId: number; drag: boolean; previous: HeldState; target: Prepared };
type NativeDragState = { saved: HeldState; layerId: string; link: DesignNavigation; sample: DesignDragSample; released: boolean; ended: boolean; playback?: NativeReactMotionPlayback; scrollJob?: DesignScrollJob; info?: NativeReactMotionInfo; pending?: NativeMotionPending; finish: () => void; finished: Promise<void>; update: (sample: DesignDragSample) => void; release: (sample: DesignDragSample) => void; cancel: (notifyOwner?: boolean) => void };

const nativeReactBytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
const instant = { transition: 'instant' as const, duration: 0 };
const isAutomatic = (trigger?: DesignTrigger) => !!trigger && ['delay', 'media-hit', 'media-end'].includes(trigger.type);
const overlayScope = (overlay: PrototypeRoute['overlays'][number], index: number) => overlay.instanceId ?? `legacy:${index}:${overlay.screen}`;
const overlayModelKey = (overlay: PrototypeRoute['overlays'][number], index: number) => JSON.stringify(['overlay', overlayScope(overlay, index), overlay.screen]);
const routeOccurrenceKey = (route: PrototypeRoute) => JSON.stringify([route.screen, route.history, route.overlays.map((overlay, index) => [overlayScope(overlay, index), overlay.screen])]);
const routeEqual = (a: PrototypeRoute, b: PrototypeRoute) => routeOccurrenceKey(a) === routeOccurrenceKey(b);
const activeRouteKey = (route: PrototypeRoute) => route.overlays.length ? overlayModelKey(route.overlays.at(-1)!, route.overlays.length - 1) : route.screen;

function sameRecord<T>(a: Record<string, T>, b: Record<string, T>, equal: (left: T, right: T) => boolean) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key]!, b[key]!));
}
function sameSession(a: PrototypeSession, b: PrototypeSession) {
  return sameRecord(a.modes, b.modes, (left, right) => left === right) && sameRecord(a.values, b.values, (left, right) => left === right || typeof left === 'object' && typeof right === 'object' && ['r', 'g', 'b', 'a'].every(key => left[key as keyof typeof left] === right[key as keyof typeof right]));
}
function sameControls(a: DesignControlSession, b: DesignControlSession) {
  return sameRecord(a, b, (left, right) => left.state === right.state && (left.value === right.value || Array.isArray(left.value) && Array.isArray(right.value) && left.value.length === right.value.length && left.value.every((value, index) => value === (right.value as number[])[index])));
}

function rootControlKey(screen: string, scope?: string) { return scope ? JSON.stringify(['overlay', scope, screen]) : screen; }
function overlayScopeInRoot(root: string) {
  try { const parts = JSON.parse(root) as unknown[]; return parts[0] === 'overlay' && typeof parts[1] === 'string' ? parts[1] : undefined; } catch { return; }
}
function scopeInControlKey(key: string) {
  try { const root = JSON.parse(key)[0]; return typeof root === 'string' ? overlayScopeInRoot(root) : undefined; } catch { return; }
}
function scopeInLayerId(id: string) { return overlayScopeInRoot(id.split('/')[0]!); }
function overlayAuthoredLayerId(id: string, scope: string) {
  const slash = id.indexOf('/'), rootText = slash < 0 ? id : id.slice(0, slash);
  try {
    const root = JSON.parse(rootText) as unknown[];
    if (root[0] !== 'overlay' || root[1] !== scope || typeof root[2] !== 'string') return;
    return { screen: root[2], layerId: `${root[2]}${slash < 0 ? '' : id.slice(slash)}` };
  } catch { return; }
}
function cloneScrollHistory(history: ScrollHistory): ScrollHistory { return new Map([...history].map(([screen, entries]) => [screen, structuredClone(entries)])); }
function resetControlsForRoot(controls: DesignControlSession, root: string) {
  return Object.fromEntries(Object.entries(controls).filter(([key]) => {
    try { return JSON.parse(key)[0] !== root; } catch { return key !== root; }
  }));
}
function modelBytes(model: NativeReactModel) { return model.byteLength ?? JSON.stringify(model).length * 2; }
function overlayPosition(settings: NonNullable<NativeReactModel['nodes'][number]['overlay']>, viewport: { width: number; height: number }, size: { width: number; height: number }, origin: DesignPoint, offset: DesignPoint): DesignPoint {
  if (settings.position === 'manual') return { x: origin.x + offset.x, y: origin.y + offset.y };
  return { x: settings.position.endsWith('left') ? 0 : settings.position.endsWith('right') ? viewport.width - size.width : (viewport.width - size.width) / 2, y: settings.position.startsWith('top') ? 0 : settings.position.startsWith('bottom') ? viewport.height - size.height : (viewport.height - size.height) / 2 };
}
function countModelBytes(models: Iterable<NativeReactModel>) { return [...new Set(models)].reduce((total, model) => total + modelBytes(model), 0); }
function defaultControlSnapshot(control: NonNullable<NativeReactModel['nodes'][number]['control']>): import('./reactExportRuntime').DesignControlSnapshot {
  const group = ['radioGroup', 'toggleGroup', 'accordion', 'tabs'].includes(control.kind), multiple = ['toggleGroup', 'accordion'].includes(control.kind);
  const findPart = (node: NativeReactModel['nodes'][number], part: string): NativeReactModel['nodes'][number] | undefined => node.part === part ? node : node.children.map(child => findPart(child, part)).find(Boolean);
  const items = findPart(control.variants[0]!.tree, control.kind === 'tabs' ? 'list' : 'items')?.children ?? [];
  const first = items.findIndex(item => item.visible && item.control?.defaults.disabled !== true), valueId = control.kind === 'collapsible' ? 'open' : 'value';
  const value = group ? (multiple || first < 0 ? [] : [first]) : control.defaults[valueId] ?? (valueId === 'open' ? false : '');
  return { value, state: control.defaults.disabled === true ? 'disabled' : 'rest' };
}

export function createNativeReactClient(assets: NativeReactAssets) {
  const url = URL.createObjectURL(new Blob([assets.worker], { type: 'text/javascript' }));
  try {
    return new NativeReactWorkerClient(new Worker(url), { graph: assets.graph, ids: assets.ids, wasm: nativeReactBytes(assets.wasm), fonts: {
      ...assets.fonts, registrations: assets.fonts.registrations.map(registration => ({ ...registration, bytes: nativeReactBytes(registration.bytes).buffer })),
    } }, () => URL.revokeObjectURL(url));
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function NativeDesignView({ assets, initialModel, width, height, responsive = false, ...props }: NativeReactProps & { assets: NativeReactAssets; initialModel: NativeReactModel }) {
  const start = assets.rootId ?? assets.ids[0]!;
  const sourceIdentity = useRef({ graph: assets.graph, revision: 0 });
  if (sourceIdentity.current.graph !== assets.graph) sourceIdentity.current = { graph: assets.graph, revision: sourceIdentity.current.revision + 1 };
  const startRoute = useRef<PrototypeRoute>({ screen: start, history: [], overlays: [] }).current;
  const initialPrepared = useRef<Prepared>({ route: startRoute, models: new Map([[start, initialModel]]), serial: 0, generation: 0, rootSizes: {} }).current;
  const [prepared, setPrepared] = useState(initialPrepared), [busy, setBusy] = useState(false), [error, setError] = useState(''), [measuredWidth, setMeasuredWidth] = useState<number>(), [automaticPaused, setAutomaticPaused] = useState(false);
  const [sessionState, setSessionState] = useState<PrototypeSession>(() => props.prototypeSession ?? emptyPrototypeSession());
  const [controlsState, setControlsState] = useState<DesignControlSession>(() => props.controlSession ?? {});
  const [values, setValues] = useState<Record<string, DesignValue>>({}), [scrollRevision, setScrollRevision] = useState(0), [nativeFrame, setNativeFrame] = useState<{ model: NativeReactModel; generation: number } | null>(null);
  const host = useRef<HTMLDivElement>(null), client = useRef<NativeReactWorkerClient | undefined>(undefined), generation = useRef(0), serial = useRef(0), occurrence = useRef(0), sequenceEpoch = useRef(0), mounted = useRef(false);
  const routeRef = useRef(startRoute), preparedRef = useRef(initialPrepared), sessionRef = useRef(props.prototypeSession ?? sessionState), controlsRef = useRef(props.controlSession ?? controlsState), scrollRef = useRef<Record<string, DesignPoint>>({});
  const scrollHistory = useRef<ScrollHistory>(new Map());
  const preparationPlayback = useRef<MediaCheckpoint | undefined>(undefined);
  const mediaOwners = useRef(new Map<string, DesignMediaState>()), mediaRestore = useRef<MediaCheckpoint | undefined>(undefined), mediaReset = useRef<{ generation: number; key: string; playback?: DesignMediaSnapshot } | undefined>(undefined);
  const mediaOwner = (key: string) => { let owner = mediaOwners.current.get(key); if (!owner) { owner = createDesignMediaState(); mediaOwners.current.set(key, owner); } return owner; };
  const captureMedia = (): MediaCheckpoint => new Map([...mediaOwners.current].map(([key, owner]) => [key, owner.capture()]));
  const restoreMedia = (checkpoint: MediaCheckpoint) => { for (const [key, snapshot] of checkpoint) mediaOwner(key).restore(snapshot); };

  const latest = useRef(props); latest.current = props;
  const focusStack = useRef<FocusTarget[]>([]), pendingFocus = useRef<FocusTarget | null | undefined>(undefined), pendingTransition = useRef<HostTransition | undefined>(undefined), motion = useRef<{ dispose: () => void; finished: Promise<boolean> } | undefined>(undefined), publication = useRef<{ generation: number; resolve: (published: boolean) => void } | undefined>(undefined);
  const deferredNativeFocus = useRef(false);
  const layoutRoute = useRef('');
  const holds = useRef<Held[]>([]), sequenceMotion = useRef<(() => void) | undefined>(undefined), autoRoutes = useRef<number[]>([]), sizeEffectMounted = useRef(false);
  const pendingNativeMotion = useRef<NativeMotionPending | undefined>(undefined), activeNativeMotion = useRef<NativeMotionPending | undefined>(undefined), dragState = useRef<NativeDragState | undefined>(undefined), motionSequence = useRef(0);
  const pendingOwnerSession = useRef<{ generation: number; session: PrototypeSession; echoed: boolean } | undefined>(undefined);
  const controlDefaults = useRef(new Map<string, import('./reactExportRuntime').DesignControlSnapshot>());
  const screenSet = useRef(new Set(assets.ids));
  screenSet.current = new Set(assets.ids);
  const knownOverlayScopes = useRef(new Set<string>());
  const currentModelFor = (route: PrototypeRoute, models = preparedRef.current.models) => models.get(route.overlays.length ? overlayModelKey(route.overlays.at(-1)!, route.overlays.length - 1) : route.screen);
  const requestedWidth = width ?? (responsive ? measuredWidth : undefined);
  const controlledChanged = (incoming: NativeReactProps) => {
    const expected = pendingOwnerSession.current;
    let sessionChanged = incoming.prototypeSession !== undefined && !sameSession(incoming.prototypeSession, sessionRef.current);
    if (incoming.prototypeSession && expected?.generation === generation.current) {
      const echo = sameSession(incoming.prototypeSession, expected.session);
      if (echo) expected.echoed = true;
      sessionChanged = echo ? false : expected.echoed || sessionChanged;
    }
    return sessionChanged || incoming.controlSession !== undefined && !sameControls(incoming.controlSession, controlsRef.current);
  };

  const discardHolds = () => { const entries = holds.current.splice(0); entries.forEach(held => held.close(false)); pruneOverlayScopes(routeRef.current); };
  const discardHoldForSource = (layerId: string, route: PrototypeRoute) => { [...holds.current].filter(held => held.sourceLayerId === layerId && held.sourceRouteKey === routeOccurrenceKey(route)).forEach(held => held.close(false)); pruneOverlayScopes(routeRef.current); };
  const activeRootSize = (rootId: string) => requestedWidth !== undefined || height !== undefined ? { [rootId]: { width: requestedWidth, height } } : undefined;
  const motionEndpoint = (route: PrototypeRoute, session: PrototypeSession, controls: DesignControlSession, scroll: Record<string, DesignPoint>, rootSizes?: Record<string, { width?: number; height?: number }>): NativeReactMotionEndpoint => ({
    rootId: route.screen, session, controls, ...(rootSizes && Object.keys(rootSizes).length ? { rootSizes } : {}), scrollPositions: scroll,
    overlays: route.overlays.map((overlay, index) => ({ rootId: overlay.screen, controlScope: overlayScope(overlay, index), origin: overlay.origin, offset: overlay.offset })),
  });
  const pruneOverlayScopes = (route: PrototypeRoute, previous?: PrototypeRoute, remember = true) => {
    const keep = new Set([
      ...route.overlays.map(overlayScope),
      ...holds.current.flatMap(held => held.route.overlays.map(overlayScope)),
      ...(previous?.overlays.map(overlayScope) ?? []),
    ]);
    const discard = [...knownOverlayScopes.current].filter(scope => !keep.has(scope));
    if (!discard.length) return;
    const stale = (scope?: string) => !!scope && discard.includes(scope);
    for (const [key, snapshot] of Object.entries(controlsRef.current)) if (stale(scopeInControlKey(key))) {
      const fallback = controlDefaults.current.get(key);
      if (fallback && JSON.stringify(snapshot) !== JSON.stringify(fallback)) try { latest.current.onControlState?.(key, structuredClone(fallback)); } catch (failure) { latest.current.onPrototypeError?.(String(failure)); }
    }
    for (const [id, point] of Object.entries(scrollRef.current)) if (stale(scopeInLayerId(id))) {
      if (remember) for (const scope of discard) {
        const authored = overlayAuthoredLayerId(id, scope); if (!authored) continue;
        const saved = scrollHistory.current.get(authored.screen) ?? {};
        saved[authored.layerId] = { ...point }; scrollHistory.current.set(authored.screen, saved);
      }
    }
    controlsRef.current = Object.fromEntries(Object.entries(controlsRef.current).filter(([key]) => !stale(scopeInControlKey(key))));
    scrollRef.current = Object.fromEntries(Object.entries(scrollRef.current).filter(([id]) => !stale(scopeInLayerId(id))));
    if (mounted.current) setValues(previousValues => Object.fromEntries(Object.entries(previousValues).filter(([id]) => !stale(scopeInLayerId(id)))));
    for (const key of controlDefaults.current.keys()) if (stale(scopeInControlKey(key))) controlDefaults.current.delete(key);
    for (const key of mediaOwners.current.keys()) if (stale(overlayScopeInRoot(key))) mediaOwners.current.delete(key);
    for (const scope of discard) knownOverlayScopes.current.delete(scope);
  };

  const restoreNativeMotion = (pending: NativeMotionPending, saved: HeldState = pending.previous, notifyOwner = true) => {
    if (!mounted.current || pending.generation !== generation.current) return;
    const currentSession = sessionRef.current, currentControls = controlsRef.current;
    const defaults = new Map(controlDefaults.current);
    generation.current++; client.current?.cancelMotion(pending.sessionId); pending.playback.dispose();
    if (motion.current === pending.playback) motion.current = undefined;
    if (pendingNativeMotion.current === pending) pendingNativeMotion.current = undefined;
    if (activeNativeMotion.current === pending) activeNativeMotion.current = undefined;
    setNativeFrame(null);
    preparationPlayback.current = undefined; mediaRestore.current = saved.media; mediaReset.current = undefined;
    routeRef.current = saved.route; preparedRef.current = saved.prepared;
    sessionRef.current = saved.session; controlsRef.current = saved.controls;
    scrollRef.current = { ...saved.scroll }; scrollHistory.current = cloneScrollHistory(saved.scrollHistory); focusStack.current = [...saved.focusStack]; pendingFocus.current = saved.focus;
    pruneOverlayScopes(saved.route, undefined, false);
    setPrepared({ ...saved.prepared, serial: ++serial.current }); setSessionState(saved.session); setControlsState(saved.controls);
    setValues(saved.values); setScrollRevision(value => value + 1); setBusy(false);
    if (notifyOwner && JSON.stringify(currentSession) !== JSON.stringify(saved.session) && latest.current.onPrototypeSessionChange) {
      try { void Promise.resolve(latest.current.onPrototypeSessionChange(structuredClone(saved.session))).then(result => { if (result === false) throw new Error('The prototype owner rejected restoring native motion variables.'); }).catch(failure => { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }); }
      catch (failure) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }
    }
    if (notifyOwner && latest.current.onControlState) for (const key of new Set([...Object.keys(currentControls), ...Object.keys(saved.controls)])) {
      const snapshot = saved.controls[key] ?? defaults.get(key);
      if (snapshot && JSON.stringify(currentControls[key]) !== JSON.stringify(snapshot)) try { latest.current.onControlState(key, structuredClone(snapshot)); } catch (failure) { latest.current.onPrototypeError?.(String(failure)); }
    }
    if (publication.current?.generation === pending.generation) { publication.current.resolve(false); publication.current = undefined; }
  };

  const resumePreparationPlayback = () => {
    const checkpoint = preparationPlayback.current; preparationPlayback.current = undefined;
    if (checkpoint) for (const [key, snapshot] of checkpoint) mediaOwner(key).restorePlayback(snapshot);
  };

  const prepareRoute = async (target: PrototypeRoute, nextSession: PrototypeSession, nextControls: DesignControlSession, link?: DesignNavigation, options: { temporary?: boolean; focusStack?: FocusTarget[]; focus?: FocusTarget | null; accept?: () => Promise<boolean>; nativeMotion?: boolean; drag?: boolean } = {}) => {
    const epoch = ++generation.current, previous = preparedRef.current, previousRoute = routeRef.current;
    const ownerSession = options.accept ? { generation: epoch, session: nextSession, echoed: false } : undefined;
    const accept = async () => { pendingOwnerSession.current = ownerSession; return await options.accept!(); };
    publication.current?.resolve(false); publication.current = undefined;
    const nativeTransition = !!link && (options.nativeMotion || link.transition === 'smart' || !!link.matchLayers);
    const activeNative = activeNativeMotion.current ?? pendingNativeMotion.current;
    if (activeNative) { client.current?.cancelMotion(activeNative.sessionId); activeNative.playback.dispose(); }
    activeNativeMotion.current = undefined; pendingNativeMotion.current = undefined;
    motion.current?.dispose(); motion.current = undefined;
    pendingTransition.current?.snapshot.remove(); pendingTransition.current = undefined;
    let transitionSnapshot: HTMLElement | undefined;
    const rootSize = activeRootSize(target.screen), models = new Map<string, NativeReactModel>(), nextScrollHistory = cloneScrollHistory(scrollHistory.current), restoredScroll: Record<string, DesignPoint> = {};
    let nativeInfo: NativeReactMotionInfo | undefined, nativeSessionId: number | undefined;
    const previousState: HeldState = { media: preparationPlayback.current ?? captureMedia(), route: structuredClone(previousRoute), prepared: previous, session: structuredClone(sessionRef.current), controls: structuredClone(controlsRef.current), scroll: { ...scrollRef.current }, scrollHistory: cloneScrollHistory(scrollHistory.current), values: structuredClone(values), focus: captureFocusTarget(), focusStack: [...focusStack.current] };
    preparationPlayback.current = previousState.media;
    setBusy(true); setError('');
    try {
      if (link && !nativeTransition && link.transition !== 'instant' && link.duration > 0 && previous) {
        const outgoingKey = activeRouteKey(previousRoute), pane = [...(host.current?.querySelectorAll<HTMLElement>('[data-native-overlay],[data-native-screen]') ?? [])].find(node => node.dataset.nativeOverlay === outgoingKey || node.dataset.nativeScreen === outgoingKey);
        if (!pane) throw new Error('The outgoing prototype occurrence is not mounted for transition capture.');
        transitionSnapshot = snapshotNativeReactView(pane);
      }
      const instances = [{ id: target.screen, key: target.screen, scope: undefined as string | undefined }, ...target.overlays.map((overlay, index) => ({ id: overlay.screen, key: overlayModelKey(overlay, index), scope: overlayScope(overlay, index) }))];
      target.overlays.forEach((overlay, index) => knownOverlayScopes.current.add(overlayScope(overlay, index)));
      for (let index = 0; index < instances.length; index++) {
        const instance = instances[index]!;
        const output = await client.current?.render({ rootId: instance.id, ...(instance.scope ? { controlScope: instance.scope } : {}), session: nextSession, controls: nextControls, ...(index === 0 && rootSize ? { rootSizes: rootSize } : {}) });
        if (!mounted.current || epoch !== generation.current || !output) { transitionSnapshot?.remove(); if (mounted.current && epoch === generation.current) { setBusy(false); resumePreparationPlayback(); } return false; }
        if (!(output.width > 0 && output.height > 0)) throw new Error('Give each prototype screen a positive width and height.');
        const recordDefaults = (node: NativeReactModel['nodes'][number]) => { if (node.control?.native?.key) controlDefaults.current.set(node.control.native.key, defaultControlSnapshot(node.control)); node.children.forEach(recordDefaults); };
        output.nodes.forEach(recordDefaults);
        if (instance.scope && !link?.preserveScroll && !link?.resetScroll && !previousRoute.overlays.some((overlay, overlayIndex) => overlayScope(overlay, overlayIndex) === instance.scope)) {
          const overlayIndex = index - 1;
          const anotherCopy = target.screen === instance.id || target.overlays.some((other, otherIndex) => otherIndex !== overlayIndex && other.screen === instance.id);
          const saved = nextScrollHistory.get(instance.id);
          if (!anotherCopy && saved) {
            const seed = (node: NativeReactModel['nodes'][number]) => {
              if (node.scroll) {
                const authored = overlayAuthoredLayerId(node.id, instance.scope!);
                const point = authored && saved[authored.layerId]; if (point) restoredScroll[node.id] = { ...point };
              }
              node.children.forEach(seed);
            };
            output.nodes.forEach(seed);
          }
        }
        models.set(instance.key, output);
        const pendingModels = [...models.values()];
        if (countModelBytes(pendingModels) > 32 * 1024 * 1024) throw new Error('The active screens and overlays exceed 32 MB; reduce their embedded assets.');
      }
      if (!mounted.current || epoch !== generation.current) { transitionSnapshot?.remove(); return false; }
      const heldModels = holds.current.flatMap(held => [...held.prepared.models.values()]);
      if (countModelBytes([...models.values(), ...preparedRef.current.models.values(), ...heldModels, ...(nativeFrame ? [nativeFrame.model] : [])]) > 32 * 1024 * 1024) throw new Error('Active screens and reversible checkpoints exceed 32 MB; reduce their embedded assets.');
      const nextScroll = { ...scrollRef.current, ...restoredScroll };
      if (link && ['navigate', 'back', 'overlay', 'swap', 'close'].includes(link.action)) {
        const from = currentModelFor(previousRoute, previous.models), to = currentModelFor(target, models);
        if (from && to) transferDesignScroll(from.nodes, to.nodes, nextScroll, link);
      }
      if (link?.resetScroll) for (const model of [currentModelFor(target, models)].filter((value): value is NativeReactModel => !!value)) {
        const clear = (node: NativeReactModel['nodes'][number]) => { delete nextScroll[node.id]; node.children.forEach(clear); };
        model.nodes.forEach(clear);
      }
      if (options.accept && !nativeTransition && !await accept()) { transitionSnapshot?.remove(); if (epoch === generation.current) { setBusy(false); resumePreparationPlayback(); } return false; }
      if (epoch !== generation.current) { transitionSnapshot?.remove(); return false; }
      if (nativeTransition && link) {
        nativeSessionId = ++motionSequence.current;
        nativeInfo = await client.current?.prepareMotion({ sessionId: nativeSessionId, from: motionEndpoint(previousRoute, sessionRef.current, controlsRef.current, scrollRef.current, previous.rootSizes), to: motionEndpoint(target, nextSession, nextControls, nextScroll, rootSize), link });
        if (!mounted.current || epoch !== generation.current || !nativeInfo) { if (nativeSessionId !== undefined) client.current?.cancelMotion(nativeSessionId); transitionSnapshot?.remove(); if (mounted.current && epoch === generation.current) { setBusy(false); resumePreparationPlayback(); } return false; }
        if (nativeInfo.sessionId !== nativeSessionId || !(Number.isFinite(nativeInfo.initialModel.width) && nativeInfo.initialModel.width > 0 && Number.isFinite(nativeInfo.initialModel.height) && nativeInfo.initialModel.height > 0)) throw new Error('The native renderer returned an invalid motion frame.');
        const heldModels = holds.current.flatMap(held => [...held.prepared.models.values()]);
        if (countModelBytes([...models.values(), ...previous.models.values(), ...heldModels, ...(nativeFrame ? [nativeFrame.model] : []), nativeInfo.initialModel]) > 32 * 1024 * 1024) throw new Error('The motion frame, active screens and reversible checkpoints exceed 32 MB; reduce their embedded assets.');
      }
      if (options.accept && nativeTransition && !await accept()) {
        if (nativeSessionId !== undefined) client.current?.cancelMotion(nativeSessionId);
        transitionSnapshot?.remove(); if (epoch === generation.current) { setBusy(false); resumePreparationPlayback(); } return false;
      }
      if (epoch !== generation.current) { if (nativeSessionId !== undefined) client.current?.cancelMotion(nativeSessionId); transitionSnapshot?.remove(); return false; }
      if (transitionSnapshot && link) pendingTransition.current = { snapshot: transitionSnapshot, link, previous, session: sessionRef.current, controls: controlsRef.current, scroll: { ...scrollRef.current }, scrollHistory: cloneScrollHistory(scrollHistory.current), route: previousRoute, focusStack: [...focusStack.current], generation: epoch, incomingKey: activeRouteKey(target), media: previousState.media, exit: link.action === 'close' && target.overlays.length < previousRoute.overlays.length };
      else transitionSnapshot?.remove();
      const nextPrepared: Prepared = { route: target, models, serial: ++serial.current, generation: epoch, rootSizes: rootSize ?? {} };
      preparationPlayback.current = undefined;
      mediaReset.current = link?.resetVideoPosition ? { generation: epoch, key: activeRouteKey(target), playback: previousState.media.get(activeRouteKey(target)) } : undefined;
      routeRef.current = target; preparedRef.current = nextPrepared;
      sessionRef.current = nextSession; controlsRef.current = nextControls; scrollRef.current = nextScroll; scrollHistory.current = nextScrollHistory;
      if (options.focusStack) focusStack.current = [...options.focusStack];
      if (options.focus !== undefined) pendingFocus.current = options.focus;
      pruneOverlayScopes(target, transitionSnapshot || nativeInfo ? previousRoute : undefined);
      if (link?.resetScroll) target.overlays.forEach(overlay => scrollHistory.current.delete(overlay.screen));
      const committed = new Promise<boolean>(resolve => { publication.current = { generation: epoch, resolve }; });
      if (nativeInfo && nativeSessionId !== undefined && link) {
        let latestFrameModel = nativeInfo.initialModel;
        const playback = createNativeReactMotionPlayback({ link, paused: true, movement: sourceId => nativeInfo?.movements[sourceId ?? ''] ?? nativeInfo?.movement, render: progress => client.current?.motionFrame(nativeSessionId!, progress) ?? Promise.resolve(undefined), apply: (model, _progress) => {
          if (!mounted.current || generation.current !== epoch) return;
          if (!(Number.isFinite(model.width) && model.width > 0 && Number.isFinite(model.height) && model.height > 0)) throw new Error('The native renderer returned invalid motion dimensions.');
          if (countModelBytes([...models.values(), ...previous.models.values(), ...holds.current.flatMap(held => [...held.prepared.models.values()]), latestFrameModel, model]) > 32 * 1024 * 1024) throw new Error('The native motion frame exceeds the 32 MB active model budget.');
          latestFrameModel = model;
          setNativeFrame({ model, generation: epoch });
        }, onError: message => { if (mounted.current && generation.current === epoch) { setError(message); latest.current.onPrototypeError?.(message); } } });
        const pending: NativeMotionPending = { generation: epoch, playback, info: nativeInfo, sessionId: nativeSessionId, drag: !!options.drag, previous: previousState, target: nextPrepared };
        pendingNativeMotion.current = pending; activeNativeMotion.current = pending; motion.current = playback; setNativeFrame({ model: nativeInfo.initialModel, generation: epoch });
      } else setNativeFrame(null);
      setSessionState(nextSession); setControlsState(controlsRef.current); setPrepared(preparedRef.current); setScrollRevision(value => value + 1); setBusy(false);
      return await committed;
    } catch (failure) {
      transitionSnapshot?.remove();
      if (nativeSessionId !== undefined) client.current?.cancelMotion(nativeSessionId);
      if (mounted.current && epoch === generation.current) { setBusy(false); resumePreparationPlayback(); const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }
      return false;
    } finally {
      if (ownerSession && pendingOwnerSession.current === ownerSession) {
        pendingOwnerSession.current = undefined;
        if (mounted.current && epoch === generation.current && controlledChanged(latest.current)) reconcileControlled();
      }
    }
  };

  const cancelSequence = () => { sequenceEpoch.current++; sequenceMotion.current?.(); sequenceMotion.current = undefined; };
  const allowTrigger = (trigger?: DesignTrigger) => {
    if (!isAutomatic(trigger)) { autoRoutes.current = []; setAutomaticPaused(false); return true; }
    const now = Date.now(); autoRoutes.current = [...autoRoutes.current.filter(value => now - value < 1000), now];
    if (autoRoutes.current.length > 20) { setAutomaticPaused(true); setError('Automatic navigation paused: this flow loops too quickly.'); return false; }
    return true;
  };

  const routeAction = async (link: DesignNavigation, layerId?: string, trigger?: DesignTrigger, origin: DesignPoint = { x: 0, y: 0 }, temporary = false) => {
    if (link.action === 'open-url') return openDesignUrl(link, latest.current.onOpenUrl);
    if (link.action === 'media') return playDesignMedia(link,mediaOwners.current.get(activeRouteKey(routeRef.current)));
    const current = routeRef.current;
    if (link.action === 'scroll') {
      if (trigger?.type === 'drag') {
        const external = await latest.current.onNavigate?.(link, layerId ?? '', trigger, origin);
        if (external === false) return false;
        return prepareRoute(current, sessionRef.current, controlsRef.current, link, { temporary, nativeMotion: true, drag: true });
      }
      const external = await latest.current.onNavigate?.(link, layerId ?? '', trigger, origin);
      if (external === false) return false;
      const model = currentModelFor(current), key = current.overlays.length ? overlayModelKey(current.overlays.at(-1)!, current.overlays.length - 1) : current.screen;
      const view = [...(host.current?.querySelectorAll<HTMLElement>('[data-xdesign-view]') ?? [])].find(node => node.closest<HTMLElement>('[data-native-screen]')?.dataset.nativeScreen === key) ?? host.current?.querySelector<HTMLElement>('[data-xdesign-view]:not([inert])');
      if (!view || !model) throw new Error('The scrolling screen is not ready.');
      const job = designScrollTo(view, link); sequenceMotion.current = job; const done = await job.finished; sequenceMotion.current = undefined; return done;
    }
    const external = await latest.current.onNavigate?.(link, layerId ?? '', trigger, origin);
    if (external === false) return false;
    const top = current.overlays.at(-1), parentPosition = top ? overlayPositions(current, preparedRef.current.models).at(-1) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const next = routePrototype(current, link, screenSet.current, { x: origin.x + parentPosition.x, y: origin.y + parentPosition.y }, ['overlay', 'swap'].includes(link.action) ? `overlay-${++occurrence.current}` : undefined);
    if (routeEqual(next, current) && !link.resetScroll && !link.preserveScroll && !link.resetInteractiveComponents && !link.resetVideoPosition) return true;
    if (!temporary && !isAutomatic(trigger)) discardHolds();
    let controls = controlsRef.current;
    if (link.resetInteractiveComponents) {
      const destination = next.overlays.at(-1), key = destination ? rootControlKey(destination.screen, overlayScope(destination, next.overlays.length - 1)) : rootControlKey(next.screen);
      controls = resetControlsForRoot(controls, key);
    }
    const stack = [...focusStack.current]; let focus: FocusTarget | null | undefined;
    if (link.action === 'overlay') stack.push(captureFocusTarget());
    else if (link.action === 'close' && current.overlays.length) focus = stack.pop() ?? null;
    else if (['navigate', 'back', 'swap'].includes(link.action) && !next.overlays.length) { stack.length = 0; focus = null; }
    const nativeMotion = trigger?.type === 'drag' || link.transition === 'smart' || !!link.matchLayers;
    return prepareRoute(next, sessionRef.current, controls, link, { temporary, focusStack: stack, focus, nativeMotion, drag: trigger?.type === 'drag' });
  };

  const onNavigate = async (link: DesignNavigation, layerId?: string, trigger?: DesignTrigger, origin?: DesignPoint) => {
    if (link.action === 'open-url' || link.action === 'media') {
      const epoch = sequenceEpoch.current;
      try { return await (link.action === 'media' ? playDesignMedia(link,mediaOwners.current.get(activeRouteKey(routeRef.current))) : openDesignUrl(link, latest.current.onOpenUrl)); }
      catch (failure) { if (mounted.current && epoch === sequenceEpoch.current) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); } return false; }
    }
    if (dragState.current && trigger?.type !== 'drag') dragState.current.cancel();
    if (!trigger || !['delay', 'media-hit', 'media-end'].includes(trigger.type)) cancelSequence();
    if (!allowTrigger(trigger)) return false;
    try { return await routeAction(link, layerId, trigger, origin); }
    catch (failure) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); return false; }
  };

  const runSequence = (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint, temporary = false, beginMutation?: (media?: DesignMediaMutation) => void) => {
    const hasUrl = allDesignActions(link).some(action => ['open-url','media'].includes(action.action));
    if (hasUrl) sequenceEpoch.current++; else cancelSequence();
    if (!allowTrigger(trigger)) return false;
    const sourceRoute = routeRef.current;
    let began = false;
    const beginAction = () => { if (!began) { began = true; beginMutation?.(); } if (!temporary && !isAutomatic(trigger)) discardHoldForSource(layerId, sourceRoute); };
    if (!hasUrl) beginAction();
    const epoch = sequenceEpoch.current;
    const active = () => mounted.current && epoch === sequenceEpoch.current && !document.hidden;
    const definitions = currentModelFor(sourceRoute)?.prototypeVariables ?? initialModel.prototypeVariables ?? { variables: [], collections: [], modes: {} };
    return executeDesignActions(link, definitions, () => sessionRef.current, async next => {
      if (hasUrl) beginAction();
      if (latest.current.prototypeSession && !latest.current.onPrototypeSessionChange) throw new Error('Connect a session change handler to update controlled prototype variables.');
      return prepareRoute(routeRef.current, next, controlsRef.current, trigger.type === 'drag' ? link : undefined, { nativeMotion: trigger.type === 'drag', drag: trigger.type === 'drag', accept: async () => await latest.current.onPrototypeSessionChange?.(next) !== false });
    }, action => { if (action.action === 'media') return playDesignMedia(action,mediaOwners.current.get(activeRouteKey(routeRef.current)),change => beginMutation?.(change)); if (hasUrl && action.action !== 'open-url') beginAction(); return routeAction(action, layerId, trigger, origin, temporary); }, active).catch(failure => {
      if (active()) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }
      return false;
    });
  };

  const reversible = (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint): DesignReversibleJob | undefined => {
    if (latest.current.onReversible) { const external = latest.current.onReversible(link, layerId, trigger, origin); if (external) return external; }
    if (holds.current.length >= 8) { setError('Use at most eight simultaneous temporary interactions.'); return; }
    const saved: HeldState = { media: captureMedia(), route: structuredClone(routeRef.current), prepared: preparedRef.current, session: structuredClone(sessionRef.current), controls: structuredClone(controlsRef.current), scroll: { ...scrollRef.current }, scrollHistory: cloneScrollHistory(scrollHistory.current), values: structuredClone(values), focus: captureFocusTarget(), focusStack: [...focusStack.current] };
    const mediaChanges = new Map<DesignMediaState,DesignMediaSnapshot>();
    let ended = false, started = !allDesignActions(link).some(action => ['open-url','media'].includes(action.action)), settle!: () => void; const finished = new Promise<void>(resolve => { settle = resolve; });
    const ownEpoch = sequenceEpoch.current + 1;
    const held = { ...saved, sourceLayerId: layerId, sourceRouteKey: routeOccurrenceKey(saved.route), finished, close: (restore: boolean) => {
      if (ended) return; ended = true; const index = holds.current.indexOf(held); if (index >= 0) { const descendants = holds.current.splice(index); descendants.filter(item => item !== held).forEach(item => item.close(false)); }
      if (!started) { if (sequenceEpoch.current === ownEpoch) sequenceEpoch.current++; if (restore) for (const [owner,snapshot] of mediaChanges) owner.restoreTransport(snapshot); settle(); return; }
      if (!restore || !mounted.current) { pruneOverlayScopes(routeRef.current); settle(); return; }
      let externalRestore: Promise<void> | undefined;
      if (JSON.stringify(saved.session) !== JSON.stringify(sessionRef.current) && latest.current.onPrototypeSessionChange) {
        try { externalRestore = Promise.resolve(latest.current.onPrototypeSessionChange(structuredClone(saved.session))).then(result => { if (result === false) throw new Error('The prototype owner rejected restoring the held variable state.'); }).catch(failure => { const message = String(failure); latest.current.onPrototypeError?.(message); }); }
        catch (failure) { const message = String(failure); latest.current.onPrototypeError?.(message); }
      }
      if (latest.current.onControlState) {
        const defaults = new Map<string, import('./reactExportRuntime').DesignControlSnapshot>();
        for (const model of [...preparedRef.current.models.values(), ...saved.prepared.models.values()]) {
          const visit = (node: NativeReactModel['nodes'][number]) => { if (node.control?.native?.key) defaults.set(node.control.native.key, defaultControlSnapshot(node.control)); node.children.forEach(visit); };
          model.nodes.forEach(visit);
        }
        const keys = new Set([...Object.keys(controlsRef.current), ...Object.keys(saved.controls)]);
        for (const key of keys) if (JSON.stringify(controlsRef.current[key]) !== JSON.stringify(saved.controls[key])) {
          const snapshot = saved.controls[key] ?? defaults.get(key);
          if (snapshot) try { latest.current.onControlState(key, structuredClone(snapshot)); } catch (failure) { latest.current.onPrototypeError?.(String(failure)); }
        }
      }
      generation.current++; publication.current?.resolve(false); publication.current = undefined; motion.current?.dispose(); motion.current = undefined;
      cancelSequence(); pendingTransition.current?.snapshot.remove(); pendingTransition.current = undefined;
      preparationPlayback.current = undefined; mediaRestore.current = saved.media; mediaReset.current = undefined;
      routeRef.current = saved.route; preparedRef.current = saved.prepared; sessionRef.current = saved.session; controlsRef.current = saved.controls; scrollRef.current = { ...saved.scroll }; scrollHistory.current = cloneScrollHistory(saved.scrollHistory); focusStack.current = [...saved.focusStack]; pendingFocus.current = saved.focus;
      pruneOverlayScopes(saved.route, undefined, false);
      setSessionState(saved.session); setControlsState(saved.controls); setPrepared({ ...saved.prepared, serial: ++serial.current }); setScrollRevision(value => value + 1); setValues(saved.values); setBusy(false); setError('');
      if (externalRestore) void externalRestore.then(settle); else settle();
    } } satisfies Held;
    holds.current.push(held);
    void runSequence(link, layerId, trigger, origin, true, change => { if (change) rememberDesignMedia(mediaChanges,change); else started = true; });
    return Object.assign(() => held.close(true), { finished });
  };

  const nativeDrag = (link: DesignNavigation, layerId: string, origin: DesignPoint) => {
    if (latest.current.onDrag) return latest.current.onDrag(link, layerId, origin);
    const deferred = allDesignActions(link).some(action => ['open-url','media'].includes(action.action));
    const mediaChanges = new Map<DesignMediaState,DesignMediaSnapshot>();
    let started = !deferred;
    const previousDrag = dragState.current, ownEpoch = sequenceEpoch.current + 1;
    if (started) { previousDrag?.cancel(); discardHolds(); }
    const saved: HeldState = { media: captureMedia(), route: structuredClone(routeRef.current), prepared: preparedRef.current, session: structuredClone(sessionRef.current), controls: structuredClone(controlsRef.current), scroll: { ...scrollRef.current }, scrollHistory: cloneScrollHistory(scrollHistory.current), values: structuredClone(values), focus: captureFocusTarget(), focusStack: [...focusStack.current] };
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const sceneSample = (sample: DesignDragSample): DesignDragSample => {
      const key = activeRouteKey(routeRef.current), view = [...(host.current?.querySelectorAll<HTMLElement>('[data-xdesign-view]') ?? [])].find(node => node.closest<HTMLElement>('[data-native-screen]')?.dataset.nativeScreen === key);
      const cssWidth = view?.getBoundingClientRect().width ?? 0, designWidth = Number.parseFloat(view?.style.width ?? ''), scale = cssWidth > 0 && designWidth > 0 ? cssWidth / designWidth : 1;
      return { offset: { x: sample.offset.x / scale, y: sample.offset.y / scale }, velocity: { x: sample.velocity.x / scale, y: sample.velocity.y / scale } };
    };
    const state: NativeDragState = {
      saved, layerId, link, sample: { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }, released: false, ended: false, finished, finish,
      update: sample => {
        if (state.ended) return; state.sample = sample;
        if (state.scrollJob?.scrub) {
          const vector = state.scrollJob.movement?.() ?? (Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x || 1) * (preparedRef.current.models.get(routeRef.current.screen)?.width ?? 320), y: 0 } : { x: 0, y: Math.sign(sample.offset.y || 1) * (preparedRef.current.models.get(routeRef.current.screen)?.height ?? 480) });
          const length = vector.x ** 2 + vector.y ** 2; if (length) state.scrollJob.scrub((sample.offset.x * vector.x + sample.offset.y * vector.y) / length);
          return;
        }
        const playback = state.playback, info = state.info; if (!playback || !info) return;
        sample = sceneSample(sample);
        let vector = info.movements[layerId] ?? info.movement;
        if (!vector || Math.hypot(vector.x, vector.y) < 1) {
          const width = info.from.width || 320, height = info.from.height || 480;
          if (link.direction) vector = { x: link.direction === 'left' ? width : link.direction === 'right' ? -width : 0, y: link.direction === 'top' ? height : link.direction === 'bottom' ? -height : 0 };
          else vector = Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x || 1) * width, y: 0 } : { x: 0, y: Math.sign(sample.offset.y || 1) * height };
        }
        const length = vector.x ** 2 + vector.y ** 2; if (length < 1) return;
        playback.scrub((sample.offset.x * vector.x + sample.offset.y * vector.y) / length);
      },
      release: sample => {
        if (state.ended) return; state.sample = sample; state.released = true; state.update(sample);
        if (state.scrollJob?.settle) {
          const vector = state.scrollJob.movement?.() ?? (Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x || 1) * (preparedRef.current.models.get(routeRef.current.screen)?.width ?? 320), y: 0 } : { x: 0, y: Math.sign(sample.offset.y || 1) * (preparedRef.current.models.get(routeRef.current.screen)?.height ?? 480) });
          const length = vector.x ** 2 + vector.y ** 2, progress = length ? (sample.offset.x * vector.x + sample.offset.y * vector.y) / length : 0, velocity = length ? (sample.velocity.x * vector.x + sample.velocity.y * vector.y) / length : 0, endpoint: 0 | 1 = progress + velocity * .15 >= .5 ? 1 : 0;
          void state.scrollJob.settle(endpoint, velocity).then(success => {
            if (state.ended || !success) return;
            if (endpoint === 0) restoreDragWithoutMotion(state); finishDrag(state);
          });
          return;
        }
        if (!state.playback || !state.info) return;
        sample = sceneSample(sample);
        let vector = state.playback.movement(layerId) ?? state.info.movements[layerId] ?? state.info.movement;
        if (!vector || Math.hypot(vector.x, vector.y) < 1) {
          const width = state.info.from.width || 320, height = state.info.from.height || 480;
          if (link.direction) vector = { x: link.direction === 'left' ? width : link.direction === 'right' ? -width : 0, y: link.direction === 'top' ? height : link.direction === 'bottom' ? -height : 0 };
          else vector = Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x || 1) * width, y: 0 } : { x: 0, y: Math.sign(sample.offset.y || 1) * height };
        }
        const direction = vector, length = direction.x ** 2 + direction.y ** 2;
        const progress = length ? (sample.offset.x * direction.x + sample.offset.y * direction.y) / length : 0;
        const velocity = length ? (sample.velocity.x * direction.x + sample.velocity.y * direction.y) / length : 0;
        const endpoint: 0 | 1 = progress + velocity * .15 >= .5 ? 1 : 0;
        void state.playback.settle(endpoint, velocity).then(success => {
          if (state.ended || !success) return;
          if (endpoint === 0 && state.pending) restoreNativeMotion(state.pending, state.saved);
          else if (endpoint === 0) restoreDragWithoutMotion(state);
          if (endpoint === 0) finishDrag(state);
        }).catch(failure => { if (!state.ended) { latest.current.onPrototypeError?.(String(failure)); state.cancel(); } });
      },
      cancel: (notifyOwner = true) => {
        if (state.ended) return;
        if (!started) { state.ended = true; if (sequenceEpoch.current === ownEpoch) sequenceEpoch.current++; for (const [owner,snapshot] of mediaChanges) owner.restoreTransport(snapshot); finish(); return; }
        state.scrollJob?.();
        const native = state.pending ?? pendingNativeMotion.current ?? activeNativeMotion.current;
        if (native) restoreNativeMotion(native, state.saved, notifyOwner); else restoreDragWithoutMotion(state, notifyOwner);
        finishDrag(state);
      },
    };
    const begin = () => { if (started || state.ended) return; previousDrag?.cancel(); discardHolds(); started = true; dragState.current = state; setBusy(true); };
    if (started) { dragState.current = state; setBusy(true); }
    if (link.action === 'scroll') {
      try {
        const key = activeRouteKey(routeRef.current), view = [...(host.current?.querySelectorAll<HTMLElement>('[data-xdesign-view]') ?? [])].find(node => node.closest<HTMLElement>('[data-native-screen]')?.dataset.nativeScreen === key);
        if (!view) throw new Error('The scrolling screen is not ready.');
        state.scrollJob = designScrollTo(view, link, true);
      } catch (failure) { latest.current.onPrototypeError?.(String(failure)); state.cancel(); return; }
      return Object.assign(() => state.cancel(), { finished, update: state.update, release: state.release });
    }
    void Promise.resolve(runSequence(link, layerId, { type: 'drag' }, origin, true, change => { if (change) rememberDesignMedia(mediaChanges,change); else begin(); })).then(result => {
      if (!started && !state.ended) { if (!result) state.cancel(); else { state.ended = true; finish(); } return; }
      if (!result && !state.ended && !state.pending && !pendingNativeMotion.current && !activeNativeMotion.current) state.cancel();
    });
    return Object.assign(() => state.cancel(), { finished, update: state.update, release: state.release });
  };

  const finishDrag = (state: NativeDragState) => {
    if (state.ended) return; state.ended = true;
    if (dragState.current === state) dragState.current = undefined;
    setBusy(false); state.finish();
  };
  const restoreDragWithoutMotion = (state: NativeDragState, notifyOwner = true) => {
    if (!mounted.current) return;
    const currentSession = sessionRef.current, currentControls = controlsRef.current;
    const defaults = new Map(controlDefaults.current);
    generation.current++; publication.current?.resolve(false); publication.current = undefined;
    preparationPlayback.current = undefined; mediaRestore.current = state.saved.media; mediaReset.current = undefined;
    routeRef.current = state.saved.route; preparedRef.current = state.saved.prepared; sessionRef.current = state.saved.session; controlsRef.current = state.saved.controls;
    scrollRef.current = { ...state.saved.scroll }; scrollHistory.current = cloneScrollHistory(state.saved.scrollHistory); focusStack.current = [...state.saved.focusStack]; pendingFocus.current = state.saved.focus;
    setNativeFrame(null); setPrepared({ ...state.saved.prepared, serial: ++serial.current }); setSessionState(state.saved.session); setControlsState(state.saved.controls); setValues(state.saved.values); setScrollRevision(value => value + 1); setBusy(false);
    if (notifyOwner && JSON.stringify(currentSession) !== JSON.stringify(state.saved.session) && latest.current.onPrototypeSessionChange) {
      try { void Promise.resolve(latest.current.onPrototypeSessionChange(structuredClone(state.saved.session))).then(result => { if (result === false) throw new Error('The prototype owner rejected restoring native drag variables.'); }).catch(failure => { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }); }
      catch (failure) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }
    }
    if (notifyOwner && latest.current.onControlState) for (const key of new Set([...Object.keys(currentControls), ...Object.keys(state.saved.controls)])) {
      const snapshot = state.saved.controls[key] ?? defaults.get(key); if (JSON.stringify(currentControls[key]) !== JSON.stringify(snapshot) && snapshot) try { latest.current.onControlState(key, structuredClone(snapshot)); } catch (failure) { latest.current.onPrototypeError?.(String(failure)); }
    }
  };

  const updateControl = (key: string, snapshot: import('./reactExportRuntime').DesignControlSnapshot) => {
    if (busy) return;
    const next = { ...controlsRef.current, [key]: structuredClone(snapshot) };
    void prepareRoute(routeRef.current, sessionRef.current, next).then(published => {
      if (!published) return;
      latest.current.onControlState?.(key, snapshot);
    });
  };

  const overlayPositions = (route: PrototypeRoute, models: Map<string, NativeReactModel>) => {
    const base = models.get(route.screen) ?? initialModel;
    return route.overlays.map((overlay, index) => {
      const model = models.get(overlayModelKey(overlay, index));
      if (!model) return { x: 0, y: 0 };
      const settings = model.nodes[0]?.overlay ?? { position: 'center' as const, closeOutside: false };
      return overlayPosition(settings, base, model, overlay.origin, overlay.offset);
    });
  };

  useEffect(() => {
    mounted.current = true;
    try { client.current = createNativeReactClient(assets); void prepareRoute(routeRef.current, sessionRef.current, controlsRef.current); }
    catch (failure) { const message = String(failure); setError(message); latest.current.onPrototypeError?.(message); }
    return () => { mounted.current = false; generation.current++; sequenceEpoch.current++; publication.current?.resolve(false); publication.current = undefined; const native = activeNativeMotion.current ?? pendingNativeMotion.current; if (native) client.current?.cancelMotion(native.sessionId); dragState.current?.cancel(); motion.current?.dispose(); pendingTransition.current?.snapshot.remove(); holds.current.splice(0).forEach(held => held.close(false)); client.current?.dispose(); client.current = undefined; };
  }, [assets]);

  useEffect(() => {
    if (!responsive || width !== undefined || !host.current) { setMeasuredWidth(undefined); return; }
    const observer = new ResizeObserver(entries => { const next = entries[0]?.contentRect.width; if (next && Number.isFinite(next)) setMeasuredWidth(next); });
    observer.observe(host.current); return () => observer.disconnect();
  }, [responsive, width]);
  useEffect(() => {
    if (!sizeEffectMounted.current) { sizeEffectMounted.current = true; return; }
    if (!client.current || !mounted.current) return;
    const controlledUpdate = controlledChanged(props);
    dragState.current?.cancel(!controlledUpdate);
    const native = activeNativeMotion.current ?? pendingNativeMotion.current;
    if (native) {
      const saved = native.previous; restoreNativeMotion(native, saved, !controlledUpdate);
      if (!controlledUpdate) void prepareRoute(saved.route, saved.session, saved.controls);
    } else if (!controlledUpdate) void prepareRoute(routeRef.current, sessionRef.current, controlsRef.current);
  }, [width, height, measuredWidth]);
  const reconcileControlled = () => {
    dragState.current?.cancel(false);
    const native = activeNativeMotion.current ?? pendingNativeMotion.current;
    if (native) restoreNativeMotion(native, native.previous, false);
    void prepareRoute(routeRef.current, latest.current.prototypeSession ?? sessionRef.current, latest.current.controlSession ?? controlsRef.current);
  };
  useEffect(() => {
    if (controlledChanged(props)) reconcileControlled();
  }, [props.prototypeSession, props.controlSession]);

  useLayoutEffect(() => {
    if (mediaRestore.current) { const checkpoint = mediaRestore.current; mediaRestore.current = undefined; restoreMedia(checkpoint); }
    const resetMedia = () => { const pending = mediaReset.current; if (pending && pending.generation === prepared.generation && pending.generation === generation.current) { mediaReset.current = undefined; mediaOwner(pending.key).reset(pending.playback); } };
    const currentRouteKey = routeOccurrenceKey(prepared.route), routeChanged = layoutRoute.current !== currentRouteKey; layoutRoute.current = currentRouteKey;
    const native = pendingNativeMotion.current; if (native && native.generation === generation.current) {
      pendingNativeMotion.current = undefined; resetMedia();
      if (native.drag) {
        const drag = dragState.current;
        if (drag) {
          drag.pending = native; drag.playback = native.playback; drag.info = native.info; drag.update(drag.sample);
          void native.playback.finished.then(complete => {
            if (!mounted.current || generation.current !== native.generation) return;
            if (!complete) { drag.cancel(); return; }
            client.current?.cancelMotion(native.sessionId);
            if (motion.current === native.playback) motion.current = undefined;
            if (activeNativeMotion.current === native) activeNativeMotion.current = undefined;
            deferredNativeFocus.current = true; setNativeFrame(null); setPrepared(current => ({ ...current, serial: ++serial.current })); pruneOverlayScopes(routeRef.current); finishDrag(drag);
          });
          if (drag.released) drag.release(drag.sample);
        } else { restoreNativeMotion(native); }
        if (publication.current?.generation === native.generation) { publication.current.resolve(true); publication.current = undefined; }
      } else {
        native.playback.resume();
        void native.playback.finished.then(complete => {
          if (!mounted.current || generation.current !== native.generation) return;
          if (!complete) { restoreNativeMotion(native); return; }
          client.current?.cancelMotion(native.sessionId);
          if (pendingNativeMotion.current === native) pendingNativeMotion.current = undefined;
          if (activeNativeMotion.current === native) activeNativeMotion.current = undefined;
          if (motion.current === native.playback) motion.current = undefined;
          deferredNativeFocus.current = true; setNativeFrame(null); setPrepared(current => ({ ...current, serial: ++serial.current })); pruneOverlayScopes(routeRef.current);
          if (publication.current?.generation === native.generation) { publication.current.resolve(true); publication.current = undefined; }
        });
      }
    } else {
    const transition = pendingTransition.current; if (transition && transition.generation === generation.current) {
      pendingTransition.current = undefined;
      try {
        let job: { dispose: () => void; finished: Promise<boolean> };
        if (transition.exit) {
          if (!host.current) throw new Error('The prototype host is no longer mounted for transition playback.');
          host.current.append(transition.snapshot);
          job = animateNativeReactExit(transition.snapshot, transition.link);
        } else {
          const incoming = [...(host.current?.querySelectorAll<HTMLElement>('[data-native-overlay],[data-native-screen]') ?? [])].find(node => node.dataset.nativeOverlay === transition.incomingKey || node.dataset.nativeScreen === transition.incomingKey);
          if (!incoming) throw new Error('The incoming prototype occurrence is not mounted for transition playback.');
          job = animateNativeReactView(incoming, transition.snapshot, transition.link);
        }
        motion.current = job; resetMedia();
        void job.finished.then(complete => {
          if (complete || !mounted.current || generation.current !== transition.generation) {
            if (complete && mounted.current && generation.current === transition.generation) pruneOverlayScopes(routeRef.current);
            if (publication.current?.generation === transition.generation) { publication.current.resolve(complete && mounted.current && generation.current === transition.generation); publication.current = undefined; }
            return;
          }
          mediaRestore.current = transition.media; mediaReset.current = undefined; routeRef.current = transition.route; preparedRef.current = transition.previous; sessionRef.current = transition.session; controlsRef.current = transition.controls; scrollRef.current = transition.scroll; scrollHistory.current = cloneScrollHistory(transition.scrollHistory); focusStack.current = [...transition.focusStack];
          setPrepared({ ...transition.previous, serial: ++serial.current }); setSessionState(transition.session); setControlsState(transition.controls); setBusy(false);
          if (publication.current?.generation === transition.generation) { publication.current.resolve(false); publication.current = undefined; }
        });
      } catch (failure) {
        transition.snapshot.remove(); mediaRestore.current = transition.media; mediaReset.current = undefined; routeRef.current = transition.route; preparedRef.current = transition.previous; sessionRef.current = transition.session; controlsRef.current = transition.controls; scrollRef.current = transition.scroll; scrollHistory.current = cloneScrollHistory(transition.scrollHistory); focusStack.current = [...transition.focusStack];
        setPrepared({ ...transition.previous, serial: ++serial.current }); setSessionState(transition.session); setControlsState(transition.controls); setBusy(false);
        if (publication.current?.generation === transition.generation) { publication.current.resolve(false); publication.current = undefined; }
        const message = String(failure); setError(message); latest.current.onPrototypeError?.(message);
      }
    } else if (publication.current && publication.current.generation === prepared.generation) {
      resetMedia(); publication.current.resolve(true); publication.current = undefined;
    }
    }
    const frameCurrent = nativeFrame?.generation === prepared.generation;
    if (frameCurrent) host.current?.focus();
    if (!frameCurrent && pendingFocus.current !== undefined) {
      const target = pendingFocus.current; pendingFocus.current = undefined;
      const restored = target?.element?.isConnected ? target.element : target?.layerId ? activeLayerFor(target.layerId, target.sourceId) : undefined;
      if (restored?.isConnected && !restored.closest('[inert],[hidden],:disabled')) restored.focus();
      else if (routeRef.current.overlays.length) host.current?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"] [data-xdesign-view]')?.focus();
      else host.current?.querySelector<HTMLElement>('[data-xdesign-view]')?.focus();
      deferredNativeFocus.current = false;
    } else if (!frameCurrent && (routeChanged || deferredNativeFocus.current) && prepared.route.overlays.length) {
      host.current?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"] [data-xdesign-view]')?.focus();
      deferredNativeFocus.current = false;
    } else if (!frameCurrent && deferredNativeFocus.current) {
      host.current?.querySelector<HTMLElement>('[data-xdesign-view]')?.focus();
      deferredNativeFocus.current = false;
    }
    const effectMotion = motion.current;
    return () => { if (effectMotion && motion.current === effectMotion) { effectMotion.dispose(); motion.current = undefined; } };
  }, [prepared]);

  const activeRoute = prepared.route, positions = overlayPositions(activeRoute, prepared.models), baseModel = prepared.models.get(activeRoute.screen) ?? initialModel;
  function captureFocusTarget(): FocusTarget {
    const element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return { element, ...(element?.getAttribute('data-xdesign-layer') ? { layerId: element.getAttribute('data-xdesign-layer')! } : {}), ...(element?.getAttribute('data-xdesign-source') ? { sourceId: element.getAttribute('data-xdesign-source')! } : {}) };
  }
  function activeLayerFor(layerId: string, sourceId?: string) {
    const activeKey = routeRef.current.overlays.length ? overlayModelKey(routeRef.current.overlays.at(-1)!, routeRef.current.overlays.length - 1) : routeRef.current.screen;
    return [...(host.current?.querySelectorAll<HTMLElement>('[data-xdesign-layer]') ?? [])].find(element => element.dataset.xdesignLayer === layerId && element.closest<HTMLElement>('[data-native-screen]')?.dataset.nativeScreen === activeKey)
      ?? (sourceId ? [...(host.current?.querySelectorAll<HTMLElement>('[data-xdesign-source]') ?? [])].find(element => element.dataset.xdesignSource === sourceId && element.closest<HTMLElement>('[data-native-screen]')?.dataset.nativeScreen === activeKey) : undefined);
  }
  const escapeAndTrapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && routeRef.current.overlays.length) { event.preventDefault(); event.stopPropagation(); void onNavigate({ action: 'close', ...instant }); return; }
    if (event.key !== 'Tab') return;
    if (nativeFrame?.generation === prepared.generation) { event.preventDefault(); return; }
    if (!routeRef.current.overlays.length) return;
    const dialog = host.current?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]'); if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')].filter(node => !node.closest('[inert],[hidden]'));
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0]!, last = focusable.at(-1)!;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  const viewProps: DesignProps = {
    ...props, disabled: busy || !!props.disabled || !!nativeFrame, automatic: props.automatic !== false && !automaticPaused && !busy && !nativeFrame,
    prototypeSession: sessionRef.current,
    controlSession: controlsRef.current,
    onPrototypeSessionChange: async next => {
      if (props.prototypeSession && !props.onPrototypeSessionChange) throw new Error('Connect a session change handler to update controlled prototype variables.');
      return prepareRoute(routeRef.current, next, controlsRef.current, undefined, { accept: async () => await latest.current.onPrototypeSessionChange?.(next) !== false });
    },
    onControlState: updateControl,
    onSequence: async (link, layerId, trigger, origin) => { if (await props.onSequence?.(link, layerId, trigger, origin) === false) return false; return runSequence(link, layerId, trigger, origin); },
    onNavigate,
    onReversible: reversible,
    onSequenceCancel: reason => { props.onSequenceCancel?.(reason); if (reason === 'url' || reason === 'media') { sequenceEpoch.current++; return; } if (reason === 'activate' || reason === 'scroll' || reason === 'cancel') dragState.current?.cancel(); if (reason === 'activate' || reason === 'scroll' || reason === 'pointer' || reason === 'cancel') cancelSequence(); },
    values: { ...props.values, ...values },
    onAction: id => props.onAction?.(id), onValueChange: (id, value) => { setValues(previous => ({ ...previous, [id]: value })); props.onValueChange?.(id, value); },
    onScrollPositionChange: (id, point) => {
      scrollRef.current[id] = point;
      const scope = scopeInLayerId(id), authored = scope ? overlayAuthoredLayerId(id, scope) : undefined;
      if (authored) { const saved = scrollHistory.current.get(authored.screen) ?? {}; saved[authored.layerId] = { ...point }; scrollHistory.current.set(authored.screen, saved); }
      props.onScrollPositionChange?.(id, point);
    },
    scrollPositions: scrollRef.current, scrollRevision: scrollRevision,
    onDrag: props.onDrag ?? nativeDrag,
    onPrototypeError: message => { setError(message); props.onPrototypeError?.(message); },
  };
  const baseKey = JSON.stringify(['screen', sourceIdentity.current.revision, activeRoute.screen]), frameCurrent = !!nativeFrame && nativeFrame.generation === prepared.generation;
  const shownWidth = frameCurrent ? nativeFrame!.model.width : baseModel.width, shownHeight = frameCurrent ? nativeFrame!.model.height : baseModel.height;
  return <div ref={host} data-native-react-host="" tabIndex={-1} onKeyDownCapture={escapeAndTrapFocus} style={{ width: responsive && !frameCurrent ? '100%' : shownWidth, height: shownHeight, position: 'relative' }}>
    <div data-native-screen={activeRoute.screen} inert={busy || frameCurrent || !!activeRoute.overlays.length || undefined} aria-hidden={frameCurrent || !!activeRoute.overlays.length || undefined} style={{ position: 'relative', width: baseModel.width, height: baseModel.height, visibility: frameCurrent ? 'hidden' : undefined }}>
      <DesignView key={baseKey} {...viewProps} mediaState={mediaOwner(activeRoute.screen)} nodes={baseModel.nodes} width={baseModel.width} height={baseModel.height} />
    </div>
    {activeRoute.overlays.map((overlay, index) => {
      const key = overlayModelKey(overlay, index), model = prepared.models.get(key); if (!model) return null;
      const settings = model.nodes[0]?.overlay ?? { position: 'center' as const, closeOutside: false }, inactive = busy || frameCurrent || index !== activeRoute.overlays.length - 1;
      return <div key={overlay.instanceId ?? `${overlay.screen}:${index}`} data-native-overlay={key} inert={inactive || undefined} aria-hidden={inactive || undefined} onClick={event => { if (event.target === event.currentTarget && settings.closeOutside && !inactive) void onNavigate({ action: 'close', ...instant }); }} style={{ position: 'absolute', inset: 0, zIndex: index + 2, display: 'grid', visibility: frameCurrent ? 'hidden' : undefined, background: settings.background ? `rgba(${settings.background.r * 255},${settings.background.g * 255},${settings.background.b * 255},${settings.background.a})` : 'transparent' }}>
        <div data-native-screen={key} role="dialog" aria-modal={!inactive || undefined} aria-label={model.nodes[0]?.name ?? 'Overlay'} tabIndex={-1} style={{ position: 'absolute', left: positions[index]!.x, top: positions[index]!.y, width: model.width, height: model.height }}>
          <DesignView key={overlay.instanceId ?? `${overlay.screen}:${index}`} {...viewProps} mediaState={mediaOwner(key)} disabled={busy || !!props.disabled || frameCurrent || index !== activeRoute.overlays.length - 1} nodes={model.nodes} width={model.width} height={model.height} />
        </div>
      </div>;
    })}
    {frameCurrent && <div data-native-motion-frame="" aria-hidden="true" inert style={{ position: 'absolute', left: 0, top: 0, zIndex: 10000, width: shownWidth, height: shownHeight, pointerEvents: 'none' }}><DesignView key={`native-motion/${nativeFrame!.generation}`} {...viewProps} mediaState={undefined} disabled automatic={false} nodes={nativeFrame!.model.nodes} width={shownWidth} height={shownHeight} scrollPositions={nativeFrame!.model.scrollPositions ?? {}} onScrollPositionChange={() => {}} /></div>}
    {busy && <span role="status" style={{ position: 'absolute', left: -10000 }}>Preparing screen…</span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
