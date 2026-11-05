import Foundation
import SwiftUI
import UIKit
import ImageIO
import ArchivesCore
import ArchivesStore

/// Owns the phone's local store + the Multipeer transport, and republishes the
/// note list for the UI. A received payload is merged into the local DB and
/// persisted, so synced content survives relaunch.
@MainActor
final class AppModel: ObservableObject {
    let sync: MultipeerSync
    private var store: ArchivesStore?
    private let assetCacheDir: URL
    private let draftsDir: URL
    @Published var errorMessage: String?
    @Published var pendingDrafts: [String: Note] = [:]
    @Published var openEditors: Set<UUID> = []
    @Published var saveStatus = "Saved on this iPhone"
    var libraryAvailable: Bool { store != nil }

    @Published var notes: [Note] = []
    @Published var assets: [Asset] = []
    @Published var collections: [NoteCollection] = []
    @Published var moodBoards: [MoodBoard] = []
    @Published var boardMembers: [String: [Asset]] = [:]
    @Published var tags: [Tag] = []
    @Published var noteTagMap: [String: [String]] = [:]
    @Published private(set) var assetRevision = 0
    @Published var lastSyncSummary: String = ""

    @Published var chat: [RosieMessage] = []
    @Published var rosieRunning = false
    private var pendingRequestID: String?
    private var rosieSessionID: String?   // Claude session for multi-turn follow-ups

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        assetCacheDir = dir.appendingPathComponent("asset-cache", isDirectory: true)
        draftsDir = dir.appendingPathComponent("drafts-v2", isDirectory: true)
        sync = MultipeerSync(displayName: UIDevice.current.name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            store = try ArchivesStore(path: dir.appendingPathComponent("archives.sqlite").path, createSchema: true)
            try FileManager.default.createDirectory(at: assetCacheDir, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: draftsDir, withIntermediateDirectories: true)
            for file in try FileManager.default.contentsOfDirectory(at: draftsDir, includingPropertiesForKeys: nil) where file.pathExtension == "json" {
                let note = try JSONDecoder().decode(Note.self, from: Data(contentsOf: file))
                guard AssetSafety.validName(note.id) else { throw SyncSafetyError.invalid("Invalid recovery draft; original file preserved.") }
                pendingDrafts[note.id] = note
            }
        } catch { errorMessage = "Library needs attention: \(error.localizedDescription)" }
        reload()
        if !pendingDrafts.isEmpty { saveStatus = "Recovered drafts need review" }

        sync.provideSnapshot = { [weak self] in
            guard let self, let store = self.store else { throw SyncSafetyError.invalid("Phone library unavailable.") }
            guard self.pendingDrafts.isEmpty, self.openEditors.isEmpty else { throw SyncSafetyError.invalid("Close the editor and save or recover pending drafts before syncing.") }
            var snap = try store.snapshot(deviceID: "iphone", generatedAt: Self.now())
            snap.haveAssetIDs = self.cachedAssetIDs()   // so the Mac skips images we already have
            return snap
        }
        sync.onPayload = { [weak self] remote in self?.receive(remote) }
        sync.onAssetData = { [weak self] fileName, data in
            guard let self else { throw SyncSafetyError.invalid("Phone library unavailable.") }
            try self.cacheAssetFile(fileName: fileName, data: data)
        }
        sync.onChatChunk = { [weak self] id, text in self?.rosieChunk(id: id, text: text) }
        sync.onChatDone = { [weak self] id, text, sessionID in self?.rosieDone(id: id, text: text, sessionID: sessionID) }
        sync.onChatError = { [weak self] id, message in self?.rosieError(id: id, message: message) }
        sync.onDisconnected = { [weak self] in self?.rosieDisconnected() }
        sync.start()
    }

    func reload() {
        guard let store else { return }
        let snap: SyncPayload
        do { snap = try store.snapshot(deviceID: "iphone", generatedAt: Self.now()) }
        catch { self.store = nil; errorMessage = "Couldn't read the library. Restart Archives to retry; no database was replaced. \(error.localizedDescription)"; return }
        notes = snap.notes.sorted { $0.updatedAt > $1.updatedAt }
        assets = snap.assets.sorted { $0.createdAt > $1.createdAt }
        collections = snap.collections
        moodBoards = snap.moodBoards.sorted { $0.updatedAt > $1.updatedAt }

        let assetByID = Dictionary(snap.assets.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var members: [String: [Asset]] = [:]
        for r in snap.moodBoardAssets.sorted(by: { $0.position < $1.position }) {
            if let a = assetByID[r.assetID] { members[r.boardID, default: []].append(a) }
        }
        boardMembers = members

        tags = snap.tags
        let tagName = Dictionary(snap.tags.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        var tagMap: [String: [String]] = [:]
        for nt in snap.noteTags { if let n = tagName[nt.tagID] { tagMap[nt.noteID, default: []].append(n) } }
        noteTagMap = tagMap
    }

    func notes(of kind: NoteKind) -> [Note] { notes.filter { $0.kind == kind } }

    // MARK: projects (nested pages via parent_id) + mood boards

    func projectRoots() -> [Note] {
        let projects = notes(of: .project)
        let ids = Set(projects.map(\.id))
        return projects.filter { $0.parentID == nil || !ids.contains($0.parentID!) }
    }
    func projectChildren(of id: String) -> [Note] { notes(of: .project).filter { $0.parentID == id } }
    func members(of boardID: String) -> [Asset] { boardMembers[boardID] ?? [] }

    func deleteNote(_ id: String) {
        // Cascade to descendants (project subpages).
        var toDelete = [id]
        var queue = [id]
        while let cur = queue.popLast() {
            for child in notes where child.parentID == cur && !toDelete.contains(child.id) {
                toDelete.append(child.id); queue.append(child.id)
            }
        }
        guard openEditors.isEmpty, !toDelete.contains(where: { pendingDrafts[$0] != nil }) else {
            errorMessage = "Save or recover drafts and close the editor before deleting."; return
        }
        perform { try requiredStore().deleteNotes(ids: toDelete, deletedAt: Self.now()) }
        reload()
    }

    // MARK: editing — persist without a full reload (the editor owns live state);
    // the list refreshes when the editor screen is dismissed.

    func createNote(_ kind: NoteKind, parentID: String? = nil) -> Note? {
        do {
            let note = try requiredStore().createNote(id: UUID().uuidString, kind: kind, parentID: parentID, now: Self.now())
            reload(); return note
        } catch { errorMessage = error.localizedDescription; return nil }
    }
    private func requiredStore() throws -> ArchivesStore {
        guard let store else { throw SyncSafetyError.invalid("Library unavailable. Your existing database has not been replaced.") }
        return store
    }
    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
    func saveBody(_ id: String, blocksJSON: String, plaintext: String) {
        guard var note = pendingDrafts[id] ?? notes.first(where: { $0.id == id }) else { errorMessage = "Note is unavailable; do not close the editor."; return }
        note.blocksJSON = blocksJSON; note.plaintext = plaintext
        stage(note)
    }
    func saveTitle(_ id: String, _ title: String) {
        guard var note = pendingDrafts[id] ?? notes.first(where: { $0.id == id }) else { errorMessage = "Note is unavailable; do not close the editor."; return }
        note.title = title; stage(note)
    }
    private func stage(_ input: Note, refreshTimestamp: Bool = true) {
        var note = input
        if refreshTimestamp { note.updatedAt = max(Self.now(), input.updatedAt + 1) }
        pendingDrafts[note.id] = note
        saveStatus = "Saving…"
        do {
            let file = try AssetSafety.url(note.id + ".json", in: draftsDir)
            try JSONEncoder().encode(note).write(to: file, options: [.atomic, .completeFileProtection])
            try requiredStore().saveNote(note)
            try FileManager.default.removeItem(at: file)
            pendingDrafts.removeValue(forKey: note.id)
            if let index = notes.firstIndex(where: { $0.id == note.id }) { notes[index] = note }
            saveStatus = pendingDrafts.isEmpty ? "Saved on this iPhone" : "Some drafts still need saving"
        } catch {
            saveStatus = "Not saved · draft retained"
            errorMessage = "Couldn't save: \(error.localizedDescription)"
        }
    }
    func retryDrafts() {
        for note in Array(pendingDrafts.values) { stage(note, refreshTimestamp: false) }
        if pendingDrafts.isEmpty { errorMessage = nil }
    }
    func recoverDraftCopies() {
        for original in Array(pendingDrafts.values) {
            do {
                let store = try requiredStore()
                var copy = try store.createNote(id: UUID().uuidString, kind: original.kind, now: Self.now())
                copy.title = original.title + " (Recovered)"; copy.blocksJSON = original.blocksJSON; copy.plaintext = original.plaintext
                try store.saveNote(copy)
                let file = try AssetSafety.url(original.id + ".json", in: draftsDir)
                if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
                pendingDrafts.removeValue(forKey: original.id)
            } catch { errorMessage = error.localizedDescription; return }
        }
        reload(); saveStatus = "Recovered as new notes"; errorMessage = nil
    }

    func syncNow() { sync.sendSnapshot() }

    // MARK: tags / collections (filtering)

    func tags(for noteID: String) -> [String] { noteTagMap[noteID] ?? [] }

    func collectionColor(_ raw: String) -> Color {
        let s = raw.lowercased()
        if s.contains("green") { return Theme.green }
        if s.contains("cyan") { return Theme.cyan }
        if s.contains("yellow") { return Theme.yellow }
        if s.contains("magenta") { return Theme.magenta }
        if s.contains("violet") { return Theme.violet }
        return Theme.tSecondary
    }

    // MARK: asset byte cache (images synced from the Mac)

    func cachedAssetURL(for asset: Asset) -> URL? {
        guard let fn = asset.fileName, !fn.isEmpty else { return nil }
        guard let url = try? AssetSafety.url(fn, in: assetCacheDir) else { return nil }
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func cachedAssetIDs() -> [String] { assets.compactMap { cachedAssetURL(for: $0) != nil ? $0.id : nil } }

    private func cacheAssetFile(fileName: String, data: Data) throws {
        do {
            guard assets.contains(where: { $0.fileName == fileName && $0.kind == .image }) else { throw SyncSafetyError.invalid("Received image without a library record.") }
            try AssetSafety.publish(data, name: fileName, in: assetCacheDir)
            assetRevision += 1
        } catch { errorMessage = error.localizedDescription; throw error }
    }

    func importImage(_ data: Data) {
        do {
            guard data.count <= 64_000_000,
                  let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 2048
                  ] as CFDictionary) else { throw SyncSafetyError.invalid("Couldn't decode this photo. Choose an image under 64 MB.") }
            let image = UIImage(cgImage: thumbnail)
            let opaque = [CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains(thumbnail.alphaInfo)
            guard let bytes = opaque ? image.jpegData(compressionQuality: 0.86) : image.pngData(), bytes.count <= AssetSafety.maxBytes else {
                throw SyncSafetyError.invalid("Photo is still too large after resizing. Choose a smaller image.")
            }
            let (ext, mime) = Self.imageKind(bytes)
            let id = UUID().uuidString, fileName = "\(id).\(ext)"
            try AssetSafety.publish(bytes, name: fileName, in: assetCacheDir)
            do {
                _ = try requiredStore().createAsset(id: id, kind: .image, fileName: fileName, mimeType: mime,
                    sizeBytes: Int64(bytes.count), originalName: fileName, now: Self.now())
            } catch {
                try? FileManager.default.removeItem(at: AssetSafety.url(fileName, in: assetCacheDir))
                throw error
            }
            assetRevision += 1; reload()
        } catch { errorMessage = error.localizedDescription }
    }

    @discardableResult
    func createBoard(_ title: String) -> MoodBoard? {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let board = try requiredStore().createMoodBoard(id: UUID().uuidString, title: t.isEmpty ? "Untitled" : t, now: Self.now())
            reload(); return board
        } catch { errorMessage = error.localizedDescription; return nil }
    }
    func addToBoard(_ boardID: String, assetID: String) { perform { try requiredStore().addAssetToBoard(boardID: boardID, assetID: assetID, now: Self.now()) }; reload() }
    func removeFromBoard(_ boardID: String, assetID: String) { perform { try requiredStore().removeAssetFromBoard(boardID: boardID, assetID: assetID, now: Self.now()) }; reload() }
    func deleteBoard(_ id: String) { perform { try requiredStore().deleteMoodBoard(id: id, now: Self.now()) }; reload() }

    static func imageKind(_ d: Data) -> (ext: String, mime: String) {
        let p = [UInt8](d.prefix(4))
        if p.count >= 4, p[0] == 0x89, p[1] == 0x50, p[2] == 0x4E, p[3] == 0x47 { return ("png", "image/png") }
        return ("jpg", "image/jpeg")
    }

    private func receive(_ remote: SyncPayload) {
        guard openEditors.isEmpty, pendingDrafts.isEmpty else {
            lastSyncSummary = "Sync paused · close the editor and save or recover drafts first."
            sync.sendSyncError(lastSyncSummary); return
        }
        do {
            let store = try requiredStore()
            let local = try store.snapshot(deviceID: "iphone", generatedAt: Self.now())
            var merged = MergeEngine.merge(local, remote)
            // Collections and tags are read-only on the phone; the Mac is authoritative.
            merged.collections = remote.collections; merged.tags = remote.tags
            let noteIDs = Set(merged.notes.map(\.id)), assetIDs = Set(merged.assets.map(\.id))
            merged.noteTags = remote.noteTags.filter { noteIDs.contains($0.noteID) }
            merged.assetTags = remote.assetTags.filter { assetIDs.contains($0.assetID) }
            let collectionIDs = Set(remote.collections.map(\.id))
            merged.notes = merged.notes.map { note in
                var note = note
                if let collection = note.collectionID, !collectionIDs.contains(collection) { note.collectionID = nil }
                return note
            }
            let directory = draftsDir.deletingLastPathComponent().appendingPathComponent("sync-backups", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try store.backup(to: directory.appendingPathComponent("\(Self.now())-\(UUID().uuidString).sqlite").path)
            try store.apply(merged)
            reload()
            guard libraryAvailable else { throw SyncSafetyError.invalid("Sync was saved but the library couldn't refresh. Restart Archives.") }
            do {
                let backups = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                    .filter { $0.pathExtension == "sqlite" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
                for old in backups.dropFirst(10) { try FileManager.default.removeItem(at: old) }
            } catch { errorMessage = "Sync saved. Old backup cleanup needs attention: \(error.localizedDescription)" }
            lastSyncSummary = "Synced · \(merged.notes.count) notes, \(merged.assets.count) assets"
            sync.confirmSync(lastSyncSummary)
            // Push our local photos the Mac doesn't have the bytes for yet.
            let macHas = Set(remote.haveAssetIDs ?? [])
            let toSend: [(name: String, url: URL)] = assets.compactMap { a in
                guard !macHas.contains(a.id), let url = cachedAssetURL(for: a), let fn = a.fileName else { return nil }
                return (fn, url)
            }
            if !toSend.isEmpty { sync.sendAssetFiles(toSend) }
        } catch {
            lastSyncSummary = "Merge failed: \(error.localizedDescription)"
            sync.sendSyncError(lastSyncSummary)
        }
    }

    // MARK: R.O.S.I.E — routed through the Mac helper (subscription Claude CLI)

    func askRosie(_ prompt: String) {
        let p = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !p.isEmpty, !rosieRunning else { return }
        guard p.utf8.count <= 32_000 else { errorMessage = "Keep messages under 32 KB."; return }
        guard !sync.connectedPeers.isEmpty else {
            chat.append(RosieMessage(role: .user, text: p))
            chat.append(RosieMessage(role: .assistant, text: "Connect to your Mac (Sync) to use R.O.S.I.E — she runs on your Mac.", failed: true))
            return
        }
        chat.append(RosieMessage(role: .user, text: p))
        chat.append(RosieMessage(role: .assistant, text: "", pending: true))
        let reqID = UUID().uuidString
        pendingRequestID = reqID
        rosieRunning = true
        UIApplication.shared.isIdleTimerDisabled = true   // don't auto-lock mid-wait (would suspend & drop the link)
        guard sync.sendChatRequest(reqID, prompt: p, sessionID: nil) else {
            rosieError(id: reqID, message: "Message wasn't sent. Reconnect to your Mac and retry."); return
        }
        // Safety net: never hang forever on "thinking" if the link drops silently.
        DispatchQueue.main.asyncAfter(deadline: .now() + 190) { [weak self] in
            guard let self, self.pendingRequestID == reqID else { return }
            self.sync.sendChatCancel(reqID)
            self.rosieError(id: reqID, message: "R.O.S.I.E didn't respond — check the Mac connection and try again.")
        }
    }

    func stopRosie() {
        guard let id = pendingRequestID else { return }
        sync.sendChatCancel(id)
        rosieError(id: id, message: "Stopped. Your next message starts fresh.")
    }

    private func rosieChunk(id: String, text: String) {
        guard id == pendingRequestID else { return }
        if let idx = chat.lastIndex(where: { $0.role == .assistant && $0.pending }) { chat[idx].text = text }
    }
    private func rosieDone(id: String, text: String, sessionID: String?) {
        guard id == pendingRequestID else { return }
        if let sessionID { rosieSessionID = sessionID }
        finishRosie { if !text.isEmpty { $0.text = text }; $0.pending = false }
    }
    private func rosieError(id: String, message: String) {
        guard id == pendingRequestID else { return }
        rosieSessionID = nil   // a bad/expired session shouldn't poison future turns
        finishRosie { $0.text = message; $0.pending = false; $0.failed = true }
    }
    private func rosieDisconnected() {
        if let id = pendingRequestID { rosieError(id: id, message: "Lost connection to your Mac. Reconnect and try again.") }
    }
    private func finishRosie(_ update: (inout RosieMessage) -> Void) {
        pendingRequestID = nil
        rosieRunning = false
        UIApplication.shared.isIdleTimerDisabled = false
        if let idx = chat.lastIndex(where: { $0.role == .assistant && $0.pending }) { update(&chat[idx]) }
    }

    static func now() -> Millis { Millis(Date().timeIntervalSince1970 * 1000) }
}

struct RosieMessage: Identifiable, Equatable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    var text: String
    var pending: Bool = false
    var failed: Bool = false
}
