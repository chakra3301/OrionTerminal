import { describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => vi.fn());
vi.mock("@monaco-editor/react", () => ({ loader: { config } }));
vi.mock("monaco-editor", () => ({ editor: { local: true }, languages: { retained: true }, typescript: { localWorker: true } }));
vi.mock("monaco-editor/editor/editor.worker?worker", () => ({ default: class { kind = "editor"; } }));
vi.mock("monaco-editor/language/json/json.worker?worker", () => ({ default: class { kind = "json"; } }));
vi.mock("monaco-editor/language/css/css.worker?worker", () => ({ default: class { kind = "css"; } }));
vi.mock("monaco-editor/language/html/html.worker?worker", () => ({ default: class { kind = "html"; } }));
vi.mock("monaco-editor/language/typescript/ts.worker?worker", () => ({ default: class { kind = "typescript"; } }));
import "./monacoRuntime";

describe("offline Monaco runtime", () => {
  it("supplies the installed editor rather than a CDN loader path", () => {
    expect(config).toHaveBeenCalledWith({ monaco: expect.objectContaining({ editor: { local: true }, languages: { retained: true, typescript: { localWorker: true } } }) });
  });
  it.each([["typescript", "typescript"], ["javascript", "typescript"], ["json", "json"], ["scss", "css"], ["html", "html"], ["rust", "editor"]])("routes %s to its local %s worker", (language, kind) => {
    const worker = globalThis.MonacoEnvironment!.getWorker!("", language) as unknown as { kind: string };
    expect(worker.kind).toBe(kind);
  });
});
