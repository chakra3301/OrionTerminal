import { create } from "zustand";
import { log } from "@/lib/log";

/** Legacy global key (pre per-project scoping). Kept only so the migrated
 * "Untitled" project can adopt whatever page was last generated. */
const LEGACY_LS_KEY = "xd-html-artifact";

export type ArtifactViewport = "desktop" | "tablet" | "mobile";

type Persisted = { html: string; title: string };

/** The project the artifact store is currently bound to. Null = Home / no
 * project, in which case there is no page to show or persist. */
let activeProjectId: string | null = null;

function keyFor(id: string): string {
  return `xd-html-artifact.${id}`;
}

function loadPersistedFrom(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Persisted;
    if (o && typeof o.html === "string") return o;
  } catch (e) {
    log.warn("html artifact load failed", e);
  }
  return null;
}

function persist(html: string, title: string): void {
  if (!activeProjectId) return;
  try {
    localStorage.setItem(keyFor(activeProjectId), JSON.stringify({ html, title }));
  } catch (e) {
    log.warn("html artifact persist failed", e);
  }
}

/** One-time migration: copy the old global page into a project's slot the
 * first time we adopt it, then drop the legacy key. */
export function migrateLegacyArtifactTo(projectId: string): void {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return;
    if (!localStorage.getItem(keyFor(projectId)))
      localStorage.setItem(keyFor(projectId), raw);
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch (e) {
    log.warn("html artifact legacy migration failed", e);
  }
}

type HtmlArtifactState = {
  html: string | null;
  title: string;
  open: boolean;
  viewport: ArtifactViewport;
  /** Set by the rail so the preview can request build/refine without coupling. */
  builder: (() => void) | null;
  refiner: ((instruction: string) => void) | null;
  /** Element-scoped AI refine: rewrite only the given element's markup. */
  elementRefiner: ((elementHtml: string, instruction: string) => void) | null;
  setArtifact: (html: string, title?: string) => void;
  openPreview: () => void;
  close: () => void;
  setViewport: (v: ArtifactViewport) => void;
  setActions: (a: {
    builder: () => void;
    refiner: (instruction: string) => void;
    elementRefiner: (elementHtml: string, instruction: string) => void;
  }) => void;
  /** Bind the store to a project (or null for Home). Loads that project's
   * saved page, or clears when the project has none. Closes the preview. */
  setProject: (projectId: string | null) => void;
};

export const useHtmlArtifact = create<HtmlArtifactState>((set) => ({
  html: null,
  title: "Untitled page",
  open: false,
  viewport: "desktop",
  builder: null,
  refiner: null,
  elementRefiner: null,
  setArtifact: (html, title) =>
    set((s) => {
      const t = title ?? s.title;
      persist(html, t);
      return { html, title: t, open: true };
    }),
  openPreview: () => set({ open: true }),
  close: () => set({ open: false }),
  setViewport: (viewport) => set({ viewport }),
  setActions: ({ builder, refiner, elementRefiner }) =>
    set({ builder, refiner, elementRefiner }),
  setProject: (projectId) => {
    activeProjectId = projectId;
    const p = projectId ? loadPersistedFrom(keyFor(projectId)) : null;
    set({
      html: p?.html ?? null,
      title: p?.title ?? "Untitled page",
      open: false,
    });
  },
}));
