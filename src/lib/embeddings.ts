import { log } from "@/lib/log";
import { configureTransformers } from "@/lib/transformersEnv";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// The transformers package is ~1.2MB minified — load it on first use via a
// dynamic import so it lands in its own code-split chunk instead of the
// main bundle. Until something calls embed/warm, nothing downloads.
type EmbedPipeline = (
  text: string,
  opts: { pooling: "mean" | "none"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let pipelinePromise: Promise<EmbedPipeline> | null = null;

function getPipeline(): Promise<EmbedPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    await configureTransformers();
    const mod = await import("@xenova/transformers");
    return (await mod.pipeline("feature-extraction", MODEL_ID, {
      quantized: true,
    })) as unknown as EmbedPipeline;
  })().catch((err) => {
    pipelinePromise = null;
    throw err;
  });
  return pipelinePromise;
}

/** True once the model has loaded successfully. Useful for surfacing
 * readiness in the UI ("indexing…" spinner). */
export function isEmbeddingReady(): boolean {
  return pipelinePromise !== null;
}

/** Pre-warm the model. Safe to call multiple times. */
export async function warmEmbeddings(): Promise<void> {
  try {
    await getPipeline();
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
    const pipe = await getPipeline();
    const output = await pipe(trimmed, { pooling: "mean", normalize: true });
    return new Float32Array(output.data as Float32Array);
  } catch (err) {
    log.warn("embed failed", err);
    return null;
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
