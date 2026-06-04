import { create } from "zustand";

type FileTreeRefreshState = {
  version: number;
  bump: () => void;
};

export const useFileTreeRefresh = create<FileTreeRefreshState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
