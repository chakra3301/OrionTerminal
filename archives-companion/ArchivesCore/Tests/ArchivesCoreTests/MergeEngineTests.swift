import XCTest
@testable import ArchivesCore

final class MergeEngineTests: XCTestCase {

    private func note(_ id: String, _ title: String, updatedAt: Millis) -> Note {
        Note(id: id, title: title, blocksJSON: "[]", plaintext: title, createdAt: 1, updatedAt: updatedAt)
    }
    private func payload(_ device: String, notes: [Note] = [], tags: [Tag] = [],
                         assets: [Asset] = [], assetTags: [AssetTag] = [],
                         tombstones: [Tombstone] = []) -> SyncPayload {
        SyncPayload(deviceID: device, generatedAt: 100, notes: notes, assets: assets,
                    tags: tags, assetTags: assetTags, tombstones: tombstones)
    }

    func testLastWriteWins() {
        let a = payload("mac", notes: [note("01", "old", updatedAt: 10)])
        let b = payload("phone", notes: [note("01", "new", updatedAt: 20)])
        XCTAssertEqual(MergeEngine.merge(a, b).notes.first?.title, "new")
        // Symmetric: order of merge must not change the winner.
        XCTAssertEqual(MergeEngine.merge(b, a).notes.first?.title, "new")
    }

    func testUnionOfDistinctRows() {
        let a = payload("mac", notes: [note("01", "from mac", updatedAt: 10)])
        let b = payload("phone", notes: [note("02", "from phone", updatedAt: 10)])
        let merged = MergeEngine.merge(a, b)
        XCTAssertEqual(Set(merged.notes.map(\.id)), ["01", "02"])
    }

    func testCommutative() {
        let a = payload("mac", notes: [note("01", "a", updatedAt: 30), note("03", "c", updatedAt: 5)])
        let b = payload("phone", notes: [note("01", "b", updatedAt: 10), note("02", "x", updatedAt: 9)])
        let ab = MergeEngine.merge(a, b)
        let ba = MergeEngine.merge(b, a)
        XCTAssertEqual(ab.notes, ba.notes)
    }

    func testTombstoneDeletesWhenNewerThanEdit() {
        let a = payload("mac", notes: [note("01", "alive", updatedAt: 10)])
        let b = payload("phone", tombstones: [Tombstone(entityType: .note, entityID: "01", deletedAt: 20)])
        let merged = MergeEngine.merge(a, b)
        XCTAssertTrue(merged.notes.isEmpty, "delete (t=20) after edit (t=10) should win")
        XCTAssertEqual(merged.tombstones.count, 1, "tombstone is retained so it keeps propagating")
    }

    func testEditAfterDeleteResurrects() {
        let a = payload("mac", notes: [note("01", "edited later", updatedAt: 30)])
        let b = payload("phone", tombstones: [Tombstone(entityType: .note, entityID: "01", deletedAt: 20)])
        let merged = MergeEngine.merge(a, b)
        XCTAssertEqual(merged.notes.first?.title, "edited later",
                       "edit (t=30) after delete (t=20) should resurrect the row")
    }

    func testTagDedupByNameAndRemap() {
        // Same name, different ids — minted independently on each device.
        let macTag = Tag(id: "01AAA", name: "Idea")
        let phoneTag = Tag(id: "01BBB", name: "idea")  // different casing too
        let a = payload("mac", tags: [macTag])
        let b = payload("phone", tags: [phoneTag],
                        assetTags: [AssetTag(assetID: "asset1", tagID: "01BBB")])
        let merged = MergeEngine.merge(a, b)

        XCTAssertEqual(merged.tags.count, 1, "duplicate tag names collapse to one")
        XCTAssertEqual(merged.tags.first?.id, "01AAA", "oldest (smallest) ULID is canonical")
        XCTAssertEqual(merged.assetTags.first?.tagID, "01AAA",
                       "references to the discarded tag id are remapped to canonical")
    }

    func testAssetsUnionCreateOnce() {
        let a = payload("mac", assets: [Asset(id: "a1", kind: .image, createdAt: 1)])
        let b = payload("phone", assets: [Asset(id: "a2", kind: .video, createdAt: 2)])
        XCTAssertEqual(Set(MergeEngine.merge(a, b).assets.map(\.id)), ["a1", "a2"])
    }

    func testIdempotentReMerge() {
        // Merging an already-merged state with one of its inputs changes nothing.
        let a = payload("mac", notes: [note("01", "x", updatedAt: 10)],
                        tags: [Tag(id: "t1", name: "a")])
        let b = payload("phone", notes: [note("02", "y", updatedAt: 10)])
        let once = MergeEngine.merge(a, b)
        let twice = MergeEngine.merge(once, a)
        XCTAssertEqual(once.notes, twice.notes)
        XCTAssertEqual(once.tags, twice.tags)
    }
}
