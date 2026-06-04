import Foundation
import GRDB
import ArchivesCore

/// GRDB-backed persistence for Archives.
///
/// Two roles:
///  - the phone's own database (`createSchema: true`) — full read/write.
///  - the desktop's existing `orion.db` (`createSchema: false`, opened read-only
///    for now) — the helper reads the Archives tables out of it without touching
///    the Tauri app's schema or migrations.
///
/// Snapshots and apply() convert between the DB and `SyncPayload`, the unit the
/// `MergeEngine` operates on.
public final class ArchivesStore {
    public let dbQueue: DatabaseQueue

    public init(path: String, createSchema: Bool, readOnly: Bool = false) throws {
        var config = Configuration()
        // Tolerate the desktop app briefly holding the DB (WAL: readers never block;
        // a write waits up to 5s for any in-flight writer).
        config.busyMode = .timeout(5)
        config.readonly = readOnly
        dbQueue = try DatabaseQueue(path: path, configuration: config)
        if createSchema { try Self.migrator.migrate(dbQueue) }
    }

    // MARK: - Schema (phone's own DB). Mirrors the desktop Archives columns so a
    // snapshot read from orion.db applies here without translation.
    private static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("archives-v1") { db in
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
                    blocks_json TEXT NOT NULL DEFAULT '[]', plaintext TEXT NOT NULL DEFAULT '',
                    parent_id TEXT, kind TEXT NOT NULL DEFAULT 'note',
                    location TEXT NOT NULL DEFAULT '', collection_id TEXT,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
                    file_name TEXT, url TEXT, metadata_json TEXT,
                    mime_type TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL DEFAULT 0,
                    original_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);

                CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);

                CREATE TABLE IF NOT EXISTS note_tags (
                    note_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (note_id, tag_id));
                CREATE TABLE IF NOT EXISTS asset_tags (
                    asset_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (asset_id, tag_id));

                CREATE TABLE IF NOT EXISTS collections (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

                CREATE TABLE IF NOT EXISTS mood_boards (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, cover_asset_id TEXT,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS mood_board_assets (
                    board_id TEXT NOT NULL, asset_id TEXT NOT NULL,
                    position INTEGER NOT NULL, added_at INTEGER NOT NULL,
                    PRIMARY KEY (board_id, asset_id));

                CREATE TABLE IF NOT EXISTS tombstones (
                    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
                    deleted_at INTEGER NOT NULL, PRIMARY KEY (entity_type, entity_id));
                """)
        }
        return m
    }

    // MARK: - Read → SyncPayload

    public func snapshot(deviceID: String, generatedAt: Millis) throws -> SyncPayload {
        try dbQueue.read { db in
            SyncPayload(
                deviceID: deviceID, generatedAt: generatedAt,
                notes: try Self.notes(db),
                assets: try Self.assets(db),
                tags: try Self.tags(db),
                collections: try Self.collections(db),
                moodBoards: try Self.moodBoards(db),
                assetTags: try Self.assetTags(db),
                noteTags: try Self.noteTags(db),
                moodBoardAssets: try Self.moodBoardAssets(db),
                tombstones: try Self.tombstones(db)
            )
        }
    }

    /// Notes for the list UI, newest first. Optionally filtered to a kind.
    public func displayNotes(kind: NoteKind? = nil) throws -> [Note] {
        try dbQueue.read { db in
            let rows: [Row]
            if let kind {
                rows = try Row.fetchAll(db, sql: "SELECT * FROM notes WHERE kind = ? ORDER BY updated_at DESC", arguments: [kind.rawValue])
            } else {
                rows = try Row.fetchAll(db, sql: "SELECT * FROM notes ORDER BY updated_at DESC")
            }
            return rows.map(Self.note)
        }
    }

    // MARK: - Apply a merged snapshot (phone DB). Wholesale replace: `merged` is
    // already the converged state, so this also drops anything tombstoned away.
    public func apply(_ merged: SyncPayload) throws {
        try dbQueue.write { db in
            for table in ["notes", "assets", "tags", "note_tags", "asset_tags",
                          "collections", "mood_boards", "mood_board_assets", "tombstones"] {
                try db.execute(sql: "DELETE FROM \(table)")
            }
            for n in merged.notes {
                try db.execute(sql: """
                    INSERT INTO notes (id,title,blocks_json,plaintext,parent_id,kind,location,collection_id,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """, arguments: [n.id, n.title, n.blocksJSON, n.plaintext, n.parentID, n.kind.rawValue, n.location, n.collectionID, n.createdAt, n.updatedAt])
            }
            for a in merged.assets {
                try db.execute(sql: """
                    INSERT INTO assets (id,kind,title,file_name,url,metadata_json,mime_type,size_bytes,original_name,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """, arguments: [a.id, a.kind.rawValue, a.title, a.fileName, a.url, a.metadataJSON, a.mimeType, a.sizeBytes, a.originalName, a.createdAt])
            }
            for t in merged.tags {
                try db.execute(sql: "INSERT INTO tags (id,name) VALUES (?,?)", arguments: [t.id, t.name])
            }
            for c in merged.collections {
                try db.execute(sql: "INSERT INTO collections (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)",
                               arguments: [c.id, c.name, c.color, c.createdAt, c.updatedAt])
            }
            for b in merged.moodBoards {
                try db.execute(sql: "INSERT INTO mood_boards (id,title,cover_asset_id,created_at,updated_at) VALUES (?,?,?,?,?)",
                               arguments: [b.id, b.title, b.coverAssetID, b.createdAt, b.updatedAt])
            }
            for r in merged.noteTags {
                try db.execute(sql: "INSERT INTO note_tags (note_id,tag_id) VALUES (?,?)", arguments: [r.noteID, r.tagID])
            }
            for r in merged.assetTags {
                try db.execute(sql: "INSERT INTO asset_tags (asset_id,tag_id) VALUES (?,?)", arguments: [r.assetID, r.tagID])
            }
            for r in merged.moodBoardAssets {
                try db.execute(sql: "INSERT INTO mood_board_assets (board_id,asset_id,position,added_at) VALUES (?,?,?,?)",
                               arguments: [r.boardID, r.assetID, r.position, r.addedAt])
            }
            for t in merged.tombstones {
                try db.execute(sql: "INSERT INTO tombstones (entity_type,entity_id,deleted_at) VALUES (?,?,?)",
                               arguments: [t.entityType.rawValue, t.entityID, t.deletedAt])
            }
        }
    }

    // MARK: - Editing (phone DB)

    public func updateNoteBody(id: String, blocksJSON: String, plaintext: String, updatedAt: Millis) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE notes SET blocks_json = ?, plaintext = ?, updated_at = ? WHERE id = ?",
                           arguments: [blocksJSON, plaintext, updatedAt, id])
        }
    }

    public func updateNoteTitle(id: String, title: String, updatedAt: Millis) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE notes SET title = ?, updated_at = ? WHERE id = ?",
                           arguments: [title, updatedAt, id])
        }
    }

    public func createNote(id: String, kind: NoteKind, parentID: String? = nil, now: Millis) throws -> Note {
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT INTO notes (id,title,blocks_json,plaintext,parent_id,kind,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?)
                """, arguments: [id, "", "[]", "", parentID, kind.rawValue, now, now])
        }
        return Note(id: id, title: "", blocksJSON: "[]", plaintext: "", parentID: parentID, kind: kind, createdAt: now, updatedAt: now)
    }

    /// Delete notes + record tombstones so the deletion propagates on the next
    /// sync (cascade for project subpages is computed by the caller).
    public func deleteNotes(ids: [String], deletedAt: Millis) throws {
        try dbQueue.write { db in
            for id in ids {
                try db.execute(sql: "DELETE FROM notes WHERE id = ?", arguments: [id])
                try db.execute(sql: "DELETE FROM note_tags WHERE note_id = ?", arguments: [id])
                try db.execute(sql: "INSERT OR REPLACE INTO tombstones (entity_type,entity_id,deleted_at) VALUES ('note',?,?)",
                               arguments: [id, deletedAt])
            }
        }
    }

    /// Integrate a peer's notes into THIS database — used for write-back into
    /// the live desktop `orion.db`. Deliberately NOT a wholesale replace: it does
    /// conditional last-write-wins upserts (only rows the peer has newer/new) plus
    /// tombstone deletes, inside one deferred-FK transaction. So a bad/dangling
    /// row fails the commit and rolls back rather than corrupting real data, and
    /// orion.db's FTS triggers keep `search_index` consistent automatically.
    /// Scoped to `notes` (the only thing the phone can edit today).
    public func applyIncomingNotes(_ remote: SyncPayload) throws -> (upserted: Int, deleted: Int) {
        var upserted = 0
        var deleted = 0
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            for n in remote.notes {
                if let existing = try Int64.fetchOne(db, sql: "SELECT updated_at FROM notes WHERE id = ?", arguments: [n.id]),
                   existing >= n.updatedAt {
                    continue   // ours is newer or identical
                }
                try db.execute(sql: """
                    INSERT INTO notes (id,title,blocks_json,plaintext,parent_id,kind,location,collection_id,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        blocks_json = excluded.blocks_json,
                        plaintext = excluded.plaintext,
                        parent_id = excluded.parent_id,
                        kind = excluded.kind,
                        location = excluded.location,
                        collection_id = excluded.collection_id,
                        updated_at = excluded.updated_at
                    """, arguments: [n.id, n.title, n.blocksJSON, n.plaintext, n.parentID,
                                     n.kind.rawValue, n.location, n.collectionID, n.createdAt, n.updatedAt])
                upserted += 1
            }
            for t in remote.tombstones where t.entityType == .note {
                if let existing = try Int64.fetchOne(db, sql: "SELECT updated_at FROM notes WHERE id = ?", arguments: [t.entityID]),
                   t.deletedAt > existing {
                    try db.execute(sql: "DELETE FROM notes WHERE id = ?", arguments: [t.entityID])
                    deleted += 1
                }
            }
        }
        return (upserted, deleted)
    }

    /// Write-back for media (assets + mood boards) into THIS database — the Mac
    /// side, for phone-created photos/boards. Same safety as notes: only INSERTs
    /// rows we don't have (assets are create-once; boards LWW; board members
    /// union) + applies board/member tombstone deletes, in one deferred-FK
    /// transaction. Never overwrites existing rows. Schema-agnostic: writes
    /// `file_path` on orion.db (absolute, under `assetsDirPath`) or `file_name`
    /// on the phone schema.
    public func applyIncomingMedia(_ remote: SyncPayload, assetsDirPath: String) throws -> (assets: Int, boards: Int) {
        var assetCount = 0
        var boardCount = 0
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            let hasFilePath = try db.columns(in: "assets").map(\.name).contains("file_path")
            let fileCol = hasFilePath ? "file_path" : "file_name"

            for a in remote.assets {
                if try Bool.fetchOne(db, sql: "SELECT 1 FROM assets WHERE id = ?", arguments: [a.id]) ?? false { continue }
                let fileVal: String? = a.fileName.map { hasFilePath ? "\(assetsDirPath)/\($0)" : $0 }
                try db.execute(sql: """
                    INSERT INTO assets (id,kind,title,\(fileCol),url,metadata_json,mime_type,size_bytes,original_name,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """, arguments: [a.id, a.kind.rawValue, a.title, fileVal, a.url, a.metadataJSON,
                                     a.mimeType, a.sizeBytes, a.originalName, a.createdAt])
                assetCount += 1
            }
            for b in remote.moodBoards {
                if let e = try Int64.fetchOne(db, sql: "SELECT updated_at FROM mood_boards WHERE id = ?", arguments: [b.id]), e >= b.updatedAt { continue }
                try db.execute(sql: """
                    INSERT INTO mood_boards (id,title,cover_asset_id,created_at,updated_at) VALUES (?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET title=excluded.title, cover_asset_id=excluded.cover_asset_id, updated_at=excluded.updated_at
                    """, arguments: [b.id, b.title, b.coverAssetID, b.createdAt, b.updatedAt])
                boardCount += 1
            }
            for r in remote.moodBoardAssets {
                try db.execute(sql: "INSERT OR IGNORE INTO mood_board_assets (board_id,asset_id,position,added_at) VALUES (?,?,?,?)",
                               arguments: [r.boardID, r.assetID, r.position, r.addedAt])
            }
            for t in remote.tombstones {
                switch t.entityType {
                case .moodBoard:
                    if let e = try Int64.fetchOne(db, sql: "SELECT updated_at FROM mood_boards WHERE id = ?", arguments: [t.entityID]), t.deletedAt > e {
                        try db.execute(sql: "DELETE FROM mood_boards WHERE id = ?", arguments: [t.entityID])
                        try db.execute(sql: "DELETE FROM mood_board_assets WHERE board_id = ?", arguments: [t.entityID])
                    }
                case .moodBoardAsset:
                    let parts = t.entityID.components(separatedBy: "\u{1}")
                    if parts.count == 2 {
                        try db.execute(sql: "DELETE FROM mood_board_assets WHERE board_id = ? AND asset_id = ?", arguments: [parts[0], parts[1]])
                    }
                default: break
                }
            }
        }
        return (assetCount, boardCount)
    }

    /// One welcome note so the UI isn't blank before the first sync.
    @discardableResult
    public func seedWelcomeIfEmpty(now: Millis) throws -> Bool {
        try dbQueue.write { db in
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM notes") ?? 0
            guard count == 0 else { return false }
            try db.execute(sql: """
                INSERT INTO notes (id,title,blocks_json,plaintext,kind,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?)
                """, arguments: ["welcome-\(now)", "Welcome to Archives",
                                 #"[{"type":"paragraph","content":[{"type":"text","text":"This note lives on your phone. Sync with your Mac to pull in everything else."}]}]"#,
                                 "This note lives on your phone. Sync with your Mac to pull in everything else.",
                                 "note", now, now])
            return true
        }
    }

    // MARK: - Assets & mood boards (phone-side creation)

    public func createAsset(id: String, kind: AssetKind, fileName: String, mimeType: String,
                            sizeBytes: Int64, originalName: String, now: Millis) throws -> Asset {
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT INTO assets (id,kind,title,file_name,url,metadata_json,mime_type,size_bytes,original_name,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """, arguments: [id, kind.rawValue, nil, fileName, nil, nil, mimeType, sizeBytes, originalName, now])
        }
        return Asset(id: id, kind: kind, fileName: fileName, mimeType: mimeType,
                     sizeBytes: sizeBytes, originalName: originalName, createdAt: now)
    }

    public func createMoodBoard(id: String, title: String, now: Millis) throws -> MoodBoard {
        try dbQueue.write { db in
            try db.execute(sql: "INSERT INTO mood_boards (id,title,cover_asset_id,created_at,updated_at) VALUES (?,?,?,?,?)",
                           arguments: [id, title, nil, now, now])
        }
        return MoodBoard(id: id, title: title, createdAt: now, updatedAt: now)
    }

    public func deleteMoodBoard(id: String, now: Millis) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM mood_boards WHERE id = ?", arguments: [id])
            try db.execute(sql: "DELETE FROM mood_board_assets WHERE board_id = ?", arguments: [id])
            try db.execute(sql: "INSERT OR REPLACE INTO tombstones (entity_type,entity_id,deleted_at) VALUES ('moodBoard',?,?)",
                           arguments: [id, now])
        }
    }

    public func addAssetToBoard(boardID: String, assetID: String, now: Millis) throws {
        try dbQueue.write { db in
            let pos = try Int.fetchOne(db, sql: "SELECT COALESCE(MAX(position),-1)+1 FROM mood_board_assets WHERE board_id = ?", arguments: [boardID]) ?? 0
            try db.execute(sql: "INSERT OR IGNORE INTO mood_board_assets (board_id,asset_id,position,added_at) VALUES (?,?,?,?)",
                           arguments: [boardID, assetID, pos, now])
            try db.execute(sql: "UPDATE mood_boards SET updated_at = ? WHERE id = ?", arguments: [now, boardID])
            try db.execute(sql: "UPDATE mood_boards SET cover_asset_id = ? WHERE id = ? AND (cover_asset_id IS NULL OR cover_asset_id = '')",
                           arguments: [assetID, boardID])
        }
    }

    public func removeAssetFromBoard(boardID: String, assetID: String, now: Millis) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM mood_board_assets WHERE board_id = ? AND asset_id = ?", arguments: [boardID, assetID])
            try db.execute(sql: "INSERT OR REPLACE INTO tombstones (entity_type,entity_id,deleted_at) VALUES ('moodBoardAsset',?,?)",
                           arguments: ["\(boardID)\u{1}\(assetID)", now])
            try db.execute(sql: "UPDATE mood_boards SET updated_at = ? WHERE id = ?", arguments: [now, boardID])
        }
    }

    // MARK: - Row mapping (defensive: works for both the phone schema and orion.db)

    private static func note(_ r: Row) -> Note {
        let fp: String? = r["file_path"]   // unused for notes; kept for symmetry
        _ = fp
        return Note(
            id: r["id"], title: r["title"] ?? "", blocksJSON: r["blocks_json"] ?? "[]",
            plaintext: r["plaintext"] ?? "", parentID: r["parent_id"],
            kind: NoteKind(rawValue: (r["kind"] as String?) ?? "note") ?? .note,
            location: r["location"] ?? "", collectionID: r["collection_id"],
            createdAt: r["created_at"] ?? 0, updatedAt: r["updated_at"] ?? 0)
    }
    private static func notes(_ db: Database) throws -> [Note] {
        try Row.fetchAll(db, sql: "SELECT * FROM notes").map(note)
    }
    private static func assets(_ db: Database) throws -> [Asset] {
        guard try db.tableExists("assets") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT * FROM assets").map { r in
            // orion.db stores an absolute file_path; the phone stores just a file_name.
            let path: String? = r["file_path"]
            let name: String? = r["file_name"]
            let fileName = name ?? path.map { ($0 as NSString).lastPathComponent }
            return Asset(
                id: r["id"], kind: AssetKind(rawValue: (r["kind"] as String?) ?? "other") ?? .other,
                title: r["title"], fileName: fileName, url: r["url"],
                metadataJSON: r["metadata_json"], mimeType: r["mime_type"] ?? "",
                sizeBytes: r["size_bytes"] ?? 0, originalName: r["original_name"] ?? "",
                createdAt: r["created_at"] ?? 0)
        }
    }
    private static func tags(_ db: Database) throws -> [Tag] {
        guard try db.tableExists("tags") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT id, name FROM tags").map { Tag(id: $0["id"], name: $0["name"] ?? "") }
    }
    private static func collections(_ db: Database) throws -> [NoteCollection] {
        guard try db.tableExists("collections") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT * FROM collections").map {
            NoteCollection(id: $0["id"], name: $0["name"] ?? "", color: $0["color"] ?? "",
                           createdAt: $0["created_at"] ?? 0, updatedAt: $0["updated_at"] ?? 0)
        }
    }
    private static func moodBoards(_ db: Database) throws -> [MoodBoard] {
        guard try db.tableExists("mood_boards") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT * FROM mood_boards").map {
            MoodBoard(id: $0["id"], title: $0["title"] ?? "", coverAssetID: $0["cover_asset_id"],
                      createdAt: $0["created_at"] ?? 0, updatedAt: $0["updated_at"] ?? 0)
        }
    }
    private static func noteTags(_ db: Database) throws -> [NoteTag] {
        guard try db.tableExists("note_tags") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT note_id, tag_id FROM note_tags").map {
            NoteTag(noteID: $0["note_id"], tagID: $0["tag_id"])
        }
    }
    private static func assetTags(_ db: Database) throws -> [AssetTag] {
        guard try db.tableExists("asset_tags") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT asset_id, tag_id FROM asset_tags").map {
            AssetTag(assetID: $0["asset_id"], tagID: $0["tag_id"])
        }
    }
    private static func moodBoardAssets(_ db: Database) throws -> [MoodBoardAsset] {
        guard try db.tableExists("mood_board_assets") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT * FROM mood_board_assets").map {
            MoodBoardAsset(boardID: $0["board_id"], assetID: $0["asset_id"],
                           position: $0["position"] ?? 0, addedAt: $0["added_at"] ?? 0)
        }
    }
    private static func tombstones(_ db: Database) throws -> [Tombstone] {
        guard try db.tableExists("tombstones") else { return [] }
        return try Row.fetchAll(db, sql: "SELECT * FROM tombstones").compactMap {
            guard let type = EntityType(rawValue: ($0["entity_type"] as String?) ?? "") else { return nil }
            return Tombstone(entityType: type, entityID: $0["entity_id"], deletedAt: $0["deleted_at"] ?? 0)
        }
    }
}
