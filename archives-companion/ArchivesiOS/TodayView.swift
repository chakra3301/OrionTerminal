import SwiftUI
import ArchivesCore

struct TodayView: View {
    @ObservedObject var model: AppModel
    @State private var showSync = false
    @State private var showSearch = false

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: "Good morning"
        case 12..<18: "Good afternoon"
        case 18..<23: "Good evening"
        default: "Still up?"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(Fmt.longDate(AppModel.now())).font(Theme.mono(11)).tracking(1.5).foregroundStyle(Theme.tTertiary)
                        Text(greeting).font(Theme.display(32, .medium)).foregroundStyle(Theme.tPrimary)
                    }
                    .padding(.top, 4)

                    let journal = Array(model.notes(of: .journal).prefix(3))
                    if !journal.isEmpty {
                        DashCard(title: "Today's Journal") {
                            ForEach(journal) { n in
                                NavigationLink(value: n) { miniRow(n) }.buttonStyle(.plain)
                            }
                        }
                    }

                    DashCard(title: "Recent Notes", accent: Theme.cyan) {
                        let recent = Array(model.notes(of: .note).prefix(4))
                        if recent.isEmpty {
                            Text("No notes yet — sync with your Mac.").font(.system(size: 13)).foregroundStyle(Theme.tTertiary)
                        }
                        ForEach(recent) { n in
                            NavigationLink(value: n) { miniRow(n) }.buttonStyle(.plain)
                        }
                    }

                    statsFooter
                }
                .padding(20)
            }
            .background(ArchivesBackground())
            .navigationDestination(for: Note.self) { NoteEditorScreen(note: $0, model: model) }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Archives").font(Theme.display(17, .semibold)).foregroundStyle(Theme.tPrimary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSearch = true } label: { Image(systemName: "magnifyingglass") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSync = true } label: { Image(systemName: "arrow.triangle.2.circlepath") }
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
            .sheet(isPresented: $showSync) { SyncView(model: model, sync: model.sync) }
            .sheet(isPresented: $showSearch) { SearchView(model: model) }
        }
    }

    @ViewBuilder private func miniRow(_ n: Note) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(n.title.isEmpty ? "Untitled" : n.title).font(Theme.display(14, .medium)).foregroundStyle(Theme.tPrimary).lineLimit(1)
            if !n.plaintext.isEmpty {
                Text(n.plaintext).font(.system(size: 12)).foregroundStyle(Theme.tSecondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private var statsFooter: some View {
        HStack(spacing: 28) {
            stat("\(model.notes.count)", "NOTES")
            stat("\(model.assets.count)", "MEDIA")
            stat("\(model.collections.count)", "COLLECTIONS")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(Theme.display(20, .semibold)).foregroundStyle(Theme.green)
            Text(label).font(Theme.mono(9)).tracking(1.5).foregroundStyle(Theme.tFaint)
        }
    }
}

struct NotesView: View {
    @ObservedObject var model: AppModel
    @State private var query = ""
    @State private var path: [Note] = []
    @State private var selectedCollectionID: String?
    @State private var selectedTag: String?

    private var filtered: [Note] {
        model.notes(of: .note)
            .filter { selectedCollectionID == nil || $0.collectionID == selectedCollectionID }
            .filter { selectedTag == nil || model.tags(for: $0.id).contains(selectedTag!) }
            .filter {
                query.isEmpty
                    || $0.title.localizedCaseInsensitiveContains(query)
                    || $0.plaintext.localizedCaseInsensitiveContains(query)
            }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                filterBar
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(filtered) { n in
                        NavigationLink(value: n) { NoteCard(note: n) }.buttonStyle(.plain)
                    }
                }
                .padding(20)
                if filtered.isEmpty {
                    ContentUnavailableView("No notes", systemImage: "note.text",
                        description: Text("Tap + to start one, or sync with your Mac.")).padding(.top, 60)
                }
            }
            .background(ArchivesBackground())
            .navigationTitle("Notes")
            .navigationDestination(for: Note.self) { NoteEditorScreen(note: $0, model: model) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button { path.append(model.createNote(.note)) } label: { Image(systemName: "plus") }
            } }
            .toolbarColorScheme(.dark, for: .navigationBar)
            .searchable(text: $query, prompt: "Search notes")
        }
    }

    @ViewBuilder private var filterBar: some View {
        if !model.collections.isEmpty || !model.tags.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if !model.collections.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("All", active: selectedCollectionID == nil, color: Theme.tSecondary, showDot: false) { selectedCollectionID = nil }
                            ForEach(model.collections) { c in
                                chip(c.name, active: selectedCollectionID == c.id, color: model.collectionColor(c.color), showDot: true) {
                                    selectedCollectionID = (selectedCollectionID == c.id) ? nil : c.id
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                if !model.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("All tags", active: selectedTag == nil, color: Theme.violet, showDot: false) { selectedTag = nil }
                            ForEach(model.tags) { t in
                                chip("#\(t.name)", active: selectedTag == t.name, color: Theme.violet, showDot: false) {
                                    selectedTag = (selectedTag == t.name) ? nil : t.name
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
            }
            .padding(.top, 12)
        }
    }

    private func chip(_ label: String, active: Bool, color: Color, showDot: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if showDot { Circle().fill(color).frame(width: 6, height: 6) }
                Text(label)
            }
            .font(Theme.mono(10)).tracking(0.4)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(active ? color : Theme.tTertiary)
            .background(active ? color.opacity(0.12) : Color.white.opacity(0.04), in: Capsule())
            .overlay(Capsule().strokeBorder(active ? color.opacity(0.4) : Color.white.opacity(0.06)))
        }
        .buttonStyle(.plain)
    }
}

struct JournalView: View {
    @ObservedObject var model: AppModel
    @State private var path: [Note] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(model.notes(of: .journal)) { n in
                        NavigationLink(value: n) { JournalRow(note: n) }.buttonStyle(.plain)
                    }
                }
                .padding(20)
                if model.notes(of: .journal).isEmpty {
                    ContentUnavailableView("No journal entries", systemImage: "book.closed",
                        description: Text("Tap + to start one, or sync with your Mac.")).padding(.top, 60)
                }
            }
            .background(ArchivesBackground())
            .navigationTitle("Journal")
            .navigationDestination(for: Note.self) { NoteEditorScreen(note: $0, model: model) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button { path.append(model.createNote(.journal)) } label: { Image(systemName: "plus") }
            } }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

