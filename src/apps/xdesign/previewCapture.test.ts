import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false, convertFileSrc: (path: string) => path }));
vi.mock("./exportXD", () => ({ computeExportBounds: vi.fn(), renderPngBytes: vi.fn() }));
vi.mock("./fx/fxExport", () => ({ renderFxSnapshot: vi.fn() }));
vi.mock("./model3d/modelRenderBridge", () => ({ getModelRenderBridge: vi.fn() }));
vi.mock("./previewImage", () => ({ loadImageBitmap: vi.fn(), scaleToPng: vi.fn() }));
vi.mock("./photo/resume", () => ({ resumableImage: vi.fn() }));
vi.mock("./pencil/runtime", async (original) => ({ ...await original<typeof import("./pencil/runtime")>(), capturePencilPreview: vi.fn() }));

import { captureProjectPicture } from "./previewCapture";
import { computeExportBounds, renderPngBytes } from "./exportXD";
import { renderFxSnapshot } from "./fx/fxExport";
import { getModelRenderBridge } from "./model3d/modelRenderBridge";
import { loadImageBitmap, scaleToPng } from "./previewImage";
import { resumableImage } from "./photo/resume";
import { capturePencilPreview } from "./pencil/runtime";
import type { PencilDocument } from "./pencil/document";
import { emptyDoc, useXDProjects, type XDProjectKind } from "./projectsStore";
import { useXDesign, type Shape } from "./store";
import { useHtmlArtifact } from "./htmlArtifactStore";
import { useFxStore } from "./fx/fxStore";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FB0", B = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const bytes = new Uint8Array([137, 80, 78, 71]);
const bounds = { x: 0, y: 0, w: 1200, h: 800 };
const drawers = [computeExportBounds, renderPngBytes, renderFxSnapshot, getModelRenderBridge, loadImageBitmap, scaleToPng, capturePencilPreview];
const kind = (value: XDProjectKind) => useXDProjects.setState((s) => ({ registry: s.registry.map((m) => m.id === A ? { ...m, kind: value } : m) }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const drawer of drawers) vi.mocked(drawer).mockReset();
  vi.mocked(resumableImage).mockReset().mockReturnValue(null);
  useXDProjects.setState({ registry: [
    { id: A, name: "A", createdAt: 1, updatedAt: 1 },
    { id: B, name: "B", createdAt: 1, updatedAt: 1 },
  ], openTabs: [A, B], activeId: A, transitioning: false });
  useXDesign.getState().hydrate(emptyDoc());
  useHtmlArtifact.getState().setProject(null);
});

describe("choosing a project's preview picture", () => {
  it("shows the image you were editing, not the board", async () => {
    const documentId = "01ARZ3NDEKTSV4RRFFQ69G5FC0", previewPath = `/data/assets/xdesign/${A}/${documentId}/v1.png`;
    useXDesign.setState({ pencilDocument: {} as PencilDocument, photoDocuments: { [documentId]: {
      id: documentId, version: "v1", name: "r2c", width: 4000, height: 2000, previewWidth: 2048, previewHeight: 1024,
      bundlePath: "/b", previewPath, originalPath: null,
    } } });
    vi.mocked(resumableImage).mockReturnValue({ source: "pencil", placementId: "node-1", documentId });
    const bitmap = { width: 2048, height: 1024, close: vi.fn() };
    vi.mocked(loadImageBitmap).mockResolvedValue(bitmap as unknown as ImageBitmap);
    vi.mocked(scaleToPng).mockResolvedValue(bytes);
    expect(await captureProjectPicture(A, 640)).toBe(bytes);
    expect(loadImageBitmap).toHaveBeenCalledWith(previewPath);
    expect(scaleToPng).toHaveBeenCalledWith(bitmap, 2048, 1024, 640);
    expect(bitmap.close).toHaveBeenCalled();
    expect(capturePencilPreview).not.toHaveBeenCalled();
    expect(renderPngBytes).not.toHaveBeenCalled();
  });

  it("keeps today's thumbnail while the project's Claude page is open, and draws the board once it's closed", async () => {
    useHtmlArtifact.getState().setProject(A, { version: 1, html: "<main>Hi</main>", title: "Hi", open: true });
    vi.mocked(computeExportBounds).mockReturnValue(bounds);
    vi.mocked(renderPngBytes).mockResolvedValue([...bytes]);
    expect(await captureProjectPicture(A, 640)).toBe("clear");
    expect(renderPngBytes).not.toHaveBeenCalled();
    useHtmlArtifact.setState({ open: false });
    expect(await captureProjectPicture(A, 640)).toEqual(bytes);
  });

  it("draws Pencil boards and clears an empty one", async () => {
    useXDesign.setState({ pencilDocument: {} as PencilDocument });
    vi.mocked(capturePencilPreview).mockResolvedValueOnce(bytes).mockResolvedValueOnce("empty").mockResolvedValueOnce(null);
    expect(await captureProjectPicture(A, 640)).toBe(bytes);
    expect(capturePencilPreview).toHaveBeenCalledWith(640);
    expect(await captureProjectPicture(A, 640)).toBe("clear");
    expect(await captureProjectPicture(A, 640)).toBeNull();
    expect(renderPngBytes).not.toHaveBeenCalled();
  });

  it("draws a legacy board whole, fit to 640", async () => {
    const shapes = [{ id: "s1", kind: "rect", x: 0, y: 0, w: 1200, h: 800 }] as unknown as Shape[];
    useXDesign.setState({ shapes });
    vi.mocked(computeExportBounds).mockReturnValueOnce(bounds).mockReturnValueOnce(bounds).mockReturnValueOnce(null);
    vi.mocked(renderPngBytes).mockResolvedValueOnce([...bytes]).mockResolvedValueOnce(null);
    const picture = await captureProjectPicture(A, 640);
    expect(picture).toBeInstanceOf(Uint8Array);
    expect(picture).toEqual(bytes);
    expect(computeExportBounds).toHaveBeenCalledWith(shapes, new Set());
    expect(renderPngBytes).toHaveBeenCalledWith(bounds, 640, false);
    expect(await captureProjectPicture(A, 640)).toBeNull();
    expect(await captureProjectPicture(A, 640)).toBe("clear");
  });

  it("draws FX at the start of the timeline, fit to 640", async () => {
    kind("fx");
    const scene = { ...useFxStore.getState().scene, width: 1920, height: 1080 };
    useFxStore.setState({ scene });
    // jsdom's Blob has no arrayBuffer().
    vi.mocked(renderFxSnapshot).mockResolvedValueOnce({ arrayBuffer: async () => bytes.slice().buffer } as Blob).mockResolvedValueOnce(null);
    expect(await captureProjectPicture(A, 640)).toEqual(bytes);
    expect(renderFxSnapshot).toHaveBeenCalledWith(scene, 0, 640, 360);
    expect(await captureProjectPicture(A, 640)).toBeNull();
    expect(renderPngBytes).not.toHaveBeenCalled();
  });

  it("draws 3D from the open viewport, and nothing when it isn't mounted", async () => {
    kind("model");
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 960;
    const captureReviewShot = vi.fn(async (): Promise<HTMLCanvasElement | null> => canvas);
    vi.mocked(getModelRenderBridge).mockReturnValue({ captureReviewShot, captureOrbit: vi.fn() });
    vi.mocked(scaleToPng).mockResolvedValue(bytes);
    expect(await captureProjectPicture(A, 640)).toBe(bytes);
    expect(scaleToPng).toHaveBeenCalledWith(canvas, 1280, 960, 640);
    captureReviewShot.mockResolvedValueOnce(null);
    expect(await captureProjectPicture(A, 640)).toBeNull();
    vi.mocked(getModelRenderBridge).mockReturnValue(null);
    expect(await captureProjectPicture(A, 640)).toBeNull();
    expect(renderPngBytes).not.toHaveBeenCalled();
  });

  it("draws nothing for a project that isn't the active one", async () => {
    useXDProjects.setState({ activeId: B });
    expect(await captureProjectPicture(A, 640)).toBeNull();
    useXDProjects.setState({ activeId: null });
    expect(await captureProjectPicture(A, 640)).toBeNull();
    for (const drawer of drawers) expect(drawer).not.toHaveBeenCalled();
  });
});
