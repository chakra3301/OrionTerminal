/** Model initialization and inference stay off the UI thread. The browser's
 * origin-scoped Cache API retains downloaded weights when available. */
import { createEmbeddingPipeline, type EmbedPipeline } from "./inferencePipelines";
import type { InferenceReply } from "./inferenceClient";

export type WorkerRequest =
  | { id: number; op: "warm" }
  | { id: number; op: "embed"; texts: string[] };

export type WorkerResponse = InferenceReply<ArrayBuffer[]>;

let pipePromise: Promise<EmbedPipeline> | null = null;

function getPipe(): Promise<EmbedPipeline> {
  if (!pipePromise) {
    pipePromise = createEmbeddingPipeline()
      .catch((err) => {
        pipePromise = null;
        throw err;
      });
  }
  return pipePromise;
}

const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

async function handle(req: WorkerRequest): Promise<void> {
  try {
    const pipe = await getPipe();
    if (req.op === "warm") {
      ctx.postMessage({ id: req.id, ok: true, value: [] });
      return;
    }
    const vectors: ArrayBuffer[] = [];
    for (const text of req.texts) {
      const out = await pipe(text, { pooling: "mean", normalize: true });
      // Copy out of the model's reusable output buffer before transferring.
      vectors.push(new Float32Array(out.data).buffer);
    }
    ctx.postMessage({ id: req.id, ok: true, value: vectors }, vectors);
  } catch (err) {
    ctx.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

ctx.onmessage = (e) => {
  void handle(e.data);
};
