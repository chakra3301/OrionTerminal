import SwiftUI
import Foundation
import ArchivesCore
import ArchivesStore
import Darwin

@MainActor
final class HelperController: NSObject, NSApplicationDelegate, ObservableObject {
    let sync = MultipeerSync(displayName: Host.current().localizedName ?? "Mac")
    @Published var dbStatus = "Library access is off"
    @Published var errorMessage: String?
    @Published var enabled = false
    @Published var chatEnabled = false
    @Published var pendingImport: SyncPayload?
    @Published var importReview = ""
    private var store: ArchivesStore?
    private var process: Process?
    private var requestID: String?
    private var buffer = Data()
    private var answer = ""
    private var history: [(String, String)] = []
    private var timeout: Task<Void, Never>?
    private var backups: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.lucaorion.archives.synchelper/backups", isDirectory: true)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Pairing never implies permission to read the Mac's library or run a model.
        do {
            if try PairingSecret.load() == nil { try sync.pair(PairingSecret.generate()) }
        } catch { errorMessage = error.localizedDescription }
        sync.onPayload = { [weak self] payload in self?.reviewImport(payload) }
        sync.onAssetData = { [weak self] name, data in
            guard let self else { throw SyncSafetyError.invalid("Mac library unavailable.") }
            try self.receiveAsset(name, data: data)
        }
        sync.onChatRequest = { [weak self] id, prompt, _ in self?.runChat(id: id, prompt: prompt) }
        sync.onChatCancel = { [weak self] id in if self?.requestID == id { self?.cancelChat() } }
        sync.onDisconnected = { [weak self] in self?.cancelChat(); self?.history = []; self?.pendingImport = nil }
        sync.start()
    }
    func applicationWillTerminate(_ notification: Notification) { cancelChat(); sync.stop() }

    func enableLibrary() {
        do {
            let path = Self.orionDBPath()
            guard FileManager.default.fileExists(atPath: path.path) else { throw SyncSafetyError.invalid("Open Orion Terminal once before enabling sync.") }
            let opened = try ArchivesStore(path: path.path, createSchema: false)
            try makeBackup(opened)
            try opened.enableDesktopSyncTracking()
            store = opened; enabled = true
            sync.provideSnapshot = { [weak self] in
                guard let self, let store = self.store else { throw SyncSafetyError.invalid("Enable library access on your Mac.") }
                var snap = try store.snapshot(deviceID: "mac", generatedAt: Self.now())
                snap.haveAssetIDs = snap.assets.compactMap { asset in
                    guard let name = asset.fileName, let url = try? AssetSafety.url(name, in: Self.assetsDir()),
                          FileManager.default.fileExists(atPath: url.path) else { return nil }
                    return asset.id
                }
                return snap
            }
            dbStatus = "Library ready · backup before every import"
        } catch { errorMessage = error.localizedDescription; dbStatus = "Library access failed" }
    }
    func disableLibrary() {
        store = nil; enabled = false; sync.provideSnapshot = nil
        sync.stop(); dbStatus = "Library access is off"; sync.start()
    }
    func copyPairingKey() {
        do {
            guard let key = try PairingSecret.load() else { return }
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(key, forType: .string)
            let revision = NSPasteboard.general.changeCount
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(60))
                if NSPasteboard.general.changeCount == revision { NSPasteboard.general.clearContents() }
            }
        } catch { errorMessage = error.localizedDescription }
    }
    func rotatePairing() {
        do { try sync.pair(PairingSecret.generate()); history = []; cancelChat() }
        catch { errorMessage = error.localizedDescription }
    }
    private func makeBackup(_ store: ArchivesStore) throws {
        try FileManager.default.createDirectory(at: backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let url = backups.appendingPathComponent("\(Self.now())-\(UUID().uuidString).sqlite")
        try store.backup(to: url.path)
        let files = try FileManager.default.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "sqlite" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        for old in files.dropFirst(10) { try FileManager.default.removeItem(at: old) }
    }
    private func reviewImport(_ payload: SyncPayload) {
        guard let store else { sync.sendSyncError("Enable library access in Archives Sync on your Mac."); return }
        do {
            let local = try store.snapshot(deviceID: "mac", generatedAt: Self.now())
            let merged = MergeEngine.merge(local, payload)
            try merged.validate()
            let before = Dictionary(uniqueKeysWithValues: local.notes.map { ($0.id, $0) })
            let after = Set(merged.notes.map(\.id))
            let added = merged.notes.filter { before[$0.id] == nil }
            let changed = merged.notes.filter { before[$0.id] != nil && before[$0.id] != $0 }
            let deleted = local.notes.filter { !after.contains($0.id) }
            let lines = added.map { "Add: " + ($0.title.isEmpty ? "Untitled" : $0.title) }
                + changed.map { "Replace: " + ($0.title.isEmpty ? "Untitled" : $0.title) }
                + deleted.map { "Delete: " + ($0.title.isEmpty ? "Untitled" : $0.title) }
            importReview = "\(added.count) new · \(changed.count) changed · \(deleted.count) deleted notes\n"
                + "\(payload.assets.count) media records · \(payload.moodBoards.count) boards in phone snapshot\n\n"
                + lines.joined(separator: "\n")
            pendingImport = payload
            sync.sendSyncStatus("Review and approve the import in Archives Sync on your Mac.")
        } catch { sync.sendSyncError(error.localizedDescription) }
    }
    func approveImport() {
        guard let payload = pendingImport else { return }
        pendingImport = nil; receive(payload)
    }
    func rejectImport() {
        pendingImport = nil; sync.sendSyncError("Import cancelled on your Mac. No phone edits were applied.")
    }
    private func receive(_ payload: SyncPayload) {
        guard let store else { sync.sendSyncError("Enable library access in Archives Sync on your Mac."); return }
        do {
            guard !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "com.lucaorion.orion-terminal" }) else {
                throw SyncSafetyError.invalid("Quit Orion Terminal before importing phone edits, so an open desktop editor cannot overwrite them. Then tap Sync again.")
            }
            try makeBackup(store)
            let count = try store.applyIncoming(payload, assetsDirPath: Self.assetsDir().path)
            dbStatus = "Synced · \(count) note changes · \(Date().formatted(date: .omitted, time: .shortened))"
            sync.sendSnapshot()
            let have = Set(payload.haveAssetIDs ?? [])
            let snap = try store.snapshot(deviceID: "mac", generatedAt: Self.now())
            let files: [(name: String, url: URL)] = snap.assets.compactMap { asset in
                guard asset.kind == .image, !have.contains(asset.id), let name = asset.fileName,
                      let url = try? AssetSafety.url(name, in: Self.assetsDir()),
                      let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                      size <= AssetSafety.maxBytes else { return nil }
                return (name, url)
            }
            sync.sendAssetFiles(files)
        } catch {
            errorMessage = "Sync failed; backup retained: \(error.localizedDescription)"
            sync.sendSyncError(error.localizedDescription)
        }
    }
    private func receiveAsset(_ name: String, data: Data) throws {
        guard let store else { throw SyncSafetyError.invalid("Mac library access is disabled.") }
        do {
            let snapshot = try store.snapshot(deviceID: "mac", generatedAt: 0)
            guard snapshot.assets.contains(where: { $0.kind == .image && $0.fileName == name }) else {
                throw SyncSafetyError.invalid("Image has no library record. Sync the library first.")
            }
            try AssetSafety.publish(data, name: name, in: Self.assetsDir())
        } catch { errorMessage = error.localizedDescription; throw error }
    }

    func cancelChat() {
        timeout?.cancel(); timeout = nil
        let old = process
        requestID = nil; process = nil; buffer = Data(); answer = ""; history = []
        guard let old, old.isRunning else { return }
        old.terminate()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            if old.isRunning { kill(old.processIdentifier, SIGKILL) }
        }
    }
    private func runChat(id: String, prompt: String) {
        guard chatEnabled, process == nil else {
            sync.sendChatError(id, message: "Enable R.O.S.I.E on your Mac and wait for any active request to finish."); return
        }
        let home = NSHomeDirectory()
        let candidates = ["\(home)/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            sync.sendChatError(id, message: "Install Claude Code and sign in on your Mac first."); return
        }
        let auth = Process(), output = Pipe()
        auth.executableURL = URL(fileURLWithPath: executable)
        auth.arguments = ["auth", "status", "--json"]
        var env = ProcessInfo.processInfo.environment
        for key in Array(env.keys) where key.hasPrefix("ANTHROPIC_") || key.hasPrefix("CLAUDE_") || key.hasPrefix("CLAUDECODE") { env.removeValue(forKey: key) }
        auth.environment = env
        auth.standardInput = FileHandle.nullDevice; auth.standardOutput = output; auth.standardError = FileHandle.nullDevice
        requestID = id; process = auth
        do { try auth.run() } catch { cancelChat(); sync.sendChatError(id, message: "Couldn't check Claude sign-in on your Mac."); return }
        timeout = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(10)) } catch { return }
            guard let self, self.requestID == id else { return }
            self.sync.sendChatError(id, message: "Claude sign-in check timed out."); self.cancelChat()
        }
        Task.detached { [weak self] in
            var bytes = Data()
            while true {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                if bytes.count < 16_000 { bytes.append(chunk.prefix(16_000 - bytes.count)) }
            }
            auth.waitUntilExit()
            let status = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
            let subscription = auth.terminationStatus == 0 && status?["loggedIn"] as? Bool == true && status?["authMethod"] as? String == "claude.ai"
            await self?.finishAuth(id: id, prompt: prompt, subscription: subscription)
        }
    }
    private func finishAuth(id: String, prompt: String, subscription: Bool) {
        guard requestID == id else { return }
        timeout?.cancel(); timeout = nil; process = nil; requestID = nil
        guard subscription else {
            sync.sendChatError(id, message: "Sign in to a Claude subscription on your Mac (claude auth login). API-key billing is not used by this companion."); return
        }
        launchChat(id: id, prompt: prompt)
    }
    private func launchChat(id: String, prompt: String) {
        guard chatEnabled else { sync.sendChatError(id, message: "Enable R.O.S.I.E in Archives Sync on your Mac first."); return }
        guard process == nil else { sync.sendChatError(id, message: "Your Mac is already answering. Try again when it finishes."); return }
        let home = NSHomeDirectory()
        let candidates = ["\(home)/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            sync.sendChatError(id, message: "Install and sign in to Claude Code on your Mac to use R.O.S.I.E."); return
        }
        do {
            let work = FileManager.default.temporaryDirectory.appendingPathComponent("archives-chat-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: executable)
            proc.arguments = ["--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                              "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
                              "--setting-sources", "", "--no-session-persistence"]
            var env = ProcessInfo.processInfo.environment
            for key in Array(env.keys) where key.hasPrefix("ANTHROPIC_") || key.hasPrefix("CLAUDE_") || key.hasPrefix("CLAUDECODE") { env.removeValue(forKey: key) }
            env["PATH"] = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            proc.environment = env; proc.currentDirectoryURL = work
            let input = Pipe(), output = Pipe(), errors = Pipe()
            proc.standardInput = input; proc.standardOutput = output; proc.standardError = errors
            let context = history.suffix(6).map { "User: \($0.0)\nAssistant: \($0.1)" }.joined(separator: "\n\n")
            let text = "You are R.O.S.I.E, the Archives mobile companion. This is a text-only conversation. You have no tools or library access. Never claim to have read or changed files.\n\n\(context)\n\nUser: \(prompt)"
            requestID = id; process = proc; buffer = Data(); answer = ""
            try proc.run()
            // A worker feeds stdin so a long prompt cannot block the UI on pipe capacity.
            Task.detached {
                try? input.fileHandleForWriting.write(contentsOf: Data(text.utf8))
                try? input.fileHandleForWriting.close()
            }
            let stderrTask = Task.detached { () -> String in
                var bytes = Data()
                while true {
                    let chunk = errors.fileHandleForReading.availableData
                    if chunk.isEmpty { break }
                    if bytes.count < 4096 { bytes.append(chunk.prefix(4096 - bytes.count)) }
                }
                return String(decoding: bytes, as: UTF8.self)
            }
            Task.detached { [weak self] in
                while true {
                    let chunk = output.fileHandleForReading.availableData
                    if chunk.isEmpty { break }
                    await self?.ingest(id: id, data: chunk)
                }
                proc.waitUntilExit()
                let diagnostic = await stderrTask.value
                await self?.finish(id: id, prompt: prompt, exitCode: proc.terminationStatus, diagnostic: diagnostic)
                try? FileManager.default.removeItem(at: work)
            }
            timeout = Task { @MainActor [weak self] in
                do { try await Task.sleep(for: .seconds(180)) } catch { return }
                guard let self, self.requestID == id else { return }
                self.sync.sendChatError(id, message: "The Mac request timed out. Your next message starts fresh.")
                self.cancelChat()
            }
        } catch {
            cancelChat(); sync.sendChatError(id, message: "Could not start Claude. Check the Mac installation.")
        }
    }
    private func ingest(id: String, data: Data) {
        guard requestID == id else { return }
        guard buffer.count + data.count <= 2_000_000 else {
            sync.sendChatError(id, message: "Model output exceeded the safety limit."); cancelChat(); return
        }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            guard let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
            switch object["type"] as? String {
            case "stream_event":
                if let event = object["event"] as? [String: Any], let delta = event["delta"] as? [String: Any], let text = delta["text"] as? String {
                    answer += text
                    if answer.utf8.count > 200_000 { sync.sendChatError(id, message: "Reply exceeded the safety limit."); cancelChat(); return }
                    sync.sendChatChunk(id, text: answer)
                }
            case "assistant":
                if let message = object["message"] as? [String: Any], let parts = message["content"] as? [[String: Any]] {
                    let text = parts.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined(separator: "\n\n")
                    if !text.isEmpty { answer = String(text.prefix(200_000)); sync.sendChatChunk(id, text: answer) }
                }
            case "result":
                if object["is_error"] as? Bool == true {
                    sync.sendChatError(id, message: "Claude could not complete the request. Check authentication on your Mac."); cancelChat(); return
                }
                if let text = object["result"] as? String, !text.isEmpty { answer = String(text.prefix(200_000)) }
            default: break
            }
        }
    }
    private func finish(id: String, prompt: String, exitCode: Int32, diagnostic: String) {
        guard requestID == id else { return }
        if !buffer.isEmpty { ingest(id: id, data: Data([10])) }
        guard requestID == id else { return }
        timeout?.cancel(); timeout = nil; process = nil; requestID = nil
        if exitCode == 0, !answer.isEmpty {
            history.append((String(prompt.prefix(16_000)), String(answer.prefix(16_000))))
            history = Array(history.suffix(6))
            sync.sendChatDone(id, text: answer, sessionID: nil)
        } else {
            history = []
            sync.sendChatError(id, message: "Claude failed (\(exitCode)). Open Claude Code on your Mac and check sign-in; then retry.")
        }
    }
    static func now() -> Millis { Millis(Date().timeIntervalSince1970 * 1000) }
    static func orionDBPath() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.lucaorion.orion-terminal/orion.db")
    }
    static func assetsDir() -> URL { orionDBPath().deletingLastPathComponent().appendingPathComponent("assets", isDirectory: true) }
}

@main
struct ArchivesSyncHelperApp: App {
    @NSApplicationDelegateAdaptor(HelperController.self) private var controller
    var body: some Scene {
        MenuBarExtra("Archives Sync", systemImage: "arrow.triangle.2.circlepath") {
            MenuContent(controller: controller, sync: controller.sync)
        }.menuBarExtraStyle(.window)
    }
}
private struct MenuContent: View {
    @ObservedObject var controller: HelperController
    @ObservedObject var sync: MultipeerSync
    @State private var confirmRotation = false
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 12) {
            Label("Archives Sync", systemImage: "lock.shield").font(.headline)
            Text("Your library. Your devices.").font(.caption).foregroundStyle(.secondary)
            Text(sync.status).font(.callout)
            Divider()
            Button("Copy pairing key") { controller.copyPairingKey() }
            Text("Paste this key in Archives → Sync on your iPhone. Treat it like a password.").font(.caption).foregroundStyle(.secondary)
            Button("Replace pairing key…") { confirmRotation = true }
            Divider()
            Text(controller.dbStatus).font(.caption)
            if controller.enabled {
                Button("Sync library now") { sync.sendSnapshot() }.disabled(sync.connectedPeers.isEmpty)
                Button("Disable library access") { controller.disableLibrary() }
            } else {
                Button("Enable library sync") { controller.enableLibrary() }
                Text("Allows your paired phone to read and edit Archives. Quit Orion Terminal before importing phone edits. A local database backup is kept before each import.").font(.caption).foregroundStyle(.secondary)
            }
            if controller.pendingImport != nil {
                Divider()
                Text("Review phone import").font(.headline)
                ScrollView { Text(controller.importReview).font(.caption).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 180)
                Text("Older phone data may include items deleted before this helper tracked deletions. Approve only changes you recognize; a backup is kept.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Cancel", role: .cancel) { controller.rejectImport() }
                    Button("Approve import") { controller.approveImport() }
                }
            }
            Toggle("Allow R.O.S.I.E via Claude", isOn: $controller.chatEnabled)
                .onChange(of: controller.chatEnabled) { _, enabled in if !enabled { controller.cancelChat() } }
            Text("Opt-in text chat uses your Mac's Claude account. No model tools or automatic note uploads.").font(.caption).foregroundStyle(.secondary)
            if let error = controller.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                Button("Dismiss error") { controller.errorMessage = nil }
            }
            Divider()
            Button("Quit Archives Sync") { NSApplication.shared.terminate(nil) }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        }.frame(width: 360, height: 560)
        .confirmationDialog("Replace pairing key?", isPresented: $confirmRotation) {
            Button("Replace key", role: .destructive) { controller.rotatePairing() }
        } message: { Text("Disconnects the current phone. Paste the new key on your phone to reconnect.") }
    }
}
