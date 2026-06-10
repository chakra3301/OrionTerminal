import { log } from "@/lib/log";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/lib/embeddingsWorker";

// Model load AND inference live in a dedicated Web Worker
// (embeddingsWorker.ts) so neither the ~800KB script parse nor the ~30ms
// per-text inference ever blocks the UI thread. Nothing spawns until the
// first embed/warm call.
let worker: Worker | null = null;
let nextId = 1;
let modelReady = false;
const pending = new Map<
  number,
  { resolve: (v: ArrayBuffer[]) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./embeddingsWorker.ts", import.meta.url), {
    type: "module",
  });
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      modelReady = true;
      p.resolve(msg.vectors);
    } else {
      p.reject(new Error(msg.error));
    }
  };
  w.onerror = (e) => {
    // The worker script itself died (load/parse) — fail everything in
    // flight and let the next call spawn a fresh worker.
    const err = new Error(e.message || "embeddings worker crashed");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

type WorkerCall =
  | { op: "warm" }
  | { op: "embed"; texts: string[] };

function call(req: WorkerCall): Promise<ArrayBuffer[]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: WorkerRequest = { ...req, id };
    getWorker().postMessage(msg);
  });
}

/** True once the model has produced at least one successful response. */
export function isEmbeddingReady(): boolean {
  return modelReady;
}

/** Pre-warm the model (spawns the worker + downloads/loads weights).
 * Safe to call multiple times. */
export async function warmEmbeddings(): Promise<void> {
  try {
    await call({ op: "warm" });
  } catch (err) {
    log.warn("embeddings warm failed", err);
  }
}

/** Embed a single string into a fixed-dim Float32Array. Returns null if
 * the model failed to load (offline first launch, etc.) — callers should
 * fall back to FTS5 in that case. */
export async function embed(text: string): Promise<Float32Array | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const [buf] = await call({ op: "embed", texts: [trimmed] });
    return buf ? new Float32Array(buf) : null;
  } catch (err) {
    log.warn("embed failed", err);
    return null;
  }
}

/** Embed several strings in ONE worker round-trip (order-stable). Used by
 * the codebase indexer where per-call message overhead would add up. */
export async function embedBatch(
  texts: string[],
): Promise<(Float32Array | null)[]> {
  if (texts.length === 0) return [];
  try {
    const bufs = await call({ op: "embed", texts });
    return texts.map((_, i) => (bufs[i] ? new Float32Array(bufs[i]!) : null));
  } catch (err) {
    log.warn("embedBatch failed", err);
    return texts.map(() => null);
  }
}

/** Cosine similarity between two same-length f32 vectors. When both
 * inputs are L2-normalized (which our pipeline produces with
 * `normalize: true`), this reduces to a plain dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

/** Pack a Float32Array into a Uint8Array byte buffer for BLOB storage in
 * SQLite. Round-trips cleanly through `deserializeVector`. */
export function serializeVector(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

/** Inverse of `serializeVector`. Accepts either a Uint8Array or a
 * number[] (which is what `tauri-plugin-sql` sometimes returns for BLOB
 * columns when no special handling is added). */
export function deserializeVector(b: Uint8Array | number[]): Float32Array {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  // Copy into a fresh ArrayBuffer to guarantee 4-byte alignment for
  // Float32Array (BLOB buffers from sqlite are not guaranteed aligned).
  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}

/** Stable hash of an indexable string. Used to skip re-embedding when
 * the underlying entity text hasn't changed. SHA-1 over UTF-8 bytes,
 * hex-encoded. */
export async function hashText(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
