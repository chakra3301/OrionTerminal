import SwiftUI
import ArchivesCore

struct RootView: View {
    @StateObject private var model = AppModel()

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
    }
}

struct SyncView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var sync: MultipeerSync

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    DashCard(title: "Status") {
                        Text(sync.status).font(.system(size: 13)).foregroundStyle(Theme.tSecondary)
                        if !model.lastSyncSummary.isEmpty {
                            Label(model.lastSyncSummary, systemImage: "checkmark.seal")
                                .font(Theme.mono(11)).foregroundStyle(Theme.green)
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
                                Text("Sync now")
                                    .font(Theme.mono(12)).tracking(0.5).textCase(.uppercase)
                                    .foregroundStyle(Theme.bg0)
                                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                                    .background(Theme.green, in: RoundedRectangle(cornerRadius: Theme.rSm))
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 4)
                        }
                    }
                }
                .padding(20)
            }
            .background(ArchivesBackground())
            .navigationTitle("Sync")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}
