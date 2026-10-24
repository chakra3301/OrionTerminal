import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";
import { preparePluginDocuments } from "./pluginDocument";
import tauri from "../../src-tauri/tauri.conf.json";
import integrity from "../../resources/preview-bootstrap-integrity.json";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const config = (html: string) => JSON.parse(parse(html).querySelector("#xd-preview-payload")!.textContent!);

describe("production SDK document bootstrap", () => {
  it("uses only the existing CSP-pinned evaluator and defers user scripts to the opaque child", () => {
    const docs = preparePluginDocuments('<main>hello</main><script>window.marker = 1</script>', "ui", "/* bridge */", "session");
    for (const html of [docs.guard, docs.content]) {
      const doc = parse(html), script = doc.querySelector("#xd-preview-bridge")!;
      const hash = `'sha256-${createHash("sha256").update(script.textContent!).digest("base64")}'`;
      expect(hash).toBe(integrity.scriptSource);
      expect(tauri.app.security.csp["script-src"]).toContain(hash);
      expect(tauri.app.security.devCsp["script-src"]).toContain(hash);
      expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")).toContain(`script-src ${hash} 'unsafe-eval'`);
      expect(doc.querySelectorAll("script:not([type])")).toHaveLength(1);
    }
    expect(docs.guard).toContain("frame-src about:"); expect(docs.content).toContain("frame-src 'none'");
    expect(parse(docs.content).querySelector('script[data-xd-script-type]')!.getAttribute("type")).toBe("application/x-orion-preview-script");
    expect(config(docs.content).bridge).toBe("/* bridge */");
  });
  it("escapes payload terminators and rejects module imports while supporting background code", () => {
    const docs = preparePluginDocuments('const x = "</script><img src=https://invalid.test>";', "background", "/* bridge */", "session");
    expect(parse(docs.guard).querySelectorAll("img")).toHaveLength(0);
    expect(parse(docs.content).querySelectorAll("img")).toHaveLength(0);
    expect(config(docs.guard).bridge).toContain("frame.sandbox = \"allow-scripts\"");
    expect(() => preparePluginDocuments('<script type="module">import "x"</script>', "ui", "", "s")).toThrow("standalone");
  });
  it("relays only the bound child/session and parent responses, including bounded child startup failure", () => {
    const docs = preparePluginDocuments("<main>test</main>", "ui", "", "session");
    const parent = { postMessage: vi.fn() }, child = { postMessage: vi.fn() }, frame = { contentWindow: child };
    let listener!: (e: { source: unknown; data: unknown }) => void;
    const append = vi.fn();
    runInNewContext(config(docs.guard).bridge, { parent, document: { createElement: () => ({ ...frame, style: {} }), body: { append } }, addEventListener: (_: string, callback: typeof listener) => { listener = callback; } });
    const packet = { channel: "orion-plugin-rpc", version: 1, sessionId: "session", type: "request" };
    listener({ source: {}, data: packet }); listener({ source: child, data: { ...packet, sessionId: "old" } });
    expect(parent.postMessage).not.toHaveBeenCalled();
    listener({ source: child, data: packet }); expect(parent.postMessage).toHaveBeenCalledWith(packet, "*");
    listener({ source: parent, data: { ...packet, type: "response" } }); expect(child.postMessage).toHaveBeenCalledOnce();
    listener({ source: child, data: { channel: "orion:xdesign-preview", version: 1, type: "startup-error", error: "x".repeat(1000) } });
    expect(parent.postMessage.mock.lastCall![0]).toMatchObject({ sessionId: "session", type: "runtime-error", message: "x".repeat(300) });
    expect(append).toHaveBeenCalledOnce();
  });
});
