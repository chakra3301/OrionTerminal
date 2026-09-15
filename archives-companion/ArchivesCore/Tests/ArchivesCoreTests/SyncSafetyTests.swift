import XCTest
@testable import ArchivesCore

final class SyncSafetyTests: XCTestCase {
    private let secret = String(repeating: "ab", count: 32)
    func testAuthenticatedRoundTripAndReplayRejection() throws {
        var phone = try SecureChannel(secret: secret, role: .phone)
        var mac = try SecureChannel(secret: secret, role: .mac)
        let message = try phone.seal(Data("private notes".utf8), recipientChallenge: mac.challenge)
        XCTAssertEqual(try mac.open(message), Data("private notes".utf8))
        XCTAssertThrowsError(try mac.open(message))
        let reply = try mac.seal(Data("reply".utf8), recipientChallenge: phone.challenge)
        XCTAssertEqual(try phone.open(reply), Data("reply".utf8))
    }
    func testWrongKeyAndOldConnectionRejected() throws {
        var phone = try SecureChannel(secret: secret, role: .phone)
        let old = try SecureChannel(secret: secret, role: .mac)
        var next = try SecureChannel(secret: secret, role: .mac)
        var wrong = try SecureChannel(secret: String(repeating: "cd", count: 32), role: .mac, challenge: old.challenge)
        let message = try phone.seal(Data("secret".utf8), recipientChallenge: old.challenge)
        XCTAssertThrowsError(try next.open(message))
        XCTAssertThrowsError(try wrong.open(message))
    }
    func testReflectionAndTamperingRejected() throws {
        var phone = try SecureChannel(secret: secret, role: .phone)
        var mac = try SecureChannel(secret: secret, role: .mac)
        let reflected = try phone.seal(Data("ready".utf8), recipientChallenge: phone.challenge)
        XCTAssertThrowsError(try phone.open(reflected))
        var changed = try phone.seal(Data("notes".utf8), recipientChallenge: mac.challenge)
        changed[changed.count - 1] ^= 1
        XCTAssertThrowsError(try mac.open(changed))
    }
    func testInvalidKeyRejected() {
        for key in ["", "123456", String(repeating: "g", count: 64), String(repeating: "é", count: 64)] {
            XCTAssertThrowsError(try SecureChannel(secret: key, role: .phone))
        }
    }
    func testAssetTraversalSymlinkAndOverwriteRefused() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        for name in ["../secret", "/tmp/secret", "..", ".", "a/b", "a\\b", "x\n", ""] {
            XCTAssertThrowsError(try AssetSafety.url(name, in: root))
        }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside.appendingPathComponent("file"))
        XCTAssertThrowsError(try AssetSafety.url("escape", in: root))
        try AssetSafety.publish(Data([1, 2]), name: "photo.jpg", in: root)
        try AssetSafety.publish(Data([1, 2]), name: "photo.jpg", in: root)
        XCTAssertThrowsError(try AssetSafety.publish(Data([9]), name: "photo.jpg", in: root))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("photo.jpg")), Data([1, 2]))
    }
    func testMalformedSnapshotRejectedBeforeMerge() throws {
        let note = Note(id: "n", title: "a", blocksJSON: "[]", plaintext: "", createdAt: 1, updatedAt: 2)
        XCTAssertThrowsError(try SyncPayload(deviceID: "p", generatedAt: 0, notes: [note, note]).validate())
        XCTAssertThrowsError(try SyncPayload(deviceID: "p", generatedAt: 0, schemaVersion: 1).validate())
        var cyclic = note; cyclic.parentID = cyclic.id
        XCTAssertThrowsError(try SyncPayload(deviceID: "p", generatedAt: 0, notes: [cyclic]).validate())
        var broken = note; broken.blocksJSON = "not json"
        XCTAssertThrowsError(try SyncPayload(deviceID: "p", generatedAt: 0, notes: [broken]).validate())
        XCTAssertThrowsError(try SyncPayload(deviceID: "p", generatedAt: 0, assets: [Asset(id: "a", kind: .image, fileName: "../x", createdAt: 0)]).validate())
    }
    func testEqualTimestampMergeIsCommutative() {
        let a = Note(id: "n", title: "a", blocksJSON: "[]", plaintext: "a", createdAt: 1, updatedAt: 2)
        var b = a; b.title = "b"; b.plaintext = "b"
        let one = SyncPayload(deviceID: "a", generatedAt: 2, notes: [a])
        let two = SyncPayload(deviceID: "b", generatedAt: 2, notes: [b])
        XCTAssertEqual(MergeEngine.merge(one, two).notes, MergeEngine.merge(two, one).notes)
    }
    func testDeletedOwnersDropJoinRowsAndOrphanParent() {
        let child = Note(id: "child", title: "child", blocksJSON: "[]", plaintext: "", parentID: "parent", createdAt: 1, updatedAt: 2)
        let payload = SyncPayload(deviceID: "a", generatedAt: 2, notes: [child], tags: [Tag(id: "t", name: "tag")],
                                  noteTags: [NoteTag(noteID: "missing", tagID: "t")])
        let merged = MergeEngine.merge(payload, SyncPayload(deviceID: "b", generatedAt: 2))
        XCTAssertTrue(merged.noteTags.isEmpty)
        XCTAssertNil(merged.notes.first?.parentID)
    }
}
