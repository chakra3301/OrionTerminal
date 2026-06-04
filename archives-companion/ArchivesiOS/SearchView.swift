import SwiftUI
import ArchivesCore

/// Search across all notes/journal/projects by title + body. In-memory (instant
/// at a personal library's scale); a SQLite FTS5 table is the upgrade if it ever
/// grows huge. Tapping a hit opens it in the editor.
struct SearchView: View {
    @ObservedObject var model: AppModel
    @State private var query = ""

    private var results: [Note] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 1 else { return [] }
        let matches = model.notes.filter {
            $0.title.range(of: q, options: .caseInsensitive) != nil
                || $0.plaintext.range(of: q, options: .caseInsensitive) != nil
        }
        return matches.sorted { a, b in
            let at = a.title.range(of: q, options: .caseInsensitive) != nil
            let bt = b.title.range(of: q, options: .caseInsensitive) != nil
            if at != bt { return at }            // title hits first
            return a.updatedAt > b.updatedAt
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(results) { n in
                        NavigationLink(value: n) { SearchRow(note: n, query: query) }.buttonStyle(.plain)
                    }
                }
                .padding(16)
                if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && results.isEmpty {
                    ContentUnavailableView.search(text: query).padding(.top, 60)
                }
            }
            .background(ArchivesBackground())
            .navigationTitle("Search")
            .navigationDestination(for: Note.self) { NoteEditorScreen(note: $0, model: model) }
            .toolbarColorScheme(.dark, for: .navigationBar)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search notes, journal, projects")
        }
    }
}

private struct SearchRow: View {
    let note: Note
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11)).foregroundStyle(kindColor)
                Text(note.title.isEmpty ? "Untitled" : note.title)
                    .font(Theme.display(15, .medium)).foregroundStyle(Theme.tPrimary).lineLimit(1)
            }
            if !snippet.isEmpty {
                Text(snippet).font(.system(size: 12)).foregroundStyle(Theme.tSecondary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }

    private var icon: String {
        switch note.kind {
        case .journal: "book.closed"
        case .project: "folder"
        case .note: "note.text"
        }
    }
    private var kindColor: Color {
        switch note.kind {
        case .journal: Theme.green
        case .project: Theme.cyan
        case .note: Theme.tSecondary
        }
    }
    private var snippet: String {
        let pt = note.plaintext
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, let r = pt.range(of: q, options: .caseInsensitive) else {
            return String(pt.prefix(120)).replacingOccurrences(of: "\n", with: " ")
        }
        let start = pt.index(r.lowerBound, offsetBy: -40, limitedBy: pt.startIndex) ?? pt.startIndex
        let end = pt.index(r.upperBound, offsetBy: 80, limitedBy: pt.endIndex) ?? pt.endIndex
        let prefix = start > pt.startIndex ? "…" : ""
        return (prefix + String(pt[start..<end])).replacingOccurrences(of: "\n", with: " ")
    }
}
