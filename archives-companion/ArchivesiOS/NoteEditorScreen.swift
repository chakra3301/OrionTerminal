import SwiftUI
import ArchivesCore

/// The editable note page: native title field + journal meta over the glass
/// gradient, with the real BlockNote editor (WKWebView) filling the body.
struct NoteEditorScreen: View {
    let note: Note
    @ObservedObject var model: AppModel
    @State private var title: String
    @State private var editorToken = UUID()

    init(note: Note, model: AppModel) {
        self.note = model.pendingDrafts[note.id] ?? note
        self.model = model
        _title = State(initialValue: (model.pendingDrafts[note.id] ?? note).title)
    }

    var body: some View {
        ZStack {
            NotePageGradient()
            VStack(alignment: .leading, spacing: 10) {
                if note.kind == .journal {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(Fmt.longDate(note.createdAt))
                            .font(.system(size: 12, weight: .semibold)).tracking(1).foregroundStyle(.white.opacity(0.55))
                        Text(Fmt.clock(note.createdAt))
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.horizontal, 18).padding(.top, 8)
                }

                TextField("Untitled", text: $title)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white.opacity(0.95))
                    .textInputAutocapitalization(.sentences)
                    .padding(.horizontal, 18)
                    .padding(.top, note.kind == .journal ? 0 : 8)
                    .onChange(of: title) { _, newValue in model.saveTitle(note.id, newValue) }

                Text(model.saveStatus).font(.caption).foregroundStyle(Theme.tSecondary).padding(.horizontal, 18)
                BlockNoteEditorView(initialBlocksJSON: note.blocksJSON, editable: true, onChange: { blocks, plaintext in
                    model.saveBody(note.id, blocksJSON: blocks, plaintext: plaintext)
                }, onError: { message in model.errorMessage = message }, onClose: { model.openEditors.remove(editorToken) })
                .id(note.id)
                .padding(.horizontal, 10)
            }
            .padding(.bottom, 8)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { model.openEditors.insert(editorToken) }
        .onDisappear { model.reload() }
    }
}
