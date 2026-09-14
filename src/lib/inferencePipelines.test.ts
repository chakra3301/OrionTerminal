import { beforeEach, expect, it, vi } from "vitest";
import { createEmbeddingPipeline, createSpeechPipeline } from "./inferencePipelines";

const mocks = vi.hoisted(() => ({
  configure: vi.fn(async () => {}),
  pipeline: vi.fn(async () => () => {}),
}));
vi.mock("./transformersEnv", () => ({ configureTransformers: mocks.configure }));
vi.mock("@huggingface/transformers", () => ({ pipeline: mocks.pipeline }));
beforeEach(() => vi.clearAllMocks());

it("retains MiniLM q8 embeddings on the WASM backend", async () => {
  await createEmbeddingPipeline();
  expect(mocks.configure).toHaveBeenCalledOnce();
  expect(mocks.pipeline).toHaveBeenCalledWith("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8", device: "wasm" });
});

it("avoids the extended QDQ optimizer that rejects the merged Whisper decoder", async () => {
  await createSpeechPipeline();
  expect(mocks.pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    dtype: "q8", device: "wasm", session_options: { graphOptimizationLevel: "basic" },
  });
});

it("does not start model loading before environment setup succeeds", async () => {
  mocks.configure.mockRejectedValueOnce(Error("configuration failed"));
  await expect(createEmbeddingPipeline()).rejects.toThrow("configuration failed");
  expect(mocks.pipeline).not.toHaveBeenCalled();
});
