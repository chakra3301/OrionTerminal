import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePencilWorkspace } from "../pencil/runtime";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoReply } from "./types";

const invoke = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
const commit = vi.hoisted(() => vi.fn<(document: PhotoDocument, nodeId?: string) => Promise<string>>());
vi.mock("../pencil/runtime", async original => ({ ...await original<typeof import("../pencil/runtime")>(), commitPencilPhoto: commit }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));
let doc: PhotoDocument, projectId: string, shapeId: string;
const image = (name: string): PhotoDocument => { const version = ulid(); return { id: ulid(), version, name, width: 20, height: 16, previewWidth: 20, previewHeight: 16, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null }; };
const ready = (document: PhotoDocument, layers = 1): PhotoReply => ({ document, state: { name: document.name, width: 20, height: 16, mode: "RGB", depth: 8, resolution: 72, activeLayer: 1, hasSelection: false, selectionBounds: null, layers: Array.from({ length: layers }, (_, index) => ({ id: index + 1, name: `Layer ${index}`, kind: "Pixel", visible: true, opacity: 1, fill: 1, blend: "Normal", clipped: false, hasMask: false })), canUndo: false, canRedo: false }, warnings: [], result: null });
beforeEach(() => {
  commit.mockReset(); commit.mockImplementation(async document => { useXDesign.setState(state => ({ photoDocuments: { ...state.photoDocuments, [document.id]: document } })); return `node-${document.name}`; });
  invoke.mockReset(); useXDesign.getState().hydrate(null); usePencilWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close();
  projectId = ulid(); doc = image("Portrait"); shapeId = useXDesign.getState().applyPhotoDocument(doc);
  useXDProjects.setState({ activeId: projectId, transitioning: false });
  usePhotoWorkspace.setState({ shapeId, documentId: doc.id, projectId, source: "legacy", state: ready(doc, 2).state, stateVersion: doc.version, busy: false });
});
afterEach(() => { usePhotoWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close(); useXDProjects.setState({ activeId: null }); });

it("duplicates the image into a new placement and switches the editor to the copy", async () => {
  const copy = image("Portrait copy");
  invoke.mockResolvedValueOnce([ready(copy)]);
  await expect(runPhotoCommand("image.duplicate", { name: "Portrait copy", mergedOnly: true })).resolves.toEqual({ documentIds: [copy.id] });
  expect(invoke).toHaveBeenCalledWith("xdesign_photo_new_documents", { projectId, photoId: doc.id, version: doc.version, command: "image.duplicate", params: { name: "Portrait copy", mergedOnly: true } });
  expect(useXDesign.getState().shapes).toHaveLength(2);
  expect(useXDesign.getState().photoDocuments[doc.id]).toEqual(doc);
  const target = usePhotoWorkspace.getState();
  expect([target.documentId, target.stateVersion, target.state?.name, target.source, target.smartTrail]).toEqual([copy.id, copy.version, "Portrait copy", "legacy", []]);
  expect(target.shapeId).not.toBe(shapeId);
  const placed = useXDesign.getState().shapes.find(shape => shape.id === target.shapeId);
  expect(placed?.kind === "image" && placed.photoDocumentId).toBe(copy.id);
});

it("places every straightened photo through Pencil and edits the last one", async () => {
  useXDesign.setState({ pencilDocument: { formatVersion: 1, graph: "{}", pageId: ulid(), panX: 0, panY: 0, zoom: 1, photoLinks: {} } });
  const photos = [image("Portrait copy 1"), image("Portrait copy 2")];
  invoke.mockResolvedValueOnce(photos.map(photo => ready(photo)));
  await runPhotoCommand("file.automate.cropAndStraightenPhotos", {});
  expect(invoke).toHaveBeenCalledWith("xdesign_photo_new_documents", expect.objectContaining({ command: "file.automate.cropAndStraightenPhotos", params: {} }));
  expect(commit.mock.calls.map(([document]) => document.id)).toEqual(photos.map(photo => photo.id));
  expect(useXDesign.getState().shapes).toHaveLength(1);
  expect(usePhotoWorkspace.getState()).toMatchObject({ documentId: photos[1]!.id, shapeId: "node-Portrait copy 2", source: "pencil" });
});

it("opens a Photomerge or HDR Pro result as a new image", async () => {
  for (const [command, name] of [["file.automate.photomerge", "Untitled_Panorama1"], ["file.automate.mergeToHdrPro", "Untitled_HDR1"]] as const) {
    const merged = image(name), params = { paths: ["/a.jpg", "/b.jpg"], useOpenDocuments: false };
    invoke.mockResolvedValueOnce([ready(merged)]);
    await expect(runPhotoCommand(command, params)).resolves.toEqual({ documentIds: [merged.id] });
    expect(invoke).toHaveBeenLastCalledWith("xdesign_photo_new_documents", expect.objectContaining({ command, params }));
    expect(usePhotoWorkspace.getState().documentId).toBe(merged.id);
  }
});

it("keeps the current image when no photo is found or the project changes meanwhile", async () => {
  invoke.mockRejectedValueOnce("no photos found on a uniform background");
  await expect(runPhotoCommand("file.automate.cropAndStraightenPhotos", {})).rejects.toBe("no photos found on a uniform background");
  expect(usePhotoWorkspace.getState()).toMatchObject({ documentId: doc.id, shapeId, busy: false, error: "no photos found on a uniform background" });
  invoke.mockImplementationOnce(async () => { useXDProjects.setState({ activeId: ulid() }); return [ready(image("Portrait copy"))]; });
  await expect(runPhotoCommand("image.duplicate", { name: "Portrait copy", mergedOnly: false })).rejects.toThrow("project changed");
  expect(useXDesign.getState().shapes).toHaveLength(1);
  expect(usePhotoWorkspace.getState()).toMatchObject({ documentId: doc.id, shapeId });
});
