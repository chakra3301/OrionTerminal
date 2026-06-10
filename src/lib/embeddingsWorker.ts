/** Dedicated Web Worker that owns the sentence-embedding model. Model load
 * (~800KB script + quantized MiniLM weights) and every inference run happen
 * here, off the main thread, so indexing never janks the UI (Tier 3 perf).
 * The IndexedDB model cache is origin-scoped, so the worker shares the
 * already-downloaded weights with any prior main-thread runs. */
import { pipeline, env } from "@xenova/transformers";

// Same env shape as transformersEnv.ts (which main-thread Whisper still
// uses): the library's relative "local model" probe resolves to the Tauri
// custom-protocol catch-all and returns index.html, so skip straight to
// the CDN. Weights cache in IndexedDB either way.
env.allowLocalModels = false;
env.remoteHost = "https://huggingface.co";
env.useBrowserCache = true;

export type WorkerRequest =
  | { id: number; op: "warm" }
  | { id: number; op: "embed"; texts: string[] };

export type WorkerResponse =
  | { id: number; ok: true; vectors: ArrayBuffer[] }
  | { id: number; ok: false; error: string };

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

type EmbedPipeline = (
  text: string,
  opts: { pooling: "mean" | "none"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let pipePromise: Promise<EmbedPipeline> | null = null;

function getPipe(): Promise<EmbedPipeline> {
  if (!pipePromise) {
    pipePromise = pipeline("feature-extraction", MODEL_ID, { quantized: true })
      .then((p) => p as unknown as EmbedPipeline)
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
      ctx.postMessage({ id: req.id, ok: true, vectors: [] });
      return;
    }
    const vectors: ArrayBuffer[] = [];
    for (const text of req.texts) {
      const out = await pipe(text, { pooling: "mean", normalize: true });
      // Copy out of the model's reusable output buffer before transferring.
      vectors.push(new Float32Array(out.data).buffer);
    }
    ctx.postMessage({ id: req.id, ok: true, vectors }, vectors);
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
