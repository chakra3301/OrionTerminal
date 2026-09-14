import { afterEach, expect, it, vi } from "vitest";
import { InferenceClient } from "./inferenceClient";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
const asWorker = (worker: FakeWorker) => worker as unknown as Worker;
afterEach(() => vi.useRealTimers());

it("resets a poisoned runtime, rejects pending work, and ignores stale replies", async () => {
  const old = new FakeWorker(), next = new FakeWorker();
  const create = vi.fn().mockReturnValueOnce(asWorker(old)).mockReturnValueOnce(asWorker(next));
  const client = new InferenceClient<object, string>(create);
  const first = client.request({}), second = client.request({});
  const outcomes = Promise.allSettled([first, second]);
  old.reply({ id: 1, ok: false, error: "model load failed" });
  expect((await outcomes).every(r => r.status === "rejected")).toBe(true);
  expect(old.terminate).toHaveBeenCalledOnce();
  expect(client.ready).toBe(false);
  const retry = client.request({});
  old.reply({ id: 3, ok: true, value: "stale" });
  next.reply({ id: 3, ok: true, value: "fresh" });
  expect(await retry).toBe("fresh");
  expect(client.ready).toBe(true);
});

it("cleans up a synchronous worker startup failure and permits retry", async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker();
  const create = vi.fn().mockImplementationOnce(() => { throw Error("startup failed"); }).mockReturnValue(asWorker(worker));
  const client = new InferenceClient<object, string>(create);
  await expect(client.request({})).rejects.toThrow("startup failed");
  expect(vi.getTimerCount()).toBe(0);
  const retry = client.request({});
  worker.reply({ id: 2, ok: true, value: "ok" });
  expect(await retry).toBe("ok");
});

it("terminates timed-out work rather than leaving an infinite pending promise", async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker();
  const client = new InferenceClient<object, string>(() => asWorker(worker), 100);
  const result = expect(client.request({})).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await result;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["onerror", "onmessageerror"] as const)("resets on %s", async event => {
  const worker = new FakeWorker();
  const client = new InferenceClient<object, string>(() => asWorker(worker));
  const result = expect(client.request({})).rejects.toThrow();
  if (event === "onerror") worker.onerror?.({ message: "crash" } as ErrorEvent);
  else worker.onmessageerror?.();
  await result;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
