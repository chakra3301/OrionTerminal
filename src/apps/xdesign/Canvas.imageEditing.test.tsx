import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { XDesignCanvas } from "./Canvas";
import { useXDesign } from "./store";
import { useXDProjects } from "./projectsStore";
import { usePhotoWorkspace } from "./photo/runtime";
import { usePencilWorkspace } from "./pencil/runtime";
import type { PhotoDocument, PhotoReply } from "./photo/types";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke, convertFileSrc: (path: string) => path }));
let root: Root, container: HTMLDivElement, photo: PhotoDocument, shapeId: string;
const mouseDown = async (detail: number) => act(async () => {
  container.querySelector("image")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail }));
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  invoke.mockReset(); useXDesign.getState().hydrate(null);
  usePencilWorkspace.setState({ editor: null, busy: false });
  usePhotoWorkspace.setState({ shapeId: null, documentId: null, busy: false });
  useXDProjects.setState({ activeId: ulid(), transitioning: false, ready: true });
  const version = ulid();
  photo = { id: ulid(), version, name: "Legacy.psd", width: 800, height: 600, previewWidth: 800, previewHeight: 600,
    originalPath: "/images/Legacy.psd", previewPath: `/assets/${version}.png`, bundlePath: `/assets/${version}.pcraft` };
  shapeId = useXDesign.getState().applyPhotoDocument(photo);
  const reply: PhotoReply = { document: photo, warnings: [], state: { name: "Legacy", width: 800, height: 600, mode: "RGB", depth: 8,
    resolution: 72, activeLayer: null, hasSelection: false, selectionBounds: null, canUndo: false, canRedo: false, layers: [] } };
  invoke.mockResolvedValue(reply);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<XDesignCanvas/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.setState({ shapeId: null, busy: false }); vi.unstubAllGlobals(); });

describe("legacy image activation", () => {
  it("keeps the grid and opens a PSD's saved image document on the second mouse-down", async () => {
    expect(container.querySelector('pattern[id="xd-grid"]')).toBeTruthy();
    await mouseDown(1); expect(invoke).not.toHaveBeenCalled();
    await mouseDown(2);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("xdesign_photo_open", expect.objectContaining({ photoId: photo.id,
      version: photo.version, sourcePath: photo.originalPath }));
    expect(usePhotoWorkspace.getState()).toMatchObject({ shapeId, documentId: photo.id, source: "legacy" });
  });
  it("does not activate a locked image or start a second image operation", async () => {
    await act(async () => useXDesign.getState().updateShape(shapeId, { locked: true })); await mouseDown(2);
    await act(async () => useXDesign.getState().updateShape(shapeId, { locked: false }));
    usePhotoWorkspace.setState({ busy: true }); await mouseDown(2);
    expect(invoke).not.toHaveBeenCalled();
  });
});
