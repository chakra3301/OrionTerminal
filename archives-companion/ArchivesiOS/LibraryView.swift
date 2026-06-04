import SwiftUI
import PhotosUI
import UIKit
import ArchivesCore

enum LibraryDest: Hashable {
    case projects, mood, media
    case board(String)
}

/// Phone hub for the "browse" surfaces (Projects / Mood Boards / Media). One
/// NavigationStack hosts the whole section, so pushing a project page or a
/// board detail works with value-based navigation.
struct LibraryView: View {
    @ObservedObject var model: AppModel
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 12) {
                    hubRow("Projects", "folder", Theme.cyan, count: model.notes(of: .project).count, dest: .projects)
                    hubRow("Mood Boards", "square.grid.2x2", Theme.magenta, count: model.moodBoards.count, dest: .mood)
                    hubRow("Media", "photo.on.rectangle", Theme.green, count: model.assets.count, dest: .media)
                }
                .padding(20)
            }
            .background(ArchivesBackground())
            .navigationTitle("Library")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .navigationDestination(for: LibraryDest.self) { dest in
                switch dest {
                case .projects: ProjectsContent(model: model, path: $path)
                case .mood: MoodListContent(model: model)
                case .media: MediaContent(model: model)
                case .board(let id): BoardDetailContent(model: model, boardID: id)
                }
            }
            .navigationDestination(for: Note.self) { NoteEditorScreen(note: $0, model: model) }
        }
    }

    private func hubRow(_ title: String, _ icon: String, _ accent: Color, count: Int, dest: LibraryDest) -> some View {
        NavigationLink(value: dest) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(accent).frame(width: 28)
                Text(title).font(Theme.display(16, .medium)).foregroundStyle(Theme.tPrimary)
                Spacer()
                Text("\(count)").font(Theme.mono(11)).foregroundStyle(Theme.tTertiary)
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.tFaint)
            }
            .padding(16)
            .background(Theme.cardBg)
            .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
            .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Projects (nested page tree)

struct ProjectsContent: View {
    @ObservedObject var model: AppModel
    @Binding var path: NavigationPath
    @State private var expanded: Set<String> = []

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(model.projectRoots()) { node in
                    ProjectNodeRows(node: node, depth: 0, model: model, expanded: $expanded, path: $path)
                }
            }
            .padding(.vertical, 12).padding(.horizontal, 14)
            if model.projectRoots().isEmpty {
                ContentUnavailableView("No projects", systemImage: "folder",
                    description: Text("Tap + to start one.")).padding(.top, 60)
            }
        }
        .background(ArchivesBackground())
        .navigationTitle("Projects")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button { path.append(model.createNote(.project, parentID: nil)) } label: { Image(systemName: "plus") }
        } }
    }

}

/// Recursive row renderer as a named struct — recursion through a concrete View
/// type avoids the "opaque type defined in terms of itself" inference error.
private struct ProjectNodeRows: View {
    let node: Note
    let depth: Int
    @ObservedObject var model: AppModel
    @Binding var expanded: Set<String>
    @Binding var path: NavigationPath

    var body: some View {
        let children = model.projectChildren(of: node.id)
        ProjectRow(
            node: node, depth: depth, hasChildren: !children.isEmpty, isExpanded: expanded.contains(node.id),
            onToggle: { toggle(node.id) },
            onOpen: { path.append(node) },
            onAddChild: { let c = model.createNote(.project, parentID: node.id); expanded.insert(node.id); path.append(c) },
            onDelete: { model.deleteNote(node.id) }
        )
        if expanded.contains(node.id) {
            ForEach(children) { child in
                ProjectNodeRows(node: child, depth: depth + 1, model: model, expanded: $expanded, path: $path)
            }
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }
}

private struct ProjectRow: View {
    let node: Note
    let depth: Int
    let hasChildren: Bool
    let isExpanded: Bool
    let onToggle: () -> Void
    let onOpen: () -> Void
    let onAddChild: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: onToggle) {
                Image(systemName: hasChildren ? (isExpanded ? "chevron.down" : "chevron.right") : "circle.fill")
                    .font(.system(size: hasChildren ? 11 : 4))
                    .foregroundStyle(Theme.tTertiary).frame(width: 16)
            }
            .buttonStyle(.plain).disabled(!hasChildren)

            Button(action: onOpen) {
                Text(node.title.isEmpty ? "Untitled" : node.title)
                    .font(Theme.display(14)).foregroundStyle(Theme.tPrimary).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button(action: onAddChild) { Image(systemName: "plus").font(.system(size: 12)).foregroundStyle(Theme.tTertiary) }
                .buttonStyle(.plain)
        }
        .padding(.vertical, 7)
        .padding(.leading, CGFloat(depth) * 16 + 4)
        .padding(.trailing, 8)
        .background(isExpanded ? Theme.cyan.opacity(0.06) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rSm))
        .contextMenu {
            Button(role: .destructive, action: onDelete) { Label("Delete (and subpages)", systemImage: "trash") }
        }
    }
}

// MARK: - Mood boards

struct MoodListContent: View {
    @ObservedObject var model: AppModel
    @State private var showNewBoard = false
    @State private var newBoardTitle = ""

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 14)], spacing: 14) {
                ForEach(model.moodBoards) { b in
                    NavigationLink(value: LibraryDest.board(b.id)) {
                        MoodBoardCard(board: b, count: model.members(of: b.id).count)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)
            if model.moodBoards.isEmpty {
                ContentUnavailableView("No mood boards", systemImage: "square.grid.2x2",
                    description: Text("Tap + to create one.")).padding(.top, 60)
            }
        }
        .background(ArchivesBackground())
        .navigationTitle("Mood Boards")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { newBoardTitle = ""; showNewBoard = true } label: { Image(systemName: "plus") }
            }
        }
        .alert("New Mood Board", isPresented: $showNewBoard) {
            TextField("Title", text: $newBoardTitle)
            Button("Create") { _ = model.createBoard(newBoardTitle) }
            Button("Cancel", role: .cancel) { }
        }
    }
}

private struct MoodBoardCard: View {
    let board: MoodBoard
    let count: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                LinearGradient(colors: [Theme.magenta.opacity(0.10), Theme.violet.opacity(0.10)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: "square.grid.2x2").font(.system(size: 24)).foregroundStyle(.white.opacity(0.4))
            }
            .frame(height: 110).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 4) {
                Text(board.title.isEmpty ? "Untitled" : board.title).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.tPrimary).lineLimit(1)
                Text("\(count) items").font(Theme.mono(9)).foregroundStyle(Theme.tTertiary)
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }
}

struct BoardDetailContent: View {
    @ObservedObject var model: AppModel
    let boardID: String
    @Environment(\.dismiss) private var dismiss
    @State private var showAdd = false
    private var board: MoodBoard? { model.moodBoards.first { $0.id == boardID } }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                ForEach(model.members(of: boardID)) { a in
                    AssetTile(asset: a, imageURL: model.cachedAssetURL(for: a))
                        .contextMenu {
                            Button(role: .destructive) { model.removeFromBoard(boardID, assetID: a.id) } label: {
                                Label("Remove from board", systemImage: "minus.circle")
                            }
                        }
                }
            }
            .padding(20)
            if model.members(of: boardID).isEmpty {
                ContentUnavailableView("Empty board", systemImage: "square.grid.2x2",
                    description: Text("Tap + to add photos.")).padding(.top, 60)
            }
        }
        .background(ArchivesBackground())
        .navigationTitle(board?.title ?? "Board")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) { model.deleteBoard(boardID); dismiss() } label: {
                        Label("Delete board", systemImage: "trash")
                    }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .sheet(isPresented: $showAdd) { AddAssetsSheet(model: model, boardID: boardID) }
    }
}

private struct AddAssetsSheet: View {
    @ObservedObject var model: AppModel
    let boardID: String
    @Environment(\.dismiss) private var dismiss

    private var available: [Asset] {
        let inBoard = Set(model.members(of: boardID).map(\.id))
        return model.assets.filter { !inBoard.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                    ForEach(available) { a in
                        Button { model.addToBoard(boardID, assetID: a.id) } label: {
                            AssetTile(asset: a, imageURL: model.cachedAssetURL(for: a))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
                if available.isEmpty {
                    ContentUnavailableView("Nothing to add", systemImage: "photo",
                        description: Text("Add photos in Media first.")).padding(.top, 60)
                }
            }
            .background(ArchivesBackground())
            .navigationTitle("Add to Board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Media

struct MediaContent: View {
    @ObservedObject var model: AppModel
    @State private var filter: AssetKind?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showLibrary = false
    @State private var showCamera = false

    private var filtered: [Asset] { filter == nil ? model.assets : model.assets.filter { $0.kind == filter } }

    var body: some View {
        ScrollView {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterChip(label: "All", count: model.assets.count, active: filter == nil) { filter = nil }
                    ForEach(AssetKind.allCases, id: \.self) { k in
                        FilterChip(label: k.rawValue, count: model.assets.filter { $0.kind == k }.count, active: filter == k) { filter = k }
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.top, 12)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                ForEach(filtered) { a in AssetTile(asset: a, imageURL: model.cachedAssetURL(for: a)) }
            }
            .padding(20)

            if filtered.isEmpty {
                ContentUnavailableView("No media", systemImage: "photo.on.rectangle",
                    description: Text("Tap + to add a photo, or sync to pull in your library.")).padding(.top, 40)
            }
        }
        .background(ArchivesBackground())
        .navigationTitle("Media")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { showCamera = true } label: { Label("Take Photo", systemImage: "camera") }
                    }
                    Button { showLibrary = true } label: { Label("Choose Photos", systemImage: "photo.on.rectangle") }
                } label: { Image(systemName: "plus") }
            }
        }
        .photosPicker(isPresented: $showLibrary, selection: $photoItems, matching: .images)
        .onChange(of: photoItems) { _, items in
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self) { model.importImage(data) }
                }
                photoItems = []
            }
        }
        .sheet(isPresented: $showCamera) { CameraPicker { data in model.importImage(data) } }
    }
}

/// Wraps UIImagePickerController for camera capture → JPEG Data.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.85) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
