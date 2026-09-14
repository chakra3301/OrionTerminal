import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ env: {
  allowLocalModels: true, remoteHost: "", useBrowserCache: false, useWasmCache: true,
  backends: { onnx: { wasm: {} as Record<string, unknown> | undefined } },
} }));
vi.mock("@huggingface/transformers", () => mock);
beforeEach(() => {
  vi.resetModules();
  mock.env.backends.onnx.wasm = {};
});

it("uses same-origin paired WASM/factory assets with no CDN executable fetch or threads", async () => {
  const { configureTransformers } = await import("./transformersEnv");
  const first = configureTransformers();
  expect(configureTransformers()).toBe(first);
  await first;
  expect(mock.env.allowLocalModels).toBe(false);
  expect(mock.env.useBrowserCache).toBe(true);
  expect(mock.env.useWasmCache).toBe(false);
  const wasm = mock.env.backends.onnx.wasm!;
  expect(wasm.numThreads).toBe(1);
  expect(wasm.proxy).toBe(false);
  const paths = wasm.wasmPaths as { mjs: string; wasm: string };
  for (const url of Object.values(paths)) expect(new URL(url).origin).toBe(location.origin);
  expect(paths.mjs).toContain("ort-wasm-simd-threaded.mjs");
  expect(paths.wasm).toContain("ort-wasm-simd-threaded.wasm");
});

it("allows retry after setup failure rather than retaining a rejected promise", async () => {
  const { configureTransformers } = await import("./transformersEnv");
  mock.env.backends.onnx.wasm = undefined;
  await expect(configureTransformers()).rejects.toThrow();
  mock.env.backends.onnx.wasm = {};
  await expect(configureTransformers()).resolves.toBeUndefined();
});
