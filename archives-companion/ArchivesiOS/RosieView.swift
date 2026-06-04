import SwiftUI
import ArchivesCore

/// R.O.S.I.E chat — prompts route over Multipeer to the Mac helper, which runs
/// the subscription Claude CLI and replies. Green accent (Archives identity).
struct RosieView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var sync: MultipeerSync
    @State private var input = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if model.chat.isEmpty { emptyState }
                            ForEach(model.chat) { m in RosieBubble(message: m).id(m.id) }
                        }
                        .padding(16)
                    }
                    .onChange(of: model.chat.count) { _, _ in
                        if let last = model.chat.last {
                            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }
                inputBar
            }
            .background(ArchivesBackground())
            .navigationTitle("R.O.S.I.E")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Circle()
                .fill(RadialGradient(colors: [Theme.green, Theme.green.opacity(0.2)], center: .center, startRadius: 2, endRadius: 30))
                .frame(width: 54, height: 54)
                .shadow(color: Theme.green.opacity(0.5), radius: 16)
            Text("Ask R.O.S.I.E about your Archives").font(Theme.display(15, .medium)).foregroundStyle(Theme.tPrimary)
            Text(sync.connectedPeers.isEmpty ? "Connect to your Mac (Sync) — she runs there." : "Connected — ask away.")
                .font(Theme.mono(10)).foregroundStyle(Theme.tTertiary)
        }
        .frame(maxWidth: .infinity).padding(.top, 80)
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Message R.O.S.I.E…", text: $input, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 15))
                .foregroundStyle(Theme.tPrimary)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: Theme.rMd))
                .overlay(RoundedRectangle(cornerRadius: Theme.rMd).strokeBorder(Theme.glassBorder))
            Button {
                model.askRosie(input); input = ""
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 28))
                    .foregroundStyle(canSend ? Theme.green : Theme.tFaint)
            }
            .disabled(!canSend)
        }
        .padding(12)
        .background(Theme.bg1)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Theme.hairline), alignment: .top)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.rosieRunning
    }
}

private struct RosieBubble: View {
    let message: RosieMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            content
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder private var content: some View {
        if message.role == .user {
            Text(message.text)
                .font(.system(size: 15)).foregroundStyle(Theme.bg0)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Theme.green, in: RoundedRectangle(cornerRadius: 14))
        } else if message.pending && message.text.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small).tint(Theme.green)
                Text("thinking…").font(Theme.mono(11)).foregroundStyle(Theme.tTertiary)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.cardBg, in: RoundedRectangle(cornerRadius: 14))
        } else {
            Text(message.text)
                .font(.system(size: 15)).foregroundStyle(message.failed ? Theme.magenta : Theme.tPrimary)
                .textSelection(.enabled)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Theme.cardBg, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(message.failed ? Theme.magenta.opacity(0.4) : Theme.glassBorder))
        }
    }
}
