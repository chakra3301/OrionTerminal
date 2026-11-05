import type { NativeReactInit, NativeReactInput, NativeReactModel, NativeReactMotionInfo, NativeReactMotionRequest, NativeReactOperation, NativeReactOutput, NativeReactRequest } from './nativeReactProtocol';

export type NativeReactWorker = {
  onmessage: ((event: MessageEvent<NativeReactOutput>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: NativeReactInput, transfer?: Transferable[]): void;
  terminate(): void;
};
type NativeReactJob = { id: number; input: NativeReactOperation; cancelled?: boolean; resolve: (result: NativeReactModel | NativeReactMotionInfo | undefined) => void; reject: (error: Error) => void };

// A single active render and one replaceable pending request bound worker memory during resize/drag.
export class NativeReactWorkerClient {
  private ready = false;
  private closed = false;
  private nextId = 0;
  private active?: NativeReactJob;
  private queued?: NativeReactJob;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private worker: NativeReactWorker, payload: NativeReactInit, private release: () => void = () => {}, private timeout = 30000) {
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'The native renderer failed.')); };
    worker.onmessageerror = () => this.fail(new Error('The native renderer returned unreadable data.'));
    this.arm();
    try { worker.postMessage({ type: 'init', payload }, [payload.wasm.buffer as ArrayBuffer]); }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  render(request: NativeReactRequest = {}): Promise<NativeReactModel | undefined> {
    return this.submit<NativeReactModel>({ type: 'render', request });
  }
  prepareMotion(motion: NativeReactMotionRequest): Promise<NativeReactMotionInfo | undefined> {
    return this.submit<NativeReactMotionInfo>({ type: 'motion-prepare', motion });
  }
  motionFrame(sessionId: number, progress: number): Promise<NativeReactModel | undefined> {
    return this.submit<NativeReactModel>({ type: 'motion-frame', sessionId, progress });
  }
  cancelMotion(sessionId: number) {
    if (this.closed) return;
    const belongs = (job?: NativeReactJob) => job?.input.type === 'motion-frame' ? job.input.sessionId === sessionId : job?.input.type === 'motion-prepare' && job.input.motion.sessionId === sessionId;
    if (belongs(this.queued)) { this.queued!.resolve(undefined); this.queued = undefined; }
    if (belongs(this.active)) { this.active!.cancelled = true; this.active!.resolve(undefined); }
    try { this.worker.postMessage({ type: 'motion-cancel', sessionId }); }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private submit<T extends NativeReactModel | NativeReactMotionInfo>(input: NativeReactOperation): Promise<T | undefined> {
    if (this.closed) return Promise.reject(new Error('This native renderer is closed.'));
    return new Promise((resolve, reject) => {
      const captured = structuredClone(input);
      this.queued?.resolve(undefined);
      this.queued = { id: ++this.nextId, input: captured, resolve: result => resolve(result as T | undefined), reject };
      this.dispatch();
    });
  }
  dispose() { this.fail(new Error('This native renderer was closed.')); }
  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(new Error('Native rendering timed out.')), this.timeout);
  }
  private dispatch() {
    if (!this.ready || this.active || !this.queued || this.closed) return;
    this.active = this.queued; this.queued = undefined; this.arm();
    try { this.worker.postMessage({ ...this.active.input, id: this.active.id }); }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private receive(message: NativeReactOutput) {
    if (this.closed) return;
    if (message.type === 'ready') { if (this.ready) return; this.ready = true; clearTimeout(this.timer); this.dispatch(); return; }
    if (message.type === 'error' && message.id === undefined) { this.fail(new Error(message.message)); return; }
    if (!this.active || message.id !== this.active.id) return;
    const job = this.active; this.active = undefined; clearTimeout(this.timer);
    if (this.queued || job.cancelled) job.resolve(undefined);
    else if (message.type === 'error') job.reject(new Error(message.message));
    else if (message.type === 'motion-ready' && job.input.type === 'motion-prepare' && message.motion.sessionId === job.input.motion.sessionId) job.resolve(message.motion);
    else if (message.type === 'model' && job.input.type !== 'motion-prepare') job.resolve(message.model);
    else job.reject(new Error('The native renderer returned an unexpected response.'));
    this.dispatch();
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    this.active?.reject(error); this.queued?.reject(error); this.active = undefined; this.queued = undefined;
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null;
    try { this.worker.terminate(); } finally { this.release(); }
  }
}
