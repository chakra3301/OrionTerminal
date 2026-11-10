import { describe, it, expect, vi, beforeEach } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => false, convertFileSrc: (path: string) => path }));

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

vi.mock("./projectPreview", () => ({ settlePreview: vi.fn(async () => {}), deleteProjectPreview: vi.fn(async () => {}) }));

import * as db from "@/lib/db";
import { settlePreview, deleteProjectPreview } from "./projectPreview";
import { useXDProjects, emptyDoc, saveDoc, loadDoc, flushActive } from "./projectsStore";
import { useFxAssist } from "./fx/fxAssist";
import { beginXDesignActivity, runXDesignUiAction } from "./runtimeActivity";
import { useXDesign } from "./store";
import { useHtmlArtifact } from "./htmlArtifactStore";
import { markProjectDirty, useXDesignSaveState } from "./saveState";

const mem = (db as unknown as { __mem: Map<string, unknown> }).__mem;
const interruptedReceipt = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' };
const otherMeta = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', name: 'Copy', createdAt: 1, updatedAt: 2 };
function recoveryReply(phase: string, document = emptyDoc(), registry: unknown[] | null = null) {
  return { version: 1, ...interruptedReceipt, phase, imported: phase === 'staged' || phase === 'committed' ? { name: 'Copy', document } : null, registry };
}

beforeEach(() => {
  localStorage.clear();
  useHtmlArtifact.getState().setProject(null);
  mem.clear();
  useXDesignSaveState.setState({ documents: {}, names: {} });
  vi.clearAllMocks();
  native.invoke.mockReset();
  useXDProjects.setState({ registry: [], openTabs: [], activeId: null, ready: false, loadError: null, transitioning: false });
  useXDesign.getState().hydrate(emptyDoc());
});

describe('interrupted project recovery', () => {
  beforeEach(() => { useXDProjects.setState({ ready: true }); });
  it('reopens the existing staged identity using the current database registry without copying or losing another window’s project', async () => {
    const original = emptyDoc(); mem.set(`xdesign.project.${otherMeta.id}`, original); mem.set('xdesign.projects', { registry: [otherMeta] });
    const document = { ...emptyDoc(), pages: [{ id: 'recovered', name: 'Recovered', shapes: [], past: [], future: [] }], activePageId: 'recovered' };
    native.invoke.mockResolvedValue(recoveryReply('staged', document));
    const id = await useXDProjects.getState().recoverDesignImport(interruptedReceipt);
    expect(id).toBe(interruptedReceipt.projectId); expect(useXDProjects.getState()).toMatchObject({ activeId: id, openTabs: [id], registry: [{ id, name: 'Copy 2' }, otherMeta] });
    expect(mem.get(`xdesign.project.${otherMeta.id}`)).toBe(original); expect(mem.get(`xdesign.project.${id}`)).toEqual(document); expect(useXDesign.getState().activePageId).toBe('recovered');
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('xdesign_project_import_control', { operation: { kind: 'status', ...interruptedReceipt } });
    expect(db.setXDesignStateAtomic).toHaveBeenCalledExactlyOnceWith(expect.any(Array), interruptedReceipt);
  });
  it('retains a staged copy after failed recovery saving and retries the same identity', async () => {
    native.invoke.mockResolvedValue(recoveryReply('staged')); vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error('Recovery disk full'));
    await expect(useXDProjects.getState().recoverDesignImport(interruptedReceipt)).rejects.toThrow('Recovery disk full');
    expect(useXDProjects.getState()).toMatchObject({ activeId: null, openTabs: [], registry: [] }); expect(mem.has(`xdesign.project.${interruptedReceipt.projectId}`)).toBe(false);
    expect(native.invoke.mock.calls.every(([, args]) => args.operation.kind === 'status')).toBe(true);
    expect(await useXDProjects.getState().recoverDesignImport(interruptedReceipt)).toBe(interruptedReceipt.projectId);
    expect(useXDProjects.getState().registry).toHaveLength(1); expect(db.setXDesignStateAtomic).toHaveBeenCalledTimes(2);
  });
  it('recovers a lost registration reply using canonical later data without replaying or deleting the copy', async () => {
    const savedMeta = { ...otherMeta, id: interruptedReceipt.projectId, name: 'Saved and renamed' };
    const canonical = { ...emptyDoc(), pages: [{ id: 'canonical', name: 'Latest', shapes: [], past: [], future: [] }], activePageId: 'canonical' };
    native.invoke.mockResolvedValueOnce(recoveryReply('staged')).mockResolvedValueOnce(recoveryReply('committed', canonical, [savedMeta, otherMeta]));
    vi.mocked(db.setXDesignStateAtomic).mockImplementationOnce(async writes => { for (const { key, value } of writes) mem.set(key, value); throw new Error('Lost recovery commit reply'); });
    expect(await useXDProjects.getState().recoverDesignImport(interruptedReceipt)).toBe(interruptedReceipt.projectId);
    expect(useXDesign.getState().activePageId).toBe('canonical'); expect(useXDProjects.getState().registry).toEqual([savedMeta, otherMeta]); expect(db.setXDesignStateAtomic).toHaveBeenCalledOnce();
    expect(native.invoke.mock.calls.map(([, args]) => args.operation.kind)).toEqual(['status', 'status']);
  });
  it('opens an already registered copy without another registry write or duplicate tab', async () => {
    const savedMeta = { ...otherMeta, id: interruptedReceipt.projectId };
    useXDProjects.setState({ openTabs: [savedMeta.id] }); native.invoke.mockResolvedValue(recoveryReply('committed', emptyDoc(), [savedMeta]));
    await useXDProjects.getState().recoverDesignImport(interruptedReceipt); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(useXDProjects.getState().openTabs).toEqual([savedMeta.id]);
  });
  it.each(['preparing', 'discarded'])('preserves incomplete %s copies without writing or opening a project', async phase => {
    native.invoke.mockResolvedValue(recoveryReply(phase)); await expect(useXDProjects.getState().recoverDesignImport(interruptedReceipt)).rejects.toThrow(phase === 'preparing' ? 'finished saving' : 'Removal has already started');
    expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(useXDProjects.getState()).toMatchObject({ activeId: null, registry: [], openTabs: [] });
  });
  it('preserves invalid recovered artwork and missing canonical metadata for review', async () => {
    native.invoke.mockResolvedValueOnce(recoveryReply('staged', { ...emptyDoc(), formatVersion: 3 } as never));
    await expect(useXDProjects.getState().recoverDesignImport(interruptedReceipt)).rejects.toThrow('newer application');
    native.invoke.mockResolvedValueOnce(recoveryReply('committed', emptyDoc(), [otherMeta]));
    await expect(useXDProjects.getState().recoverDesignImport(interruptedReceipt)).rejects.toThrow('metadata is unavailable'); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(useXDProjects.getState().activeId).toBeNull();
  });
  it('refuses recovery and removal after another project becomes active, preserving live unsaved work', async () => {
    const original = await useXDProjects.getState().newProject('Live original');
    useXDesign.getState().addShape({ kind: 'rect', x: 7, y: 8, w: 20, h: 30, fill: '#000', stroke: 'transparent', strokeWidth: 0, radius: 0 }); vi.clearAllMocks();
    await expect(useXDProjects.getState().recoverDesignImport(interruptedReceipt)).rejects.toThrow('start screen'); await expect(useXDProjects.getState().removeInterruptedImport(interruptedReceipt)).rejects.toThrow('start screen');
    expect(native.invoke).not.toHaveBeenCalled(); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(useXDProjects.getState().activeId).toBe(original); expect(useXDesign.getState().shapes).toMatchObject([{ kind: 'rect', x: 7 }]);
  });
  it('removes only the unused import through its original receipt and leaves saved projects intact', async () => {
    mem.set(`xdesign.project.${otherMeta.id}`, emptyDoc()); mem.set('xdesign.projects', { registry: [otherMeta] }); useXDProjects.setState({ registry: [otherMeta] }); native.invoke.mockResolvedValue(recoveryReply('discarded'));
    expect(await useXDProjects.getState().removeInterruptedImport(interruptedReceipt)).toBe('removed'); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(mem.has(`xdesign.project.${otherMeta.id}`)).toBe(true); expect(useXDProjects.getState().registry).toEqual([otherMeta]);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('xdesign_project_import_control', { operation: { kind: 'discard', ...interruptedReceipt } });
  });
  it('keeps a copy registered by another window and refreshes its metadata without opening or rewriting it', async () => {
    const savedMeta = { ...otherMeta, id: interruptedReceipt.projectId }; native.invoke.mockResolvedValue(recoveryReply('committed', emptyDoc(), [savedMeta, otherMeta]));
    expect(await useXDProjects.getState().removeInterruptedImport(interruptedReceipt)).toBe('kept'); expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(useXDProjects.getState()).toMatchObject({ activeId: null, openTabs: [], registry: [savedMeta, otherMeta] });
  });
});

describe("xdesign projectsStore", () => {
  it('cleans failed managed imports without changing the original project', async () => {
    const original = await useXDProjects.getState().newProject('Original');
    let receipt!: { projectId: string; operationId: string };
    native.invoke.mockImplementation(async (_command, args) => ({ version: 1, projectId: args.operation.projectId, operationId: args.operation.operationId, phase: 'discarded', imported: null, registry: null }));
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error('Registry disk full'));
    await expect(useXDProjects.getState().importDesignProject(async (id, assets) => {
      receipt = { projectId: id, operationId: assets.receipt.operationId };
      return assets.run(async () => ({ name: 'Copy', document: emptyDoc() }));
    })).rejects.toThrow('Registry disk full');
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('xdesign_project_import_control', { operation: { kind: 'discard', ...receipt } });
    expect(useXDProjects.getState()).toMatchObject({ activeId: original, registry: [{ id: original }] });
    expect(mem.has(`xdesign.project.${receipt.projectId}`)).toBe(false);
    expect(db.setXDesignStateAtomic).toHaveBeenLastCalledWith(expect.any(Array), receipt);
  });
  it('opens canonical registered data after a lost managed commit reply without saving twice', async () => {
    const original = await useXDProjects.getState().newProject('Original');
    const canonical = { ...emptyDoc(), activePageId: 'canonical', pages: [{ id: 'canonical', name: 'Saved copy', shapes: [], past: [], future: [] }] };
    vi.mocked(db.setXDesignStateAtomic).mockImplementationOnce(async writes => {
      for (const { key, value } of writes) mem.set(key, value);
      throw new Error('Lost commit reply');
    });
    native.invoke.mockImplementation(async (_command, args) => {
      const { projectId, operationId } = args.operation;
      return { version: 1, projectId, operationId, phase: 'committed', imported: { name: 'Saved copy', document: canonical }, registry: (mem.get('xdesign.projects') as { registry: unknown[] }).registry };
    });
    const id = await useXDProjects.getState().importDesignProject(async (_id, assets) => assets.run(async () => ({ name: 'Copy', document: emptyDoc() })));
    expect(id).not.toBe(original); expect(useXDProjects.getState().activeId).toBe(id); expect(useXDesign.getState().activePageId).toBe('canonical');
    expect(db.setXDesignStateAtomic).toHaveBeenCalledTimes(2); expect(native.invoke).toHaveBeenCalledOnce();
  });
  it('cleans staged assets when validation fails before registry saving', async () => {
    native.invoke.mockImplementation(async (_command, args) => ({ version: 1, projectId: args.operation.projectId, operationId: args.operation.operationId, phase: 'discarded', imported: null, registry: null }));
    await expect(useXDProjects.getState().importDesignProject(async (_id, assets) => assets.run(async () => ({ name: 'Future', document: { ...emptyDoc(), formatVersion: 3 } as never })))).rejects.toThrow('newer application');
    expect(db.setXDesignStateAtomic).not.toHaveBeenCalled(); expect(native.invoke).toHaveBeenCalledOnce(); expect(useXDProjects.getState().activeId).toBeNull();
  });
  it("opens a portable import under a fresh identity and publishes its document and registry together", async () => {
    const original = await useXDProjects.getState().newProject("Original");
    useXDesign.getState().addShape({kind:"rect",x:1,y:2,w:30,h:40,fill:"#000000",stroke:"transparent",strokeWidth:0,radius:0});
    const imported = {...emptyDoc(),pages:[{id:"imported-page",name:"Imported",shapes:[],past:[],future:[]}],activePageId:"imported-page"};
    let assetProject="";
    const id = await useXDProjects.getState().importDesignProject(async newId => {assetProject=newId;return {name:"Original",document:imported};});
    expect(id).not.toBe(original);expect(assetProject).toBe(id);
    expect(useXDProjects.getState()).toMatchObject({activeId:id,registry:[{id,name:"Original 2"},{id:original}]});
    expect(mem.get(`xdesign.project.${original}`)).toMatchObject({pages:[{shapes:[{kind:"rect",x:1}]}]});
    expect(mem.get(`xdesign.project.${id}`)).toEqual(imported);
    expect(db.setXDesignStateAtomic).toHaveBeenLastCalledWith([{key:`xdesign.project.${id}`,value:imported},{key:"xdesign.projects",value:{registry:useXDProjects.getState().registry}}]);
    expect(useXDesign.getState().activePageId).toBe("imported-page");
  });
  it("preserves the current project and registry when an import is invalid or cannot commit", async () => {
    const original = await useXDProjects.getState().newProject("Original");
    await expect(useXDProjects.getState().importDesignProject(async () => ({name:"Future",document:{...emptyDoc(),formatVersion:3} as never}))).rejects.toThrow("newer application");
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("Disk full"));
    await expect(useXDProjects.getState().importDesignProject(async () => ({name:"Import",document:emptyDoc()}))).rejects.toThrow("Disk full");
    expect(useXDProjects.getState()).toMatchObject({activeId:original,registry:[{id:original}],transitioning:false});
    expect([...mem.keys()].filter(key=>key.startsWith("xdesign.project."))).toEqual([`xdesign.project.${original}`]);
  });
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

  it("drops removed 3D model projects from the list without deleting their data", async () => {
    const design = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Keep", createdAt: 1, updatedAt: 1 };
    const model = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", name: "3D Model", createdAt: 1, updatedAt: 1, kind: "model" };
    const modelDoc = { reference: null };
    mem.set("xdesign.projects", { registry: [model, design] }); mem.set(`xdesign.model.${model.id}`, modelDoc);
    await useXDProjects.getState().init();
    expect(useXDProjects.getState().registry).toEqual([design]);
    expect(mem.get("xdesign.projects")).toEqual({ registry: [design] });
    expect(mem.get(`xdesign.model.${model.id}`)).toBe(modelDoc);
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

describe("image saves", () => {
  const A = "01ARZ3NDEKTSV4RRFFQ69G5FB0", B = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
  const meta = (id: string) => useXDProjects.getState().registry.find((m) => m.id === id)!;
  const noteImageSaved = (id: string, path: string, saveAs: boolean) => useXDProjects.getState().noteImageSaved(id, path, saveAs);
  beforeEach(() => {
    useXDProjects.setState({ ready: true, registry: [
      { id: A, name: "Untitled design", createdAt: 1, updatedAt: 1 },
      { id: B, name: "Other", createdAt: 1, updatedAt: 5 },
    ] });
  });

  it("names a default-named project after its Save As file and moves it to the top", async () => {
    await noteImageSaved(A, "/Users/me/Desktop/photoshop/r2c.psd", true);
    expect(meta(A)).toMatchObject({ name: "r2c", nameFromFile: true });
    expect(meta(A).updatedAt).toBeGreaterThan(5);
    expect((mem.get("xdesign.projects") as { registry: unknown[] }).registry).toEqual(useXDProjects.getState().registry);
  });

  it("keeps following later Save As until the owner renames it", async () => {
    await noteImageSaved(A, "/x/r2c.psd", true);
    await noteImageSaved(A, "/x/r2c-final.png", true);
    expect(meta(A).name).toBe("r2c-final");
    await useXDProjects.getState().renameProject(A, "Poster");
    expect(meta(A).name).toBe("Poster");
    expect("nameFromFile" in meta(A)).toBe(false);
    await noteImageSaved(A, "/x/new.psd", true);
    expect(meta(A).name).toBe("Poster");
  });

  it("only Save As renames; ⌘S, copies and exports just move it to the top", async () => {
    await noteImageSaved(A, "/x/r2c.psd", false);
    expect(meta(A).name).toBe("Untitled design");
    expect(meta(A).updatedAt).toBeGreaterThan(5);
  });

  it("numbers a taken name and doesn't count the project itself", async () => {
    await useXDProjects.getState().renameProject(B, "r2c");
    await noteImageSaved(A, "/x/r2c.psd", true);
    expect(meta(A).name).toBe("r2c 2");
    await noteImageSaved(A, "/x/r2c.psd", true);
    expect(meta(A).name).toBe("r2c 2");
  });

  it("recognises only the app's default names", async () => {
    const renamed = ["Untitled", "Untitled 3", "Untitled design", "Untitled design 2", "Webpage", "Deck 4", "Motion", "Image", "Imported design", "Recovered design 2"];
    const kept = ["My Deck", "Deck two", "Untitled-1", "FX Scene", "3D Model"];
    for (const name of [...renamed, ...kept]) {
      useXDProjects.setState({ registry: [{ id: A, name, createdAt: 1, updatedAt: 1 }] });
      await noteImageSaved(A, "/x/r2c.psd", true);
      expect(meta(A).name, name).toBe(renamed.includes(name) ? "r2c" : name);
    }
  });

  it("takes the name from any path and ignores names that would be empty", async () => {
    await noteImageSaved(A, "C:\\Users\\me\\r2c.psd", true);
    expect(meta(A).name).toBe("r2c");
    useXDProjects.setState({ registry: [{ id: A, name: "Untitled", createdAt: 1, updatedAt: 1 }] });
    await noteImageSaved(A, "/x/.psd", true);
    expect(meta(A).name).toBe("Untitled");
    expect(meta(A).updatedAt).toBeGreaterThan(1);
  });

  it("refuses a project list whose name-origin flag isn't true", async () => {
    const stored = { registry: [{ id: A, name: "r2c", createdAt: 1, updatedAt: 1, nameFromFile: "yes" }] };
    mem.set("xdesign.projects", stored);
    useXDProjects.setState({ ready: false, registry: [] });
    await expect(useXDProjects.getState().init()).rejects.toThrow(/list is invalid/);
    expect(useXDProjects.getState().loadError).toMatch(/not been overwritten/);
    expect(mem.get("xdesign.projects")).toBe(stored);
  });
});

describe("project previews", () => {
  const A = "01ARZ3NDEKTSV4RRFFQ69G5FB0", B = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
  const page = (name: string) => ({ ...emptyDoc(), pages: [{ id: name, name, shapes: [], past: [], future: [] }], activePageId: name });
  beforeEach(() => {
    mem.set(`xdesign.project.${A}`, page("A page")); mem.set(`xdesign.project.${B}`, page("B page"));
    useXDProjects.setState({ ready: true, openTabs: [A, B], activeId: A, registry: [
      { id: A, name: "A", createdAt: 1, updatedAt: 1 },
      { id: B, name: "B", createdAt: 1, updatedAt: 1 },
    ] });
    useXDesign.getState().hydrate(page("A page"));
    useHtmlArtifact.getState().setProject(A);
  });

  it("lets the leaving project's preview finish after it's saved and before the next project loads", async () => {
    const seen: Array<{ id: string; activeId: string | null; updatedAt: number; page: string }> = [];
    vi.mocked(settlePreview).mockImplementation(async (id) => {
      const { activeId, registry } = useXDProjects.getState();
      seen.push({ id, activeId, updatedAt: registry.find((m) => m.id === id)!.updatedAt, page: useXDesign.getState().activePageId });
    });
    await useXDProjects.getState().openProject(B);
    await useXDProjects.getState().goHome();
    await useXDProjects.getState().openProject(A);
    await useXDProjects.getState().closeTab(A);
    expect(seen.map(({ id, activeId, page }) => [id, activeId, page])).toEqual([[A, A, "A page"], [B, B, "B page"], [A, A, "A page"]]);
    expect(seen.every(({ updatedAt }) => updatedAt > 1)).toBe(true);
    expect(useXDProjects.getState().activeId).toBe(B);
  });

  it("deletes a project's preview with it, only once the delete is committed", async () => {
    vi.mocked(db.setXDesignStateAtomic).mockRejectedValueOnce(new Error("disk full"));
    await expect(useXDProjects.getState().deleteProject(B)).rejects.toThrow("disk full");
    expect(deleteProjectPreview).not.toHaveBeenCalled();
    await useXDProjects.getState().deleteProject(B);
    expect(deleteProjectPreview).toHaveBeenCalledExactlyOnceWith(B);
  });
});
