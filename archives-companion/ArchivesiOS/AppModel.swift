import Foundation
import SwiftUI
import UIKit
import ArchivesCore
import ArchivesStore

/// Owns the phone's local store + the Multipeer transport, and republishes the
/// note list for the UI. A received payload is merged into the local DB and
/// persisted, so synced content survives relaunch.
@MainActor
final class AppModel: ObservableObject {
    let sync: MultipeerSync
    private let store: ArchivesStore
    private let assetCacheDir: URL

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
        let dir = try! FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        store = try! ArchivesStore(path: dir.appendingPathComponent("archives.sqlite").path, createSchema: true)
        assetCacheDir = dir.appendingPathComponent("asset-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: assetCacheDir, withIntermediateDirectories: true)
        sync = MultipeerSync(displayName: UIDevice.current.name)

        try? store.seedWelcomeIfEmpty(now: Self.now())
        reload()

        sync.provideSnapshot = { [weak self] in
            guard let self else { return SyncPayload(deviceID: "iphone", generatedAt: Self.now()) }
            var snap = (try? self.store.snapshot(deviceID: "iphone", generatedAt: Self.now()))
                ?? SyncPayload(deviceID: "iphone", generatedAt: Self.now())
            snap.haveAssetIDs = self.cachedAssetIDs()   // so the Mac skips images we already have
            return snap
        }
        sync.onPayload = { [weak self] remote in self?.receive(remote) }
        sync.onAssetFile = { [weak self] fileName, localURL in self?.cacheAssetFile(fileName: fileName, from: localURL) }
        sync.onChatChunk = { [weak self] id, text in self?.rosieChunk(id: id, text: text) }
        sync.onChatDone = { [weak self] id, text, sessionID in self?.rosieDone(id: id, text: text, sessionID: sessionID) }
        sync.onChatError = { [weak self] id, message in self?.rosieError(id: id, message: message) }
        sync.onDisconnected = { [weak self] in self?.rosieDisconnected() }
        sync.start()
    }

    func reload() {
        guard let snap = try? store.snapshot(deviceID: "iphone", generatedAt: Self.now()) else { return }
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
        try? store.deleteNotes(ids: toDelete, deletedAt: Self.now())
        reload()
    }

    // MARK: editing — persist without a full reload (the editor owns live state);
    // the list refreshes when the editor screen is dismissed.

    func createNote(_ kind: NoteKind, parentID: String? = nil) -> Note {
        let id = UUID().uuidString
        return (try? store.createNote(id: id, kind: kind, parentID: parentID, now: Self.now()))
            ?? Note(id: id, title: "", blocksJSON: "[]", plaintext: "", parentID: parentID, kind: kind, createdAt: Self.now(), updatedAt: Self.now())
    }

    func saveBody(_ id: String, blocksJSON: String, plaintext: String) {
        try? store.updateNoteBody(id: id, blocksJSON: blocksJSON, plaintext: plaintext, updatedAt: Self.now())
    }

    func saveTitle(_ id: String, _ title: String) {
        try? store.updateNoteTitle(id: id, title: title, updatedAt: Self.now())
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
        let url = assetCacheDir.appendingPathComponent(fn)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func cachedAssetIDs() -> [String] { assets.compactMap { cachedAssetURL(for: $0) != nil ? $0.id : nil } }

    private func cacheAssetFile(fileName: String, from src: URL) {
        let dest = assetCacheDir.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: dest)
        if (try? FileManager.default.copyItem(at: src, to: dest)) != nil { assetRevision += 1 }
    }

    // MARK: creating assets / mood boards (phone-side; persists locally + survives
    // sync via merge — pushing these to the Mac is the next step).

    func importImage(_ data: Data) {
        let (ext, mime) = Self.imageKind(data)
        let id = UUID().uuidString
        let fileName = "\(id).\(ext)"
        do {
            try data.write(to: assetCacheDir.appendingPathComponent(fileName))
            _ = try store.createAsset(id: id, kind: .image, fileName: fileName, mimeType: mime,
                                      sizeBytes: Int64(data.count), originalName: fileName, now: Self.now())
            assetRevision += 1
            reload()
        } catch { }
    }

    @discardableResult
    func createBoard(_ title: String) -> MoodBoard? {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = try? store.createMoodBoard(id: UUID().uuidString, title: t.isEmpty ? "Untitled" : t, now: Self.now())
        reload(); return b
    }
    func addToBoard(_ boardID: String, assetID: String) { try? store.addAssetToBoard(boardID: boardID, assetID: assetID, now: Self.now()); reload() }
    func removeFromBoard(_ boardID: String, assetID: String) { try? store.removeAssetFromBoard(boardID: boardID, assetID: assetID, now: Self.now()); reload() }
    func deleteBoard(_ id: String) { try? store.deleteMoodBoard(id: id, now: Self.now()); reload() }

    static func imageKind(_ d: Data) -> (ext: String, mime: String) {
        let p = [UInt8](d.prefix(4))
        if p.count >= 4, p[0] == 0x89, p[1] == 0x50, p[2] == 0x4E, p[3] == 0x47 { return ("png", "image/png") }
        return ("jpg", "image/jpeg")
    }

    private func receive(_ remote: SyncPayload) {
        guard let local = try? store.snapshot(deviceID: "iphone", generatedAt: Self.now()) else { return }
        let merged = MergeEngine.merge(local, remote)
        do {
            try store.apply(merged)
            reload()
            lastSyncSummary = "Synced · \(merged.notes.count) notes, \(merged.assets.count) assets"
            // Push our local photos the Mac doesn't have the bytes for yet.
            let macHas = Set(remote.haveAssetIDs ?? [])
            let toSend: [(name: String, url: URL)] = assets.compactMap { a in
                guard !macHas.contains(a.id), let url = cachedAssetURL(for: a), let fn = a.fileName else { return nil }
                return (fn, url)
            }
            if !toSend.isEmpty { sync.sendAssetFiles(toSend) }
        } catch {
            lastSyncSummary = "Merge failed: \(error.localizedDescription)"
        }
    }

    // MARK: R.O.S.I.E — routed through the Mac helper (subscription Claude CLI)

    func askRosie(_ prompt: String) {
        let p = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !p.isEmpty else { return }
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
        sync.sendChatRequest(reqID, prompt: p, sessionID: rosieSessionID)
        // Safety net: never hang forever on "thinking" if the link drops silently.
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
            guard let self, self.pendingRequestID == reqID else { return }
            self.rosieError(id: reqID, message: "R.O.S.I.E didn't respond — check the Mac connection and try again.")
        }
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
