import SwiftUI
import ArchivesCore

/// `.ar-card` with the mono green-dot header used across Today/Sync.
struct DashCard<Content: View>: View {
    let title: String
    var accent: Color = Theme.green
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(title).font(Theme.mono(11)).tracking(1).textCase(.uppercase).foregroundStyle(Theme.tSecondary)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }
}

/// `.ar-note-card` — notes-grid tile.
struct NoteCard: View {
    let note: Note
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(note.title.isEmpty ? "Untitled" : note.title)
                .font(Theme.display(16, .medium)).foregroundStyle(Theme.tPrimary).lineLimit(2)
            if !note.plaintext.isEmpty {
                Text(note.plaintext).font(.system(size: 13)).foregroundStyle(Theme.tSecondary)
                    .lineSpacing(3).lineLimit(4)
            }
            Text(Fmt.relative(note.updatedAt)).font(Theme.mono(10)).foregroundStyle(Theme.tTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }
}

/// `.ar-journal-rail-item` — journal entry row.
struct JournalRow: View {
    let note: Note
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.title.isEmpty ? "Untitled" : note.title)
                .font(Theme.display(14, .medium)).foregroundStyle(Theme.tPrimary).lineLimit(1)
            HStack(spacing: 8) {
                Text(Fmt.railStamp(note.createdAt)).font(Theme.mono(10)).tracking(0.8).foregroundStyle(Theme.tTertiary)
                if !note.location.isEmpty {
                    Label(note.location, systemImage: "mappin.and.ellipse").font(Theme.mono(10)).foregroundStyle(Theme.cyan)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10).padding(.horizontal, 14)
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rSm).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rSm))
    }
}

/// The `.note-page` atmospheric gradient (radial purple/blue/green over near-black).
struct NotePageGradient: View {
    var body: some View {
        ZStack {
            Color(hex: 0x0a0a0a)
            RadialGradient(colors: [Color(hex: 0x1a0a2e).opacity(0.9), .clear], center: UnitPoint(x: 0.2, y: 0.45), startRadius: 0, endRadius: 320)
            RadialGradient(colors: [Color(hex: 0x0a1628).opacity(0.9), .clear], center: UnitPoint(x: 0.85, y: 0.18), startRadius: 0, endRadius: 320)
            RadialGradient(colors: [Color(hex: 0x0e1a0e).opacity(0.9), .clear], center: UnitPoint(x: 0.5, y: 0.88), startRadius: 0, endRadius: 360)
        }
        .ignoresSafeArea()
    }
}

/// The Apple-glass `.note-page` editor surface (read-only preview for now).
struct NotePage: View {
    let note: Note
    var showJournalMeta: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if showJournalMeta {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(Fmt.longDate(note.createdAt))
                            .font(.system(size: 12, weight: .semibold)).tracking(1).foregroundStyle(.white.opacity(0.55))
                        HStack(spacing: 10) {
                            Text(Fmt.clock(note.createdAt)).font(.system(size: 13)).foregroundStyle(.white.opacity(0.6))
                            if !note.location.isEmpty {
                                Label(note.location, systemImage: "mappin.and.ellipse")
                                    .font(.system(size: 12))
                                    .padding(.horizontal, 10).padding(.vertical, 3)
                                    .foregroundStyle(Color(hex: 0x4aa8ff))
                                    .background(Color(hex: 0x007AFF).opacity(0.12), in: Capsule())
                                    .overlay(Capsule().strokeBorder(Color(hex: 0x007AFF).opacity(0.25)))
                            }
                        }
                    }
                }
                Text(note.title.isEmpty ? "Untitled" : note.title)
                    .font(.system(size: 32, weight: .bold)).foregroundStyle(.white.opacity(0.95))
                Text(note.plaintext.isEmpty ? "Empty note." : note.plaintext)
                    .font(.system(size: 16)).lineSpacing(6).foregroundStyle(.white.opacity(0.92))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.vertical, 24)
                    .background(Color(hex: 0x0a0a0f).opacity(0.65))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.white.opacity(0.10)))
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
                Text("Read-only preview — the full BlockNote editor is the next phase.")
                    .font(Theme.mono(10)).foregroundStyle(Theme.tTertiary).padding(.top, 16)
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(20)
        }
        .background(NotePageGradient())
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// `.ar-media-tile` — asset tile (kind gradient + icon; bytes arrive a later phase).
struct AssetTile: View {
    let asset: Asset
    var imageURL: URL? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                if asset.kind == .image, let imageURL {
                    AsyncImage(url: imageURL) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            ZStack { tileGradient; Image(systemName: icon).font(.system(size: 26)).foregroundStyle(.white.opacity(0.5)) }
                        }
                    }
                } else {
                    tileGradient
                    Image(systemName: icon).font(.system(size: 26)).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(height: 120).frame(maxWidth: .infinity)
            .clipped()
            VStack(alignment: .leading, spacing: 6) {
                Text(displayName).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.tPrimary).lineLimit(1)
                Text(Fmt.byteSize(asset.sizeBytes)).font(Theme.mono(9)).foregroundStyle(Theme.tTertiary)
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.cardBg)
        .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }
    private var displayName: String {
        if let t = asset.title, !t.isEmpty { return t }
        return asset.originalName.isEmpty ? "Untitled" : asset.originalName
    }
    private var icon: String {
        switch asset.kind {
        case .image: "photo"
        case .video: "film"
        case .audio: "waveform"
        case .doc: "doc.text"
        case .other: "square.dashed"
        }
    }
    private var tileGradient: some View {
        let pair: [Color]
        switch asset.kind {
        case .video: pair = [Theme.magenta.opacity(0.12), Theme.violet.opacity(0.12)]
        case .audio: pair = [Theme.green.opacity(0.10), Theme.cyan.opacity(0.10)]
        case .doc:   pair = [Theme.yellow.opacity(0.10), Color(hex: 0xff9a4c).opacity(0.10)]
        case .image: pair = [Theme.cyan.opacity(0.08), Theme.violet.opacity(0.08)]
        case .other: pair = [Color.white.opacity(0.04), Color.white.opacity(0.02)]
        }
        return LinearGradient(colors: pair, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// Kind filter pill for Media.
struct FilterChip: View {
    let label: String
    let count: Int
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(label)
                if count > 0 { Text("\(count)").foregroundStyle(active ? Theme.green : Theme.tFaint) }
            }
            .font(Theme.mono(10)).tracking(0.5).textCase(.uppercase)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(active ? Theme.green : Theme.tTertiary)
            .background((active ? Theme.green.opacity(0.10) : Color.white.opacity(0.04)), in: Capsule())
            .overlay(Capsule().strokeBorder(active ? Theme.green.opacity(0.35) : Color.white.opacity(0.06)))
        }
        .buttonStyle(.plain)
    }
}
