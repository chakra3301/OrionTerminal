import { create } from "zustand";

// Tab containers (tabs, activeTabId, open/close/etc.) now live in
// `useWorkspace` (src/components/workspace/workspaceStore.ts). This store
// owns file-buffer state only — contents loaded from disk, the originally-
// loaded version (for diff/dirty), and the load flag.

export type FileBuffer = {
  contents: string;
  original: string;
  loaded: boolean;
};

export type { Tab, TabDescriptor, AssetFilter } from "@/components/workspace/types";
import type { Tab } from "@/components/workspace/types";

type TabsState = {
  fileBuffers: Record<string, FileBuffer>;
  updateBuffer: (path: string, contents: string) => void;
  markLoaded: (path: string, contents: string) => void;
  markSaved: (path: string) => void;
  dropBuffer: (path: string) => void;
};

export const useTabsStore = create<TabsState>((set) => ({
  fileBuffers: {},

  updateBuffer: (path, contents) => {
    set((s) => {
      const buf = s.fileBuffers[path];
      const original = buf?.original ?? "";
      const loaded = buf?.loaded ?? false;
      return {
        fileBuffers: {
          ...s.fileBuffers,
          [path]: { contents, original, loaded },
        },
      };
    });
  },

  markLoaded: (path, contents) => {
    set((s) => ({
      fileBuffers: {
        ...s.fileBuffers,
        [path]: { contents, original: contents, loaded: true },
      },
    }));
  },

  markSaved: (path) => {
    set((s) => {
      const buf = s.fileBuffers[path];
      if (!buf) return s;
      return {
        fileBuffers: {
          ...s.fileBuffers,
          [path]: { ...buf, original: buf.contents },
        },
      };
    });
  },

  dropBuffer: (path) => {
    set((s) => {
      if (!s.fileBuffers[path]) return s;
      const { [path]: _drop, ...rest } = s.fileBuffers;
      return { fileBuffers: rest };
    });
  },
}));

export function isFileTabDirty(
  tab: Tab,
  buffers: Record<string, FileBuffer>,
): boolean {
  if (tab.descriptor.kind !== "file") return tab.dirty === true;
  const buf = buffers[tab.descriptor.path];
  return !!buf?.loaded && buf.contents !== buf.original;
}

export function isPathDirty(
  path: string,
  buffers: Record<string, FileBuffer>,
): boolean {
  const buf = buffers[path];
  return !!buf?.loaded && buf.contents !== buf.original;
}
