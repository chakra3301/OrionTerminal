import Foundation

// Mirrors the Archives subset of the desktop SQLite schema (src-tauri/migrations).
// Timestamps are Int64 milliseconds since the Unix epoch — the same unit the
// desktop stores (JS `Date.now()`), so rows merge by a shared clock.
//
// IDs are ULIDs (globally unique + time-sortable). That uniqueness is what lets
// two independently-edited databases merge by a plain union without primary-key
// collisions — the central reason this offline, no-cloud design is tractable.

public typealias Millis = Int64

public enum NoteKind: String, Codable, Sendable, CaseIterable {
    case note, journal, project
}

public enum AssetKind: String, Codable, Sendable, CaseIterable {
    case image, video, audio, doc, other
}

/// A note, journal entry, or project page. `blocksJSON` is the BlockNote
/// document verbatim — kept opaque here so the phone round-trips it losslessly.
public struct Note: Codable, Sendable, Identifiable, Equatable, Hashable {
    public var id: String
    public var title: String
    public var blocksJSON: String
    public var plaintext: String
    public var parentID: String?
    public var kind: NoteKind
    public var location: String
    public var collectionID: String?
    public var createdAt: Millis
    public var updatedAt: Millis

    public init(id: String, title: String, blocksJSON: String, plaintext: String,
                parentID: String? = nil, kind: NoteKind = .note, location: String = "",
                collectionID: String? = nil, createdAt: Millis, updatedAt: Millis) {
        self.id = id; self.title = title; self.blocksJSON = blocksJSON
        self.plaintext = plaintext; self.parentID = parentID; self.kind = kind
        self.location = location; self.collectionID = collectionID
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

/// A media asset. The desktop schema has no `updated_at` — assets are treated
/// as create-once, so they merge by union-of-id rather than last-write-wins.
public struct Asset: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var kind: AssetKind
    public var title: String?
    public var fileName: String?      // basename inside the assets dir; the bytes travel separately
    public var url: String?
    public var metadataJSON: String?
    public var mimeType: String
    public var sizeBytes: Int64
    public var originalName: String
    public var createdAt: Millis

    public init(id: String, kind: AssetKind, title: String? = nil, fileName: String? = nil,
                url: String? = nil, metadataJSON: String? = nil, mimeType: String = "",
                sizeBytes: Int64 = 0, originalName: String = "", createdAt: Millis) {
        self.id = id; self.kind = kind; self.title = title; self.fileName = fileName
        self.url = url; self.metadataJSON = metadataJSON; self.mimeType = mimeType
        self.sizeBytes = sizeBytes; self.originalName = originalName; self.createdAt = createdAt
    }
}

/// `name` is UNIQUE on the desktop. Two devices can mint the same name under
/// different ids, so the merge deduplicates tags by lowercased name.
public struct Tag: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}

public struct NoteCollection: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var color: String
    public var createdAt: Millis
    public var updatedAt: Millis
    public init(id: String, name: String, color: String, createdAt: Millis, updatedAt: Millis) {
        self.id = id; self.name = name; self.color = color
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

public struct MoodBoard: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var title: String
    public var coverAssetID: String?
    public var createdAt: Millis
    public var updatedAt: Millis
    public init(id: String, title: String, coverAssetID: String? = nil, createdAt: Millis, updatedAt: Millis) {
        self.id = id; self.title = title; self.coverAssetID = coverAssetID
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

// MARK: - Join rows (sets)

public struct AssetTag: Codable, Sendable, Equatable, Hashable {
    public var assetID: String
    public var tagID: String
    public init(assetID: String, tagID: String) { self.assetID = assetID; self.tagID = tagID }
}

public struct NoteTag: Codable, Sendable, Equatable, Hashable {
    public var noteID: String
    public var tagID: String
    public init(noteID: String, tagID: String) { self.noteID = noteID; self.tagID = tagID }
}

public struct MoodBoardAsset: Codable, Sendable, Equatable, Hashable {
    public var boardID: String
    public var assetID: String
    public var position: Int
    public var addedAt: Millis
    public init(boardID: String, assetID: String, position: Int, addedAt: Millis) {
        self.boardID = boardID; self.assetID = assetID; self.position = position; self.addedAt = addedAt
    }
}

// MARK: - Deletions

public enum EntityType: String, Codable, Sendable, CaseIterable {
    case note, asset, collection, moodBoard
    case assetTag, noteTag, moodBoardAsset
    // Tag deletions are intentionally not tracked: orphan tags are harmless and
    // dedup-by-name already prevents duplication. (v1 limitation, by design.)
}

/// Records that a row was deleted, so the deletion propagates on the next sync
/// instead of the row being resurrected from the other device's union.
public struct Tombstone: Codable, Sendable, Equatable, Hashable {
    public var entityType: EntityType
    public var entityID: String      // composite key (see CompositeKey) for join rows
    public var deletedAt: Millis
    public init(entityType: EntityType, entityID: String, deletedAt: Millis) {
        self.entityType = entityType; self.entityID = entityID; self.deletedAt = deletedAt
    }
}

/// Stable string keys for join rows so they can be tombstoned and de-duplicated.
/// The separator is a control char that can't appear in a ULID.
public enum CompositeKey {
    static let sep = "\u{1}"
    public static func assetTag(_ r: AssetTag) -> String { "\(r.assetID)\(sep)\(r.tagID)" }
    public static func noteTag(_ r: NoteTag) -> String { "\(r.noteID)\(sep)\(r.tagID)" }
    public static func moodBoardAsset(_ r: MoodBoardAsset) -> String { "\(r.boardID)\(sep)\(r.assetID)" }
}
