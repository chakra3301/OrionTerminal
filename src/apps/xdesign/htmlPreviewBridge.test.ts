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

function factory() {
  const sources: string[] = [];
  const revoked: string[] = [];
  return {
    sources,
    revoked,
    value: {
      create(source: string) {
        sources.push(source);
        return `blob:preview-${sources.length}`;
      },
      revoke(url: string) {
        revoked.push(url);
      },
    },
  };
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

  it("moves generated scripts to blob URLs and installs the bridge first", () => {
    const urls = factory();
    const prepared = prepareHtmlPreview(
      `<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src *">
        <script>window.generated = true</script>
        <script src="https://evil.example/payload.js"></script>
      </head><body onclick="window.clicked=true"><canvas id="scene"></canvas></body></html>`,
      urls.value,
    );
    const doc = new DOMParser().parseFromString(prepared.srcDoc, "text/html");
    const csp = doc.getElementById(HTML_PREVIEW_CSP_ID);
    const scripts = Array.from(doc.querySelectorAll("script"));

    expect(csp?.getAttribute("content")).toContain("script-src blob:");
    expect(csp?.getAttribute("content")).toContain("connect-src 'none'");
    expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(scripts[0]?.id).toBe(HTML_PREVIEW_BRIDGE_ID);
    expect(scripts).toHaveLength(2);
    expect(scripts.every((script) => script.textContent === "")).toBe(true);
    expect(scripts.every((script) => script.getAttribute("src")?.startsWith("blob:"))).toBe(true);
    expect(prepared.srcDoc).not.toContain("https://evil.example/payload.js");
    expect(urls.sources).toHaveLength(2);
    expect(urls.sources.some((source) => source.includes(HTML_PREVIEW_CHANNEL))).toBe(true);
    expect(urls.sources.some((source) => source.includes("window.generated = true"))).toBe(true);

    prepared.release();
    expect(urls.revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  it("releases every generated blob", () => {
    const urls = factory();
    const prepared = prepareHtmlPreview("<script>1</script>", urls.value);
    prepared.release();
    expect(urls.revoked).toHaveLength(2);
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
