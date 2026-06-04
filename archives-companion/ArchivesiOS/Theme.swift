import SwiftUI
import ArchivesCore

/// Archives 47 design system, ported 1:1 from src/styles/tokens.css (neon theme).
enum Theme {
    // Backgrounds
    static let bg0 = Color(hex: 0x03060a)
    static let bg1 = Color(hex: 0x060a0f)
    static let bg2 = Color(hex: 0x0a1015)
    static let bg3 = Color(hex: 0x10171d)

    // Neon accents
    static let green   = Color(hex: 0x39ff88)
    static let cyan    = Color(hex: 0x00e0ff)
    static let yellow  = Color(hex: 0xe6ff3a)
    static let magenta = Color(hex: 0xff3ea5)
    static let violet  = Color(hex: 0xb14cff)

    // Text tiers
    static let tPrimary   = Color(hex: 0xe6f4ec)
    static let tSecondary = Color(hex: 0x9ab0a8)
    static let tTertiary  = Color(hex: 0x5a706a)
    static let tFaint     = Color(hex: 0x324036)

    // Surfaces / borders (the rgba(255,255,255,…) layering from the chrome CSS)
    static let cardBg       = Color.white.opacity(0.02)
    static let cardBgHover  = Color.white.opacity(0.04)
    static let hairline     = Color.white.opacity(0.05)
    static let glassBorder  = Color.white.opacity(0.06)

    // Radii
    static let rSm: CGFloat = 6
    static let rMd: CGFloat = 10
    static let rLg: CGFloat = 16
    static let rPill: CGFloat = 999

    // Type — Space Grotesk (display) + JetBrains Mono (labels/meta). Falls back
    // to the system font automatically if the bundled face isn't found.
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Space Grotesk", size: size).weight(weight)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("JetBrains Mono", size: size).weight(weight)
    }
}

extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: 1)
    }
}

// MARK: - Reusable chrome

/// The dark layered app background (bg-0 with a faint green-tinted lift).
struct ArchivesBackground: View {
    var body: some View {
        ZStack {
            Theme.bg0
            RadialGradient(colors: [Theme.green.opacity(0.05), .clear],
                           center: .topLeading, startRadius: 0, endRadius: 500)
        }
        .ignoresSafeArea()
    }
}

/// Mono, uppercase, wide-tracked section label (`.ar-section`).
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(Theme.mono(9, .medium))
            .tracking(2)
            .textCase(.uppercase)
            .foregroundStyle(Theme.tFaint)
    }
}

/// `.ar-card` surface.
struct CardModifier: ViewModifier {
    var accent: Color = .white
    func body(content: Content) -> some View {
        content
            .padding(18)
            .background(Theme.cardBg)
            .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
            .clipShape(RoundedRectangle(cornerRadius: Theme.rMd))
    }
}
extension View {
    func archivesCard(accent: Color = .white) -> some View { modifier(CardModifier(accent: accent)) }
}

/// A neon pill (`.ar-pill-btn` / tags). `active` fills with the accent tint.
struct Pill: View {
    let text: String
    var accent: Color = Theme.violet
    var active: Bool = false
    var body: some View {
        Text(text)
            .font(Theme.mono(10))
            .tracking(0.4)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(active ? accent : Theme.tTertiary)
            .background((active ? accent.opacity(0.10) : Color.white.opacity(0.04)),
                        in: Capsule())
            .overlay(Capsule().strokeBorder(active ? accent.opacity(0.35) : Color.white.opacity(0.06)))
    }
}

// MARK: - Formatting

enum Fmt {
    private static func date(_ ms: Millis) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    static func relative(_ ms: Millis) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: date(ms), relativeTo: Date())
    }
    /// "SAT, DEC 02 18:45" — the journal rail stamp.
    static func railStamp(_ ms: Millis) -> String {
        let f = DateFormatter(); f.dateFormat = "EEE, MMM dd HH:mm"
        return f.string(from: date(ms)).uppercased()
    }
    /// "MONDAY, DECEMBER 2, 2025"
    static func longDate(_ ms: Millis) -> String {
        let f = DateFormatter(); f.dateFormat = "EEEE, MMMM d, yyyy"
        return f.string(from: date(ms)).uppercased()
    }
    static func clock(_ ms: Millis) -> String {
        let f = DateFormatter(); f.dateFormat = "h:mm a"
        return f.string(from: date(ms))
    }
    static func byteSize(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
