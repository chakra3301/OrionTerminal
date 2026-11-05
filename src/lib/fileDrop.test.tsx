import { useRef, StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { DropEvent } from "./fileDrop";

const webview = vi.hoisted(() => ({ handler: null as null | ((event: { payload: unknown }) => void), unlisten: vi.fn(), listens: 0 }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => { webview.listens += 1; webview.handler = handler; return () => { webview.handler = null; webview.unlisten(); }; } }) }));
const { startFileDropOrchestrator, useFileDropZone } = await import("./fileDrop");

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function Zone({ onDrop }: { onDrop: (event: DropEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFileDropZone(ref, "canvas", onDrop);
  return <div ref={ref}><span>canvas</span></div>;
}

it("keeps one listener through StrictMode's start/release/start and routes Mac point drops unscaled", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
  // App's mount effect under StrictMode: the cancelled first start releases as soon as it resolves.
  const first = startFileDropOrchestrator(), second = startFileDropOrchestrator();
  (await first)();
  const releaseSecond = await second;
  expect(webview.listens).toBe(1);
  expect(webview.unlisten).not.toHaveBeenCalled();

  const onDrop = vi.fn(), host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StrictMode><Zone onDrop={onDrop}/></StrictMode>));
  const span = host.querySelector("span")!;
  const at = vi.fn(() => span);
  document.elementFromPoint = at;
  webview.handler!({ payload: { type: "drop", paths: ["/tmp/photo.png"], position: { x: 300, y: 200 } } });
  expect(at).toHaveBeenCalledWith(300, 200);
  expect(onDrop).toHaveBeenCalledWith({ type: "drop", paths: ["/tmp/photo.png"], point: { x: 300, y: 200 } });

  releaseSecond();
  await Promise.resolve();
  expect(webview.unlisten).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
