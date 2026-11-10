import Foundation

/// A full snapshot of one device's Archives database, plus its tombstones.
///
/// v1 exchanges complete snapshots rather than deltas: it's simpler and provably
/// correct (the merge is deterministic), and Archives is small enough that the
/// payload stays cheap. Delta sync (send only rows changed since a per-peer
/// high-water mark) is the obvious later optimization.
///
/// The asset *bytes* are NOT in here — only `Asset.fileName` references them.
/// Files travel alongside the payload as Multipeer resources so a 50MB video
/// doesn't get base64'd into JSON.
public struct SyncPayload: Codable, Sendable {
    public static let currentSchemaVersion = 2

    public var schemaVersion: Int
    public var deviceID: String
    public var generatedAt: Millis

    public var notes: [Note]
    public var assets: [Asset]
    public var tags: [Tag]
    public var collections: [NoteCollection]
    public var moodBoards: [MoodBoard]
    public var assetTags: [AssetTag]
    public var noteTags: [NoteTag]
    public var moodBoardAssets: [MoodBoardAsset]
    public var tombstones: [Tombstone]
    /// Asset ids whose BYTES the sender already has cached, so the peer can skip
    /// re-sending them. Optional → backward-compatible decode of older payloads.
    public var haveAssetIDs: [String]?

    public init(deviceID: String, generatedAt: Millis,
                notes: [Note] = [], assets: [Asset] = [], tags: [Tag] = [],
                collections: [NoteCollection] = [], moodBoards: [MoodBoard] = [],
                assetTags: [AssetTag] = [], noteTags: [NoteTag] = [],
                moodBoardAssets: [MoodBoardAsset] = [], tombstones: [Tombstone] = [],
                haveAssetIDs: [String]? = nil,
                schemaVersion: Int = SyncPayload.currentSchemaVersion) {
        self.haveAssetIDs = haveAssetIDs
        self.schemaVersion = schemaVersion
        self.deviceID = deviceID
        self.generatedAt = generatedAt
        self.notes = notes; self.assets = assets; self.tags = tags
        self.collections = collections; self.moodBoards = moodBoards
        self.assetTags = assetTags; self.noteTags = noteTags
        self.moodBoardAssets = moodBoardAssets; self.tombstones = tombstones
    }

    public func validate() throws {
        guard schemaVersion == Self.currentSchemaVersion else { throw SyncSafetyError.invalid("Update both Archives and the Mac sync helper before syncing.") }
        func unique(_ ids: [String]) -> Bool {
            ids.count <= 20_000 && Set(ids).count == ids.count && ids.allSatisfy { !$0.isEmpty && $0.utf8.count <= 180 && !$0.contains("\u{1}") }
        }
        guard unique(notes.map(\.id)), unique(assets.map(\.id)), unique(tags.map(\.id)),
              unique(collections.map(\.id)), unique(moodBoards.map(\.id)),
              noteTags.count <= 100_000, assetTags.count <= 100_000,
              moodBoardAssets.count <= 100_000, tombstones.count <= 100_000 else {
            throw SyncSafetyError.invalid("Invalid or oversized library snapshot.")
        }
        let futureLimit = Millis(Date().timeIntervalSince1970 * 1000) + 300_000
        guard tombstones.allSatisfy({ !$0.entityID.isEmpty && $0.entityID.utf8.count <= 361 && $0.deletedAt >= 0 && $0.deletedAt <= futureLimit }),
              assets.allSatisfy({ $0.createdAt >= 0 && $0.createdAt <= futureLimit && $0.sizeBytes >= 0 }),
              moodBoards.allSatisfy({ $0.createdAt >= 0 && $0.updatedAt >= 0 && $0.updatedAt <= futureLimit }),
              collections.allSatisfy({ $0.createdAt >= 0 && $0.updatedAt >= 0 && $0.updatedAt <= futureLimit }) else {
            throw SyncSafetyError.invalid("Invalid timestamps. Check both devices' clocks before syncing.")
        }
        for note in notes {
            guard note.title.utf8.count <= 16_000, note.blocksJSON.utf8.count <= 2_000_000,
                  note.plaintext.utf8.count <= 2_000_000,
                  note.createdAt >= 0, note.createdAt <= futureLimit, note.updatedAt >= 0, note.updatedAt <= futureLimit,
                  let data = note.blocksJSON.data(using: .utf8),
                  (try? JSONSerialization.jsonObject(with: data)) is [Any] else {
                throw SyncSafetyError.invalid("Invalid note document; no changes applied.")
            }
        }
        let parents = Dictionary(uniqueKeysWithValues: notes.map { ($0.id, $0.parentID) })
        for note in notes {
            var visited: Set<String> = [note.id]
            var parent = note.parentID
            while let id = parent {
                guard visited.insert(id).inserted, visited.count <= 128 else {
                    throw SyncSafetyError.invalid("Cyclic or excessively deep project hierarchy.")
                }
                parent = parents[id] ?? nil
            }
        }
        guard assets.allSatisfy({ $0.fileName == nil || AssetSafety.validName($0.fileName!) }) else {
            throw SyncSafetyError.invalid("Unsafe asset filename in snapshot.")
        }
    }

    public func encoded() throws -> Data { try JSONEncoder().encode(self) }
    public static func decoded(_ data: Data) throws -> SyncPayload {
        try JSONDecoder().decode(SyncPayload.self, from: data)
    }

    /// Asset ids whose bytes the receiver may not have yet (everything with a
    /// filename, in v1 — refined to a real diff once peers track what they hold).
    public var assetFileNames: [(id: String, fileName: String)] {
        assets.compactMap { a in a.fileName.map { (a.id, $0) } }
    }
}
