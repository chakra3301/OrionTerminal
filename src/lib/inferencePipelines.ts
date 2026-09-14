import { configureTransformers } from "./transformersEnv";

export type EmbedPipeline = (
  text: string,
  opts: { pooling: "mean" | "none"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

export type AsrPipeline = (
  input: Float32Array,
) => Promise<{ text: string }>;

export async function createEmbeddingPipeline(): Promise<EmbedPipeline> {
  await configureTransformers();
  const { pipeline } = await import("@huggingface/transformers");
  return await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
    device: "wasm",
  }) as unknown as EmbedPipeline;
}

export async function createSpeechPipeline(): Promise<AsrPipeline> {
  await configureTransformers();
  const { pipeline } = await import("@huggingface/transformers");
  return await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    dtype: "q8",
    device: "wasm",
    // ORT's extended QDQ rewrite rejects this older merged q8 decoder's
    // transposed embedding scale. Basic optimization preserves the graph.
    session_options: { graphOptimizationLevel: "basic" },
  }) as unknown as AsrPipeline;
}
