import SwiftUI
import ArchivesCore

struct RootView: View {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            TodayView(model: model).tabItem { Label("Today", systemImage: "sun.max") }
            NotesView(model: model).tabItem { Label("Notes", systemImage: "note.text") }
            JournalView(model: model).tabItem { Label("Journal", systemImage: "book.closed") }
            LibraryView(model: model).tabItem { Label("Library", systemImage: "square.stack") }
            RosieView(model: model, sync: model.sync).tabItem { Label("R.O.S.I.E", systemImage: "sparkles") }
        }
        .tint(Theme.green)
        .preferredColorScheme(.dark)
        .disabled(!model.libraryAvailable)
        .safeAreaInset(edge: .top) {
            if model.errorMessage != nil || !model.pendingDrafts.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(model.errorMessage ?? "Recovered drafts need review", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Theme.tPrimary)
                    if !model.pendingDrafts.isEmpty {
                        HStack {
                            Button("Retry saving") { model.retryDrafts() }
                            Button("Recover as new notes") { model.recoverDraftCopies() }
                        }.font(.caption.bold()).tint(Theme.green)
                    } else if model.libraryAvailable {
                        Button("Dismiss") { model.errorMessage = nil }.font(.caption)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.bg2)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.stopRosie() }
            if phase == .active { model.sync.start() }
        }
    }
}

struct SyncView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var sync: MultipeerSync
    @State private var pairingKey = ""
    @State private var pairingError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "lock.shield").font(.system(size: 32)).foregroundStyle(Theme.green)
                        Text("Your library.\nYour devices.").font(Theme.display(30, .bold)).foregroundStyle(Theme.tPrimary)
                        Text("Local-first. Encrypted. No cloud account.").font(.subheadline).foregroundStyle(Theme.tSecondary)
                    }.padding(.vertical, 12)
                    DashCard(title: sync.paired ? "Pairing key saved" : "Pair your Mac", accent: Theme.cyan) {
                        Text("Open the updated Archives Sync helper on your Mac → Copy pairing key. Paste it here once.")
                            .font(.subheadline).foregroundStyle(Theme.tSecondary)
                        SecureField("Mac pairing key", text: $pairingKey)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                            .accessibilityLabel("64-character Mac pairing key")
                        Button(sync.paired ? "Replace pairing" : "Save pairing") {
                            do { try sync.pair(pairingKey); pairingKey = ""; pairingError = nil }
                            catch { pairingError = error.localizedDescription }
                        }.disabled(pairingKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if let pairingError { Text(pairingError).font(.caption).foregroundStyle(Theme.magenta) }
                        Text("Replacing the key disconnects this phone. Keep the key private.").font(.caption).foregroundStyle(Theme.tTertiary)
                    }
                    DashCard(title: "Status") {
                        Text(sync.status).font(.system(size: 13)).foregroundStyle(Theme.tSecondary)
                        if !model.lastSyncSummary.isEmpty {
                            Label(model.lastSyncSummary, systemImage: model.lastSyncSummary.hasPrefix("Synced") ? "checkmark.seal" : "exclamationmark.circle")
                                .font(Theme.mono(11)).foregroundStyle(Theme.tSecondary)
                        }
                    }

                    DashCard(title: "Nearby Devices", accent: Theme.cyan) {
                        let pending = sync.discoveredPeers.filter { !sync.connectedPeers.contains($0) }
                        if pending.isEmpty {
                            Label("Searching for your Mac…", systemImage: "antenna.radiowaves.left.and.right")
                                .font(.system(size: 13)).foregroundStyle(Theme.tTertiary)
                        }
                        ForEach(pending, id: \.self) { peer in
                            Button { sync.invite(peer) } label: {
                                Label(peer.displayName, systemImage: "laptopcomputer")
                                    .font(.system(size: 14)).foregroundStyle(Theme.tPrimary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if !sync.connectedPeers.isEmpty {
                        DashCard(title: "Connected") {
                            ForEach(sync.connectedPeers, id: \.self) { peer in
                                Label(peer.displayName, systemImage: "checkmark.circle.fill")
                                    .font(.system(size: 14)).foregroundStyle(Theme.green)
                            }
                            Button { model.syncNow() } label: {
                                Text("Sync library")
                                    .font(Theme.mono(12)).tracking(0.5).textCase(.uppercase)
                                    .foregroundStyle(Theme.bg0)
                                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                                    .background(Theme.green, in: RoundedRectangle(cornerRadius: Theme.rSm))
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 4)
                            Text("Close the phone editor and quit Orion Terminal on your Mac before syncing edits. Reopen the desktop app afterward.")
                                .font(.caption).foregroundStyle(Theme.tSecondary)
                            Button("Disconnect") { sync.stop() }
                        }
                    }
                }
                .padding(20)
            }
            .background(ArchivesBackground())
            .navigationTitle("Sync")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { NavigationLink("Privacy", destination: PrivacyView()) } }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}
