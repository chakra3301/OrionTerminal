import XCTest
import GRDB
import ArchivesCore
@testable import ArchivesStore

final class SyncPersistenceTests: XCTestCase {
    private func fixture(_ test: (ArchivesStore, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("fixture.sqlite")
        let store = try ArchivesStore(path: path.path, createSchema: true)
        try test(store, directory)
    }
    func testMissingNoteSaveReportsFailure() throws {
        try fixture { store, _ in
            let note = Note(id: "absent", title: "draft", blocksJSON: "[]", plaintext: "", createdAt: 1, updatedAt: 1)
            XCTAssertThrowsError(try store.saveNote(note))
        }
    }
    func testStaleDraftCannotReplaceNewerSavedContent() throws {
        try fixture { store, _ in
            var original = try store.createNote(id: "n", kind: .note, now: 1)
            original.title = "Recovered draft"; original.updatedAt = 2
            try store.updateNoteTitle(id: "n", title: "New saved version", updatedAt: 10)
            XCTAssertThrowsError(try store.saveNote(original))
            XCTAssertEqual(try store.displayNotes().first?.title, "New saved version")
        }
    }
    func testBoardReadditionSurvivesOldRemovalTombstone() throws {
        try fixture { store, directory in
            try store.enableDesktopSyncTracking()
            let payload = SyncPayload(deviceID: "p", generatedAt: 20,
                assets: [Asset(id: "a", kind: .image, fileName: "a.png", createdAt: 1)],
                moodBoards: [MoodBoard(id: "b", title: "Board", createdAt: 1, updatedAt: 20)],
                moodBoardAssets: [MoodBoardAsset(boardID: "b", assetID: "a", position: 0, addedAt: 20)],
                tombstones: [Tombstone(entityType: .moodBoardAsset, entityID: "b\u{1}a", deletedAt: 10)])
            var older = payload
            older.moodBoardAssets[0].addedAt = 5; older.tombstones = []
            _ = try store.applyIncoming(older, assetsDirPath: directory.path)
            _ = try store.applyIncoming(payload, assetsDirPath: directory.path)
            XCTAssertEqual(try store.snapshot(deviceID: "m", generatedAt: 20).moodBoardAssets.first?.addedAt, 20)
        }
    }
    func testDesktopDeletionTrackingPreventsStaleResurrection() throws {
        try fixture { store, directory in
            _ = try store.createNote(id: "n", kind: .note, now: 1)
            let stale = try store.snapshot(deviceID: "phone", generatedAt: 2)
            try store.enableDesktopSyncTracking()
            try store.enableDesktopSyncTracking()
            try store.dbQueue.write { db in try db.execute(sql: "DELETE FROM notes WHERE id='n'") }
            XCTAssertEqual(try store.snapshot(deviceID: "mac", generatedAt: 3).tombstones.count, 1)
            _ = try store.applyIncoming(stale, assetsDirPath: directory.path)
            XCTAssertTrue(try store.displayNotes().isEmpty)
        }
    }
    func testDesktopBoardMemberDeletionDoesNotResurrect() throws {
        try fixture { store, directory in
            _ = try store.createAsset(id: "a", kind: .image, fileName: "a.png", mimeType: "image/png", sizeBytes: 1, originalName: "a.png", now: 1)
            _ = try store.createMoodBoard(id: "b", title: "Board", now: 1)
            try store.addAssetToBoard(boardID: "b", assetID: "a", now: 2)
            let stale = try store.snapshot(deviceID: "phone", generatedAt: 2)
            try store.enableDesktopSyncTracking()
            try store.dbQueue.write { db in try db.execute(sql: "DELETE FROM mood_board_assets WHERE board_id='b'") }
            _ = try store.applyIncoming(stale, assetsDirPath: directory.path)
            XCTAssertTrue(try store.snapshot(deviceID: "m", generatedAt: 3).moodBoardAssets.isEmpty)
        }
    }
    func testCombinedNoteMediaFailureRollsBackNotes() throws {
        try fixture { store, directory in
            try store.enableDesktopSyncTracking()
            try store.dbQueue.write { db in
                try db.execute(sql: "CREATE TRIGGER injected_failure BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
            }
            let remote = SyncPayload(deviceID: "phone", generatedAt: 1,
                notes: [Note(id: "n", title: "new", blocksJSON: "[]", plaintext: "", createdAt: 1, updatedAt: 1)],
                assets: [Asset(id: "a", kind: .image, fileName: "a.png", createdAt: 1)])
            XCTAssertThrowsError(try store.applyIncoming(remote, assetsDirPath: directory.path))
            XCTAssertTrue(try store.displayNotes().isEmpty)
        }
    }
    func testBackupRoundTripNoOverwrite() throws {
        try fixture { store, directory in
            _ = try store.createNote(id: "n", kind: .note, now: 1)
            let backup = directory.appendingPathComponent("backup.sqlite")
            try store.backup(to: backup.path)
            XCTAssertThrowsError(try store.backup(to: backup.path))
            let restored = try ArchivesStore(path: backup.path, createSchema: false, readOnly: true)
            XCTAssertEqual(try restored.displayNotes().map(\.id), ["n"])
        }
    }
    func testCurrentDesktopMigrationsAndPhoneRoundTrip() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let migrations = root.appendingPathComponent("src-tauri/migrations")
        let scripts = try FileManager.default.contentsOfDirectory(at: migrations, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "sql" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertGreaterThanOrEqual(scripts.count, 29)
        let mac = try ArchivesStore(path: directory.appendingPathComponent("desktop.sqlite").path, createSchema: false)
        try mac.dbQueue.write { db in
            for script in scripts { try db.execute(sql: String(contentsOf: script, encoding: .utf8)) }
        }
        try mac.enableDesktopSyncTracking()
        let note = Note(id: "phone-note", title: "Phone note", blocksJSON: "[]", plaintext: "searchable", createdAt: 1, updatedAt: 2)
        _ = try mac.applyIncoming(SyncPayload(deviceID: "phone", generatedAt: 2, notes: [note]), assetsDirPath: directory.path)
        XCTAssertEqual(try mac.displayNotes().first?.title, "Phone note")
        let phone = try ArchivesStore(path: directory.appendingPathComponent("phone.sqlite").path, createSchema: true)
        try phone.apply(mac.snapshot(deviceID: "mac", generatedAt: 3))
        XCTAssertEqual(try phone.displayNotes(), try mac.displayNotes())
        try mac.dbQueue.write { db in try db.execute(sql: "DELETE FROM notes WHERE id='phone-note'") }
        _ = try mac.applyIncoming(phone.snapshot(deviceID: "phone", generatedAt: 4), assetsDirPath: directory.path)
        XCTAssertTrue(try mac.displayNotes().isEmpty)
    }
}
