import { createSpeechPipeline, type AsrPipeline } from "./inferencePipelines";
import type { InferenceReply } from "./inferenceClient";

export type SpeechRequest = { op: "warm" } | { op: "transcribe"; samples: ArrayBuffer };
let pipeline: Promise<AsrPipeline> | null = null;
const ctx = self as unknown as {
  postMessage(message: InferenceReply<string>): void;
  onmessage: ((event: MessageEvent<SpeechRequest & { id: number }>) => void) | null;
};

ctx.onmessage = async ({ data: request }) => {
  const { id } = request;
  try {
    const pipe = await (pipeline ??= createSpeechPipeline());
    if (request.op === "warm") {
      ctx.postMessage({ id, ok: true, value: "" });
      return;
    }
    // whisper-tiny.en is English-only; v4 rejects task/language overrides.
    const result = await pipe(new Float32Array(request.samples));
    ctx.postMessage({ id, ok: true, value: result.text.trim() });
  } catch (error) {
    ctx.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
