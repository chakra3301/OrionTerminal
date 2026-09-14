import { create } from "zustand";
import { toast } from "@/store/toastStore";
import { markProjectDirty } from "./saveState";
import { validateHtmlArtifact, type HtmlArtifactData } from "./htmlArtifactData";

export type ArtifactViewport = "desktop" | "tablet" | "mobile";

type HtmlArtifactState = {
  projectId: string | null;
  html: string | null;
  title: string;
  open: boolean;
  viewport: ArtifactViewport;
  builder: (() => void) | null;
  refiner: ((instruction: string) => void) | null;
  elementRefiner: ((elementHtml: string, instruction: string) => void) | null;
  setArtifact: (html: string, title?: string, expectedProjectId?: string | null) => boolean;
  openPreview: () => void;
  close: () => void;
  setViewport: (v: ArtifactViewport) => void;
  setActions: (a: {
    builder: () => void;
    refiner: (instruction: string) => void;
    elementRefiner: (elementHtml: string, instruction: string) => void;
  }) => void;
  setProject: (projectId: string | null, artifact?: HtmlArtifactData | null) => void;
};

export function snapshotHtmlArtifact(projectId: string): HtmlArtifactData | null {
  const s = useHtmlArtifact.getState();
  if (s.projectId !== projectId) throw new Error("Webpage belongs to another project; save refused.");
  return s.html === null ? null : { version: 1, html: s.html, title: s.title, open: s.open };
}

export const useHtmlArtifact = create<HtmlArtifactState>((set, get) => ({
  projectId: null,
  html: null,
  title: "Untitled page",
  open: false,
  viewport: "desktop",
  builder: null,
  refiner: null,
  elementRefiner: null,
  setArtifact: (html, title, expectedProjectId = get().projectId) => {
    const s = get();
    if (!s.projectId || s.projectId !== expectedProjectId) {
      toast.error("Webpage was not applied", { body: "The owning project changed. The original response remains in chat." });
      return false;
    }
    try {
      const data = validateHtmlArtifact({ version: 1, html, title: title ?? s.title, open: true });
      if (s.html === data.html && s.title === data.title && s.open) return true;
      markProjectDirty(s.projectId);
      set({ html: data.html, title: data.title, open: data.open });
      return true;
    } catch (error) {
      toast.error("Webpage was not applied", { body: String(error) });
      return false;
    }
  },
  openPreview: () => {
    const s = get();
    if (!s.projectId || s.html === null || s.open) return;
    markProjectDirty(s.projectId); set({ open: true });
  },
  close: () => {
    const s = get();
    if (!s.projectId || s.html === null || !s.open) return;
    markProjectDirty(s.projectId); set({ open: false });
  },
  setViewport: (viewport) => set({ viewport }),
  setActions: ({ builder, refiner, elementRefiner }) => set({ builder, refiner, elementRefiner }),
  setProject: (projectId, artifact) => {
    const data = artifact == null ? null : validateHtmlArtifact(artifact);
    set({ projectId, html: data?.html ?? null, title: data?.title ?? "Untitled page", open: data?.open ?? false });
  },
}));
