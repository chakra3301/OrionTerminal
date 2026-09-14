import wasmUrl from "onnx-assets/ort-wasm-simd-threaded.wasm?url";
import moduleUrl from "onnx-assets/ort-wasm-simd-threaded.mjs?url";

let configuredPromise: Promise<void> | null = null;

export function configureTransformers(): Promise<void> {
  if (configuredPromise) return configuredPromise;
  configuredPromise = import("@huggingface/transformers").then(({ env }) => {
    // Tauri's catch-all would return index.html for a missing local model.
    env.allowLocalModels = false;
    env.remoteHost = "https://huggingface.co";
    env.useBrowserCache = true;
    // Ship the Safari-compatible factory and matching binary together. No CDN
    // executable downloads or cross-origin-isolation requirement for threads.
    env.useWasmCache = false;
    const wasm = env.backends.onnx.wasm!;
    wasm.numThreads = 1;
    wasm.proxy = false;
    wasm.wasmPaths = {
      wasm: new URL(wasmUrl, globalThis.location.href).href,
      mjs: new URL(moduleUrl, globalThis.location.href).href,
    };
  }).catch((error) => {
    configuredPromise = null;
    throw error;
  });
  return configuredPromise;
}
