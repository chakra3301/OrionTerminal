/** Assembles the Brain graph from everything live in Orion Terminal:
 * zustand stores (notes / assets / mood boards / collections) plus two async
 * SQLite reads (chats, embedding vectors). Rebuilds automatically when store
 * data changes; chats + vectors refresh on mount and via refresh(). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { listAllChats, listEmbeddings } from "@/lib/db";
import { deserializeVector } from "@/lib/embeddings";
import { log } from "@/lib/log";
import {
  buildBrainGraph,
  type BrainGraph,
  type BrainInputs,
} from "@/apps/archives/brain/graphBuild";

type AsyncSlices = {
  chats: BrainInputs["chats"];
  vectors: BrainInputs["vectors"];
  loading: boolean;
};

export function useBrainGraph(): {
  graph: BrainGraph;
  loading: boolean;
  refresh: () => void;
} {
  const notes = useNotesStore((s) => s.notes);
  const assets = useAssetsStore((s) => s.assets);
  const boards = useMoodBoardsStore((s) => s.boards);
  const boardMembers = useMoodBoardsStore((s) => s.members);
  const collections = useCollectionsStore((s) => s.collections);

  const [slices, setSlices] = useState<AsyncSlices>({
    chats: [],
    vectors: [],
    loading: true,
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setSlices((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        const [chatRows, embeddingRows] = await Promise.all([
          listAllChats(500),
          listEmbeddings(),
        ]);
        if (cancelled) return;
        setSlices({
          chats: chatRows.map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updated_at,
          })),
          vectors: embeddingRows.map((r) => ({
            kind: r.kind,
            id: r.id,
            vector: deserializeVector(r.vector),
          })),
          loading: false,
        });
      } catch (e) {
        log.warn("brain graph async slices failed", e);
        if (!cancelled) setSlices((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const graph = useMemo<BrainGraph>(() => {
    const inputs: BrainInputs = {
      notes: Array.from(notes.values()).map((n) => ({
        id: n.id,
        title: n.title,
        kind: n.kind,
        plaintext: n.plaintext,
        blocks: n.blocks,
        parentId: n.parentId,
        collectionId: n.collectionId,
        tags: n.tags,
        updatedAt: n.updatedAt,
      })),
      chats: slices.chats,
      assets: Array.from(assets.values()).map((a) => ({
        id: a.id,
        title: a.title,
        tags: a.tags,
        createdAt: a.createdAt,
      })),
      boards: Array.from(boards.values()).map((b) => ({
        id: b.id,
        title: b.title,
        updatedAt: b.updatedAt,
      })),
      boardMembers,
      collections: Array.from(collections.values()).map((c) => ({
        id: c.id,
        name: c.name,
      })),
      vectors: slices.vectors,
    };
    return buildBrainGraph(inputs);
  }, [notes, assets, boards, boardMembers, collections, slices]);

  return { graph, loading: slices.loading, refresh };
}
