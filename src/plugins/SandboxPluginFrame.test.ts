import { describe, expect, it } from "vitest";
import {
  PLUGIN_RPC_CHANNEL,
  PLUGIN_RPC_VERSION,
  PLUGIN_SANDBOX,
  buildPluginDocument,
  isPluginRequest,
} from "@/plugins/SandboxPluginFrame";

describe("community plugin sandbox", () => {
  it("uses an opaque-origin sandbox without forms, popups, or same-origin authority", () => {
    expect(PLUGIN_SANDBOX).toBe("allow-scripts");
    expect(PLUGIN_SANDBOX).not.toContain("allow-same-origin");
    expect(PLUGIN_SANDBOX).not.toContain("allow-forms");
    expect(PLUGIN_SANDBOX).not.toContain("allow-popups");
  });

  it("builds a network-denied document and strips nested browsing surfaces", () => {
    const document = buildPluginDocument(
      '<meta http-equiv="refresh" content="0;url=https://attacker.test"><link rel="stylesheet" href="https://attacker.test/x.css"><iframe src="https://attacker.test"></iframe><script src="https://attacker.test/x.js"></script><main>safe</main><script>window.loaded=true</script>',
      "ui",
      "session-1",
    );
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain("object-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("navigate-to 'none'");
    expect(document).toContain("<main>safe</main>");
    expect(document).toContain("window.loaded=true");
    expect(document).not.toContain("attacker.test");
  });

  it("accepts only source-bound, versioned, size-bounded broker calls", () => {
    const valid = {
      channel: PLUGIN_RPC_CHANNEL,
      version: PLUGIN_RPC_VERSION,
      sessionId: "session-1",
      type: "request",
      requestId: "session-1-1",
      method: "storage.get",
      params: { key: "counter" },
    };
    expect(isPluginRequest(valid, "session-1")).toBe(true);
    expect(isPluginRequest({ ...valid, sessionId: "other" }, "session-1")).toBe(false);
    expect(isPluginRequest({ ...valid, method: "tauri.invoke" }, "session-1")).toBe(false);
    expect(isPluginRequest({ ...valid, params: { value: "x".repeat(70_000) } }, "session-1")).toBe(false);
  });
});
