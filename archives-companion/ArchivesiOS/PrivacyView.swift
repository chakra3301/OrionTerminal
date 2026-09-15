import SwiftUI

struct PrivacyView: View {
    private var legal: URL? { Bundle.main.url(forResource: "Acknowledgements", withExtension: "txt", subdirectory: "Legal") }
    var body: some View {
        List {
            Section("Your data") {
                Text("Notes, media and recovery drafts live on your iPhone. Sync only exchanges them with the Mac holding your pairing key. There is no Orion cloud account, analytics or advertising.")
                Text("Library access and AI are separate permissions in the Mac helper. Optional R.O.S.I.E messages and recent chat context are sent to Anthropic using your Mac's Claude account; Anthropic's account terms and privacy policy apply. Notes are not automatically included. Avoid sending sensitive information you don't want the provider to process.")
                Text("Sync keeps the ten most recent database backups locally. To remove your phone library and its backups, delete this app. This does not delete the Mac's copy. Treat your pairing key like a password; replace it on the Mac if you lose a device.")
            }
            Section("Beta limits") {
                Text("Requires the updated Archives Sync Mac helper. Close the phone editor and quit Orion Terminal before importing edits. Images up to 8 MB sync; videos and audio are metadata-only. Unsupported note blocks stay protected from editing. Sync uses last-write-wins; keep backups and avoid editing the same note on both devices between syncs.")
            }
            Section("Open source") {
                if let legal {
                    ShareLink("Export acknowledgements", item: legal)
                    NavigationLink("Read acknowledgements") {
                        ScrollView { Text((try? String(contentsOf: legal, encoding: .utf8)) ?? "Notices unavailable")
                            .font(.caption.monospaced()).textSelection(.enabled).padding() }
                            .navigationTitle("Acknowledgements")
                    }
                }
                ForEach(["core", "react", "mantine"], id: \.self) { package in
                    if let source = Bundle.main.url(forResource: "blocknote-\(package)-0.39.2", withExtension: "tgz", subdirectory: "Legal") {
                        ShareLink("BlockNote \(package) · MPL source", item: source)
                    }
                }
            }
        }
        .navigationTitle("Privacy & licenses")
    }
}
