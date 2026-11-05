import SwiftUI
import WebKit

struct BlockNoteEditorView: UIViewRepresentable {
    let initialBlocksJSON: String
    var editable = true
    let onChange: (String, String) -> Void
    let onError: (String) -> Void
    let onClose: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "archives")
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.isOpaque = false; web.backgroundColor = .clear; web.scrollView.backgroundColor = .clear
        web.scrollView.keyboardDismissMode = .interactive
        context.coordinator.web = web
        if let url = Bundle.main.url(forResource: "editor", withExtension: "html") {
            context.coordinator.editorURL = url
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else { onError("The bundled editor is missing. Your note has not been changed.") }
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) { context.coordinator.parent = self }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        coordinator.active = false
        web.configuration.userContentController.removeScriptMessageHandler(forName: "archives")
        web.navigationDelegate = nil
        let onClose = coordinator.parent.onClose
        Task { @MainActor in onClose() }
    }
    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: BlockNoteEditorView
        weak var web: WKWebView?
        var editorURL: URL?
        var active = true
        private var injected = false
        init(_ parent: BlockNoteEditorView) { self.parent = parent }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard active, message.frameInfo.isMainFrame, message.webView === web,
                  web?.url?.standardizedFileURL == editorURL?.standardizedFileURL,
                  let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready": injectInitial()
            case "error": parent.onError(body["message"] as? String ?? "This note cannot be edited safely on this version.")
            case "change":
                guard injected, let blocks = body["blocks"] as? String, let plain = body["plaintext"] as? String,
                      blocks.utf8.count <= 2_000_000, plain.utf8.count <= 2_000_000 else {
                    parent.onError("Note exceeds the mobile editor limit. Original saved content is preserved."); return
                }
                parent.onChange(blocks, plain)
            default: break
            }
        }
        private func injectInitial() {
            guard active, !injected, let web else { return }
            do {
                let json = parent.initialBlocksJSON.isEmpty ? "[]" : parent.initialBlocksJSON
                let argument = String(decoding: try JSONEncoder().encode(json), as: UTF8.self)
                injected = true
                web.evaluateJavaScript("window.archivesLoad(\(argument), \(parent.editable));") { [weak self] _, error in
                    guard let self, self.active, let error else { return }
                    self.parent.onError("Couldn't load the editor: \(error.localizedDescription)")
                }
            } catch { parent.onError(error.localizedDescription) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            let allowed = navigationAction.request.url?.standardizedFileURL == editorURL?.standardizedFileURL
                && navigationAction.navigationType == .other
            decisionHandler(allowed ? .allow : .cancel)
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            guard active else { return }
            parent.onError("The editor stopped. Recent saved changes are safe. Close and reopen this note.")
        }
    }
}
