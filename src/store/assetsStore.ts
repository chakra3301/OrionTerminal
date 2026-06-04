import { create } from "zustand";
import {
  listAssets,
  insertAsset,
  deleteAsset,
  setAssetFavorite as dbSetAssetFavorite,
  upsertTagsByName,
  attachAssetTags,
  listAllAssetTags,
  type AssetKind,
  type AssetRow,
} from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import {
  scheduleReindex,
  removeEntityEmbedding,
} from "@/lib/embeddingIndexer";

export type Asset = {
  id: string;
  kind: AssetKind;
  title: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  createdAt: number;
  tags: string[];
  favorite: boolean;
};

function rowToAsset(
  r: Omit<AssetRow, "favorite"> & { favorite?: number },
  tags: string[] = [],
): Asset {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title ?? r.original_name ?? "Untitled",
    filePath: r.file_path ?? "",
    mimeType: r.mime_type ?? "",
    sizeBytes: r.size_bytes ?? 0,
    originalName: r.original_name ?? "",
    createdAt: r.created_at,
    tags,
    favorite: !!r.favorite,
  };
}

type AssetsState = {
  assets: Map<string, Asset>;
  loaded: boolean;
  /** Set of asset ids currently being auto-tagged. UI uses this to dim or
   * pulse the tag slot until results arrive. */
  taggingIds: Set<string>;

  load: () => Promise<void>;
  /**
   * Ingest one or more files by their host-side absolute paths. Each file is
   * copied into the app data dir, a DB row is created, and the new asset is
   * inserted into the store. Returns the list of newly-created assets in
   * input order (skipping any that failed). Auto-tagging fires async; the
   * promise resolves immediately after the rows are inserted.
   */
  ingestPaths: (paths: string[]) => Promise<Asset[]>;
  /**
   * Ingest one or more in-memory blobs (clipboard paste, drag from another
   * webview, screenshot capture). Bytes are written via `asset_store_bytes`.
   */
  ingestBlobs: (
    blobs: Array<{ blob: Blob; suggestedName?: string }>,
  ) => Promise<Asset[]>;
  setTags: (id: string, tags: string[]) => void;
  toggleFavorite: (id: string, favorite?: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: new Map(),
  loaded: false,
  taggingIds: new Set(),

  load: async () => {
    try {
      const [rows, tagsByAsset] = await Promise.all([
        listAssets(),
        listAllAssetTags(),
      ]);
      const map = new Map<string, Asset>();
      for (const r of rows) {
        map.set(r.id, rowToAsset(r, tagsByAsset.get(r.id) ?? []));
      }
      set({ assets: map, loaded: true });
    } catch (e) {
      log.error("assets load failed", e);
      set({ loaded: true });
    }
  },

  setTags: (id, tags) =>
    set((s) => {
      const existing = s.assets.get(id);
      if (!existing) return s;
      const next = new Map(s.assets);
      next.set(id, { ...existing, tags });
      const taggingIds = new Set(s.taggingIds);
      taggingIds.delete(id);
      return { assets: next, taggingIds };
    }),

  ingestBlobs: async (blobs) => {
    const created: Asset[] = [];
    for (const { blob, suggestedName } of blobs) {
      try {
        const buf = await blob.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buf));
        const stored = await ipc.assetStoreBytes(
          bytes,
          suggestedName ?? "",
          blob.type ?? "",
        );
        const row: Omit<AssetRow, "favorite"> = {
          id: stored.id,
          kind: stored.kind,
          title: stored.originalName,
          file_path: stored.filePath,
          url: null,
          metadata_json: null,
          mime_type: stored.mimeType,
          size_bytes: stored.sizeBytes,
          original_name: stored.originalName,
          created_at: Date.now(),
        };
        await insertAsset(row);
        created.push(rowToAsset(row));
      } catch (e) {
        log.error("blob ingest failed", e);
      }
    }
    if (created.length > 0) {
      set((s) => {
        const next = new Map(s.assets);
        const taggingIds = new Set(s.taggingIds);
        for (const a of created) {
          next.set(a.id, a);
          taggingIds.add(a.id);
        }
        return { assets: next, taggingIds };
      });
      for (const a of created) {
        scheduleReindex("asset", a.id, () => assetIndexableText(a.id));
        void runAutoTag(a);
      }
    }
    return created;
  },

  ingestPaths: async (paths) => {
    const created: Asset[] = [];
    for (const sourcePath of paths) {
      try {
        const stored = await ipc.assetStoreFile(sourcePath);
        const row: Omit<AssetRow, "favorite"> = {
          id: stored.id,
          kind: stored.kind,
          title: stored.originalName,
          file_path: stored.filePath,
          url: null,
          metadata_json: null,
          mime_type: stored.mimeType,
          size_bytes: stored.sizeBytes,
          original_name: stored.originalName,
          created_at: Date.now(),
        };
        await insertAsset(row);
        const asset = rowToAsset(row);
        created.push(asset);
      } catch (e) {
        log.error("asset ingest failed", sourcePath, e);
      }
    }
    if (created.length > 0) {
      set((s) => {
        const next = new Map(s.assets);
        const taggingIds = new Set(s.taggingIds);
        for (const a of created) {
          next.set(a.id, a);
          taggingIds.add(a.id);
        }
        return { assets: next, taggingIds };
      });
      // Kick off auto-tagging in the background — fire and forget; the store
      // updates as results arrive.
      for (const a of created) {
        scheduleReindex("asset", a.id, () => assetIndexableText(a.id));
        void runAutoTag(a);
      }
    }
    return created;
  },

  toggleFavorite: async (id, favorite) => {
    const existing = get().assets.get(id);
    if (!existing) return;
    const next = favorite ?? !existing.favorite;
    set((s) => {
      const map = new Map(s.assets);
      map.set(id, { ...existing, favorite: next });
      return { assets: map };
    });
    await dbSetAssetFavorite(id, next);
  },

  remove: async (id) => {
    const asset = get().assets.get(id);
    if (!asset) return;
    try {
      await deleteAsset(id);
      if (asset.filePath) {
        await ipc.assetDeleteFile(asset.filePath).catch((e) => {
          log.warn("asset file delete failed (DB row already removed)", e);
        });
      }
      set((s) => {
        const next = new Map(s.assets);
        next.delete(id);
        const taggingIds = new Set(s.taggingIds);
        taggingIds.delete(id);
        return { assets: next, taggingIds };
      });
      void removeEntityEmbedding("asset", id);
    } catch (e) {
      log.error("asset remove failed", e);
    }
  },
}));

/**
 * Ask the Claude CLI for 1–3 short tags for a freshly-ingested asset and
 * persist them. Best-effort — failures get logged and the asset just goes
 * untagged. Tags are lowercase single words/hyphenated phrases.
 *
 * Images use the vision-capable variant (`claude --print` with an `@<path>`
 * attachment) so tags reflect actual visual content, not just the filename.
 * Non-images stay on the cheaper metadata-only path.
 */
async function runAutoTag(asset: Asset): Promise<void> {
  const isImage = asset.kind === "image" && !!asset.filePath;
  const prompt = isImage ? buildImageTagPrompt(asset) : buildTagPrompt(asset);
  try {
    const reply = isImage
      ? await ipc.claudeOneshotWithImage(prompt, asset.filePath)
      : await ipc.claudeOneshot(prompt);
    const tags = parseTags(reply);
    if (tags.length === 0) {
      useAssetsStore.getState().setTags(asset.id, []);
      return;
    }
    const records = await upsertTagsByName(tags);
    await attachAssetTags(
      asset.id,
      records.map((r) => r.id),
    );
    useAssetsStore.getState().setTags(
      asset.id,
      records.map((r) => r.name),
    );
    // Tags substantially change the indexable text — re-embed once they land.
    scheduleReindex("asset", asset.id, () => assetIndexableText(asset.id));
  } catch (e) {
    log.warn("auto-tag failed", asset.id, e);
    useAssetsStore.getState().setTags(asset.id, []);
  }
}

/** Build the same indexable string the boot backfill uses for assets, by
 * id. Lives here so save-path reindex stays in sync with backfill. Returns
 * null when the asset is gone (deleted between schedule and fire). */
function assetIndexableText(id: string): string | null {
  const a = useAssetsStore.getState().assets.get(id);
  if (!a) return null;
  const parts = [a.title, a.originalName, ...a.tags].filter(Boolean);
  return parts.join("\n").trim() || null;
}

function buildTagPrompt(a: Asset): string {
  return [
    "You're tagging a personal-archive asset. Reply with 1 to 3 short tags,",
    "comma-separated, lowercase, single words or hyphenated phrases. No",
    "explanations, no punctuation other than commas and hyphens.",
    "",
    `Filename: ${a.originalName}`,
    `Kind: ${a.kind}`,
    `Mime: ${a.mimeType || "(unknown)"}`,
    `Size: ${a.sizeBytes} bytes`,
    "",
    "Tags:",
  ].join("\n");
}

function buildImageTagPrompt(a: Asset): string {
  // Same shape as the metadata prompt, but tells Claude to look at the
  // attached image and tag what it actually sees. Filename is still useful
  // context but visual content dominates.
  return [
    "Tag the attached image with 1 to 3 short tags, comma-separated,",
    "lowercase, single words or hyphenated phrases. Pick tags that capture",
    "the dominant subject, mood, or visual style. No explanations, no",
    "punctuation other than commas and hyphens.",
    "",
    `Filename: ${a.originalName}`,
    "",
    "Tags:",
  ].join("\n");
}

function parseTags(reply: string): string[] {
  // Take the first non-empty line (CLI sometimes adds trailing newlines).
  const firstLine = reply
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return [];
  return firstLine
    .replace(/^tags:\s*/i, "")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^#+/, ""))
    .filter((t) => t.length > 0 && t.length <= 24 && /^[a-z0-9-]+$/.test(t))
    .slice(0, 3);
}

/**
 * Pure helper — turn the assets map into a date-desc list. Call this from
 * `useMemo` (NOT as a Zustand selector); returning a fresh array on every
 * call would force re-renders since Zustand compares snapshots with `===`.
 */
export function sortAssetsDesc(map: Map<string, Asset>): Asset[] {
  return Array.from(map.values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
