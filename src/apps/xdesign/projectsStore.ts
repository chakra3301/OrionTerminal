import { livePencilSnapshot, validatePencilDocument, type PencilDocument } from "./pencil/document";
import { readRoomImageBindings } from './pencil/roomImageBindings';
import { initializeImageStorage } from "./projectStorage";
import { create } from "zustand";
import { validatePhotoDocuments, type PhotoDocument } from "./photo/types";
import { validatePhotoDrafts, type PhotoDraft } from "./photo/drafts";
import { ulid } from "ulid";
import { getAppState, setAppState, setXDesignStateAtomic } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { toast } from "@/store/toastStore";
import { useAppChat } from "@/store/appChatStore";
import {
  useXDesign,
  type Page,
  type Variable,
  type Mode,
} from "./store";
import { useHtmlArtifact, snapshotHtmlArtifact } from "./htmlArtifactStore";
import { legacyHtmlKey, readLegacyHtml, validateHtmlArtifact, type HtmlArtifactData } from "./htmlArtifactData";
import { useFxStore, snapshotFxDoc, emptyFxDoc } from "./fx/fxStore";
import type { FxDoc } from "./fx/fxModel";
import { trackXDesignActivity, xdesignProjectChangeReason } from "./runtimeActivity";
import { useModelStore, snapshotModelDoc, emptyModelDoc, type ModelDoc } from "./model3d/modelStore";
import { useModelAssist } from "./model3d/modelAssist";
import { useFxAssist } from "./fx/fxAssist";
import { fxEffect } from "./fx/fxRegistry";
import { discardProjectSaveState, projectSaveStarted, projectSaveFinished } from "./saveState";
import { ProjectAssetImport, projectImportControl, type ProjectImportReceipt, type ProjectImportResult } from './projectAssetImport';

/** A persisted XDesign document — the same shape `useXDesign.hydrate` accepts
 * and `useXDesignPersistence` writes. One per project. */
export type XDDoc = {
  formatVersion?: 2;
  photoDocuments?: Record<string, PhotoDocument>;
  photoDrafts?: PhotoDraft[];
  pencilDocument?: PencilDocument | null;
  pages: Page[];
  activePageId: string;
  variables?: Variable[];
  modes?: Mode[];
  activeModeId?: string;
  htmlArtifact?: HtmlArtifactData | null;
};

export type XDProjectKind = "design" | "fx" | "model";

export type XDProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Undefined = "design" (pre-FX metas hydrate cleanly). */
  kind?: XDProjectKind;
};

export function projectKind(meta: XDProjectMeta | undefined): XDProjectKind {
  return meta?.kind ?? "design";
}

const DEFAULT_PAGE_ID = "page-default";
const DEFAULT_MODE_ID = "mode-default";
const persistInOrder = serialQueue();
const saveInOrder = serialQueue();
const transitionInOrder = serialQueue();
let ensuringActive: Promise<string> | null = null;
let initializing: Promise<void> | null = null;

function projectChange<T>(work: () => Promise<T>): Promise<T> {
  const result = transitionInOrder(async () => {
    await useXDProjects.getState().init();
    if (useXDProjects.getState().activeId) {
      const reason = xdesignProjectChangeReason();
      if (reason) throw new Error(reason);
      if (useAppChat.getState().threads.xdesign.running) throw new Error("Stop the design assistant before switching projects.");
    }
    useXDProjects.setState({ transitioning: true });
    try { return await work(); }
    finally { useXDProjects.setState({ transitioning: false }); }
  });
  void result.catch((e) => toast.error("XDesign project change failed", { body: String(e) }));
  return result;
}

function docKey(id: string): `xdesign.project.${string}` {
  return `xdesign.project.${id}`;
}

function fxDocKey(id: string): `xdesign.fx.${string}` {
  return `xdesign.fx.${id}`;
}

function modelDocKey(id: string): `xdesign.model.${string}` {
  return `xdesign.model.${id}`;
}

/** Fresh, empty single-page document. */
export function emptyDoc(): XDDoc {
  return {
    pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: [], past: [], future: [] }],
    activePageId: DEFAULT_PAGE_ID,
    variables: [],
    modes: [{ id: DEFAULT_MODE_ID, name: "Default" }],
    activeModeId: DEFAULT_MODE_ID,
    htmlArtifact: null,
  };
}

/** Snapshot the live `useXDesign` state into a persistable doc. Mirrors the
 * flush logic in `useXDesignPersistence` — drops transient per-page history. */
export function snapshotActiveDoc(): XDDoc {
  const s = useXDesign.getState();
  const pages = s.pages.map((p) => ({
    id: p.id,
    name: p.name,
    shapes: p.id === s.activePageId ? s.shapes : p.shapes,
    past: [],
    future: [],
  }));
  return {
    formatVersion: 2,
    photoDocuments: s.photoDocuments,
    photoDrafts: s.photoDrafts,
    pencilDocument: livePencilSnapshot(s.pencilDocument),
    pages,
    activePageId: s.activePageId,
    variables: s.variables,
    modes: s.modes,
    activeModeId: s.activeModeId,
    htmlArtifact: useXDProjects.getState().activeId ? snapshotHtmlArtifact(useXDProjects.getState().activeId!) : null,
  };
}

export function validateDesignDoc(doc: XDDoc): void {
  const ids = new Set<string>();
  if (!doc || !Array.isArray(doc.pages) || !doc.pages.length || doc.pages.some((p) => {
    if (!p || typeof p.id !== "string" || ids.has(p.id) || typeof p.name !== "string" || !Array.isArray(p.shapes)) return true;
    ids.add(p.id);
    return p.shapes.some((shape) => !shape || typeof shape.id !== "string" ||
      !["rect", "ellipse", "frame", "text", "image", "path"].includes(shape.kind) ||
      ![shape.x, shape.y, shape.w, shape.h].every(Number.isFinite));
  }) || !ids.has(doc.activePageId) ||
    (doc.variables !== undefined && !Array.isArray(doc.variables)) ||
    (doc.modes !== undefined && !Array.isArray(doc.modes))) {
    throw new Error("Design project data is invalid or unsupported. Restore a backup; it has not been overwritten.");
  }
  if (doc.formatVersion !== undefined && doc.formatVersion !== 2) throw new Error("This XDesign document needs a newer application version");
  if (doc.photoDocuments !== undefined) validatePhotoDocuments(doc.photoDocuments);
  if (doc.photoDrafts !== undefined) validatePhotoDrafts(doc.photoDrafts, doc.photoDocuments ?? {});
  if (doc.pencilDocument) {
    validatePencilDocument(doc.pencilDocument);
    for (const id of Object.values(doc.pencilDocument.photoLinks)) if (!doc.photoDocuments?.[id]) throw new Error("A linked photo document is missing");
    for (const binding of readRoomImageBindings(doc.pencilDocument.roomImages).bindings) if (!doc.photoDocuments?.[binding.photo.id]) throw new Error("A local shared image document is missing");
  }
  for (const page of doc.pages) for (const shape of page.shapes) {
    if (shape.kind === "image" && shape.photoDocumentId && !doc.photoDocuments?.[shape.photoDocumentId]) throw new Error("An image document is missing; restore a project backup");
  }
  if (doc.htmlArtifact !== undefined && doc.htmlArtifact !== null) validateHtmlArtifact(doc.htmlArtifact);
}

export async function loadDoc(id: string): Promise<XDDoc | null> {
  return trackXDesignActivity(
    "project-load",
    "Wait for the XDesign project to finish loading before disabling the plugin.",
    async () => {
      let doc = await getAppState<XDDoc>(docKey(id), true);
      if (doc !== null) {
        validateDesignDoc(doc);
        // An explicit null is authoritative, so old browser copies cannot resurrect a removed page.
        if (!Object.prototype.hasOwnProperty.call(doc, "htmlArtifact")) {
          const artifact = readLegacyHtml(legacyHtmlKey(id));
          if (artifact !== null) {
            doc = { ...doc, htmlArtifact: artifact };
            await saveDoc(id, doc);
          }
        }
      }
      return doc;
    },
  );
}

export async function saveDoc(id: string, doc: XDDoc): Promise<void> {
  await trackXDesignActivity(
    "project-save",
    "Wait for the XDesign project to finish saving before disabling the plugin.",
    () => saveInOrder(() => setAppState(docKey(id), doc)),
  );
}

export async function loadFxDoc(id: string): Promise<FxDoc | null> {
  return trackXDesignActivity(
    "project-load",
    "Wait for the XDesign project to finish loading before disabling the plugin.",
    async () => {
      const doc = await getAppState<FxDoc>(fxDocKey(id), true);
      if (doc !== null && (!doc?.scene || !Array.isArray(doc.scene.layers) ||
        ![doc.scene.width, doc.scene.height, doc.scene.duration].every((v) => Number.isFinite(v) && v > 0) ||
        typeof doc.scene.background !== "string" || doc.scene.layers.some((layer) =>
          !layer || typeof layer.id !== "string" || !fxEffect(layer.effectId)))) {
        throw new Error("FX project data is invalid or needs an unavailable effect. It has not been overwritten.");
      }
      return doc;
    },
  );
}

export async function saveFxDoc(id: string, doc: FxDoc): Promise<void> {
  await trackXDesignActivity(
    "project-save",
    "Wait for the XDesign project to finish saving before disabling the plugin.",
    () => saveInOrder(() => setAppState(fxDocKey(id), doc)),
  );
}

export async function loadModelDoc(id: string): Promise<ModelDoc | null> {
  return trackXDesignActivity(
    "project-load",
    "Wait for the XDesign model to finish loading before disabling the plugin.",
    () => getAppState<ModelDoc>(modelDocKey(id), true),
  );
}

export async function saveModelDoc(id: string, doc: ModelDoc): Promise<void> {
  await trackXDesignActivity(
    "project-save",
    "Wait for the XDesign model to finish saving before disabling the plugin.",
    () => saveInOrder(() => setAppState(modelDocKey(id), doc)),
  );
}

/** Load a project's doc into the right live store (design vs fx) and scope
 * the HTML artifact panel. Single path used by open/close/delete. */
async function hydrateProjectById(
  id: string,
  registry: XDProjectMeta[],
): Promise<void> {
  const meta = registry.find((m) => m.id === id);
  if (!meta) throw new Error("This project no longer exists.");
  const kind = projectKind(meta);
  if (kind === "fx") {
    const doc = await loadFxDoc(id);
    if (!doc) throw new Error("FX project data is missing. Restore a database backup instead of overwriting it with an empty scene.");
    useFxStore.getState().hydrateFx(doc);
    useHtmlArtifact.getState().setProject(null);
  } else if (kind === "model") {
    const doc = await loadModelDoc(id);
    if (!doc) throw new Error("Model project data is missing. Restore a database backup.");
    useModelStore.getState().hydrateModel(doc);
    useHtmlArtifact.getState().setProject(null);
  } else {
    const doc = await loadDoc(id);
    if (!doc) throw new Error("Design project data is missing. Restore a database backup.");
    useXDesign.getState().hydrate(doc);
    useHtmlArtifact.getState().setProject(id, doc.htmlArtifact);
  }
  useModelAssist.getState().clear();
  useFxAssist.getState().clear();
}

type XDProjectsState = {
  registry: XDProjectMeta[];
  openTabs: string[];
  /** Active project id, or null to show the Home / start screen. */
  activeId: string | null;
  /** True once `init()` has run (so the UI doesn't flash). */
  ready: boolean;
  loadError: string | null;
  transitioning: boolean;

  init: () => Promise<void>;
  /** Guarantee a DESIGN project is open before a canvas mutation. Returns
   * the active id, creating a fresh project if currently on Home or if the
   * active project is an FX scene (design shapes must never land in an FX
   * doc slot). */
  ensureActive: () => Promise<string>;
  newProject: (name?: string, kind?: XDProjectKind) => Promise<string>;
  importDesignProject: (read: (id: string, assets: ProjectAssetImport) => Promise<{ name: string; document: XDDoc; roomGrantState?: unknown }>) => Promise<string>;
  recoverDesignImport: (receipt: ProjectImportReceipt) => Promise<string>;
  removeInterruptedImport: (receipt: ProjectImportReceipt) => Promise<'removed' | 'kept'>;
  openProject: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  goHome: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

function readRegistry(value: unknown): XDProjectMeta[] {
  const entries = value && typeof value === "object" ? (value as { registry?: unknown }).registry : null;
  const seen = new Set<string>();
  if (!Array.isArray(entries) || entries.some((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(entry.id) || seen.has(entry.id) ||
      typeof entry.name !== "string" || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt) ||
      (entry.kind !== undefined && !["design", "fx", "model"].includes(entry.kind))) return true;
    seen.add(entry.id); return false;
  })) throw new Error("The XDesign project list is invalid. Restore a database backup; it has not been overwritten.");
  return entries as XDProjectMeta[];
}

async function updateRegistry(update: (registry: XDProjectMeta[]) => XDProjectMeta[]): Promise<void> {
  await trackXDesignActivity("project-registry-save", "Wait for the XDesign project list to finish saving before disabling the plugin.",
    () => persistInOrder(async () => {
      const registry = update(useXDProjects.getState().registry);
      await setAppState("xdesign.projects", { registry });
      useXDProjects.setState({ registry });
    }));
}

async function commitProjectState(registry: XDProjectMeta[], writes: Parameters<typeof setXDesignStateAtomic>[0], receipt?: ProjectImportReceipt): Promise<void> {
  await trackXDesignActivity("project-registry-save", "Wait for the XDesign project transaction before disabling the plugin.",
    () => persistInOrder(async () => {
      const transaction = [...writes, { key: "xdesign.projects" as const, value: { registry } }];
      await saveInOrder(() => receipt ? setXDesignStateAtomic(transaction, receipt) : setXDesignStateAtomic(transaction));
      useXDProjects.setState({ registry });
    }));
}

function registeredImport(result: ProjectImportResult, id: string): { registry: XDProjectMeta[]; document: XDDoc } {
  if (result.phase !== 'committed' || !result.imported || !result.registry) throw new Error('Recovered project registration is unavailable');
  validateDesignDoc(result.imported.document);
  const registry = readRegistry({ registry: result.registry });
  if (!registry.some(meta => meta.id === id && projectKind(meta) === 'design')) throw new Error('Recovered project metadata is unavailable');
  return { registry, document: result.imported.document };
}

/** Flush the live doc to the active project's slot + bump its updatedAt.
 * No-op when on Home (no active project). */
export async function flushActive(): Promise<void> {
  const { activeId, registry } = useXDProjects.getState();
  if (!activeId) return;
  const revision = projectSaveStarted(activeId);
  try {
    const kind = projectKind(registry.find((m) => m.id === activeId));
    if (kind === "fx") await saveFxDoc(activeId, snapshotFxDoc());
    else if (kind === "model") await saveModelDoc(activeId, snapshotModelDoc());
    else await saveDoc(activeId, snapshotActiveDoc());
    await updateRegistry((registry) => registry.map((m) =>
      m.id === activeId ? { ...m, updatedAt: Date.now() } : m,
    ));
    projectSaveFinished(activeId, revision);
  } catch (error) {
    projectSaveFinished(activeId, revision, String(error));
    toast.error("XDesign project was not saved", {
      body: `${String(error)}. Your work is still in memory; use Retry save before closing the app.`,
      dedupeKey: `xdesign-save-${activeId}`,
    });
    throw error;
  }
}

function uniqueName(registry: XDProjectMeta[], base = "Untitled"): string {
  const names = new Set(registry.map((m) => m.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export const useXDProjects = create<XDProjectsState>((set, get) => ({
  registry: [],
  openTabs: [],
  activeId: null,
  ready: false,
  loadError: null,
  transitioning: false,

  init: () => {
    if (get().ready) return Promise.resolve();
    if (initializing) return initializing;
    set({ loadError: null });
    initializing = trackXDesignActivity("project-load", "Wait for the project list to load before disabling XDesign.", async () => {
      const stored = await getAppState<unknown>("xdesign.projects", true);
      let registry = stored === null ? [] : readRegistry(stored);
      // An explicitly empty registry is not a request to resurrect deleted legacy work.
      if (stored === null) {
        const legacy = await getAppState<XDDoc | unknown[]>("xdesign.doc", true);
        if (legacy) {
          const id = ulid(), now = Date.now();
          const doc: XDDoc = Array.isArray(legacy)
            ? { ...emptyDoc(), pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: legacy as never, past: [], future: [] }] }
            : legacy;
          const htmlArtifact = !Array.isArray(legacy) && Object.prototype.hasOwnProperty.call(legacy, "htmlArtifact")
            ? legacy.htmlArtifact : readLegacyHtml("xd-html-artifact");
          const adopted = { ...doc, htmlArtifact: htmlArtifact ?? null };
          validateDesignDoc(adopted);
          registry = [{ id, name: "Untitled", createdAt: now, updatedAt: now }];
          await commitProjectState(registry, [{ key: docKey(id), value: adopted }]);
        }
      }
      // Migrate unopened legacy pages too, so subsequent SQLite backups include them.
      // Keep browser originals: cleanup is separate from a successful data migration.
      for (const meta of registry) {
        if (projectKind(meta) === "design" && localStorage.getItem(legacyHtmlKey(meta.id)) !== null) {
          if (!await loadDoc(meta.id)) throw new Error("Browser webpage has no matching project document. Preserve the original profile before recovery.");
        }
      }
      useHtmlArtifact.getState().setProject(null);
      await initializeImageStorage();
      set({ registry, openTabs: [], activeId: null, ready: true });
    }).catch((error) => {
      set({ loadError: String(error) });
      throw error;
    }).finally(() => { initializing = null; });
    return initializing;
  },

  ensureActive: async () => {
    await get().init();
    await transitionInOrder(async () => {});
    const { activeId, registry } = get();
    if (activeId && projectKind(registry.find((m) => m.id === activeId)) === "design") {
      return activeId;
    }
    if (!ensuringActive) ensuringActive = get().newProject().finally(() => { ensuringActive = null; });
    return ensuringActive;
  },

  newProject: (name, kind = "design") => projectChange(async () => {
    await flushActive();
    const id = ulid();
    const now = Date.now();
    const meta: XDProjectMeta = {
      id,
      name: name?.trim() || uniqueName(get().registry, kind === "fx" ? "FX Scene" : kind === "model" ? "3D Model" : "Untitled"),
      createdAt: now,
      updatedAt: now,
      ...(kind !== "design" ? { kind } : {}),
    };
    const registry = [meta, ...get().registry];
    const key = kind === "fx" ? fxDocKey(id) : kind === "model" ? modelDocKey(id) : docKey(id);
    const doc = kind === "fx" ? emptyFxDoc() : kind === "model" ? emptyModelDoc(name?.trim() || "3D Model") : emptyDoc();
    await commitProjectState(registry, [{ key, value: doc }]);
    useModelAssist.getState().clear();
    useFxAssist.getState().clear();
    if (kind === "fx") useFxStore.getState().hydrateFx(doc as FxDoc);
    else if (kind === "model") useModelStore.getState().hydrateModel(doc as ModelDoc);
    else useXDesign.getState().hydrate(doc as XDDoc);
    useHtmlArtifact.getState().setProject(kind === "design" ? id : null);
    set((s) => ({
      openTabs: [...s.openTabs, id],
      activeId: id,
    }));
    return id;
  }),

  importDesignProject: (read) => projectChange(async () => {
    await flushActive();
    const id = ulid();
    const assets = new ProjectAssetImport(id);
    return trackXDesignActivity("project-import", "Wait for the project file to finish opening before disabling XDesign.", async () => {
      let document: XDDoc;
      try {
        const imported = await read(id, assets);
        validateDesignDoc(imported.document);
        const now = Date.now();
        const meta: XDProjectMeta = { id, name: uniqueName(get().registry, imported.name.trim() || "Imported design"), createdAt: now, updatedAt: now };
        await commitProjectState([meta, ...get().registry], [{ key: docKey(id), value: imported.document }, ...(imported.roomGrantState === undefined ? [] : [{ key: `xdesign.roomGrants.${id}` as const, value: imported.roomGrantState }])], assets.used ? assets.receipt : undefined);
        document = imported.document;
      } catch (error) {
        const recovered = await assets.afterFailure(error);
        if (!recovered) throw error;
        const saved = registeredImport(recovered, id);
        set({ registry: saved.registry }); document = saved.document;
      }
      useXDesign.getState().hydrate(document);
      useHtmlArtifact.getState().setProject(id, document.htmlArtifact);
      useModelAssist.getState().clear(); useFxAssist.getState().clear();
      set(s => ({ openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id], activeId: id }));
      return id;
    });
  }),

  recoverDesignImport: (receipt) => projectChange(() => trackXDesignActivity('project-import-recovery', 'Wait for the recovered copy to open before disabling XDesign.', async () => {
    if (get().activeId) throw new Error('Return to the XDesign start screen before opening an interrupted copy.');
    let recovered = await projectImportControl(receipt, 'status');
    let document: XDDoc;
    const id = receipt.projectId;
    if (recovered.phase === 'staged' && recovered.imported) {
      validateDesignDoc(recovered.imported.document);
      const stored = await getAppState<unknown>('xdesign.projects', true);
      const registry = stored === null ? [] : readRegistry(stored);
      const now = Date.now();
      const meta: XDProjectMeta = { id, name: uniqueName(registry, recovered.imported.name.trim() || 'Recovered design'), createdAt: now, updatedAt: now };
      try {
        await commitProjectState([meta, ...registry], [{ key: docKey(id), value: recovered.imported.document }], receipt);
        document = recovered.imported.document;
      } catch (error) {
        try { recovered = await projectImportControl(receipt, 'status'); }
        catch (readError) { throw new Error(`${String(error)}. The recovered copy is retained: ${String(readError)}`, { cause: error }); }
        if (recovered.phase !== 'committed') throw error;
        const saved = registeredImport(recovered, id);
        set({ registry: saved.registry }); document = saved.document;
      }
    } else {
      if (recovered.phase === 'preparing') throw new Error('This copy stopped before its artwork finished saving. Remove the unused copy or retry opening the original file.');
      if (recovered.phase === 'discarded') throw new Error('Removal has already started for this copy. Finish removing the unused copy.');
      const saved = registeredImport(recovered, id);
      set({ registry: saved.registry }); document = saved.document;
    }
    useXDesign.getState().hydrate(document);
    useHtmlArtifact.getState().setProject(id, document.htmlArtifact);
    useModelAssist.getState().clear(); useFxAssist.getState().clear();
    set(s => ({ openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id], activeId: id }));
    return id;
  })),

  removeInterruptedImport: (receipt) => projectChange(() => trackXDesignActivity('project-import-recovery', 'Wait for the unused copy to be removed before disabling XDesign.', async () => {
    if (get().activeId) throw new Error('Return to the XDesign start screen before removing an interrupted copy.');
    const recovered = await projectImportControl(receipt, 'discard');
    if (recovered.phase === 'discarded') return 'removed';
    if (recovered.phase !== 'committed') throw new Error('The unused copy could not be removed. Refresh and try again.');
    const saved = registeredImport(recovered, receipt.projectId);
    set({ registry: saved.registry });
    return 'kept';
  })),

  openProject: (id) => projectChange(async () => {
    if (get().activeId === id) return;
    await flushActive();
    await hydrateProjectById(id, get().registry);
    set((s) => ({
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      activeId: id,
    }));
  }),

  switchTo: (id) => get().openProject(id),

  closeTab: (id) => projectChange(async () => {
    const { activeId, openTabs } = get();
    if (activeId === id) await flushActive();
    const remaining = openTabs.filter((t) => t !== id);

    if (activeId !== id) {
      set({ openTabs: remaining });
      return;
    }
    // Closing the active tab.
    if (remaining.length === 0) {
      useHtmlArtifact.getState().setProject(null);
      set({ openTabs: [], activeId: null }); // → Home
      return;
    }
    // Switch to the neighbour (prefer the tab to the left of the closed one).
    const closedIdx = openTabs.indexOf(id);
    const nextId = remaining[Math.max(0, closedIdx - 1)]!;
    await hydrateProjectById(nextId, get().registry);
    set({ openTabs: remaining, activeId: nextId });
  }),

  goHome: () => projectChange(async () => {
    await flushActive();
    useHtmlArtifact.getState().setProject(null);
    set({ activeId: null });
  }),

  renameProject: (id, name) => projectChange(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateRegistry((registry) => registry.map((m) =>
      m.id === id ? { ...m, name: trimmed, updatedAt: Date.now() } : m,
    ));
  }),

  deleteProject: (id) => projectChange(async () => {
    const { activeId, openTabs } = get();
    if (!get().registry.some((meta) => meta.id === id)) return;
    const registry = get().registry.filter((m) => m.id !== id);
    await commitProjectState(registry, [
      { key: docKey(id), value: null },
      { key: fxDocKey(id), value: null },
      { key: modelDocKey(id), value: null },
    ]);
    discardProjectSaveState(id);
    const remaining = openTabs.filter((t) => t !== id);
    if (activeId !== id) { set({ openTabs: remaining }); return; }
    useHtmlArtifact.getState().setProject(null);
    set({ openTabs: remaining, activeId: null });
    if (remaining.length) {
      const nextId = remaining[remaining.length - 1]!;
      try {
        await hydrateProjectById(nextId, registry);
        set({ activeId: nextId });
      } catch (error) {
        toast.error("Project deleted, but the next project could not open", { body: String(error) });
      }
    }
  }),
}));
