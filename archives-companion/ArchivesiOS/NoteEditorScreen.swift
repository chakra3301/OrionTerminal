import SwiftUI
import ArchivesCore

/// The editable note page: native title field + journal meta over the glass
/// gradient, with the real BlockNote editor (WKWebView) filling the body.
struct NoteEditorScreen: View {
    let note: Note
    @ObservedObject var model: AppModel
    @State private var title: String

    init(note: Note, model: AppModel) {
        self.note = note
        self.model = model
        _title = State(initialValue: note.title)
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

                BlockNoteEditorView(initialBlocksJSON: note.blocksJSON, editable: true) { blocks, plaintext in
                    model.saveBody(note.id, blocksJSON: blocks, plaintext: plaintext)
                }
                .padding(.horizontal, 10)
            }
            .padding(.bottom, 8)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onDisappear { model.reload() }   // refresh the list once editing ends
    }
}
