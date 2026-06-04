import SwiftUI
import WebKit

/// Hosts the real BlockNote editor (bundled web app) in a transparent WKWebView
/// so it renders over the native NotePage glass. Bridge:
///   web → native: postMessage({type:"ready"|"change", blocks, plaintext})
///   native → web: window.archivesLoad(blocksJSON, editable)
struct BlockNoteEditorView: UIViewRepresentable {
    let initialBlocksJSON: String
    var editable: Bool = true
    let onChange: (_ blocksJSON: String, _ plaintext: String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(context.coordinator, name: "archives")
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.keyboardDismissMode = .interactive
        context.coordinator.web = web
        if let url = Bundle.main.url(forResource: "editor", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "archives")
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: BlockNoteEditorView
        weak var web: WKWebView?
        init(_ parent: BlockNoteEditorView) { self.parent = parent }

        nonisolated func userContentController(_ controller: WKUserContentController,
                                               didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            let blocks = body["blocks"] as? String ?? "[]"
            let plain = body["plaintext"] as? String ?? ""
            Task { @MainActor in
                switch type {
                case "ready": self.injectInitial()
                case "change": self.parent.onChange(blocks, plain)
                default: break
                }
            }
        }

        private func injectInitial() {
            guard let web else { return }
            let json = parent.initialBlocksJSON.isEmpty ? "[]" : parent.initialBlocksJSON
            // Encoding a String yields a JSON string literal — safe to inline as a JS arg.
            guard let arg = try? String(data: JSONEncoder().encode(json), encoding: .utf8) else { return }
            web.evaluateJavaScript("window.archivesLoad && window.archivesLoad(\(arg), \(parent.editable));")
        }
    }
}
