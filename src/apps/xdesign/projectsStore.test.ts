import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const mem = new Map<string, unknown>();
  return {
    __mem: mem,
    setXDesignStateAtomic: vi.fn(async (writes: Array<{ key: string; value: unknown }>) => {
      for (const { key, value } of writes) {
        if (value === null) mem.delete(key);
        else mem.set(key, value);
      }
    }),
    getAppState: vi.fn(async (key: string) => (mem.has(key) ? mem.get(key) : null)),
    setAppState: vi.fn(async (key: string, value: unknown) => {
      if (value === null) mem.delete(key);
      else mem.set(key, value);
    }),
  };
});

import * as db from "@/lib/db";
import { useXDProjects, emptyDoc, saveDoc, loadDoc, flushActive } from "./projectsStore";
import { useModelStore } from "./model3d/modelStore";
import { useFxAssist } from "./fx/fxAssist";
import { beginXDesignActivity, runXDesignUiAction } from "./runtimeActivity";
import { useXDesign } from "./store";
import { useHtmlArtifact } from "./htmlArtifactStore";
import { markProjectDirty, useXDesignSaveState } from "./saveState";

const mem = (db as unknown as { __mem: Map<string, unknown> }).__mem;

beforeEach(() => {
  localStorage.clear();
  useHtmlArtifact.getState().setProject(null);
  mem.clear();
  useXDesignSaveState.setState({ documents: {}, names: {} });
  vi.clearAllMocks();
  useXDProjects.setState({ registry: [], openTabs: [], activeId: null, ready: false, loadError: null, transitioning: false });
  useXDesign.getState().hydrate(emptyDoc());
});

describe("xdesign projectsStore", () => {
  it("migrates unopened browser pages into their SQLite documents and retains originals", async () => {
    const a = await useXDProjects.getState().newProject("Legacy A");
    const b = await useXDProjects.getState().newProject("Legacy B");
    for (const id of [a, b]) {
      const { htmlArtifact: _, ...oldDoc } = emptyDoc();
      mem.set(`xdesign.project.${id}`, oldDoc);
      localStorage.setItem(`xd-html-artifact.${id}`, JSON.stringify({ html: `<h1>${id} — 🛰️</h1>`, title: id, open: true }));
    }
    useXDProjects.setState({ ready: false, activeId: null });
    await useXDProjects.getState().init();
    for (const id of [a, b]) {
      const raw = localStorage.getItem(`xd-html-artifact.${id}`)!;
      expect(mem.get(`xdesign.project.${id}`)).toMatchObject({ htmlArtifact: { version: 1, ...JSON.parse(raw) } });
    }
    localStorage.clear();
    await useXDProjects.getState().openProject(a);
    expect(useHtmlArtifact.getState()).toMatchObject({ projectId: a, html: `<h1>${a} — 🛰️</h1>`, open: true });
  });

  it("failed legacy migration preserves both copies and retries without publishing an empty page", async () => {
    const id = await useXDProjects.getState().newProject("Legacy failure");
    const { htmlArtifact: _, ...oldDoc } = emptyDoc();
    mem.set(`xdesign.project.${id}`, oldDoc);
    const raw = JSON.stringify({ html: "<p>Only browser copy</p>", title: "Retain", open: true });
    localStorage.setItem(`xd-html-artifact.${id}`, raw);
    useXDProjects.setState({ ready: false, activeId: null });
    vi.mocked(db.setAppState).mockRejectedValueOnce(new Error("disk full"));
    await expect(useXDProjects.getState().init()).rejects.toThrow("disk full");
    expect(useXDProjects.getState().ready).toBe(false);
    expect(mem.get(`xdesign.project.${id}`)).toEqual(oldDoc);
    expect(localStorage.getItem(`xd-html-artifact.${id}`)).toBe(raw);
    await useXDProjects.getState().init();
    expect(mem.get(`xdesign.project.${id}`)).toMatchObject({ htmlArtifact: { html: "<p>Only browser copy</p>" } });
  });

  it("rejects malformed browser and future database pages without overwriting either", async () => {
    const id = await useXDProjects.getState().newProject();
    const { htmlArtifact: _, ...oldDoc } = emptyDoc();
    mem.set(`xdesign.project.${id}`, oldDoc);
    localStorage.setItem(`xd-html-artifact.${id}`, "broken JSON");
    await expect(loadDoc(id)).rejects.toThrow("could not be migrated");
    expect(localStorage.getItem(`xd-html-artifact.${id}`)).toBe("broken JSON");
    expect(mem.get(`xdesign.project.${id}`)).toEqual(oldDoc);
    const future = { ...oldDoc, htmlArtifact: { version: 2, html: "<p>Future</p>", title: "Future", open: true } };
    mem.set(`xdesign.project.${id}`, future);
    await expect(loadDoc(id)).rejects.toThrow("unsupported");
    expect(mem.get(`xdesign.project.${id}`)).toEqual(future);
  });

  it("uses SQLite authority, including explicit null, instead of stale browser pages", async () => {
    const id = await useXDProjects.getState().newProject();
    localStorage.setItem(`xd-html-artifact.${id}`, "broken obsolete copy");
    expect((await loadDoc(id))?.htmlArtifact).toBeNull();
    useHtmlArtifact.getState().setArtifact("<p>SQLite wins</p>", "Saved");
    await flushActive();
    expect((await loadDoc(id))?.htmlArtifact?.html).toBe("<p>SQLite wins</p>");
  });

  it("atomically adopts the global legacy webpage with the legacy canvas", async () => {
    mem.set("xdesign.doc", []);
    const raw = JSON.stringify({ html: "<h1>Global legacy</h1>", title: "Global", open: true });
    localStorage.setItem("xd-html-artifact", raw);
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("commit failure"));
    await expect(useXDProjects.getState().init()).rejects.toThrow("commit failure");
    expect(mem.has("xdesign.projects")).toBe(false);
    expect(localStorage.getItem("xd-html-artifact")).toBe(raw);
    await useXDProjects.getState().init();
    const id = useXDProjects.getState().registry[0]!.id;
    expect(mem.get(`xdesign.project.${id}`)).toMatchObject({ htmlArtifact: { html: "<h1>Global legacy</h1>" } });
    expect(localStorage.getItem("xd-html-artifact")).toBe(raw);
  });

  it("retains a failed webpage edit, blocks leaving, and persists it after retry", async () => {
    const id = await useXDProjects.getState().newProject();
    useHtmlArtifact.getState().setArtifact("<h1>Unsaved page</h1>", "Retry me");
    expect(useXDesignSaveState.getState().documents[id]).toBeDefined();
    vi.mocked(db.setAppState).mockRejectedValueOnce(new Error("page save failed"));
    await expect(useXDProjects.getState().goHome()).rejects.toThrow("page save failed");
    expect(useXDProjects.getState().activeId).toBe(id);
    expect(useHtmlArtifact.getState().html).toBe("<h1>Unsaved page</h1>");
    expect(useXDesignSaveState.getState().documents[id]?.error).toContain("page save failed");
    await useXDProjects.getState().goHome();
    localStorage.clear();
    await useXDProjects.getState().openProject(id);
    expect(useHtmlArtifact.getState().html).toBe("<h1>Unsaved page</h1>");
  });

  it("does not acknowledge newer HTML when an older snapshot finishes saving", async () => {
    const id = await useXDProjects.getState().newProject();
    useHtmlArtifact.getState().setArtifact("<p>First</p>");
    let release!: () => void;
    vi.mocked(db.setAppState).mockImplementationOnce((key, value) => new Promise<void>((resolve) => {
      release = () => { mem.set(key, value); resolve(); };
    }));
    const pending = flushActive();
    await vi.waitFor(() => expect(release).toBeDefined());
    useHtmlArtifact.getState().setArtifact("<p>Second</p>");
    release(); await pending;
    expect(mem.get(`xdesign.project.${id}`)).toMatchObject({ htmlArtifact: { html: "<p>First</p>" } });
    expect(useXDesignSaveState.getState().documents[id]).toBeDefined();
    await flushActive();
    expect(mem.get(`xdesign.project.${id}`)).toMatchObject({ htmlArtifact: { html: "<p>Second</p>" } });
    expect(useXDesignSaveState.getState().documents[id]).toBeUndefined();
  });

  it("rejects late page results for a different project and locks webpage preparation", async () => {
    const a = await useXDProjects.getState().newProject("A");
    const b = await useXDProjects.getState().newProject("B");
    expect(useHtmlArtifact.getState().setArtifact("<h1>Late A</h1>", "A", a)).toBe(false);
    expect(useHtmlArtifact.getState().html).toBeNull();
    const end = beginXDesignActivity("html-generation", "Wait for webpage preparation");
    try {
      await expect(useXDProjects.getState().goHome()).rejects.toThrow("webpage preparation");
      expect(useXDProjects.getState().activeId).toBe(b);
    } finally { end(); }
  });

  it("a saved older snapshot cannot acknowledge a newer edit", async () => {
    const id = await useXDProjects.getState().newProject("Dirty race");
    markProjectDirty(id);
    let release!: () => void;
    vi.mocked(db.setAppState).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = flushActive();
    await vi.waitFor(() => expect(release).toBeDefined());
    const newer = markProjectDirty(id);
    release(); await first;
    expect(useXDesignSaveState.getState().documents[id]?.revision).toBe(newer);
    await flushActive();
    expect(useXDesignSaveState.getState().documents[id]).toBeUndefined();
  });

  it("failed registry metadata keeps work dirty even after the document write succeeds", async () => {
    const id = await useXDProjects.getState().newProject("Metadata failure");
    const original = vi.mocked(db.setAppState).getMockImplementation()!;
    vi.mocked(db.setAppState).mockImplementationOnce(original).mockRejectedValueOnce(new Error("registry full"));
    await expect(flushActive()).rejects.toThrow(/registry full/);
    expect(useXDesignSaveState.getState().documents[id]?.error).toMatch(/registry full/);
    await flushActive();
    expect(useXDesignSaveState.getState().documents[id]).toBeUndefined();
  });
  it("preserves the active canvas and avoids an orphan on failed creation, then retries", async () => {
    const id = await useXDProjects.getState().newProject("Existing");
    const snapshot = useXDesign.getState().shapes;
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("injected commit failure"));
    await expect(useXDProjects.getState().newProject("Failed")).rejects.toThrow(/commit failure/);
    expect(useXDProjects.getState().activeId).toBe(id);
    expect(useXDProjects.getState().registry.map((m) => m.id)).toEqual([id]);
    expect(useXDesign.getState().shapes).toBe(snapshot);
    expect([...mem.keys()].filter((k) => k.startsWith("xdesign.project."))).toHaveLength(1);
    const next = await useXDProjects.getState().newProject("Retry");
    expect(next).not.toBe(id);
    expect(useXDProjects.getState().activeId).toBe(next);
  });

  it("keeps documents, registry and tabs on failed deletion, then retries", async () => {
    const a = await useXDProjects.getState().newProject("A");
    const b = await useXDProjects.getState().newProject("B");
    const registry = useXDProjects.getState().registry;
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("injected delete failure"));
    await expect(useXDProjects.getState().deleteProject(b)).rejects.toThrow(/delete failure/);
    expect(useXDProjects.getState().registry).toBe(registry);
    expect(useXDProjects.getState().activeId).toBe(b);
    expect(useXDProjects.getState().openTabs).toEqual([a, b]);
    expect(mem.has(`xdesign.project.${b}`)).toBe(true);
    await useXDProjects.getState().deleteProject(b);
    expect(mem.has(`xdesign.project.${b}`)).toBe(false);
    expect(useXDProjects.getState().activeId).toBe(a);
  });

  it("does not let queued autosave metadata overwrite an in-flight rename", async () => {
    const id = await useXDProjects.getState().newProject("Original");
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(db.setAppState).mockImplementationOnce(async (key, value) => { await wait; mem.set(key, value); });
    const rename = useXDProjects.getState().renameProject(id, "Renamed");
    await vi.waitFor(() => expect(db.setAppState).toHaveBeenCalled());
    const save = flushActive();
    await vi.waitFor(() => expect(db.setAppState).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([rename, save]);
    expect(useXDProjects.getState().registry[0]!.name).toBe("Renamed");
    expect(mem.get("xdesign.projects")).toMatchObject({ registry: [expect.objectContaining({ name: "Renamed" })] });
  });

  it("does not display a rename that failed to persist", async () => {
    const id = await useXDProjects.getState().newProject("Original");
    vi.mocked(db.setAppState).mockRejectedValueOnce(new Error("injected rename failure"));
    await expect(useXDProjects.getState().renameProject(id, "Lost")).rejects.toThrow(/rename failure/);
    expect(useXDProjects.getState().registry[0]!.name).toBe("Original");
    await useXDProjects.getState().renameProject(id, "Saved");
    expect(useXDProjects.getState().registry[0]!.name).toBe("Saved");
  });

  it("returns Home rather than leaving a deleted active project when its neighbour is corrupt", async () => {
    const a = await useXDProjects.getState().newProject("Missing");
    const b = await useXDProjects.getState().newProject("Delete me");
    mem.delete(`xdesign.project.${a}`);
    await useXDProjects.getState().deleteProject(b);
    expect(useXDProjects.getState().activeId).toBeNull();
    expect(useXDProjects.getState().registry.map((m) => m.id)).toEqual([a]);
    expect(mem.has(`xdesign.project.${b}`)).toBe(false);
    expect(useXDProjects.getState().transitioning).toBe(false);
  });
  it("serializes overlapping saves so an old snapshot cannot win", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(db.setAppState).mockImplementationOnce(async (key, value) => { await gate; mem.set(key, value); });
    const first = saveDoc("race", { ...emptyDoc(), activePageId: "older" });
    await vi.waitFor(() => expect(db.setAppState).toHaveBeenCalledTimes(1));
    const second = saveDoc("race", { ...emptyDoc(), activePageId: "newer" });
    await Promise.resolve();
    expect(db.setAppState).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect(mem.get("xdesign.project.race")).toMatchObject({ activePageId: "newer" });
  });

  it("coalesces simultaneous ensureActive calls into one project", async () => {
    const ids = await Promise.all([useXDProjects.getState().ensureActive(), useXDProjects.getState().ensureActive()]);
    expect(ids[0]).toBe(ids[1]);
    expect(useXDProjects.getState().registry).toHaveLength(1);
  });

  it("keeps model reference metadata across project switches", async () => {
    const id = await useXDProjects.getState().newProject("Model", "model");
    useModelStore.getState().setReference({ assetId: "asset", filePath: "/reference.png", dataUrl: "data:image/png;base64,dGVzdA==", w: 32, h: 48 });
    await useXDProjects.getState().goHome();
    await useXDProjects.getState().openProject(id);
    expect(useModelStore.getState().reference).toMatchObject({ assetId: "asset", filePath: "/reference.png", w: 32, h: 48 });
  });

  it("refuses project transitions while an assistant owns the live scene", async () => {
    const id = await useXDProjects.getState().newProject();
    const end = beginXDesignActivity("fx-assist", "Stop FX Assist before switching projects.");
    try {
      await expect(useXDProjects.getState().newProject()).rejects.toThrow("Stop FX Assist");
      expect(useXDProjects.getState().activeId).toBe(id);
    } finally { end(); }
  });

  it("keeps the real project store locked after Stop until an admitted tool finishes", async () => {
    const a = await useXDProjects.getState().newProject("A");
    const b = await useXDProjects.getState().newProject("B");
    const stopAssistant = beginXDesignActivity("fx-assist", "Stop FX Assist before switching projects.");
    let release!: () => void;
    const action = runXDesignUiAction(() => {}, () => new Promise<void>((resolve) => { release = resolve; }));
    stopAssistant();
    try {
      await expect(useXDProjects.getState().openProject(a)).rejects.toThrow(/current AI action/);
      await expect(useXDProjects.getState().newProject()).rejects.toThrow(/current AI action/);
      await expect(useXDProjects.getState().closeTab(b)).rejects.toThrow(/current AI action/);
      await expect(useXDProjects.getState().goHome()).rejects.toThrow(/current AI action/);
      expect(useXDProjects.getState().activeId).toBe(b);
    } finally { release(); await action; }
    await useXDProjects.getState().openProject(a);
    expect(useXDProjects.getState().activeId).toBe(a);
  });

  it("does not replace a missing project document with a blank one", async () => {
    const id = await useXDProjects.getState().newProject();
    await useXDProjects.getState().goHome();
    mem.delete(`xdesign.project.${id}`);
    await expect(useXDProjects.getState().openProject(id)).rejects.toThrow("data is missing");
    expect(useXDProjects.getState().activeId).toBeNull();
    expect(mem.has(`xdesign.project.${id}`)).toBe(false);
    expect(useXDProjects.getState().transitioning).toBe(false);
  });
  it("waits for the same initialization before creating instead of overwriting the stored list", async () => {
    const old = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Keep", createdAt: 1, updatedAt: 1 };
    let release!: (value: unknown) => void;
    vi.mocked(db.getAppState).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const init = useXDProjects.getState().init();
    const create = useXDProjects.getState().newProject("New");
    await Promise.resolve(); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled();
    release({ registry: [old] }); await init; await create;
    expect(useXDProjects.getState().registry.map((p) => p.name)).toEqual(["New", "Keep"]);
  });

  it("rejects a malformed project list, blocks creation, and supports loading retry", async () => {
    const malformed = { registry: { broken: true } };
    mem.set("xdesign.projects", malformed);
    await expect(useXDProjects.getState().init()).rejects.toThrow(/list is invalid/);
    await expect(useXDProjects.getState().newProject()).rejects.toThrow(/list is invalid/);
    expect(useXDProjects.getState().ready).toBe(false);
    expect(useXDProjects.getState().loadError).toMatch(/not been overwritten/);
    expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(mem.get("xdesign.projects")).toBe(malformed);
    mem.set("xdesign.projects", { registry: [] });
    await useXDProjects.getState().init();
    expect(useXDProjects.getState().ready).toBe(true); expect(useXDProjects.getState().loadError).toBeNull();
  });

  it("legacy adoption is atomic and retryable without orphaning a document", async () => {
    mem.set("xdesign.doc", emptyDoc());
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("legacy commit failed"));
    await expect(useXDProjects.getState().init()).rejects.toThrow(/legacy commit failed/);
    expect([...mem.keys()]).toEqual(["xdesign.doc"]);
    await useXDProjects.getState().init();
    expect(useXDProjects.getState().registry).toHaveLength(1);
    expect([...mem.keys()].filter((key) => key.startsWith("xdesign.project."))).toHaveLength(1);
  });

  it("does not resurrect legacy work after the last project was intentionally deleted", async () => {
    mem.set("xdesign.doc", emptyDoc()); mem.set("xdesign.projects", { registry: [] });
    await useXDProjects.getState().init();
    expect(useXDProjects.getState().registry).toEqual([]); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled();
  });

  it("refuses malformed design data without replacing the active canvas", async () => {
    const old = await useXDProjects.getState().newProject("Keep");
    const bad = await useXDProjects.getState().newProject("Bad");
    await useXDProjects.getState().openProject(old);
    const snapshot = useXDesign.getState().shapes;
    const invalid = { pages: "broken" }; mem.set(`xdesign.project.${bad}`, invalid);
    const clear = vi.spyOn(useFxAssist.getState(), "clear");
    try {
      await expect(useXDProjects.getState().openProject(bad)).rejects.toThrow(/invalid or unsupported/);
      expect(clear).not.toHaveBeenCalled();
    } finally { clear.mockRestore(); }
    expect(useXDProjects.getState().activeId).toBe(old); expect(useXDesign.getState().shapes).toBe(snapshot);
    expect(mem.get(`xdesign.project.${bad}`)).toBe(invalid);
  });

  it("does not silently strip unknown FX effects when opening a stored scene", async () => {
    const id = await useXDProjects.getState().newProject("Future scene", "fx");
    await useXDProjects.getState().goHome();
    const doc = structuredClone(mem.get(`xdesign.fx.${id}`)) as { scene: { layers: Array<{ effectId: string }> } };
    doc.scene.layers[0]!.effectId = "unknown-future-effect"; mem.set(`xdesign.fx.${id}`, doc);
    await expect(useXDProjects.getState().openProject(id)).rejects.toThrow(/unavailable effect/);
    expect(useXDProjects.getState().activeId).toBeNull(); expect(mem.get(`xdesign.fx.${id}`)).toBe(doc);
  });

  it("starts on Home with no projects", async () => {
    await useXDProjects.getState().init();
    const s = useXDProjects.getState();
    expect(s.ready).toBe(true);
    expect(s.activeId).toBeNull();
    expect(s.registry).toEqual([]);
  });

  it("migrates a legacy xdesign.doc into an Untitled project", async () => {
    mem.set("xdesign.doc", {
      pages: [{ id: "p1", name: "Page 1", shapes: [{ id: "s1", kind: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#fff", radius: 0, stroke: "transparent", strokeWidth: 0 }] }],
      activePageId: "p1",
    });
    await useXDProjects.getState().init();
    const s = useXDProjects.getState();
    expect(s.registry).toHaveLength(1);
    expect(s.registry[0]!.name).toBe("Untitled");
    expect(s.activeId).toBeNull(); // still lands on Home
    const doc = mem.get(`xdesign.project.${s.registry[0]!.id}`) as { activePageId: string };
    expect(doc.activePageId).toBe("p1");
  });

  it("new project opens it as the active tab", async () => {
    await useXDProjects.getState().init();
    const id = await useXDProjects.getState().newProject("My Design");
    const s = useXDProjects.getState();
    expect(s.activeId).toBe(id);
    expect(s.openTabs).toEqual([id]);
    expect(s.registry[0]!.name).toBe("My Design");
  });

  it("auto-names unique Untitled projects", async () => {
    await useXDProjects.getState().init();
    await useXDProjects.getState().newProject();
    await useXDProjects.getState().newProject();
    const names = useXDProjects.getState().registry.map((m) => m.name).sort();
    expect(names).toEqual(["Untitled", "Untitled 2"]);
  });

  it("closing the last tab returns to Home", async () => {
    await useXDProjects.getState().init();
    const id = await useXDProjects.getState().newProject();
    await useXDProjects.getState().closeTab(id);
    const s = useXDProjects.getState();
    expect(s.activeId).toBeNull();
    expect(s.openTabs).toEqual([]);
  });

  it("closing a non-last active tab switches to the neighbour", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    const b = await useXDProjects.getState().newProject("B");
    expect(useXDProjects.getState().activeId).toBe(b);
    await useXDProjects.getState().closeTab(b);
    const s = useXDProjects.getState();
    expect(s.openTabs).toEqual([a]);
    expect(s.activeId).toBe(a);
  });

  it("persists edits into the active project slot on switch", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    useXDesign.getState().addShape({
      kind: "rect", x: 0, y: 0, w: 10, h: 10, radius: 0,
      fill: "#fff", stroke: "transparent", strokeWidth: 0,
    });
    const b = await useXDProjects.getState().newProject("B");
    // Opening B should have flushed A's shape to A's slot.
    const docA = mem.get(`xdesign.project.${a}`) as { pages: { shapes: unknown[] }[] };
    expect(docA.pages[0]!.shapes).toHaveLength(1);
    // And B starts empty.
    void b;
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });

  it("reopening a closed project restores its shapes", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    useXDesign.getState().addShape({
      kind: "rect", x: 0, y: 0, w: 10, h: 10, radius: 0,
      fill: "#fff", stroke: "transparent", strokeWidth: 0,
    });
    await useXDProjects.getState().goHome();
    expect(useXDProjects.getState().activeId).toBeNull();
    await useXDProjects.getState().openProject(a);
    expect(useXDesign.getState().shapes).toHaveLength(1);
  });

  it("ensureActive creates a project when on Home, else reuses the active one", async () => {
    await useXDProjects.getState().init();
    const created = await useXDProjects.getState().ensureActive();
    expect(useXDProjects.getState().activeId).toBe(created);
    const again = await useXDProjects.getState().ensureActive();
    expect(again).toBe(created);
    expect(useXDProjects.getState().registry).toHaveLength(1);
  });

  it("scopes the HTML webpage artifact per project", async () => {
    localStorage.clear();
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    useHtmlArtifact.getState().setArtifact("<h1>A page</h1>", "A");
    expect(useHtmlArtifact.getState().html).toContain("A page");
    // New project B must start with no page.
    await useXDProjects.getState().newProject("B");
    expect(useHtmlArtifact.getState().html).toBeNull();
    // Back to A restores its page; Home clears it.
    await useXDProjects.getState().openProject(a);
    expect(useHtmlArtifact.getState().html).toContain("A page");
    await useXDProjects.getState().goHome();
    expect(useHtmlArtifact.getState().html).toBeNull();
  });

  it("deletes a project and removes its doc slot", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    await useXDProjects.getState().deleteProject(a);
    const s = useXDProjects.getState();
    expect(s.registry).toEqual([]);
    expect(mem.has(`xdesign.project.${a}`)).toBe(false);
    expect(s.activeId).toBeNull();
  });
});
