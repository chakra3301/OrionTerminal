import { create } from "zustand";
import { ipc, type TreeNode } from "@/lib/ipc";
import {
  listCodeFileHashes,
  listCodeChunks,
  replaceCodeChunks,
  deleteCodeFile,
  getCodeFileHash,
} from "@/lib/db";
import {
  embed,
  embedBatch,
  hashText,
  serializeVector,
  deserializeVector,
  cosineSimilarity,
} from "@/lib/embeddings";
import { chunkCode, chunkEmbedText, looksMinified } from "./codeChunker";
import { useProjectStore } from "@/store/projectStore";
import { log } from "@/lib/log";
import { beginOrionActivity } from "@/apps/orion/runtimeActivity";

/** Source extensions worth indexing. Everything else (binaries, lockfiles,
 * JSON blobs) only adds noise to retrieval. */
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "rs", "py", "go", "java", "kt", "swift",
  "c", "h", "m", "cpp", "hpp", "cc", "cs",
  "rb", "php", "css", "scss", "less", "html",
  "vue", "svelte", "sql", "sh", "zsh", "bash",
  "toml", "yaml", "yml", "md",
]);
const MAX_FILE_CHARS = 200_000;
const EMBED_BATCH = 8;
const MIN_SCORE = 0.25;

type IndexState = {
  state: "idle" | "indexing" | "ready";
  total: number;
  done: number;
};

export const useCodebaseIndex = create<IndexState>(() => ({
  state: "idle",
  total: 0,
  done: 0,
}));

export type CodeHit = {
  path: string; // project-relative
  startLine: number;
  endLine: number;
  score: number;
};

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function collectCodeFiles(tree: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const c of n.children ?? []) {
      if (c.is_dir) walk(c);
      else if (CODE_EXT.has(extOf(c.name))) out.push(c.path);
    }
  };
  walk(tree);
  return out;
}

function relPath(root: string, abs: string): string {
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^\//, "") : abs;
}

// In-memory vectors for search — rebuilt lazily after any index write.
let searchCache: {
  projectId: string;
  rows: Array<{ path: string; startLine: number; endLine: number; vector: Float32Array }>;
} | null = null;

function invalidateSearchCache(): void {
  searchCache = null;
}

/** Index (or re-index) one file. Returns true if rows changed. */
async function indexOneFile(
  projectId: string,
  root: string,
  absPath: string,
  knownHash: string | null,
): Promise<boolean> {
  const rel = relPath(root, absPath);
  let content: string;
  try {
    content = await ipc.readFile(absPath);
  } catch {
    await deleteCodeFile(projectId, rel);
    return true;
  }
  if (content.length > MAX_FILE_CHARS || looksMinified(content)) {
    if (knownHash !== null) {
      await deleteCodeFile(projectId, rel);
      return true;
    }
    return false;
  }
  const hash = await hashText(content);
  if (hash === knownHash) return false;

  const chunks = chunkCode(content);
  const rows: Array<{ idx: number; startLine: number; endLine: number; vector: Uint8Array }> = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((c) => chunkEmbedText(rel, c)));
    batch.forEach((c, j) => {
      const v = vectors[j];
      if (v) {
        rows.push({
          idx: c.idx,
          startLine: c.startLine,
          endLine: c.endLine,
          vector: serializeVector(v),
        });
      }
    });
  }
  await replaceCodeChunks(projectId, rel, hash, rows);
  return true;
}

let running = false;
let queued: { projectId: string; root: string } | null = null;
let generation = 0;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let stopProjectSubscription: (() => void) | null = null;

/** Full hash-aware sweep: new/changed files re-embed, deleted files drop.
 * Serial on purpose — inference runs in the worker, so this never janks
 * the UI; serializing just keeps memory flat. */
export async function indexCodebase(projectId: string, root: string): Promise<void> {
  if (running) {
    queued = { projectId, root };
    return;
  }
  const runGeneration = generation;
  const endActivity = beginOrionActivity(
    "codebase-index",
    "Wait for Orion's codebase index to finish before disabling the plugin.",
  );
  running = true;
  try {
    const tree = await ipc.readDirTree(root, 10);
    if (runGeneration !== generation) return;
    const files = collectCodeFiles(tree);
    const stored = await listCodeFileHashes(projectId);
    const current = new Set(files.map((f) => relPath(root, f)));

    for (const [path] of stored) {
      if (runGeneration !== generation) return;
      if (!current.has(path)) {
        await deleteCodeFile(projectId, path);
        invalidateSearchCache();
      }
    }

    useCodebaseIndex.setState({ state: "indexing", total: files.length, done: 0 });
    let changed = 0;
    for (const abs of files) {
      if (runGeneration !== generation) return;
      const rel = relPath(root, abs);
      try {
        if (await indexOneFile(projectId, root, abs, stored.get(rel) ?? null)) {
          changed++;
          invalidateSearchCache();
        }
      } catch (e) {
        log.warn("code index failed for", rel, e);
      }
      useCodebaseIndex.setState((s) => ({ ...s, done: s.done + 1 }));
    }
    useCodebaseIndex.setState((s) => ({ ...s, state: "ready" }));
    if (changed > 0) log.info(`codebase index: ${changed} file(s) re-embedded`);
  } catch (e) {
    log.warn("codebase index failed", e);
    useCodebaseIndex.setState((s) => ({ ...s, state: "ready" }));
  } finally {
    running = false;
    endActivity();
    if (queued && runGeneration === generation) {
      const next = queued;
      queued = null;
      void indexCodebase(next.projectId, next.root);
    }
  }
}

function scheduleProjectIndex(project: { id: string; root_path: string } | null): void {
  if (!project) return;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void indexCodebase(project.id, project.root_path);
  }, 4_000);
}

export function startCodebaseIndexing(): () => void {
  if (stopProjectSubscription) return stopProjectSubscription;
  scheduleProjectIndex(useProjectStore.getState().active);
  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    if (state.active?.id !== previous.active?.id) scheduleProjectIndex(state.active);
  });
  let disposed = false;
  stopProjectSubscription = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    stopProjectSubscription = null;
    stopCodebaseIndexing();
  };
  return stopProjectSubscription;
}

export function stopCodebaseIndexing(): void {
  generation += 1;
  queued = null;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  invalidateSearchCache();
  useCodebaseIndex.setState({ state: "idle", total: 0, done: 0 });
}

// ── Single-file reindex on save ───────────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleCodeFileReindex(absPath: string): void {
  const project = useProjectStore.getState().active;
  if (!project || !absPath.startsWith(project.root_path)) return;
  if (!CODE_EXT.has(extOf(absPath))) return;
  const prev = saveTimers.get(absPath);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    absPath,
    setTimeout(() => {
      saveTimers.delete(absPath);
      const runGeneration = generation;
      const endActivity = beginOrionActivity(
        `code-reindex:${absPath}`,
        "Wait for Orion's saved file to finish indexing before disabling the plugin.",
      );
      void (async () => {
        try {
          const rel = relPath(project.root_path, absPath);
          const known = await getCodeFileHash(project.id, rel);
          if (
            runGeneration === generation &&
            (await indexOneFile(project.id, project.root_path, absPath, known))
          ) {
            invalidateSearchCache();
          }
        } catch (e) {
          log.warn("code reindex on save failed", e);
        } finally {
          endActivity();
        }
      })();
    }, 1500),
  );
}

// ── Semantic search ───────────────────────────────────────────────────────

export async function searchCodebase(
  query: string,
  projectId: string,
  k = 4,
): Promise<CodeHit[]> {
  const qv = await embed(query);
  if (!qv) return [];
  if (!searchCache || searchCache.projectId !== projectId) {
    const rows = await listCodeChunks(projectId);
    searchCache = {
      projectId,
      rows: rows.map((r) => ({
        path: r.path,
        startLine: r.start_line,
        endLine: r.end_line,
        vector: deserializeVector(r.vector),
      })),
    };
  }
  return searchCache.rows
    .map((r) => ({
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      score: cosineSimilarity(qv, r.vector),
    }))
    .filter((h) => h.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
