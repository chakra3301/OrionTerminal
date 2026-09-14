import { describe, expect, it } from "vitest";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import {
  HTML_PREVIEW_BRIDGE_ID,
  HTML_PREVIEW_CHANNEL,
  HTML_PREVIEW_CSP_ID,
  HTML_PREVIEW_SANDBOX,
  HTML_PREVIEW_VERSION,
  parsePreviewEvent,
  prepareHtmlPreview,
  previewCommand,
} from "@/apps/xdesign/htmlPreviewBridge";

const BOOTSTRAP_HASH = tauriConfig.app.security.csp["script-src"].split(/\s+/).find((source) => source.startsWith("'sha256-"))!;
function documents(html: string) {
  const prepared = prepareHtmlPreview(html);
  const guard = new DOMParser().parseFromString(prepared.srcDoc, "text/html");
  const data = JSON.parse(guard.getElementById("xd-preview-payload")!.textContent!);
  return { guard, inner: new DOMParser().parseFromString(data.html, "text/html") };
}

describe("opaque HTML preview preparation", () => {
  it("enables a production shell CSP without inline script authority", () => {
    const csp = tauriConfig.app.security.csp;
    expect(csp).toBeTruthy();
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp["base-uri"]).toBe("'none'");
  });

  it("uses a scripts-only opaque sandbox", () => {
    expect(HTML_PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(HTML_PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    expect(HTML_PREVIEW_SANDBOX).not.toContain("allow-popups");
    expect(HTML_PREVIEW_SANDBOX).not.toContain("allow-forms");
  });

  it("loads one fixed bootstrap and keeps document code inert until inside the child", () => {
    const { guard, inner } = documents(`<meta http-equiv="Content-Security-Policy" content="default-src *">
      <script>window.generated = true</script><script src="https://evil.example/payload.js"></script>`);
    expect(guard.querySelectorAll("script")).toHaveLength(2);
    expect(guard.querySelector("script[src]")).toBeNull();
    expect(guard.getElementById(HTML_PREVIEW_BRIDGE_ID)?.textContent).toContain("parent === window");
    expect(inner.querySelector("script[data-xd-script-type]")?.textContent).toBe("window.generated = true");
    expect(inner.querySelector("script[data-xd-script-type]")?.getAttribute("type")).toBe("application/x-orion-preview-script");
    expect(inner.querySelectorAll("script[src]")).toHaveLength(0);
    expect(inner.body.lastElementChild?.id).toBe(HTML_PREVIEW_BRIDGE_ID);
    expect(inner.documentElement.outerHTML).not.toContain("evil.example");
    const config = JSON.parse(inner.getElementById("xd-preview-payload")!.textContent!);
    expect(config.bridge).toContain(HTML_PREVIEW_CHANNEL);
  });

  it("uses a trusted parent policy to block child self-navigation", () => {
    const { guard, inner } = documents("<h1>Preview</h1>");
    expect(guard.getElementById(HTML_PREVIEW_CSP_ID)?.getAttribute("content")).toContain("frame-src about:");
    for (const doc of [guard, inner]) {
      const csp = doc.getElementById(HTML_PREVIEW_CSP_ID)?.getAttribute("content");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain(`script-src ${BOOTSTRAP_HASH} 'unsafe-eval'`);
      expect(csp).not.toContain("script-src blob:");
      expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    }
    expect(inner.getElementById(HTML_PREVIEW_CSP_ID)?.getAttribute("content")).toContain("frame-src 'none'");
  });

  it("does not let document markup break out of the guard payload", () => {
    const { guard, inner } = documents('<script>window.test = "</script><img id="escape" src=x>"</script><meta http-equiv="refresh" content="0;url=https://evil.example">');
    expect(guard.querySelector("#escape")).toBeNull();
    expect(guard.body.children).toHaveLength(1);
    expect(guard.body.firstElementChild?.id).toBe(HTML_PREVIEW_BRIDGE_ID);
    expect(inner.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it("preserves non-executable metadata and validates startup errors", () => {
    const { inner } = documents('<script type="application/ld+json">{"name":"demo"}</script>');
    expect(inner.querySelector('script[type="application/ld+json"]')?.textContent).toBe('{"name":"demo"}');
    expect(parsePreviewEvent({ channel: HTML_PREVIEW_CHANNEL, version: 1, type: "startup-error", error: "failed" })).toEqual({ type: "startup-error", error: "failed" });
    expect(parsePreviewEvent({ channel: HTML_PREVIEW_CHANNEL, version: 1, type: "startup-error", error: "x".repeat(2001) })).toBeNull();
  });
});

describe("preview RPC validation", () => {
  const selection = {
    path: [0, 1],
    rect: { top: 2, left: 3, width: 100, height: 40 },
    tag: "div",
    className: "card",
    inlineStyle: "color: red",
    outerHTML: '<div class="card">Hi</div>',
    computed: { color: "rgb(255, 0, 0)" },
  };

  it("accepts a bounded selection from the expected protocol", () => {
    expect(
      parsePreviewEvent({
        channel: HTML_PREVIEW_CHANNEL,
        version: HTML_PREVIEW_VERSION,
        type: "selection",
        selection,
      }),
    ).toEqual({ type: "selection", selection });
  });

  it("rejects wrong channels, malformed paths, and non-http links", () => {
    expect(parsePreviewEvent({ channel: "other", version: 1, type: "ready" })).toBeNull();
    expect(
      parsePreviewEvent({
        channel: HTML_PREVIEW_CHANNEL,
        version: HTML_PREVIEW_VERSION,
        type: "selection",
        selection: { ...selection, path: [-1] },
      }),
    ).toBeNull();
    expect(
      parsePreviewEvent({
        channel: HTML_PREVIEW_CHANNEL,
        version: HTML_PREVIEW_VERSION,
        type: "external-link",
        url: "javascript:alert(1)",
      }),
    ).toBeNull();
  });

  it("accepts recording bytes only with a supported extension", () => {
    const bytes = new ArrayBuffer(4);
    expect(
      parsePreviewEvent({
        channel: HTML_PREVIEW_CHANNEL,
        version: HTML_PREVIEW_VERSION,
        type: "record-result",
        requestId: "r1",
        ext: "webm",
        bytes,
      }),
    ).toEqual({ type: "record-result", requestId: "r1", ext: "webm", bytes });
    expect(
      parsePreviewEvent({
        channel: HTML_PREVIEW_CHANNEL,
        version: HTML_PREVIEW_VERSION,
        type: "record-result",
        requestId: "r1",
        ext: "exe",
        bytes,
      }),
    ).toBeNull();
  });

  it("wraps commands in the versioned channel", () => {
    expect(previewCommand({ type: "set-edit", enabled: true })).toEqual({
      channel: HTML_PREVIEW_CHANNEL,
      version: HTML_PREVIEW_VERSION,
      type: "set-edit",
      enabled: true,
    });
  });

});
