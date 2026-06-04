import { create } from "zustand";
import { ulid } from "ulid";
import {
  listMoodBoards,
  insertMoodBoard,
  renameMoodBoard as dbRenameMoodBoard,
  setMoodBoardCover as dbSetMoodBoardCover,
  setMoodBoardFavorite as dbSetMoodBoardFavorite,
  deleteMoodBoard,
  listAllMoodBoardMembers,
  addAssetToMoodBoard,
  removeAssetFromMoodBoard,
  reorderMoodBoardAssets,
  type MoodBoardRow,
} from "@/lib/db";
import { log } from "@/lib/log";

export type MoodBoard = {
  id: string;
  title: string;
  coverAssetId: string | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};

function rowToBoard(r: MoodBoardRow): MoodBoard {
  return {
    id: r.id,
    title: r.title,
    coverAssetId: r.cover_asset_id,
    favorite: !!r.favorite,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type State = {
  boards: Map<string, MoodBoard>;
  /** boardId → ordered list of assetIds in the board. */
  members: Map<string, string[]>;
  loaded: boolean;

  load: () => Promise<void>;
  create: (title: string) => Promise<MoodBoard>;
  rename: (id: string, title: string) => Promise<void>;
  setCover: (id: string, coverAssetId: string | null) => Promise<void>;
  toggleFavorite: (id: string, favorite?: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addAsset: (boardId: string, assetId: string) => Promise<void>;
  removeAsset: (boardId: string, assetId: string) => Promise<void>;
  /** Replace the member order for a board with the given list. */
  reorderAssets: (boardId: string, orderedAssetIds: string[]) => Promise<void>;
};

export const useMoodBoardsStore = create<State>((set, get) => ({
  boards: new Map(),
  members: new Map(),
  loaded: false,

  load: async () => {
    try {
      const [rows, memberRows] = await Promise.all([
        listMoodBoards(),
        listAllMoodBoardMembers(),
      ]);
      const boards = new Map<string, MoodBoard>();
      for (const r of rows) boards.set(r.id, rowToBoard(r));
      const members = new Map<string, string[]>();
      for (const m of memberRows) {
        const arr = members.get(m.board_id) ?? [];
        arr.push(m.asset_id);
        members.set(m.board_id, arr);
      }
      set({ boards, members, loaded: true });
    } catch (e) {
      log.error("mood boards load failed", e);
      set({ loaded: true });
    }
  },

  create: async (title) => {
    const now = Date.now();
    const board: MoodBoard = {
      id: ulid(),
      title: title.trim() || "Untitled board",
      coverAssetId: null,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await insertMoodBoard({
      id: board.id,
      title: board.title,
      cover_asset_id: null,
      created_at: board.createdAt,
      updated_at: board.updatedAt,
    });
    set((s) => {
      const next = new Map(s.boards);
      next.set(board.id, board);
      const members = new Map(s.members);
      members.set(board.id, []);
      return { boards: next, members };
    });
    return board;
  },

  rename: async (id, title) => {
    const board = get().boards.get(id);
    if (!board) return;
    const updatedAt = Date.now();
    const trimmed = title.trim() || "Untitled board";
    await dbRenameMoodBoard(id, trimmed, updatedAt);
    set((s) => {
      const next = new Map(s.boards);
      next.set(id, { ...board, title: trimmed, updatedAt });
      return { boards: next };
    });
  },

  setCover: async (id, coverAssetId) => {
    const board = get().boards.get(id);
    if (!board) return;
    const updatedAt = Date.now();
    await dbSetMoodBoardCover(id, coverAssetId, updatedAt);
    set((s) => {
      const next = new Map(s.boards);
      next.set(id, { ...board, coverAssetId, updatedAt });
      return { boards: next };
    });
  },

  toggleFavorite: async (id, favorite) => {
    const board = get().boards.get(id);
    if (!board) return;
    const next = favorite ?? !board.favorite;
    const updatedAt = Date.now();
    set((s) => {
      const map = new Map(s.boards);
      map.set(id, { ...board, favorite: next, updatedAt });
      return { boards: map };
    });
    await dbSetMoodBoardFavorite(id, next, updatedAt);
  },

  remove: async (id) => {
    await deleteMoodBoard(id);
    set((s) => {
      const next = new Map(s.boards);
      next.delete(id);
      const members = new Map(s.members);
      members.delete(id);
      return { boards: next, members };
    });
  },

  addAsset: async (boardId, assetId) => {
    const board = get().boards.get(boardId);
    if (!board) return;
    const current = get().members.get(boardId) ?? [];
    if (current.includes(assetId)) return;
    await addAssetToMoodBoard(boardId, assetId);
    const updatedAt = Date.now();
    set((s) => {
      const members = new Map(s.members);
      members.set(boardId, [...current, assetId]);
      const boards = new Map(s.boards);
      // Auto-set cover to the first asset added so boards have a thumbnail
      // without the user having to pick one.
      const coverAssetId = board.coverAssetId ?? assetId;
      boards.set(boardId, { ...board, coverAssetId, updatedAt });
      return { members, boards };
    });
    if (!board.coverAssetId) {
      // Persist the auto-pick so it sticks across launches.
      try {
        await dbSetMoodBoardCover(boardId, assetId, updatedAt);
      } catch (e) {
        log.warn("set cover failed", e);
      }
    }
  },

  reorderAssets: async (boardId, orderedAssetIds) => {
    const board = get().boards.get(boardId);
    if (!board) return;
    // Optimistic: update the in-memory order immediately so the UI snaps,
    // then persist. On error, revert to the previous order.
    const previous = get().members.get(boardId) ?? [];
    set((s) => {
      const members = new Map(s.members);
      members.set(boardId, orderedAssetIds);
      return { members };
    });
    try {
      await reorderMoodBoardAssets(boardId, orderedAssetIds);
      const updatedAt = Date.now();
      set((s) => {
        const boards = new Map(s.boards);
        boards.set(boardId, { ...board, updatedAt });
        return { boards };
      });
    } catch (e) {
      log.error("reorder failed; reverting", e);
      set((s) => {
        const members = new Map(s.members);
        members.set(boardId, previous);
        return { members };
      });
    }
  },

  removeAsset: async (boardId, assetId) => {
    const board = get().boards.get(boardId);
    if (!board) return;
    await removeAssetFromMoodBoard(boardId, assetId);
    const updatedAt = Date.now();
    set((s) => {
      const members = new Map(s.members);
      const next = (members.get(boardId) ?? []).filter((id) => id !== assetId);
      members.set(boardId, next);
      const boards = new Map(s.boards);
      // If the removed asset was the cover, swap in the next member (or null).
      const coverAssetId =
        board.coverAssetId === assetId ? next[0] ?? null : board.coverAssetId;
      boards.set(boardId, { ...board, coverAssetId, updatedAt });
      return { members, boards };
    });
    if (board.coverAssetId === assetId) {
      const newCover = get().members.get(boardId)?.[0] ?? null;
      try {
        await dbSetMoodBoardCover(boardId, newCover, updatedAt);
      } catch (e) {
        log.warn("set cover failed", e);
      }
    }
  },
}));

export function sortBoardsDesc(map: Map<string, MoodBoard>): MoodBoard[] {
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
