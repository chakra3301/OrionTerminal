import Foundation

/// Deterministic, order-independent merge of two Archives snapshots.
///
/// The key property: `merge(a, b)` and `merge(b, a)` produce the same logical
/// state. So a single two-way exchange — each device merges the other's payload
/// into its own — converges both devices to an identical database. No server,
/// no coordination, no ongoing connection.
///
/// Rules, by table:
///  - notes / collections / moodBoards: last-write-wins by `updatedAt`.
///  - assets: create-once → union by id (no `updatedAt` exists to compare).
///  - tags: dedup by lowercased name; the lexicographically-smallest id (= the
///    oldest ULID) is canonical, and references to the other id are remapped.
///  - join rows (asset↔tag, note↔tag, board↔asset): set union, remapped tags.
///  - a tombstone suppresses a row only if it was deleted *after* the row's last
///    edit — so editing on one device after deleting on the other resurrects it,
///    which is the intuitive single-user outcome.
public enum MergeEngine {

    public static func merge(_ a: SyncPayload, _ b: SyncPayload) -> SyncPayload {
        // 1. Union tombstones, keeping the latest deletion per (type, id).
        var tomb: [String: Tombstone] = [:]
        for t in a.tombstones + b.tombstones {
            let k = tombKey(t.entityType, t.entityID)
            if let e = tomb[k], e.deletedAt >= t.deletedAt { continue }
            tomb[k] = t
        }
        func deleted(_ type: EntityType, _ id: String, after rowTime: Millis) -> Bool {
            guard let t = tomb[tombKey(type, id)] else { return false }
            return t.deletedAt > rowTime
        }

        // 2. Tags: dedup by name, build a remap from any tag id -> canonical id.
        var canonicalByName: [String: Tag] = [:]
        for tag in a.tags + b.tags {
            let n = tag.name.lowercased()
            if let existing = canonicalByName[n] {
                if tag.id < existing.id { canonicalByName[n] = tag }
            } else {
                canonicalByName[n] = tag
            }
        }
        var tagRemap: [String: String] = [:]
        for tag in a.tags + b.tags {
            tagRemap[tag.id] = canonicalByName[tag.name.lowercased()]!.id
        }
        let mergedTags = canonicalByName.values.sorted { $0.id < $1.id }

        // 3. Versioned rows: latest by updatedAt, then drop those a later tombstone covers.
        let notes = mergeVersioned(a.notes, b.notes, type: .note,
                                   id: \.id, updatedAt: \.updatedAt, deleted: deleted)
        let collections = mergeVersioned(a.collections, b.collections, type: .collection,
                                         id: \.id, updatedAt: \.updatedAt, deleted: deleted)
        let moodBoards = mergeVersioned(a.moodBoards, b.moodBoards, type: .moodBoard,
                                        id: \.id, updatedAt: \.updatedAt, deleted: deleted)

        // 4. Assets: union by id (create-once), drop tombstoned-after-create.
        var assetByID: [String: Asset] = [:]
        for asset in a.assets + b.assets where assetByID[asset.id] == nil {
            assetByID[asset.id] = asset
        }
        let assets = assetByID.values
            .filter { !deleted(.asset, $0.id, after: $0.createdAt) }
            .sorted { $0.id < $1.id }

        // 5. Join rows: remap tag ids, then set-union, then drop tombstoned.
        var assetTagByKey: [String: AssetTag] = [:]
        for raw in a.assetTags + b.assetTags {
            let r = AssetTag(assetID: raw.assetID, tagID: tagRemap[raw.tagID] ?? raw.tagID)
            assetTagByKey[CompositeKey.assetTag(r)] = r
        }
        let assetTags = assetTagByKey
            .filter { !deleted(.assetTag, $0.key, after: 0) }
            .values.sorted { CompositeKey.assetTag($0) < CompositeKey.assetTag($1) }

        var noteTagByKey: [String: NoteTag] = [:]
        for raw in a.noteTags + b.noteTags {
            let r = NoteTag(noteID: raw.noteID, tagID: tagRemap[raw.tagID] ?? raw.tagID)
            noteTagByKey[CompositeKey.noteTag(r)] = r
        }
        let noteTags = noteTagByKey
            .filter { !deleted(.noteTag, $0.key, after: 0) }
            .values.sorted { CompositeKey.noteTag($0) < CompositeKey.noteTag($1) }

        var boardAssetByKey: [String: MoodBoardAsset] = [:]
        for r in a.moodBoardAssets + b.moodBoardAssets {
            let k = CompositeKey.moodBoardAsset(r)
            if let e = boardAssetByKey[k], e.addedAt >= r.addedAt { continue }
            boardAssetByKey[k] = r
        }
        let moodBoardAssets = boardAssetByKey.values
            .filter { !deleted(.moodBoardAsset, CompositeKey.moodBoardAsset($0), after: $0.addedAt) }
            .sorted { $0.position < $1.position }

        return SyncPayload(
            deviceID: a.deviceID,
            generatedAt: max(a.generatedAt, b.generatedAt),
            notes: notes, assets: assets, tags: mergedTags,
            collections: collections, moodBoards: moodBoards,
            assetTags: assetTags, noteTags: noteTags, moodBoardAssets: moodBoardAssets,
            tombstones: tomb.values.sorted { $0.entityID < $1.entityID }
        )
    }

    // MARK: - Helpers

    private static func tombKey(_ type: EntityType, _ id: String) -> String {
        "\(type.rawValue)\u{1}\(id)"
    }

    private static func mergeVersioned<T>(
        _ aRows: [T], _ bRows: [T], type: EntityType,
        id: KeyPath<T, String>, updatedAt: KeyPath<T, Millis>,
        deleted: (EntityType, String, Millis) -> Bool
    ) -> [T] {
        var best: [String: T] = [:]
        for r in aRows + bRows {
            let i = r[keyPath: id]
            if let e = best[i], e[keyPath: updatedAt] >= r[keyPath: updatedAt] { continue }
            best[i] = r
        }
        return best.values
            .filter { !deleted(type, $0[keyPath: id], $0[keyPath: updatedAt]) }
            .sorted { $0[keyPath: id] < $1[keyPath: id] }
    }
}
