import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onMounted, onUnmounted, ref } from "vue";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { ulid } from "ulid";
import { mountPencilCanvas } from "./CanvasHost";
import { usePencilWorkspace } from "./runtime";
import { usePhotoWorkspace } from "../photo/runtime";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import type { PhotoDocument, PhotoReply } from "../photo/types";

const host = vi.hoisted(() => ({ invoke: vi.fn(), upstreamDoubleClick: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: host.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@open-pencil/vue", () => ({
  useCanvas: () => ({ hitTestSectionTitle: () => null, hitTestComponentLabel: () => null, hitTestFrameTitle: () => null }),
  useCanvasInput: (canvas: { value: HTMLCanvasElement }) => {
    onMounted(() => canvas.value.addEventListener("dblclick", host.upstreamDoubleClick));
    onUnmounted(() => canvas.value.removeEventListener("dblclick", host.upstreamDoubleClick));
    return { cursorOverride: ref(null) };
  },
  useTextEdit: vi.fn(), toolCursor: () => "default",
}));

let editor: Editor, element: HTMLDivElement, canvas: HTMLCanvasElement, unmount: () => void, imageId: string, frameId: string, photo: PhotoDocument, reply: PhotoReply;
const doubleClick = (x = 150, y = 150) => canvas.dispatchEvent(new MouseEvent("dblclick", {
  bubbles: true, cancelable: true, button: 0, detail: 2,
  clientX: 10 + editor.state.panX + x * editor.state.zoom,
  clientY: 20 + editor.state.panY + y * editor.state.zoom,
}));
beforeEach(() => {
  host.invoke.mockReset(); host.upstreamDoubleClick.mockClear(); useXDesign.getState().hydrate(null);
  const projectId = ulid(); useXDProjects.setState({ activeId: projectId, transitioning: false, ready: true });
  usePhotoWorkspace.setState({ shapeId: null, documentId: null, busy: false });
  editor = createEditor(); usePencilWorkspace.setState({ editor, busy: false, error: null });
  frameId = editor.graph.createNode("FRAME", editor.state.currentPageId, { x: 100, y: 100, width: 200, height: 200, clipsContent: true }).id;
  photo = { id: ulid(), version: ulid(), name: "Poster.psd", width: 800, height: 600, previewWidth: 800, previewHeight: 600,
    originalPath: "/images/Poster.psd", previewPath: "", bundlePath: "" };
  photo.previewPath = `/assets/${photo.version}.png`; photo.bundlePath = `/assets/${photo.version}.pcraft`;
  useXDesign.setState({ photoDocuments: { [photo.id]: photo } });
  imageId = editor.graph.createNode("RECTANGLE", frameId, { x: 20, y: 20, width: 80, height: 80,
    fills: [{ type: "IMAGE", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: "preview" }],
    pluginData: [{ pluginId: "orion.xdesign", key: "photoDocumentId", value: photo.id }],
  }).id;
  reply = { document: photo, warnings: [], state: { name: "Poster", width: 800, height: 600, mode: "RGB", depth: 8,
    resolution: 72, activeLayer: 2, hasSelection: false, selectionBounds: null, canUndo: false, canRedo: false,
    layers: [1, 2].map(id => ({ id, name: `PSD layer ${id}`, kind: "Raster", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false })),
  } };
  host.invoke.mockResolvedValue(reply);
  element = document.createElement("div"); document.body.append(element);
  unmount = mountPencilCanvas(element, editor, () => {}, vi.fn());
  canvas = element.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20 } as DOMRect);
});
afterEach(() => { unmount(); element.remove(); editor.dispose(); usePencilWorkspace.setState({ editor: null }); usePhotoWorkspace.setState({ shapeId: null, busy: false }); });

describe("image activation in the mounted design canvas", () => {
  it("double-clicks a nested PSD into image mode using the layered document, including after pan and zoom", async () => {
    editor.state.panX = 60; editor.state.panY = 40; editor.state.zoom = 2;
    canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(host.invoke).not.toHaveBeenCalled();
    doubleClick(); await vi.waitFor(() => expect(usePhotoWorkspace.getState().shapeId).toBe(imageId));
    expect(host.invoke).toHaveBeenCalledExactlyOnceWith("xdesign_photo_open", expect.objectContaining({ photoId: photo.id,
      version: photo.version, sourcePath: "/images/Poster.psd", sourceData: null }));
    expect(usePhotoWorkspace.getState()).toMatchObject({ source: "pencil", documentId: photo.id, state: { layers: [{ name: "PSD layer 1" }, { name: "PSD layer 2" }] } });
    expect(editor.state.selectedIds.has(imageId)).toBe(true);
    expect(host.upstreamDoubleClick).not.toHaveBeenCalled();
  });
  it("leaves text and empty-space double-clicks with the upstream editor", () => {
    editor.graph.updateNode(imageId, { visible: false });
    editor.graph.createNode("TEXT", frameId, { x: 20, y: 20, width: 80, height: 80, text: "Title" });
    doubleClick(); doubleClick(350, 350);
    expect(host.upstreamDoubleClick).toHaveBeenCalledTimes(2);
    expect(host.invoke).not.toHaveBeenCalled();
  });
  it("does not open locked images, read-only library images, or activate images while drawing or busy", () => {
    editor.graph.updateNode(imageId, { locked: true }); doubleClick();
    editor.graph.updateNode(imageId, { locked: false, internalOnly: true }); doubleClick();
    editor.graph.updateNode(imageId, { internalOnly: false });
    editor.state.activeTool = "RECTANGLE"; doubleClick(); editor.state.activeTool = "SELECT";
    usePhotoWorkspace.setState({ busy: true }); doubleClick(); usePhotoWorkspace.setState({ busy: false });
    usePencilWorkspace.setState({ busy: true }); doubleClick();
    expect(host.invoke).not.toHaveBeenCalled();
  });
  it("respects frame clipping when an image extends outside its parent", () => {
    editor.graph.updateNode(imageId, { x: 150, width: 100 }); doubleClick(320, 150);
    expect(host.invoke).not.toHaveBeenCalled();
  });
  it("opens only once during an in-flight image activation", async () => {
    let finish!: (reply: PhotoReply) => void;
    host.invoke.mockReturnValueOnce(new Promise<PhotoReply>(resolve => { finish = resolve; }));
    doubleClick(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledOnce());
    doubleClick();
    expect(host.invoke).toHaveBeenCalledOnce(); expect(host.upstreamDoubleClick).not.toHaveBeenCalled();
    finish(reply); await vi.waitFor(() => expect(usePhotoWorkspace.getState().shapeId).toBe(imageId));
  });
  it("reports failed opening in the workspace and allows another attempt", async () => {
    host.invoke.mockRejectedValueOnce(new Error("PSD unavailable"));
    doubleClick(); await vi.waitFor(() => expect(usePencilWorkspace.getState().error).toContain("PSD unavailable"));
    await Promise.resolve(); doubleClick();
    await vi.waitFor(() => expect(usePhotoWorkspace.getState().shapeId).toBe(imageId));
    expect(usePencilWorkspace.getState().error).toBeNull();
  });
  it("removes the activation listener when the design canvas unmounts", () => {
    unmount(); unmount = () => {};
    canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    expect(host.invoke).not.toHaveBeenCalled();
  });
});
