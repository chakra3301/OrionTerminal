import { designEase, designSpringDuration, isDesignSpring, type DesignNavigation, type DesignPoint } from './reactExportRuntime';
import type { NativeReactModel } from './nativeReactProtocol';

export type NativeReactMotionPlayback = (() => void) & {
  dispose: () => void;
  finished: Promise<boolean>;
  readonly active: boolean;
  pause: () => void;
  resume: () => void;
  seek: (progress: number) => void;
  scrub: (progress: number) => void;
  settle: (target: 0 | 1, velocity?: number) => Promise<boolean>;
  movement: (sourceId?: string) => DesignPoint | undefined;
};

type PlaybackOptions = {
  link: DesignNavigation;
  render: (progress: number) => Promise<NativeReactModel | undefined>;
  apply: (model: NativeReactModel, progress: number) => void;
  movement?: (sourceId?: string) => DesignPoint | undefined;
  onError?: (message: string) => void;
  paused?: boolean;
};
type Frame = { sequence: number; epoch: number; progress: number; endpoint?: 0 | 1 };

const MAX_DURATION = 10_000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function createNativeReactMotionPlayback(options: PlaybackOptions): NativeReactMotionPlayback {
  const { link } = options;
  let easing = link.easing, duration = isDesignSpring(easing) ? designSpringDuration(easing) : link.duration;
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION) throw new Error('Choose a finite native motion duration of at most ten seconds.');
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { easing = 'linear'; duration = Math.min(200, duration); }

  let active = true, paused = !!options.paused, disposed = false, endpointHold = false, hasRequested = false, sequence = 0, epoch = 0;
  let frameId: number | undefined, lastTime = 0, elapsed = 0, from = 0, target: 0 | 1 = 1, runEasing = easing, runDuration = duration;
  let requestedProgress = 0, pending: Frame | undefined, rendering = false, positionedManually = false, manualRemaining = 1;
  let endpointResolve: ((success: boolean) => void) | undefined;
  let finish!: (success: boolean) => void;
  const finished = new Promise<boolean>(resolve => { finish = resolve; });

  const cancelFrame = () => { if (frameId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId); frameId = undefined; };
  const advanceEpoch = () => { epoch++; hasRequested = false; };
  const settleEndpoint = (success: boolean) => { const resolve = endpointResolve; endpointResolve = undefined; resolve?.(success); };
  const stop = (success: boolean, message?: string) => {
    if (disposed) return;
    disposed = true; active = false; advanceEpoch(); cancelFrame(); pending = undefined;
    settleEndpoint(false); finish(success);
    if (message) { try { options.onError?.(message); } catch {} }
  };
  const fail = (failure: unknown) => stop(false, String(failure));

  const dispatch = () => {
    if (disposed || rendering || !pending) return;
    const request = pending; pending = undefined; rendering = true; const requestEpoch = epoch;
    let result: Promise<NativeReactModel | undefined>;
    try { result = Promise.resolve(options.render(request.progress)); }
    catch (failure) { rendering = false; if (request.sequence === sequence) fail(failure); else dispatch(); return; }
    void result.then(model => {
      rendering = false;
      if (disposed || requestEpoch !== epoch || request.epoch !== epoch) { dispatch(); return; }
      if (!model) { if (request.sequence === sequence) fail('Native motion rendering was superseded before its requested frame was ready.'); else dispatch(); return; }
      try { options.apply(model, request.progress); } catch (failure) { fail(failure); return; }
      if (request.sequence === sequence && request.endpoint !== undefined && request.progress === request.endpoint) {
        if (request.endpoint === 1) { settleEndpoint(true); stop(true); }
        else { endpointHold = true; paused = true; settleEndpoint(true); }
      }
      dispatch();
    }, failure => {
      rendering = false;
      if (disposed || requestEpoch !== epoch || request.epoch !== epoch) { dispatch(); return; }
      if (request.sequence === sequence) fail(failure); else dispatch();
    });
  };
  const requestFrame = (progress: number, endpoint?: 0 | 1) => {
    if (disposed) return;
    if (!Number.isFinite(progress) || progress < -100 || progress > 100) { fail('Choose a finite bounded native motion progress.'); return; }
    if (hasRequested && endpoint === undefined && progress === requestedProgress) return;
    const request = { sequence: ++sequence, epoch, progress, ...(endpoint === undefined ? {} : { endpoint }) };
    requestedProgress = progress; hasRequested = true; pending = request; dispatch();
  };
  const schedule = () => {
    if (disposed || paused || frameId !== undefined) return;
    if (typeof requestAnimationFrame !== 'function') { fail('This environment cannot schedule native motion frames.'); return; }
    frameId = requestAnimationFrame(tick);
  };
  const advance = (now: number) => {
    elapsed = Math.min(runDuration, elapsed + Math.max(0, now - lastTime)); lastTime = now;
    const progress = runDuration === 0 ? 1 : clamp(elapsed / runDuration);
    const eased = designEase(progress, runEasing, runDuration);
    requestFrame(from + (target - from) * eased, progress >= 1 ? target : undefined);
    return progress >= 1;
  };
  const tick: FrameRequestCallback = now => {
    frameId = undefined;
    if (!active || paused || disposed) return;
    try { if (!advance(now)) schedule(); }
    catch (failure) { fail(failure); }
  };
  const beginRun = (start: number, end: 0 | 1, nextEasing: typeof easing, nextDuration: number) => {
    cancelFrame(); elapsed = 0; lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    from = start; target = end; runEasing = nextEasing; runDuration = nextDuration; paused = false;
    if (nextDuration === 0) requestFrame(end, end);
    else schedule();
  };

  requestFrame(0);
  if (!paused) {
    if (duration === 0) requestFrame(1, 1);
    else schedule();
  }

  const pause = () => {
    if (disposed || paused) return;
    if (frameId !== undefined) {
      cancelFrame();
      const now = typeof performance !== 'undefined' ? performance.now() : lastTime;
      const done = advance(now);
      paused = true;
      if (done) return;
    } else paused = true;
  };
  const resume = () => {
    if (disposed || !paused) return;
    if (endpointHold) { endpointHold = false; advanceEpoch(); positionedManually = false; beginRun(0, 1, easing, duration); return; }
    if (positionedManually) {
      advanceEpoch(); positionedManually = false;
      const start = Math.max(-100, Math.min(100, requestedProgress)); beginRun(start, 1, easing, duration * manualRemaining);
      return;
    }
    paused = false; lastTime = typeof performance !== 'undefined' ? performance.now() : lastTime; schedule();
  };
  const seek = (progress: number) => {
    if (!Number.isFinite(progress)) { fail('Choose a finite native motion timeline position.'); return; }
    pause(); advanceEpoch(); endpointHold = false; positionedManually = true; const value = clamp(progress), raw = duration === 0 ? 1 : value; manualRemaining = 1 - value;
    requestFrame(designEase(raw, easing, duration));
  };
  const scrub = (progress: number) => {
    if (!Number.isFinite(progress)) { fail('Choose a finite native motion drag position.'); return; }
    pause(); advanceEpoch(); endpointHold = false; positionedManually = true; const value = clamp(progress); manualRemaining = 1 - value; requestFrame(value);
  };
  const settle = (end: 0 | 1, velocity = 0) => {
    if (disposed || (end !== 0 && end !== 1) || !Number.isFinite(velocity)) return Promise.resolve(false);
    cancelFrame(); paused = true; advanceEpoch(); positionedManually = false;
    settleEndpoint(false);
    return new Promise<boolean>(resolve => {
      endpointResolve = resolve;
      endpointHold = false;
      const start = Math.max(-100, Math.min(100, requestedProgress));
      const delta = end - start;
      if (!delta) { requestFrame(end, end); if (rendering || pending) return; return; }
      let nextEasing = easing;
      if (isDesignSpring(nextEasing)) nextEasing = { ...nextEasing, initialVelocity: Math.max(-100, Math.min(100, velocity / delta)) };
      const nextDuration = isDesignSpring(nextEasing) ? designSpringDuration(nextEasing) : Math.max(0, Math.round(duration * Math.abs(delta)));
      beginRun(start, end, nextEasing, nextDuration);
    });
  };
  const movement = (sourceId?: string) => options.movement?.(sourceId);
  const api = Object.assign(() => stop(false), { dispose: () => stop(false), finished, pause, resume, seek, scrub, settle, movement });
  Object.defineProperty(api, 'active', { get: () => active });
  return api as NativeReactMotionPlayback;
}
