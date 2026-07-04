import { create } from "zustand";
import { ulid } from "ulid";
import { getAppState, setAppState } from "@/lib/db";
import {
  useXDesign,
  type Page,
  type Variable,
  type Mode,
} from "./store";
import { useHtmlArtifact, migrateLegacyArtifactTo } from "./htmlArtifactStore";
import { useFxStore, snapshotFxDoc, emptyFxDoc } from "./fx/fxStore";
import type { FxDoc } from "./fx/fxModel";

/** A persisted XDesign document — the same shape `useXDesign.hydrate` accepts
 * and `useXDesignPersistence` writes. One per project. */
export type XDDoc = {
  pages: Page[];
  activePageId: string;
  variables?: Variable[];
  modes?: Mode[];
  activeModeId?: string;
};

export type XDProjectKind = "design" | "fx";

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

function docKey(id: string): `xdesign.project.${string}` {
  return `xdesign.project.${id}`;
}

function fxDocKey(id: string): `xdesign.fx.${string}` {
  return `xdesign.fx.${id}`;
}

/** Fresh, empty single-page document. */
export function emptyDoc(): XDDoc {
  return {
    pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: [], past: [], future: [] }],
    activePageId: DEFAULT_PAGE_ID,
    variables: [],
    modes: [{ id: DEFAULT_MODE_ID, name: "Default" }],
    activeModeId: DEFAULT_MODE_ID,
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
    pages,
    activePageId: s.activePageId,
    variables: s.variables,
    modes: s.modes,
    activeModeId: s.activeModeId,
  };
}

export async function loadDoc(id: string): Promise<XDDoc | null> {
  return getAppState<XDDoc>(docKey(id));
}

export async function saveDoc(id: string, doc: XDDoc): Promise<void> {
  await setAppState(docKey(id), doc);
}

export async function loadFxDoc(id: string): Promise<FxDoc | null> {
  return getAppState<FxDoc>(fxDocKey(id));
}

export async function saveFxDoc(id: string, doc: FxDoc): Promise<void> {
  await setAppState(fxDocKey(id), doc);
}

/** Load a project's doc into the right live store (design vs fx) and scope
 * the HTML artifact panel. Single path used by open/close/delete. */
async function hydrateProjectById(
  id: string,
  registry: XDProjectMeta[],
): Promise<void> {
  const kind = projectKind(registry.find((m) => m.id === id));
  if (kind === "fx") {
    const doc = (await loadFxDoc(id)) ?? emptyFxDoc();
    useFxStore.getState().hydrateFx(doc);
    useHtmlArtifact.getState().setProject(null);
  } else {
    const doc = (await loadDoc(id)) ?? emptyDoc();
    useXDesign.getState().hydrate(doc);
    useHtmlArtifact.getState().setProject(id);
  }
}

type XDProjectsState = {
  registry: XDProjectMeta[];
  openTabs: string[];
  /** Active project id, or null to show the Home / start screen. */
  activeId: string | null;
  /** True once `init()` has run (so the UI doesn't flash). */
  ready: boolean;

  init: () => Promise<void>;
  /** Guarantee a DESIGN project is open before a canvas mutation. Returns
   * the active id, creating a fresh project if currently on Home or if the
   * active project is an FX scene (design shapes must never land in an FX
   * doc slot). */
  ensureActive: () => Promise<string>;
  newProject: (name?: string, kind?: XDProjectKind) => Promise<string>;
  openProject: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  goHome: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

/** Persist the registry (recent list). Tabs + active are session state and
 * intentionally NOT restored across launches — we always land on Home. */
function persistRegistry(registry: XDProjectMeta[]): void {
  void setAppState("xdesign.projects", { registry });
}

/** Flush the live doc to the active project's slot + bump its updatedAt.
 * No-op when on Home (no active project). */
export async function flushActive(): Promise<void> {
  const { activeId, registry } = useXDProjects.getState();
  if (!activeId) return;
  if (projectKind(registry.find((m) => m.id === activeId)) === "fx") {
    await saveFxDoc(activeId, snapshotFxDoc());
  } else {
    await saveDoc(activeId, snapshotActiveDoc());
  }
  const next = registry.map((m) =>
    m.id === activeId ? { ...m, updatedAt: Date.now() } : m,
  );
  useXDProjects.setState({ registry: next });
  persistRegistry(next);
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

  init: async () => {
    const stored = await getAppState<{ registry?: XDProjectMeta[] }>(
      "xdesign.projects",
    );
    let registry = stored?.registry ?? [];

    // Migrate a pre-projects document: if the legacy single-doc key exists and
    // there are no projects yet, adopt it as "Untitled" so no work is lost.
    if (registry.length === 0) {
      const legacy = await getAppState<XDDoc | unknown[]>("xdesign.doc");
      if (legacy) {
        const id = ulid();
        const now = Date.now();
        const doc: XDDoc = Array.isArray(legacy)
          ? { ...emptyDoc(), pages: [{ id: DEFAULT_PAGE_ID, name: "Page 1", shapes: legacy as never, past: [], future: [] }] }
          : (legacy as XDDoc);
        await saveDoc(id, doc);
        migrateLegacyArtifactTo(id);
        registry = [{ id, name: "Untitled", createdAt: now, updatedAt: now }];
        persistRegistry(registry);
      }
    }

    useHtmlArtifact.getState().setProject(null);
    set({ registry, openTabs: [], activeId: null, ready: true });
  },

  ensureActive: async () => {
    const { activeId, registry } = get();
    if (activeId && projectKind(registry.find((m) => m.id === activeId)) === "design") {
      return activeId;
    }
    return get().newProject();
  },

  newProject: async (name, kind = "design") => {
    await flushActive();
    const id = ulid();
    const now = Date.now();
    const meta: XDProjectMeta = {
      id,
      name: name?.trim() || uniqueName(get().registry, kind === "fx" ? "FX Scene" : "Untitled"),
      createdAt: now,
      updatedAt: now,
      ...(kind === "fx" ? { kind } : {}),
    };
    if (kind === "fx") {
      const doc = emptyFxDoc();
      await saveFxDoc(id, doc);
      useFxStore.getState().hydrateFx(doc);
      useHtmlArtifact.getState().setProject(null);
    } else {
      await saveDoc(id, emptyDoc());
      useXDesign.getState().hydrate(emptyDoc());
      useHtmlArtifact.getState().setProject(id);
    }
    const registry = [meta, ...get().registry];
    set((s) => ({
      registry,
      openTabs: [...s.openTabs, id],
      activeId: id,
    }));
    persistRegistry(registry);
    return id;
  },

  openProject: async (id) => {
    if (get().activeId === id) return;
    await flushActive();
    await hydrateProjectById(id, get().registry);
    set((s) => ({
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      activeId: id,
    }));
  },

  switchTo: async (id) => {
    await get().openProject(id);
  },

  closeTab: async (id) => {
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
  },

  goHome: async () => {
    await flushActive();
    useHtmlArtifact.getState().setProject(null);
    set({ activeId: null });
  },

  renameProject: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const registry = get().registry.map((m) =>
      m.id === id ? { ...m, name: trimmed, updatedAt: Date.now() } : m,
    );
    set({ registry });
    persistRegistry(registry);
  },

  deleteProject: async (id) => {
    const { activeId, openTabs } = get();
    const registry = get().registry.filter((m) => m.id !== id);
    void setAppState(docKey(id), null);
    void setAppState(fxDocKey(id), null);

    const remaining = openTabs.filter((t) => t !== id);
    if (activeId === id) {
      if (remaining.length === 0) {
        useHtmlArtifact.getState().setProject(null);
        set({ registry, openTabs: [], activeId: null });
      } else {
        const nextId = remaining[remaining.length - 1]!;
        await hydrateProjectById(nextId, registry);
        set({ registry, openTabs: remaining, activeId: nextId });
      }
    } else {
      set({ registry, openTabs: remaining });
    }
    persistRegistry(registry);
  },
}));
