import XCTest
import ArchivesCore
@testable import ArchivesStore

final class StoreRoundTripTests: XCTestCase {

    private func makeStore() throws -> (ArchivesStore, String) {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("archives-test-\(UUID().uuidString).sqlite").path
        return (try ArchivesStore(path: path, createSchema: true), path)
    }

    func testSeedSnapshotMergeApplyAndTombstone() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        // Seed → snapshot reads it back.
        XCTAssertTrue(try store.seedWelcomeIfEmpty(now: 1000))
        XCTAssertFalse(try store.seedWelcomeIfEmpty(now: 1001), "second seed is a no-op")
        var snap = try store.snapshot(deviceID: "phone", generatedAt: 1000)
        XCTAssertEqual(snap.notes.count, 1)
        let welcomeID = snap.notes[0].id

        // A note from the Mac merges in and persists through apply().
        let remote = SyncPayload(deviceID: "mac", generatedAt: 2000, notes: [
            Note(id: "n2", title: "From Mac", blocksJSON: "[]", plaintext: "hi", createdAt: 2000, updatedAt: 2000),
        ])
        try store.apply(MergeEngine.merge(snap, remote))
        let notes = try store.displayNotes()
        XCTAssertEqual(notes.count, 2)
        XCTAssertTrue(notes.contains { $0.title == "From Mac" })

        // A remote delete (newer than the welcome note's last edit) removes it.
        snap = try store.snapshot(deviceID: "phone", generatedAt: 3000)
        let delete = SyncPayload(deviceID: "mac", generatedAt: 3000, tombstones: [
            Tombstone(entityType: .note, entityID: welcomeID, deletedAt: 3000),
        ])
        try store.apply(MergeEngine.merge(snap, delete))
        let after = try store.displayNotes()
        XCTAssertEqual(after.count, 1)
        XCTAssertFalse(after.contains { $0.id == welcomeID })
        XCTAssertEqual(after.first?.title, "From Mac")
    }

    func testApplyIncomingNotesLWWUpsert() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        // Simulate the Mac's existing notes.
        try store.apply(SyncPayload(deviceID: "mac", generatedAt: 1, notes: [
            Note(id: "a", title: "Mac old", blocksJSON: "[]", plaintext: "old", createdAt: 1, updatedAt: 10),
            Note(id: "b", title: "Mac keeps", blocksJSON: "[]", plaintext: "keep", createdAt: 1, updatedAt: 50),
        ]))

        // Phone brings: a edited (newer), b stale (older → must NOT overwrite), c new.
        let incoming = SyncPayload(deviceID: "phone", generatedAt: 100, notes: [
            Note(id: "a", title: "Phone new", blocksJSON: "[]", plaintext: "new", createdAt: 1, updatedAt: 20),
            Note(id: "b", title: "Phone stale", blocksJSON: "[]", plaintext: "stale", createdAt: 1, updatedAt: 30),
            Note(id: "c", title: "Phone created", blocksJSON: "[]", plaintext: "c", createdAt: 60, updatedAt: 60),
        ])
        let r = try store.applyIncomingNotes(incoming)

        XCTAssertEqual(r.upserted, 2, "a (newer) + c (new); b skipped as stale")
        let notes = try store.displayNotes()
        XCTAssertEqual(notes.first { $0.id == "a" }?.title, "Phone new")
        XCTAssertEqual(notes.first { $0.id == "b" }?.title, "Mac keeps", "stale phone edit must not clobber newer Mac note")
        XCTAssertNotNil(notes.first { $0.id == "c" })
    }

    func testApplyIncomingNotesTombstoneDelete() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        try store.apply(SyncPayload(deviceID: "mac", generatedAt: 1, notes: [
            Note(id: "x", title: "doomed", blocksJSON: "[]", plaintext: "", createdAt: 1, updatedAt: 10),
        ]))
        let r = try store.applyIncomingNotes(SyncPayload(deviceID: "phone", generatedAt: 100, tombstones: [
            Tombstone(entityType: .note, entityID: "x", deletedAt: 20),
        ]))
        XCTAssertEqual(r.deleted, 1)
        XCTAssertTrue(try store.displayNotes().isEmpty)
    }

    func testApplyIncomingMedia() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        let remote = SyncPayload(
            deviceID: "phone", generatedAt: 10,
            assets: [Asset(id: "a1", kind: .image, fileName: "a1.jpg", mimeType: "image/jpeg", sizeBytes: 5, originalName: "a1.jpg", createdAt: 10)],
            moodBoards: [MoodBoard(id: "b1", title: "Trip", coverAssetID: "a1", createdAt: 10, updatedAt: 10)],
            moodBoardAssets: [MoodBoardAsset(boardID: "b1", assetID: "a1", position: 0, addedAt: 10)]
        )
        let r = try store.applyIncomingMedia(remote, assetsDirPath: "/tmp/assets")
        XCTAssertEqual(r.assets, 1)
        XCTAssertEqual(r.boards, 1)

        var snap = try store.snapshot(deviceID: "mac", generatedAt: 11)
        XCTAssertEqual(snap.assets.first?.id, "a1")
        XCTAssertEqual(snap.moodBoards.first?.title, "Trip")
        XCTAssertEqual(snap.moodBoardAssets.count, 1)

        XCTAssertEqual(try store.applyIncomingMedia(remote, assetsDirPath: "/tmp/assets").assets, 0, "re-apply is idempotent (asset exists)")

        _ = try store.applyIncomingMedia(
            SyncPayload(deviceID: "phone", generatedAt: 20, tombstones: [Tombstone(entityType: .moodBoard, entityID: "b1", deletedAt: 20)]),
            assetsDirPath: "/tmp/assets")
        snap = try store.snapshot(deviceID: "mac", generatedAt: 21)
        XCTAssertTrue(snap.moodBoards.isEmpty, "board tombstone propagated")
    }

    func testMoodBoardCRUD() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        _ = try store.createAsset(id: "a1", kind: .image, fileName: "a1.jpg", mimeType: "image/jpeg",
                                  sizeBytes: 10, originalName: "a1.jpg", now: 1)
        _ = try store.createMoodBoard(id: "b1", title: "Trip", now: 1)
        try store.addAssetToBoard(boardID: "b1", assetID: "a1", now: 2)

        var snap = try store.snapshot(deviceID: "phone", generatedAt: 3)
        XCTAssertEqual(snap.assets.count, 1)
        XCTAssertEqual(snap.moodBoards.count, 1)
        XCTAssertEqual(snap.moodBoardAssets.count, 1)
        XCTAssertEqual(snap.moodBoards.first?.coverAssetID, "a1", "first added asset becomes the cover")

        try store.removeAssetFromBoard(boardID: "b1", assetID: "a1", now: 4)
        snap = try store.snapshot(deviceID: "phone", generatedAt: 5)
        XCTAssertTrue(snap.moodBoardAssets.isEmpty)
        XCTAssertTrue(snap.tombstones.contains { $0.entityType == .moodBoardAsset })

        try store.deleteMoodBoard(id: "b1", now: 6)
        snap = try store.snapshot(deviceID: "phone", generatedAt: 7)
        XCTAssertTrue(snap.moodBoards.isEmpty)
        XCTAssertTrue(snap.tombstones.contains { $0.entityType == .moodBoard && $0.entityID == "b1" })
    }

    func testCollectionsAndTagsRoundTrip() throws {
        let (store, path) = try makeStore()
        defer { try? FileManager.default.removeItem(atPath: path) }

        let payload = SyncPayload(
            deviceID: "mac", generatedAt: 10,
            notes: [Note(id: "n1", title: "Tagged", blocksJSON: "[]", plaintext: "x", collectionID: "c1", createdAt: 10, updatedAt: 10)],
            tags: [Tag(id: "t1", name: "idea")],
            collections: [NoteCollection(id: "c1", name: "Work", color: "var(--neon-green)", createdAt: 10, updatedAt: 10)],
            noteTags: [NoteTag(noteID: "n1", tagID: "t1")]
        )
        try store.apply(payload)
        let back = try store.snapshot(deviceID: "phone", generatedAt: 11)
        XCTAssertEqual(back.collections.first?.name, "Work")
        XCTAssertEqual(back.tags.first?.name, "idea")
        XCTAssertEqual(back.noteTags.first, NoteTag(noteID: "n1", tagID: "t1"))
        XCTAssertEqual(back.notes.first?.collectionID, "c1")
    }
}
