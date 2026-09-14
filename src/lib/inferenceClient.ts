export type InferenceReply<T> =
  | { id: number; ok: true; value: T }
  | { id: number; ok: false; error: string };

export class InferenceClient<Request, Value> {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: Value) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  ready = false;

  constructor(private createWorker: () => Worker, private timeoutMs = 180_000) {}

  private reset(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<InferenceReply<Value>>) => {
      if (this.worker !== worker) return;
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (!msg.ok) {
        // A rejected ONNX initialization/run can poison its realm-wide promise
        // chain. Retrying the same worker would replay the error indefinitely.
        this.reset(new Error(msg.error));
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      this.ready = true;
      p.resolve(msg.value);
    };
    worker.onerror = (event) => {
      if (this.worker === worker) this.reset(new Error(event.message || "Inference worker crashed"));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.reset(new Error("Could not decode inference response"));
    };
    this.worker = worker;
    return worker;
  }

  request(request: Request, transfer: Transferable[] = []): Promise<Value> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset(new Error("Local inference timed out. Please retry.")), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.getWorker().postMessage({ ...request, id }, transfer);
      } catch (error) {
        this.reset(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
