import Database from "@tauri-apps/plugin-sql";
import { log } from "@/lib/log";

const DB_URL = "sqlite:orion.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then((db) => {
      log.info("db loaded:", DB_URL);
      return db;
    });
  }
  return dbPromise;
}

export type AppStateKey =
  | "last_project_id"
  | "tabs.open"
  | "tabs.active"
  | "workspace.layout"
  | "workspace.focusedPanel"
  | "panel_sizes"
  | "window_size"
  | "theme"
  | "right_rail_open"
  | "sidebar_open"
  | "terminal_open"
  | "terminal_height"
  | "today.weekRead"
  | "shell.windows"
  | "wallpaper"
  | "preview"
  | "xdesign.doc"
  | "xdesign.projects"
  | `xdesign.project.${string}`
  | "shell.focusedWindowId"
  | "rosie.ttsEnabled"
  | "voice.listenMode"
  | "mcp.servers"
  | "models"
  | "widget.monitor"
  | "reduce_glass"
  | "tab_autocomplete"
  | "repolens"
  | "learn_scratchpad"
  | "auth.user"
  | "auth.session"
  | "onboarding.completed";

export async function getAppState<T = unknown>(
  key: AppStateKey,
): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_state WHERE key = $1",
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setAppState<T = unknown>(
  key: AppStateKey,
  value: T,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

/** Delete a single app_state key. Used by the auth reset escape hatch to wipe
 * ONLY `auth.user` / `auth.session` — never any user-data table. Row delete,
 * not a schema change (append-only migration rule untouched). */
export async function deleteAppState(key: AppStateKey): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM app_state WHERE key = $1", [key]);
}

/** True if the vault already holds any user content. Drives the gate decision
 * for accountless installs: existing data + no `auth.user` ⇒ stay unlocked
 * (opt-in to sign-in via Settings), never force account creation. */
export async function hasAnyUserData(): Promise<boolean> {
  const db = await getDb();
  // Hardcoded table list — no user input interpolated.
  for (const table of ["notes", "assets", "chats", "projects", "mood_boards"]) {
    try {
      const rows = await db.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM ${table}`,
      );
      if ((rows[0]?.n ?? 0) > 0) return true;
    } catch {
      /* table may not exist on an ancient schema — ignore and keep checking */
    }
  }
  return false;
}

export type ActivitySource = "hermes" | "archives" | "orion" | "xdesign";

export type ActivityEntry = {
  id: string;
  ts: number;
  source: ActivitySource;
  kind: string;
  title: string;
  summary: string;
  ref_id: string;
};

/** Rapid repeats of the same (source, kind, ref_id) within this window bump the
 * existing row instead of piling up — keeps "edited note X" as one rolling
 * entry rather than one per debounced save. */
const ACTIVITY_COLLAPSE_MS = 10 * 60 * 1000;

/**
 * Append a lightweight activity entry. Fire-and-forget and self-swallowing:
 * activity logging must never break the action it's recording. Callers can
 * `void logActivity(...)` without a catch.
 */
export async function logActivity(e: {
  source: ActivitySource;
  kind: string;
  title?: string;
  summary?: string;
  refId?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    const title = (e.title ?? "").slice(0, 200);
    const summary = (e.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    const refId = e.refId ?? "";
    if (refId) {
      const recent = await db.select<{ id: string; ts: number }[]>(
        "SELECT id, ts FROM activity_log WHERE source = $1 AND kind = $2 AND ref_id = $3 ORDER BY ts DESC LIMIT 1",
        [e.source, e.kind, refId],
      );
      if (recent[0] && now - recent[0].ts < ACTIVITY_COLLAPSE_MS) {
        await db.execute(
          "UPDATE activity_log SET ts = $1, title = $2, summary = $3 WHERE id = $4",
          [now, title, summary, recent[0].id],
        );
        return;
      }
    }
    const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await db.execute(
      "INSERT INTO activity_log (id, ts, source, kind, title, summary, ref_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, now, e.source, e.kind, title, summary, refId],
    );
  } catch (err) {
    log.warn("logActivity failed", err);
  }
}

/** Most-recent activity across the terminal, newest first. */
export async function recentActivity(opts?: {
  limit?: number;
  source?: ActivitySource;
  sinceMs?: number;
}): Promise<ActivityEntry[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 200);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.source) {
    params.push(opts.source);
    where.push(`source = $${params.length}`);
  }
  if (opts?.sinceMs) {
    params.push(opts.sinceMs);
    where.push(`ts >= $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  return db.select<ActivityEntry[]>(
    `SELECT id, ts, source, kind, title, summary, ref_id FROM activity_log ${clause} ORDER BY ts DESC LIMIT $${params.length}`,
    params,
  );
}

// ── Per-project workspace layouts ─────────────────────────────

export type WorkspaceLayoutRow<TLayout = unknown> = {
  layout: TLayout;
  focusedPanelId: string | null;
};

type WorkspaceLayoutDbRow = {
  project_id: string;
  layout_json: string;
  focused_panel_id: string | null;
};

export async function getWorkspaceLayout<TLayout = unknown>(
  projectId: string,
): Promise<WorkspaceLayoutRow<TLayout> | null> {
  const db = await getDb();
  const rows = await db.select<WorkspaceLayoutDbRow[]>(
    "SELECT * FROM workspace_layouts WHERE project_id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      layout: JSON.parse(row.layout_json) as TLayout,
      focusedPanelId: row.focused_panel_id,
    };
  } catch {
    return null;
  }
}

export async function setWorkspaceLayout<TLayout = unknown>(
  projectId: string,
  layout: TLayout,
  focusedPanelId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO workspace_layouts (project_id, layout_json, focused_panel_id, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(project_id) DO UPDATE SET
       layout_json = excluded.layout_json,
       focused_panel_id = excluded.focused_panel_id,
       updated_at = excluded.updated_at`,
    [projectId, JSON.stringify(layout), focusedPanelId, Date.now()],
  );
}

export type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  last_opened_at: number;
};

export async function upsertProject(p: ProjectRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO projects (id, name, root_path, last_opened_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(root_path) DO UPDATE SET last_opened_at = excluded.last_opened_at`,
    [p.id, p.name, p.root_path, p.last_opened_at],
  );
}

export async function getProjectByPath(
  rootPath: string,
): Promise<ProjectRow | null> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT * FROM projects WHERE root_path = $1",
    [rootPath],
  );
  return rows[0] ?? null;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const db = await getDb();
  return db.select<ProjectRow[]>(
    "SELECT * FROM projects ORDER BY last_opened_at DESC",
  );
}

/** Remove a project from the recents list. Only forgets the entry — the
 * folder on disk is untouched. */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function getProjectById(id: string): Promise<ProjectRow | null> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT * FROM projects WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/** Which app the chat was authored in. Routes `openChatById` back to the
 * right surface. Legacy rows from before migration 0012 have origin=null,
 * which is treated as 'archives'. */
export type ChatOrigin = "archives" | "orion" | "xdesign" | "rosie";

export type ChatRow = {
  id: string;
  title: string;
  messages_json: string;
  searchable_text: string;
  session_id: string | null;
  project_id: string | null;
  total_cost_usd: number;
  origin: ChatOrigin | null;
  created_at: number;
  updated_at: number;
};

export async function upsertChat(c: ChatRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO chats (id, title, messages_json, searchable_text, session_id, project_id, total_cost_usd, origin, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       messages_json = excluded.messages_json,
       searchable_text = excluded.searchable_text,
       session_id = excluded.session_id,
       project_id = excluded.project_id,
       total_cost_usd = excluded.total_cost_usd,
       origin = excluded.origin,
       updated_at = excluded.updated_at`,
    [
      c.id,
      c.title,
      c.messages_json,
      c.searchable_text,
      c.session_id,
      c.project_id,
      c.total_cost_usd,
      c.origin,
      c.created_at,
      c.updated_at,
    ],
  );
}

export async function listChatsForProject(
  projectId: string | null,
): Promise<ChatRow[]> {
  const db = await getDb();
  if (projectId === null) {
    return db.select<ChatRow[]>(
      "SELECT * FROM chats WHERE project_id IS NULL ORDER BY updated_at DESC",
    );
  }
  return db.select<ChatRow[]>(
    "SELECT * FROM chats WHERE project_id = $1 ORDER BY updated_at DESC",
    [projectId],
  );
}

export async function listAllChats(limit = 50): Promise<ChatRow[]> {
  const db = await getDb();
  return db.select<ChatRow[]>(
    "SELECT * FROM chats ORDER BY updated_at DESC LIMIT $1",
    [limit],
  );
}

export async function renameChat(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chats SET title = $1 WHERE id = $2", [title, id]);
}

export async function deleteChat(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chats WHERE id = $1", [id]);
}

export async function countNotes(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM notes");
  return rows[0]?.n ?? 0;
}

export async function countAssets(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM assets");
  return rows[0]?.n ?? 0;
}

export type AssetKind = "image" | "video" | "audio" | "doc" | "other";

export type AssetRow = {
  id: string;
  kind: AssetKind;
  title: string | null;
  file_path: string | null;
  url: string | null;
  metadata_json: string | null;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  created_at: number;
  favorite: number;
};

export async function setAssetFavorite(
  id: string,
  favorite: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE assets SET favorite = $1 WHERE id = $2", [
    favorite ? 1 : 0,
    id,
  ]);
}

export async function listAssets(limit = 500): Promise<AssetRow[]> {
  const db = await getDb();
  return db.select<AssetRow[]>(
    "SELECT * FROM assets ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
}

export async function insertAsset(
  a: Omit<AssetRow, "favorite">,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO assets (
       id, kind, title, file_path, url, metadata_json,
       mime_type, size_bytes, original_name, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      a.id,
      a.kind,
      a.title,
      a.file_path,
      a.url,
      a.metadata_json,
      a.mime_type,
      a.size_bytes,
      a.original_name,
      a.created_at,
    ],
  );
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM assets WHERE id = $1", [id]);
}

// ── Tags ─────────────────────────────────────────────────────

/**
 * Upsert tags by name, returning the rows. Tag names are case-insensitive on
 * lookup (we lowercase before matching) but the original casing is preserved
 * on insert.
 */
export async function upsertTagsByName(
  names: string[],
): Promise<Array<{ id: string; name: string }>> {
  const db = await getDb();
  const out: Array<{ id: string; name: string }> = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const existing = await db.select<Array<{ id: string; name: string }>>(
      "SELECT id, name FROM tags WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [name],
    );
    if (existing[0]) {
      out.push(existing[0]);
      continue;
    }
    // ulid-ish: ms timestamp + small random; collisions are not a concern.
    const id = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await db.execute("INSERT INTO tags (id, name) VALUES ($1, $2)", [id, name]);
    out.push({ id, name });
  }
  return out;
}

export async function attachAssetTags(
  assetId: string,
  tagIds: string[],
): Promise<void> {
  const db = await getDb();
  for (const tagId of tagIds) {
    await db.execute(
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES ($1, $2)
       ON CONFLICT(asset_id, tag_id) DO NOTHING`,
      [assetId, tagId],
    );
  }
}

export async function listAssetTags(assetId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<Array<{ name: string }>>(
    `SELECT t.name FROM tags t
     JOIN asset_tags at ON at.tag_id = t.id
     WHERE at.asset_id = $1
     ORDER BY t.name`,
    [assetId],
  );
  return rows.map((r) => r.name);
}

// ── Mood boards ──────────────────────────────────────────────

export type MoodBoardRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  created_at: number;
  updated_at: number;
  favorite: number;
};

export async function setMoodBoardFavorite(
  id: string,
  favorite: boolean,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE mood_boards SET favorite = $1, updated_at = $2 WHERE id = $3",
    [favorite ? 1 : 0, updatedAt, id],
  );
}

export type MoodBoardMemberRow = {
  board_id: string;
  asset_id: string;
  position: number;
  added_at: number;
};

export async function listMoodBoards(): Promise<MoodBoardRow[]> {
  const db = await getDb();
  return db.select<MoodBoardRow[]>(
    "SELECT * FROM mood_boards ORDER BY updated_at DESC",
  );
}

export async function insertMoodBoard(
  b: Omit<MoodBoardRow, "favorite">,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO mood_boards (id, title, cover_asset_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [b.id, b.title, b.cover_asset_id, b.created_at, b.updated_at],
  );
}

export async function renameMoodBoard(
  id: string,
  title: string,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE mood_boards SET title = $1, updated_at = $2 WHERE id = $3",
    [title, updatedAt, id],
  );
}

export async function setMoodBoardCover(
  id: string,
  coverAssetId: string | null,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE mood_boards SET cover_asset_id = $1, updated_at = $2 WHERE id = $3",
    [coverAssetId, updatedAt, id],
  );
}

export async function deleteMoodBoard(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM mood_boards WHERE id = $1", [id]);
}

export async function listAllMoodBoardMembers(): Promise<MoodBoardMemberRow[]> {
  const db = await getDb();
  return db.select<MoodBoardMemberRow[]>(
    "SELECT * FROM mood_board_assets ORDER BY board_id, position",
  );
}

export async function addAssetToMoodBoard(
  boardId: string,
  assetId: string,
): Promise<void> {
  const db = await getDb();
  // Position = current max + 1 within this board (new members go to the end).
  const rows = await db.select<Array<{ next: number }>>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next
     FROM mood_board_assets WHERE board_id = $1`,
    [boardId],
  );
  const position = rows[0]?.next ?? 0;
  const now = Date.now();
  await db.execute(
    `INSERT INTO mood_board_assets (board_id, asset_id, position, added_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(board_id, asset_id) DO NOTHING`,
    [boardId, assetId, position, now],
  );
  await db.execute(
    "UPDATE mood_boards SET updated_at = $1 WHERE id = $2",
    [now, boardId],
  );
}

export async function removeAssetFromMoodBoard(
  boardId: string,
  assetId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM mood_board_assets WHERE board_id = $1 AND asset_id = $2",
    [boardId, assetId],
  );
  await db.execute(
    "UPDATE mood_boards SET updated_at = $1 WHERE id = $2",
    [Date.now(), boardId],
  );
}

/**
 * Rewrite the position column for every member of a board to match the given
 * ordered list. Runs as a single transaction so a partial reorder never
 * leaves the table inconsistent.
 */
export async function reorderMoodBoardAssets(
  boardId: string,
  orderedAssetIds: string[],
): Promise<void> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    for (let i = 0; i < orderedAssetIds.length; i++) {
      await db.execute(
        "UPDATE mood_board_assets SET position = $1 WHERE board_id = $2 AND asset_id = $3",
        [i, boardId, orderedAssetIds[i]],
      );
    }
    await db.execute(
      "UPDATE mood_boards SET updated_at = $1 WHERE id = $2",
      [Date.now(), boardId],
    );
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

/** Bulk variant: returns a map of assetId → tag names. */
export async function listAllAssetTags(): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db.select<Array<{ asset_id: string; name: string }>>(
    `SELECT at.asset_id, t.name FROM tags t
     JOIN asset_tags at ON at.tag_id = t.id
     ORDER BY t.name`,
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.asset_id) ?? [];
    arr.push(r.name);
    map.set(r.asset_id, arr);
  }
  return map;
}

export async function listAllNoteTags(): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db.select<Array<{ note_id: string; name: string }>>(
    `SELECT nt.note_id, t.name FROM tags t
     JOIN note_tags nt ON nt.tag_id = t.id
     ORDER BY t.name`,
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.note_id) ?? [];
    arr.push(r.name);
    map.set(r.note_id, arr);
  }
  return map;
}

export async function attachNoteTags(
  noteId: string,
  tagIds: string[],
): Promise<void> {
  const db = await getDb();
  for (const tagId of tagIds) {
    await db.execute(
      `INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2)
       ON CONFLICT(note_id, tag_id) DO NOTHING`,
      [noteId, tagId],
    );
  }
}

export async function detachNoteTagByName(
  noteId: string,
  tagName: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM note_tags
     WHERE note_id = $1 AND tag_id IN (
       SELECT id FROM tags WHERE LOWER(name) = LOWER($2)
     )`,
    [noteId, tagName],
  );
}

export async function getChatById(id: string): Promise<ChatRow | null> {
  const db = await getDb();
  const rows = await db.select<ChatRow[]>(
    "SELECT * FROM chats WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export type NoteKind = "note" | "journal" | "project";

// ── FTS5 search across notes / chats / assets ────────────────

export type SearchEntityType = "note" | "chat" | "asset";

export type SearchHit = {
  entityId: string;
  entityType: SearchEntityType;
  title: string;
  snippet: string;
  /** For notes: the underlying kind (note | journal | project) so the result
   * can be routed to the right view. Null for chat/asset. */
  noteKind?: NoteKind | null;
};

type SearchRow = {
  entity_id: string;
  entity_type: SearchEntityType;
  title: string;
  snip: string;
  note_kind: NoteKind | null;
};

/**
 * Run an FTS5 query against `search_index` and return ranked hits. Cleans the
 * input (drops FTS5 syntax chars) and appends `*` to each term so partial
 * typing matches prefixes. Joins back to `notes` to pull each note's `kind`
 * so the caller can route to the right Archives view.
 */
export async function searchArchive(
  query: string,
  limit = 20,
): Promise<SearchHit[]> {
  const cleaned = query.replace(/["*()]/g, " ").trim();
  if (!cleaned) return [];
  const ftsQuery = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t + "*")
    .join(" ");
  const db = await getDb();
  const rows = await db.select<SearchRow[]>(
    `SELECT s.entity_id  AS entity_id,
            s.entity_type AS entity_type,
            s.title       AS title,
            snippet(search_index, 3, '〔', '〕', '…', 16) AS snip,
            n.kind        AS note_kind
       FROM search_index s
       LEFT JOIN notes n
         ON n.id = s.entity_id AND s.entity_type = 'note'
      WHERE search_index MATCH $1
      ORDER BY rank
      LIMIT $2`,
    [ftsQuery, limit],
  );
  return rows.map((r) => ({
    entityId: r.entity_id,
    entityType: r.entity_type,
    title: r.title || "Untitled",
    snippet: r.snip || "",
    noteKind: r.note_kind ?? null,
  }));
}

// ── Embeddings (semantic search) ─────────────────────────────

export type EmbeddingKind = "note" | "chat" | "asset";

export type StoredEmbedding = {
  kind: EmbeddingKind;
  id: string;
  vector: Uint8Array;
  textHash: string;
};

type EmbeddingRow = {
  entity_kind: EmbeddingKind;
  entity_id: string;
  vector: number[] | Uint8Array;
  text_hash: string;
};

type EmbeddingHashRow = {
  entity_kind: EmbeddingKind;
  entity_id: string;
  text_hash: string;
};

/** Map of "kind:id" → text_hash, used by the indexer to decide whether to
 * re-embed an entity (skipped if its current text hash matches the stored
 * one). One bulk read at boot is cheap and avoids per-entity lookups. */
export async function listEmbeddingHashes(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select<EmbeddingHashRow[]>(
    "SELECT entity_kind, entity_id, text_hash FROM embeddings",
  );
  const out = new Map<string, string>();
  for (const r of rows) out.set(`${r.entity_kind}:${r.entity_id}`, r.text_hash);
  return out;
}

/** All embedding rows. The vector column comes back as either a Uint8Array
 * or a number[] depending on tauri-plugin-sql's BLOB handling — callers run
 * it through `deserializeVector` to get a Float32Array. */
export async function listEmbeddings(): Promise<StoredEmbedding[]> {
  const db = await getDb();
  const rows = await db.select<EmbeddingRow[]>(
    "SELECT entity_kind, entity_id, vector, text_hash FROM embeddings",
  );
  return rows.map((r) => ({
    kind: r.entity_kind,
    id: r.entity_id,
    vector: r.vector instanceof Uint8Array ? r.vector : new Uint8Array(r.vector),
    textHash: r.text_hash,
  }));
}

export async function upsertEmbedding(
  kind: EmbeddingKind,
  id: string,
  vectorBytes: Uint8Array,
  textHash: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO embeddings(entity_kind, entity_id, vector, text_hash, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
       vector = excluded.vector,
       text_hash = excluded.text_hash,
       updated_at = excluded.updated_at`,
    [kind, id, Array.from(vectorBytes), textHash, Date.now()],
  );
}

export async function deleteEmbedding(
  kind: EmbeddingKind,
  id: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM embeddings WHERE entity_kind = $1 AND entity_id = $2",
    [kind, id],
  );
}

// ── Codebase semantic index (code_embeddings, migration 0018) ─────────────

export type CodeChunkRow = {
  path: string;
  chunk_idx: number;
  start_line: number;
  end_line: number;
  hash: string;
  vector: Uint8Array | number[];
};

export async function getCodeFileHash(
  projectId: string,
  path: string,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ hash: string }>>(
    "SELECT hash FROM code_embeddings WHERE project_id = $1 AND path = $2 LIMIT 1",
    [projectId, path],
  );
  return rows[0]?.hash ?? null;
}

/** path → whole-file hash (any chunk row carries it). */
export async function listCodeFileHashes(
  projectId: string,
): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select<Array<{ path: string; hash: string }>>(
    "SELECT DISTINCT path, hash FROM code_embeddings WHERE project_id = $1",
    [projectId],
  );
  return new Map(rows.map((r) => [r.path, r.hash]));
}

export async function listCodeChunks(
  projectId: string,
): Promise<CodeChunkRow[]> {
  const db = await getDb();
  return db.select<CodeChunkRow[]>(
    `SELECT path, chunk_idx, start_line, end_line, hash, vector
     FROM code_embeddings WHERE project_id = $1`,
    [projectId],
  );
}

/** Replace every chunk row for a file in one pass (delete + insert). */
export async function replaceCodeChunks(
  projectId: string,
  path: string,
  hash: string,
  chunks: Array<{
    idx: number;
    startLine: number;
    endLine: number;
    vector: Uint8Array;
  }>,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM code_embeddings WHERE project_id = $1 AND path = $2",
    [projectId, path],
  );
  const now = Date.now();
  for (const c of chunks) {
    await db.execute(
      `INSERT INTO code_embeddings(project_id, path, chunk_idx, start_line, end_line, hash, vector, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [projectId, path, c.idx, c.startLine, c.endLine, hash, Array.from(c.vector), now],
    );
  }
}

export async function deleteCodeFile(
  projectId: string,
  path: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM code_embeddings WHERE project_id = $1 AND path = $2",
    [projectId, path],
  );
}

// ── Agent-edit checkpoints (migration 0019) ───────────────────────────────

export type CheckpointRow = {
  id: string;
  project_id: string;
  label: string;
  created_at: number;
  file_count: number;
};

export async function insertCheckpoint(
  id: string,
  projectId: string,
  label: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO checkpoints(id, project_id, label, created_at) VALUES ($1, $2, $3, $4)",
    [id, projectId, label, Date.now()],
  );
}

export async function setCheckpointLabel(id: string, label: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE checkpoints SET label = $1 WHERE id = $2", [label, id]);
}

export async function addCheckpointFile(
  checkpointId: string,
  path: string,
  content: string,
  existed: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO checkpoint_files(checkpoint_id, path, content, existed)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(checkpoint_id, path) DO NOTHING`,
    [checkpointId, path, content, existed ? 1 : 0],
  );
}

export async function listCheckpoints(
  projectId: string,
  limit = 20,
): Promise<CheckpointRow[]> {
  const db = await getDb();
  return db.select<CheckpointRow[]>(
    `SELECT c.id, c.project_id, c.label, c.created_at,
            (SELECT COUNT(*) FROM checkpoint_files f WHERE f.checkpoint_id = c.id) AS file_count
     FROM checkpoints c WHERE c.project_id = $1
     ORDER BY c.created_at DESC LIMIT $2`,
    [projectId, limit],
  );
}

export async function getCheckpointFiles(
  checkpointId: string,
): Promise<Array<{ path: string; content: string; existed: number }>> {
  const db = await getDb();
  return db.select(
    "SELECT path, content, existed FROM checkpoint_files WHERE checkpoint_id = $1",
    [checkpointId],
  );
}

export async function deleteCheckpoint(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM checkpoint_files WHERE checkpoint_id = $1", [id]);
  await db.execute("DELETE FROM checkpoints WHERE id = $1", [id]);
}

/** Keep the newest `keep` checkpoints for a project; drop the rest. */
export async function pruneCheckpoints(projectId: string, keep = 20): Promise<void> {
  const db = await getDb();
  const old = await db.select<Array<{ id: string }>>(
    `SELECT id FROM checkpoints WHERE project_id = $1
     ORDER BY created_at DESC LIMIT -1 OFFSET $2`,
    [projectId, keep],
  );
  for (const row of old) await deleteCheckpoint(row.id);
}

export type NoteRow = {
  id: string;
  title: string;
  blocks_json: string;
  plaintext: string;
  parent_id: string | null;
  kind: NoteKind;
  location: string;
  collection_id: string | null;
  created_at: number;
  updated_at: number;
  favorite: number;
};

export async function setNoteFavorite(
  id: string,
  favorite: boolean,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET favorite = $1, updated_at = $2 WHERE id = $3",
    [favorite ? 1 : 0, updatedAt, id],
  );
}

export type CollectionRow = {
  id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
};

export async function listCollections(): Promise<CollectionRow[]> {
  const db = await getDb();
  return db.select<CollectionRow[]>(
    "SELECT * FROM collections ORDER BY updated_at DESC",
  );
}

export async function insertCollection(c: CollectionRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO collections (id, name, color, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [c.id, c.name, c.color, c.created_at, c.updated_at],
  );
}

export async function renameCollection(
  id: string,
  name: string,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE collections SET name = $1, updated_at = $2 WHERE id = $3",
    [name, updatedAt, id],
  );
}

export async function setCollectionColor(
  id: string,
  color: string,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE collections SET color = $1, updated_at = $2 WHERE id = $3",
    [color, updatedAt, id],
  );
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM collections WHERE id = $1", [id]);
}

export async function setNoteCollection(
  noteId: string,
  collectionId: string | null,
  updatedAt: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET collection_id = $1, updated_at = $2 WHERE id = $3",
    [collectionId, updatedAt, noteId],
  );
}

/**
 * Tag-name → count for tags that are attached to assets and/or notes.
 * Used by the sidebar tag cloud to surface top tags from real data.
 */
export async function listTagsWithCounts(
  limit = 20,
): Promise<Array<{ name: string; count: number }>> {
  const db = await getDb();
  const rows = await db.select<Array<{ name: string; count: number }>>(
    `SELECT t.name AS name,
            (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) +
            (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS count
       FROM tags t
       ORDER BY count DESC
       LIMIT $1`,
    [limit],
  );
  return rows.filter((r) => r.count > 0);
}

// ─────────────────────────────────────────────────────────────
// Hermes — Kanban tasks + parallel-swarm agents (migration 0015)
// ─────────────────────────────────────────────────────────────

export type HermesTaskRow = {
  id: string;
  title: string;
  prompt: string;
  column_id: string;
  position: number;
  status: string;
  parent_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  dispatched_at: number | null;
};

export type HermesAgentRow = {
  id: string;
  task_id: string;
  label: string;
  prompt: string;
  status: string;
  output: string;
  error: string;
  session_id: string | null;
  position: number;
  model: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export async function listHermesTasks(): Promise<HermesTaskRow[]> {
  const db = await getDb();
  return db.select<HermesTaskRow[]>(
    "SELECT * FROM hermes_tasks ORDER BY column_id, position, created_at",
  );
}

export async function listHermesAgents(): Promise<HermesAgentRow[]> {
  const db = await getDb();
  return db.select<HermesAgentRow[]>(
    "SELECT * FROM hermes_agents ORDER BY task_id, position, created_at",
  );
}

export async function insertHermesTask(t: HermesTaskRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO hermes_tasks
       (id, title, prompt, column_id, position, status, parent_id, created_by, created_at, updated_at, dispatched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      t.id,
      t.title,
      t.prompt,
      t.column_id,
      t.position,
      t.status,
      t.parent_id,
      t.created_by,
      t.created_at,
      t.updated_at,
      t.dispatched_at,
    ],
  );
}

export async function updateHermesTask(
  id: string,
  patch: {
    title?: string;
    prompt?: string;
    column_id?: string;
    position?: number;
    status?: string;
    dispatched_at?: number | null;
    updated_at: number;
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.title !== undefined) { sets.push(`title = $${i++}`); vals.push(patch.title); }
  if (patch.prompt !== undefined) { sets.push(`prompt = $${i++}`); vals.push(patch.prompt); }
  if (patch.column_id !== undefined) { sets.push(`column_id = $${i++}`); vals.push(patch.column_id); }
  if (patch.position !== undefined) { sets.push(`position = $${i++}`); vals.push(patch.position); }
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); vals.push(patch.status); }
  if (patch.dispatched_at !== undefined) { sets.push(`dispatched_at = $${i++}`); vals.push(patch.dispatched_at); }
  sets.push(`updated_at = $${i++}`);
  vals.push(patch.updated_at);
  vals.push(id);
  await db.execute(`UPDATE hermes_tasks SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

export async function deleteHermesTask(id: string): Promise<void> {
  const db = await getDb();
  // No FK cascade (rusqlite writers don't enable foreign_keys); cascade here.
  await db.execute("DELETE FROM hermes_agents WHERE task_id = $1", [id]);
  await db.execute("DELETE FROM hermes_tasks WHERE id = $1", [id]);
}

export async function insertHermesAgent(a: HermesAgentRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO hermes_agents
       (id, task_id, label, prompt, status, output, error, session_id, position, model, created_at, updated_at, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      a.id,
      a.task_id,
      a.label,
      a.prompt,
      a.status,
      a.output,
      a.error,
      a.session_id,
      a.position,
      a.model,
      a.created_at,
      a.updated_at,
      a.started_at,
      a.finished_at,
    ],
  );
}

export async function updateHermesAgent(
  id: string,
  patch: {
    label?: string;
    prompt?: string;
    status?: string;
    output?: string;
    error?: string;
    session_id?: string | null;
    model?: string;
    started_at?: number | null;
    finished_at?: number | null;
    updated_at: number;
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.label !== undefined) { sets.push(`label = $${i++}`); vals.push(patch.label); }
  if (patch.prompt !== undefined) { sets.push(`prompt = $${i++}`); vals.push(patch.prompt); }
  if (patch.model !== undefined) { sets.push(`model = $${i++}`); vals.push(patch.model); }
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); vals.push(patch.status); }
  if (patch.output !== undefined) { sets.push(`output = $${i++}`); vals.push(patch.output); }
  if (patch.error !== undefined) { sets.push(`error = $${i++}`); vals.push(patch.error); }
  if (patch.session_id !== undefined) { sets.push(`session_id = $${i++}`); vals.push(patch.session_id); }
  if (patch.started_at !== undefined) { sets.push(`started_at = $${i++}`); vals.push(patch.started_at); }
  if (patch.finished_at !== undefined) { sets.push(`finished_at = $${i++}`); vals.push(patch.finished_at); }
  sets.push(`updated_at = $${i++}`);
  vals.push(patch.updated_at);
  vals.push(id);
  await db.execute(`UPDATE hermes_agents SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

export async function deleteHermesAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM hermes_agents WHERE id = $1", [id]);
}

export async function listNotes(): Promise<NoteRow[]> {
  const db = await getDb();
  return db.select<NoteRow[]>(
    "SELECT * FROM notes ORDER BY updated_at DESC",
  );
}

export async function getNoteById(id: string): Promise<NoteRow | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function insertNote(
  n: Omit<NoteRow, "favorite">,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO notes (id, title, blocks_json, plaintext, parent_id, kind, location, collection_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      n.id,
      n.title,
      n.blocks_json,
      n.plaintext,
      n.parent_id,
      n.kind,
      n.location,
      n.collection_id,
      n.created_at,
      n.updated_at,
    ],
  );
}

export async function updateNote(
  id: string,
  patch: {
    title?: string;
    blocks_json?: string;
    plaintext?: string;
    parent_id?: string | null;
    location?: string;
    updated_at: number;
  },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.title !== undefined) {
    sets.push(`title = $${i++}`);
    vals.push(patch.title);
  }
  if (patch.blocks_json !== undefined) {
    sets.push(`blocks_json = $${i++}`);
    vals.push(patch.blocks_json);
  }
  if (patch.plaintext !== undefined) {
    sets.push(`plaintext = $${i++}`);
    vals.push(patch.plaintext);
  }
  if (patch.parent_id !== undefined) {
    sets.push(`parent_id = $${i++}`);
    vals.push(patch.parent_id);
  }
  if (patch.location !== undefined) {
    sets.push(`location = $${i++}`);
    vals.push(patch.location);
  }
  sets.push(`updated_at = $${i++}`);
  vals.push(patch.updated_at);
  vals.push(id);
  await db.execute(
    `UPDATE notes SET ${sets.join(", ")} WHERE id = $${i}`,
    vals,
  );
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

// Removes empty placeholder notes left over from "Mod+N then closed without
// typing." Safe at app start: a note with no title, no plaintext, and no
// children is effectively non-existent to the user.
export async function purgeEmptyNotes(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `DELETE FROM notes
     WHERE COALESCE(title, '') = ''
       AND COALESCE(plaintext, '') = ''
       AND id NOT IN (
         SELECT parent_id FROM notes WHERE parent_id IS NOT NULL
       )`,
  );
  return result.rowsAffected ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Command Center — profiles, channels, messages, missions (migration 0027)
// ─────────────────────────────────────────────────────────────

export type CCProfileRow = {
  id: string;
  name: string;
  rank: string;
  division: string;
  accent: string;
  brain_model: string;
  skill_ids_json: string;
  wiki_root: string;
  charter: string;
  autonomy_level: number;
  position: number;
  created_at: number;
  updated_at: number;
  avatar_path: string;
};

export type CCChannelRow = {
  id: string;
  kind: string;
  division: string;
  name: string;
  position: number;
  created_at: number;
};

export type CCMessageRow = {
  id: string;
  channel_id: string;
  from_profile_id: string;
  to_profile_id: string | null;
  kind: string;
  body: string;
  mission_ref: string;
  ts: number;
};

export type CCMissionRow = {
  id: string;
  title: string;
  brief: string;
  status: string;
  autonomy_level: number;
  assigned_profile_id: string | null;
  origin_profile_id: string | null;
  ts: number;
  updated_at: number;
};

export async function listCCProfiles(): Promise<CCProfileRow[]> {
  const db = await getDb();
  return db.select<CCProfileRow[]>(
    "SELECT * FROM cc_profiles ORDER BY rank, position, name",
  );
}

export async function insertCCProfile(p: CCProfileRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO cc_profiles
       (id, name, rank, division, accent, brain_model, skill_ids_json, wiki_root, charter, autonomy_level, position, created_at, updated_at, avatar_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [p.id, p.name, p.rank, p.division, p.accent, p.brain_model, p.skill_ids_json, p.wiki_root, p.charter, p.autonomy_level, p.position, p.created_at, p.updated_at, p.avatar_path ?? ""],
  );
}

export async function updateCCProfile(
  id: string,
  patch: Partial<Omit<CCProfileRow, "id" | "created_at">> & { updated_at: number },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(id);
  await db.execute(`UPDATE cc_profiles SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

export async function deleteCCProfile(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM cc_profiles WHERE id = $1", [id]);
}

export async function listCCChannels(): Promise<CCChannelRow[]> {
  const db = await getDb();
  return db.select<CCChannelRow[]>(
    "SELECT * FROM cc_channels ORDER BY position, created_at",
  );
}

export async function insertCCChannel(c: CCChannelRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO cc_channels (id, kind, division, name, position, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.id, c.kind, c.division, c.name, c.position, c.created_at],
  );
}

export async function deleteCCChannel(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM cc_channels WHERE id = $1", [id]);
}

export async function listCCMessages(channelId?: string): Promise<CCMessageRow[]> {
  const db = await getDb();
  if (channelId) {
    return db.select<CCMessageRow[]>(
      "SELECT * FROM cc_messages WHERE channel_id = $1 ORDER BY ts",
      [channelId],
    );
  }
  return db.select<CCMessageRow[]>("SELECT * FROM cc_messages ORDER BY ts");
}

export async function insertCCMessage(m: CCMessageRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO cc_messages (id, channel_id, from_profile_id, to_profile_id, kind, body, mission_ref, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [m.id, m.channel_id, m.from_profile_id, m.to_profile_id, m.kind, m.body, m.mission_ref, m.ts],
  );
}

export async function listCCMissions(): Promise<CCMissionRow[]> {
  const db = await getDb();
  return db.select<CCMissionRow[]>(
    "SELECT * FROM cc_missions ORDER BY updated_at DESC",
  );
}

export async function insertCCMission(m: CCMissionRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO cc_missions (id, title, brief, status, autonomy_level, assigned_profile_id, origin_profile_id, ts, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [m.id, m.title, m.brief, m.status, m.autonomy_level, m.assigned_profile_id, m.origin_profile_id, m.ts, m.updated_at],
  );
}

export async function updateCCMission(
  id: string,
  patch: Partial<Omit<CCMissionRow, "id" | "ts">> & { updated_at: number },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(id);
  await db.execute(`UPDATE cc_missions SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}
