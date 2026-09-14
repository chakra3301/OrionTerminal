import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./htmlPreviewBridge", async (original) => ({
  ...await original<typeof import("./htmlPreviewBridge")>(),
  prepareHtmlPreview: (html: string) => ({ srcDoc: html, release: vi.fn() }),
}));
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";
import { useHtmlArtifact } from "./htmlArtifactStore";
import { useXDProjects } from "./projectsStore";
import { useXDesignSaveState } from "./saveState";
import { HTML_PREVIEW_CHANNEL, HTML_PREVIEW_VERSION } from "./htmlPreviewBridge";

let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useXDesignSaveState.setState({ documents: {}, names: {} });
  useXDProjects.setState({ activeId: "a", transitioning: false });
  useHtmlArtifact.getState().setProject("a", { version: 1, html: "<h1>Original</h1>", title: "Page", open: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<HtmlArtifactPreview />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function message(source: Window | null, data: object) {
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { source, data: { channel: HTML_PREVIEW_CHANNEL, version: HTML_PREVIEW_VERSION, ...data } })); });
}

it("reopens the latest edited HTML rather than the iframe's original srcdoc", async () => {
  const frame = host.querySelector("iframe")!;
  await message(frame.contentWindow, { type: "ready" });
  const edit = [...host.querySelectorAll("button")].find(b => b.textContent === " Edit") ?? [...host.querySelectorAll("button")].find(b => b.title.startsWith("Edit elements"))!;
  await act(async () => edit.click());
  await message(frame.contentWindow, { type: "persist", html: "<h1>Edited</h1>" });
  expect(useHtmlArtifact.getState().html).toBe("<h1>Edited</h1>");
  expect(host.textContent).toContain("Unsaved page");
  await act(async () => useHtmlArtifact.getState().close());
  expect(host.querySelector("iframe")).toBeNull();
  await act(async () => useHtmlArtifact.getState().openPreview());
  expect(host.querySelector("iframe")!.getAttribute("srcdoc")).toBe("<h1>Edited</h1>");
});

it("replaces the iframe on project switch and refuses the previous frame's persistence messages", async () => {
  const oldFrame = host.querySelector("iframe")!;
  const oldWindow = oldFrame.contentWindow;
  await act(async () => {
    useXDProjects.setState({ activeId: "b" });
    useHtmlArtifact.getState().setProject("b", { version: 1, html: "<h1>B</h1>", title: "B", open: true });
  });
  expect(host.querySelector("iframe")).not.toBe(oldFrame);
  await message(oldWindow, { type: "persist", html: "<h1>Late A</h1>" });
  expect(useHtmlArtifact.getState().html).toBe("<h1>B</h1>");
  expect(host.querySelector("iframe")!.getAttribute("srcdoc")).toBe("<h1>B</h1>");
});
