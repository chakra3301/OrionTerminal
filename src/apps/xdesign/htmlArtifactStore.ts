import { create } from "zustand";
import { log } from "@/lib/log";

const LS_KEY = "xd-html-artifact";

export type ArtifactViewport = "desktop" | "tablet" | "mobile";

type Persisted = { html: string; title: string };

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Persisted;
    if (o && typeof o.html === "string") return o;
  } catch (e) {
    log.warn("html artifact load failed", e);
  }
  return null;
}

function persist(html: string, title: string): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ html, title }));
  } catch (e) {
    log.warn("html artifact persist failed", e);
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
};

const initial = loadPersisted();

export const useHtmlArtifact = create<HtmlArtifactState>((set) => ({
  html: initial?.html ?? null,
  title: initial?.title ?? "Untitled page",
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
}));
