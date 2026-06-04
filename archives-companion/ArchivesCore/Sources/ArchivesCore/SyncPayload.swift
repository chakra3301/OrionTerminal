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
    public static let currentSchemaVersion = 1

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
