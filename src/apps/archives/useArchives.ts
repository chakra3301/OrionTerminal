import { create } from "zustand";

export type ArchivesView =
  | "today"
  | "journal"
  | "projects"
  | "notes"
  | "mood"
  | "media"
  | "favorites"
  | "chats"
  | "database";

type ArchivesState = {
  view: ArchivesView;
  setView: (view: ArchivesView) => void;
  /** Currently-open note in the Journal view (and the "open this" target
   * from Notes/Today cards). Null until something is opened. */
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  /** Asset currently shown in the AssetPreviewModal. Null = closed. */
  previewingAssetId: string | null;
  setPreviewingAssetId: (id: string | null) => void;
  /** Currently-open mood board (Mood view). Null = list mode. */
  openBoardId: string | null;
  setOpenBoardId: (id: string | null) => void;
  /** Currently-open project page (Projects view). Null = nothing selected. */
  openProjectId: string | null;
  setOpenProjectId: (id: string | null) => void;
  /** Set of project ids whose children are visible in the tree rail. */
  expandedProjectIds: Set<string>;
  toggleProjectExpanded: (id: string) => void;
  /** Sidebar-driven filter for Projects/Notes/Journal views. */
  selectedCollectionId: string | null;
  setSelectedCollectionId: (id: string | null) => void;
  /** Collection being viewed AS a database (table/board/…). */
  databaseCollectionId: string | null;
  openDatabase: (collectionId: string) => void;
  /** Sidebar-driven tag filter. Tag name (lowercase), not id. */
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  /** Currently-open kind=note in the Notes view (lifted from local state
   * so search results can route into it). */
  openNoteId: string | null;
  setOpenNoteId: (id: string | null) => void;
  /** Live sidebar search query. */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Cached counts shown in the rail subtitle / sidebar badges. */
  noteCount: number;
  assetCount: number;
  chatCount: number;
  setCounts: (counts: {
    notes?: number;
    assets?: number;
    chats?: number;
  }) => void;
};

export const useArchives = create<ArchivesState>((set) => ({
  view: "today",
  setView: (view) => set({ view }),
  databaseCollectionId: null,
  openDatabase: (collectionId) => set({ databaseCollectionId: collectionId, view: "database" }),
  selectedNoteId: null,
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
  previewingAssetId: null,
  setPreviewingAssetId: (previewingAssetId) => set({ previewingAssetId }),
  openBoardId: null,
  setOpenBoardId: (openBoardId) => set({ openBoardId }),
  openProjectId: null,
  setOpenProjectId: (openProjectId) => set({ openProjectId }),
  expandedProjectIds: new Set(),
  toggleProjectExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedProjectIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedProjectIds: next };
    }),
  selectedCollectionId: null,
  setSelectedCollectionId: (selectedCollectionId) =>
    set({ selectedCollectionId }),
  selectedTag: null,
  setSelectedTag: (selectedTag) => set({ selectedTag }),
  openNoteId: null,
  setOpenNoteId: (openNoteId) => set({ openNoteId }),
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  noteCount: 0,
  assetCount: 0,
  chatCount: 0,
  setCounts: (counts) =>
    set((s) => ({
      noteCount: counts.notes ?? s.noteCount,
      assetCount: counts.assets ?? s.assetCount,
      chatCount: counts.chats ?? s.chatCount,
    })),
}));
