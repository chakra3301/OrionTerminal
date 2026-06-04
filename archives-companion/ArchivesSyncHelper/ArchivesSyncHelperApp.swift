import SwiftUI
import Foundation
import ArchivesCore
import ArchivesStore

// Lives in the menu bar (LSUIElement), no Dock icon. Advertises over Multipeer
// at launch and reads the same orion.db the Tauri desktop app uses.
//
// orion.db is opened READ-ONLY for now: the phone can pull the Mac's Archives,
// but writing the phone's changes back into the live desktop DB is deferred
// until the concurrent-write path (WAL + busy timeout, or a "close the desktop
// app" guard) is proven safe against real data.
@MainActor
final class HelperController: NSObject, NSApplicationDelegate, ObservableObject {
    let sync = MultipeerSync(displayName: Host.current().localizedName ?? "Mac")
    @Published var dbStatus = "starting…"
    private var store: ArchivesStore?

    // Streaming Claude state (all touched only on the main actor).
    private var streamBuffer = Data()
    private var streamSessionID: String?
    private var streamFinalText = ""
    private var streamErr = ""
    private var streamRequestID: String?
    private var streamProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureDB()
        sync.onPayload = { [weak self] payload in
            guard let self else { return }
            if let store = self.store {
                do {
                    let n = try store.applyIncomingNotes(payload)
                    var summary = "from phone: +\(n.upserted) edits, −\(n.deleted) deletes"
                    if let dir = Self.assetsDir() {
                        let m = try store.applyIncomingMedia(payload, assetsDirPath: dir.path)
                        if m.assets > 0 || m.boards > 0 { summary += " · +\(m.assets) photos, +\(m.boards) boards" }
                    }
                    self.dbStatus = summary
                } catch {
                    self.dbStatus = "write-back failed: \(error.localizedDescription)"
                }
            }
            // Send the Mac's fresh state back so the phone converges too (one-tap two-way),
            // then stream any image files the phone doesn't have yet.
            self.sync.sendSnapshot()
            self.sendMissingAssets(have: Set(payload.haveAssetIDs ?? []))
        }
        sync.onAssetFile = { [weak self] fileName, localURL in self?.receiveAssetFile(fileName: fileName, from: localURL) }
        sync.onChatRequest = { [weak self] id, prompt, sessionID in self?.runClaude(id: id, prompt: prompt, sessionID: sessionID) }
        sync.start()   // advertise/browse at launch — NOT from MenuBarExtra content
    }

    /// Stream the subscription Claude CLI (stream-json) for a prompt from the
    /// phone, resuming `sessionID` for multi-turn. stdout chunks are forwarded to
    /// the main actor so all parsing/state stays single-threaded. Augments PATH
    /// (a launchd agent gets a stripped one) and gives the child /dev/null stdin
    /// (else `claude --print` blocks waiting on an inherited stdin that never EOFs).
    private func runClaude(id: String, prompt: String, sessionID: String?) {
        streamProcess?.terminate()
        streamBuffer = Data(); streamSessionID = nil; streamFinalText = ""; streamErr = ""; streamRequestID = id

        let home = NSHomeDirectory()
        var env = ProcessInfo.processInfo.environment
        let extra = ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "\(home)/.claude/local"]
        env["PATH"] = (extra + [env["PATH"] ?? ""]).joined(separator: ":")

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var args = ["claude", "--print", "--output-format", "stream-json", "--verbose"]
        if let sid = sessionID, !sid.isEmpty { args += ["--resume", sid] }
        args += ["--", prompt]
        proc.arguments = args
        proc.environment = env
        proc.currentDirectoryURL = URL(fileURLWithPath: home)
        proc.standardInput = FileHandle.nullDevice
        let out = Pipe(); proc.standardOutput = out
        let errPipe = Pipe(); proc.standardError = errPipe
        streamProcess = proc

        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { @MainActor in self?.ingestStream(id: id, data: data) }
        }
        errPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let s = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.streamErr += s }
        }
        proc.terminationHandler = { [weak self] p in
            let code = p.terminationStatus
            Task { @MainActor in self?.finishStream(id: id, exitCode: code) }
        }

        do { try proc.run() }
        catch {
            streamRequestID = nil
            sync.sendChatError(id, message: "couldn't run claude — is the CLI on PATH? \(error.localizedDescription)")
        }
    }

    private func ingestStream(id: String, data: Data) {
        guard id == streamRequestID else { return }
        streamBuffer.append(data)
        // stream-json emits one complete JSON object per line.
        while let nl = streamBuffer.firstIndex(of: 0x0a) {
            let lineData = streamBuffer.subdata(in: streamBuffer.startIndex..<nl)
            streamBuffer.removeSubrange(streamBuffer.startIndex...nl)
            guard !lineData.isEmpty,
                  let obj = (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any] else { continue }
            if let sid = obj["session_id"] as? String { streamSessionID = sid }
            switch obj["type"] as? String {
            case "assistant":
                if let text = Self.assistantText(obj) {
                    streamFinalText = text                 // snapshots are full text → replace
                    sync.sendChatChunk(id, text: text)
                }
            case "result":
                if let r = obj["result"] as? String, !r.isEmpty { streamFinalText = r }
            default: break
            }
        }
    }

    private func finishStream(id: String, exitCode: Int32) {
        guard id == streamRequestID else { return }
        streamProcess = nil
        streamRequestID = nil
        if exitCode == 0 && !streamFinalText.isEmpty {
            sync.sendChatDone(id, text: streamFinalText, sessionID: streamSessionID)
        } else {
            sync.sendChatError(id, message: streamErr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                               ? "claude exited (\(exitCode))" : streamErr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private static func assistantText(_ obj: [String: Any]) -> String? {
        guard let msg = obj["message"] as? [String: Any],
              let content = msg["content"] as? [[String: Any]] else { return nil }
        let parts = content.compactMap { ($0["type"] as? String) == "text" ? $0["text"] as? String : nil }
        let joined = parts.joined()
        return joined.isEmpty ? nil : joined
    }

    private func sendMissingAssets(have: Set<String>) {
        guard let store, let dir = Self.assetsDir() else { return }
        guard let snap = try? store.snapshot(deviceID: "mac", generatedAt: 0) else { return }
        let files: [(name: String, url: URL)] = snap.assets.compactMap { a in
            guard a.kind == .image, !have.contains(a.id), let fn = a.fileName, !fn.isEmpty else { return nil }
            let url = dir.appendingPathComponent(fn)
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            // Skip very large files so a sync can't stall on a huge image.
            if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int64, size > 8_000_000 { return nil }
            return (fn, url)
        }
        sync.sendAssetFiles(files)
    }

    /// A phone-created image arrived — drop it into the Mac's assets dir (where
    /// orion.db's `file_path` points). Never overwrites an existing file.
    private func receiveAssetFile(fileName: String, from src: URL) {
        guard let dir = Self.assetsDir() else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(fileName)
        guard !FileManager.default.fileExists(atPath: dest.path) else { return }
        try? FileManager.default.copyItem(at: src, to: dest)
    }

    static func assetsDir() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("com.lucaorion.orion-terminal/assets", isDirectory: true)
    }

    private func configureDB() {
        guard let path = Self.orionDBPath() else {
            dbStatus = "couldn't locate Application Support"; useEmptyProvider(); return
        }
        guard FileManager.default.fileExists(atPath: path) else {
            dbStatus = "orion.db not found — open the desktop app once"; useEmptyProvider(); return
        }
        do {
            // Read/write so phone edits can flow back. Safe against the running
            // desktop app: SQLite multi-process locking + a 5s busy timeout, and
            // write-back uses conditional upserts in a transaction (no wholesale writes).
            let store = try ArchivesStore(path: path, createSchema: false, readOnly: false)
            self.store = store
            let count = (try? store.snapshot(deviceID: "mac", generatedAt: 0).notes.count) ?? 0
            dbStatus = "orion.db ready · \(count) notes (read/write)"
            sync.provideSnapshot = { [weak store] in
                var snap = (try? store?.snapshot(deviceID: "mac", generatedAt: Self.now()))
                    ?? SyncPayload(deviceID: "mac", generatedAt: Self.now())
                // "have" = the bytes are actually on disk (NOT just a row), so the
                // phone still sends a file for a row we just wrote but haven't received.
                if let dir = Self.assetsDir() {
                    snap.haveAssetIDs = snap.assets.compactMap { a in
                        guard let fn = a.fileName,
                              FileManager.default.fileExists(atPath: dir.appendingPathComponent(fn).path) else { return nil }
                        return a.id
                    }
                }
                return snap
            }
        } catch {
            dbStatus = "orion.db read error: \(error.localizedDescription)"; useEmptyProvider()
        }
    }

    private func useEmptyProvider() {
        sync.provideSnapshot = { SyncPayload(deviceID: "mac", generatedAt: Self.now()) }
    }

    static func now() -> Millis { Millis(Date().timeIntervalSince1970 * 1000) }

    static func orionDBPath() -> String? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("com.lucaorion.orion-terminal/orion.db").path
    }
}

@main
struct ArchivesSyncHelperApp: App {
    @NSApplicationDelegateAdaptor(HelperController.self) private var controller

    var body: some Scene {
        MenuBarExtra {
            MenuContent(controller: controller, sync: controller.sync)
        } label: {
            MenuBarLabel(sync: controller.sync)
        }
        .menuBarExtraStyle(.window)
    }
}

private struct MenuBarLabel: View {
    @ObservedObject var sync: MultipeerSync
    var body: some View {
        Image(systemName: sync.connectedPeers.isEmpty ? "arrow.triangle.2.circlepath" : "checkmark.icloud")
    }
}

private struct MenuContent: View {
    @ObservedObject var controller: HelperController
    @ObservedObject var sync: MultipeerSync

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Archives Sync").font(.headline)
            Text(controller.dbStatus).font(.caption).foregroundStyle(.secondary)
            Text(sync.status).font(.caption).foregroundStyle(.secondary)
            Divider()
            if sync.connectedPeers.isEmpty {
                Label("Waiting for iPhone…", systemImage: "iphone.gen3")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(sync.connectedPeers, id: \.self) { peer in
                    Label(peer.displayName, systemImage: "checkmark.circle.fill").font(.callout)
                }
                Button("Sync now") { sync.sendSnapshot() }
            }
            Divider()
            Button("Quit Archives Sync") { NSApplication.shared.terminate(nil) }
        }
        .padding(10)
        .frame(width: 260)
    }
}
