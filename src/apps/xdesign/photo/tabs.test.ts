import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { editPencilImage } from "../pencil/runtime";
import { addPhotoTabs, editImage, finishSmartContents, resumeSmartContents, usePhotoWorkspace } from "./runtime";
import { activateTab, closeAllTabs, closeOtherTabs, closeTab, closeVanishedTab, cycleTab, leaveImageEditor, tabDocumentId } from "./tabs";
import type { PhotoDocument, PhotoReply, PhotoTab } from "./types";

const invoke = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), editImage: vi.fn(), resumeSmartContents: vi.fn(), finishSmartContents: vi.fn() }));
vi.mock("../pencil/runtime", async original => ({ ...await original<typeof import("../pencil/runtime")>(), editPencilImage: vi.fn() }));

let projectId: string;
const docs: Record<string, PhotoDocument> = {};
const image = (name: string) => { const version = ulid(), doc: PhotoDocument = { id: ulid(), version, name, width: 20, height: 16, previewWidth: 20, previewHeight: 16, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null }; const shape = useXDesign.getState().applyPhotoDocument(doc); docs[shape] = doc; return shape; };
const show = (shapeId: string, source: PhotoTab["source"] = "legacy") => usePhotoWorkspace.setState({ shapeId, documentId: docs[shapeId]?.id ?? ulid(), projectId, source, smartTrail: [] });
const tabs = () => usePhotoWorkspace.getState().tabs.map(tab => tab.placementId);
const active = () => usePhotoWorkspace.getState().shapeId;
const legacy = (placementId: string): PhotoTab => ({ source: "legacy", placementId });
const remove = (shapeId: string) => useXDesign.setState(state => ({ shapes: state.shapes.filter(shape => shape.id !== shapeId) }));
let a: string, b: string, c: string;
const withContents = (shapeId: string) => {
  const child = ulid(), trail = [{ parent: docs[shapeId]!, childId: child, layer: 2, past: [], future: [] }];
  show(shapeId); usePhotoWorkspace.setState({ documentId: child, smartTrail: trail });
  useXDesign.setState(state => ({ photoDrafts: [...state.photoDrafts, { id: child, shapeId, source: "legacy", updatedAt: 1, trail }] }));
  return child;
};

beforeEach(() => {
  invoke.mockReset(); useXDesign.getState().hydrate(null); usePhotoWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close();
  projectId = ulid(); useXDProjects.setState({ activeId: projectId, transitioning: false });
  vi.mocked(editImage).mockReset().mockImplementation(async shapeId => { await Promise.resolve(); show(shapeId); });
  vi.mocked(editPencilImage).mockReset().mockImplementation(async nodeId => { show(nodeId, "pencil"); });
  vi.mocked(resumeSmartContents).mockReset().mockImplementation(async draftId => { const draft = useXDesign.getState().photoDrafts.find(item => item.id === draftId)!; usePhotoWorkspace.setState({ shapeId: draft.shapeId, documentId: draft.trail.at(-1)!.childId, source: draft.source, projectId, smartTrail: draft.trail }); });
  vi.mocked(finishSmartContents).mockReset().mockImplementation(async () => { usePhotoWorkspace.setState(state => ({ smartTrail: state.smartTrail.slice(0, -1) })); });
  a = image("First"); b = image("Second"); c = image("Third");
});
afterEach(() => { usePhotoWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close(); useXDProjects.setState({ activeId: null }); });

describe("The tab list", () => {
  it("adds a tab for every image opened and keeps one per placement", () => {
    show(a); show(b); show(a);
    expect(tabs()).toEqual([a, b]); expect(active()).toBe(a);
    expect(usePhotoWorkspace.getState().tabProject).toBe(projectId);
  });
  it("a different project starts a new tab list", () => {
    show(a); show(b);
    projectId = ulid(); useXDProjects.setState({ activeId: projectId }); show(c);
    expect(tabs()).toEqual([c]); expect(usePhotoWorkspace.getState().tabProject).toBe(projectId);
  });
  it("close clears the tabs, leave keeps them", () => {
    show(a); show(b);
    usePhotoWorkspace.getState().leave();
    expect(active()).toBeNull(); expect(tabs()).toEqual([a, b]);
    show(c); expect(tabs()).toEqual([a, b, c]);
    usePhotoWorkspace.getState().close();
    expect(tabs()).toEqual([]); expect(usePhotoWorkspace.getState().tabProject).toBeNull();
  });
  it("creates a tab per new image", () => {
    show(a);
    addPhotoTabs("legacy", [a, b, c], projectId);
    expect(tabs()).toEqual([a, b, c]);
  });
});

describe("Switching tabs", () => {
  it("activates a tab through its opener", async () => {
    show(a); show(b);
    await activateTab(legacy(a));
    expect(editImage).toHaveBeenCalledWith(a); expect(active()).toBe(a);
    await activateTab(legacy(a));
    expect(editImage).toHaveBeenCalledTimes(1);
    addPhotoTabs("pencil", ["1:5"], projectId);
    await activateTab({ source: "pencil", placementId: "1:5" });
    expect(editPencilImage).toHaveBeenCalledWith("1:5");
  });
  it("switching away keeps open contents and coming back reopens them", async () => {
    const child = ulid(), trail = [{ parent: docs[a]!, childId: child, layer: 2, past: [], future: [] }];
    show(b); show(a); usePhotoWorkspace.setState({ documentId: child, smartTrail: trail });
    useXDesign.setState({ photoDrafts: [{ id: child, shapeId: a, source: "legacy", updatedAt: 1, trail }] });
    await activateTab(legacy(b));
    expect(usePhotoWorkspace.getState().tabs.find(tab => tab.placementId === a)?.draftId).toBe(child);
    await activateTab(legacy(a));
    expect(resumeSmartContents).toHaveBeenCalledWith(child); expect(editImage).toHaveBeenCalledTimes(1);
    expect(usePhotoWorkspace.getState().smartTrail).toEqual(trail);
    expect(usePhotoWorkspace.getState().tabs.find(tab => tab.placementId === a)?.draftId).toBeUndefined();
  });
  it("opens the image itself when its contents draft is gone", async () => {
    show(b); show(a); usePhotoWorkspace.setState({ smartTrail: [{ parent: docs[a]!, childId: ulid(), layer: 2, past: [], future: [] }] });
    await activateTab(legacy(b)); await activateTab(legacy(a));
    expect(resumeSmartContents).not.toHaveBeenCalled(); expect(editImage).toHaveBeenLastCalledWith(a);
  });
  it("cycles with wrap", async () => {
    show(a); show(b); show(c);
    await cycleTab(1); expect(active()).toBe(a);
    await cycleTab(-1); expect(active()).toBe(c);
    await cycleTab(-1); expect(active()).toBe(b);
  });
  it("switches page to a legacy tab on another page", async () => {
    const actual = await vi.importActual<typeof import("./runtime")>("./runtime");
    vi.mocked(editImage).mockImplementation(actual.editImage);
    const first = useXDesign.getState().activePageId;
    show(a);
    useXDesign.getState().newPage("Two");
    const other = image("Elsewhere");
    useXDesign.getState().switchPage(first);
    addPhotoTabs("legacy", [other], projectId);
    expect(tabDocumentId(legacy(other))).toBe(docs[other]!.id);
    invoke.mockImplementation(async () => ({ document: docs[other], state: { name: "Elsewhere", width: 20, height: 16, mode: "RGB", depth: 8, resolution: 72, activeLayer: 1, hasSelection: false, selectionBounds: null, layers: [], canUndo: false, canRedo: false, paths: { saved: [], work: false } }, warnings: [] }) as PhotoReply);
    await activateTab(legacy(other));
    expect(useXDesign.getState().activePageId).not.toBe(first);
    expect(active()).toBe(other); expect(usePhotoWorkspace.getState().documentId).toBe(docs[other]!.id);
    remove(other); expect(tabDocumentId(legacy(other))).toBeNull();
  });
  it("refuses to switch or close while busy", async () => {
    show(a); show(b); show(c);
    usePhotoWorkspace.setState({ busy: true });
    await activateTab(legacy(a)); await closeTab(); await closeTab(legacy(a)); closeAllTabs(); closeOtherTabs(); leaveImageEditor();
    expect(editImage).not.toHaveBeenCalled(); expect(tabs()).toEqual([a, b, c]); expect(active()).toBe(c);
  });
  it("waits for a quiet commit instead of dropping the switch", async () => {
    show(a); show(b); show(c); usePhotoWorkspace.setState({ busy: true, quiet: true });
    await activateTab(legacy(a)); expect(editImage).toHaveBeenLastCalledWith(a);
    await cycleTab(1); expect(editImage).toHaveBeenLastCalledWith(b);
    await closeTab(legacy(c)); expect(tabs()).toEqual([a, b]);
    await closeOtherTabs(); expect(tabs()).toEqual([b]);
  });
});

describe("Closing tabs", () => {
  it("closing the active tab activates its right neighbour, else its left", async () => {
    show(a); show(b); show(c); await activateTab(legacy(b));
    useXDesign.setState({ photoResume: { source: "legacy", placementId: b, documentId: docs[b]!.id } });
    await closeTab(); expect(active()).toBe(c); expect(tabs()).toEqual([a, c]);
    await closeTab(); expect(active()).toBe(a); expect(tabs()).toEqual([a]);
    useXDesign.setState({ photoResume: { source: "legacy", placementId: a, documentId: docs[a]!.id } });
    await closeTab(); expect(active()).toBeNull(); expect(tabs()).toEqual([]); expect(useXDesign.getState().photoResume).toBeNull();
  });
  it("keeps the tab open when its neighbour fails to open", async () => {
    show(a); show(b);
    vi.mocked(editImage).mockRejectedValueOnce(new Error("missing"));
    await expect(closeTab()).rejects.toThrow("missing");
    expect(active()).toBe(b); expect(tabs()).toEqual([a, b]);
  });
  it("closing a background tab only removes it", async () => {
    show(a); show(b);
    await closeTab(legacy(a));
    expect(editImage).not.toHaveBeenCalled(); expect(tabs()).toEqual([b]); expect(active()).toBe(b);
  });
  it("closing the active tab with contents open saves them first", async () => {
    show(a); show(b); usePhotoWorkspace.setState({ smartTrail: [{ parent: docs[b]!, childId: ulid(), layer: 2, past: [], future: [] }] });
    await closeTab();
    expect(finishSmartContents).toHaveBeenCalledWith(true); expect(tabs()).toEqual([a, b]); expect(editImage).not.toHaveBeenCalled();
  });
  it("closing a background tab saves its open contents first", async () => {
    show(b); const child = withContents(a); await activateTab(legacy(b));
    await closeTab(legacy(a));
    expect(resumeSmartContents).toHaveBeenCalledWith(child); expect(finishSmartContents).toHaveBeenCalledWith(true);
    expect(tabs()).toEqual([b]); expect(active()).toBe(b); expect(usePhotoWorkspace.getState().smartTrail).toEqual([]);
  });
  it("close others saves open contents in the tabs it closes", async () => {
    show(b); const child = withContents(a); await activateTab(legacy(c));
    await closeOtherTabs();
    expect(resumeSmartContents).toHaveBeenCalledWith(child); expect(finishSmartContents).toHaveBeenCalledTimes(1);
    expect(tabs()).toEqual([c]); expect(active()).toBe(c);
  });
  it("close all saves open contents first", async () => {
    show(a); withContents(b);
    await closeAllTabs();
    expect(finishSmartContents).toHaveBeenCalledWith(true); expect(active()).toBeNull(); expect(tabs()).toEqual([]);
  });
  it("a tab whose contents fail to save stays open", async () => {
    show(b); withContents(a); await activateTab(legacy(b));
    vi.mocked(finishSmartContents).mockRejectedValueOnce(new Error("The parent changed"));
    await expect(closeTab(legacy(a))).rejects.toThrow("The parent changed");
    expect(tabs()).toEqual([b, a]); expect(active()).toBe(a);
  });
  it("close all and close others", () => {
    show(a); show(b); show(c);
    closeOtherTabs(); expect(tabs()).toEqual([c]); expect(active()).toBe(c);
    show(a); useXDesign.setState({ photoResume: { source: "legacy", placementId: a, documentId: docs[a]!.id } });
    closeAllTabs(); expect(active()).toBeNull(); expect(tabs()).toEqual([]); expect(useXDesign.getState().photoResume).toBeNull();
  });
  it("the vanished active tab hands over to its neighbour", async () => {
    show(b); show(a); remove(a);
    closeVanishedTab(); closeVanishedTab();
    await vi.waitFor(() => expect(active()).toBe(b));
    expect(editImage).toHaveBeenCalledTimes(1); expect(tabs()).toEqual([b]);
    remove(b); closeVanishedTab();
    expect(active()).toBeNull(); expect(tabs()).toEqual([]);
  });
  it("leaving keeps the tabs and forgets the resume", () => {
    show(a); show(b); useXDesign.setState({ photoResume: { source: "legacy", placementId: b, documentId: docs[b]!.id } });
    leaveImageEditor();
    expect(active()).toBeNull(); expect(tabs()).toEqual([a, b]); expect(useXDesign.getState().photoResume).toBeNull();
  });
});
