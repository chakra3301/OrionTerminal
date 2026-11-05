import Foundation
@preconcurrency import MultipeerConnectivity

struct WireMessage: Codable {
    enum Kind: String, Codable { case ready, sync, syncError, syncStatus, asset, assetReceipt, chatRequest, chatChunk, chatDone, chatError, chatCancel }
    var kind: Kind
    var sync: SyncPayload? = nil
    var requestID: String? = nil
    var text: String? = nil
    var sessionID: String? = nil
    var fileName: String? = nil
    var bytes: Data? = nil
}

private struct Hello: Codable { let protocolVersion: Int; let challenge: String }

@MainActor
public final class MultipeerSync: NSObject, ObservableObject {
    public static let serviceType = "archives-sync"
    @Published public private(set) var discoveredPeers: [MCPeerID] = []
    @Published public private(set) var connectedPeers: [MCPeerID] = []
    @Published public private(set) var status = "Pair your Mac to enable private sync."
    @Published public private(set) var paired = false
    public var provideSnapshot: (@MainActor () throws -> SyncPayload)?
    public var onPayload: (@MainActor (SyncPayload) -> Void)?
    public var onAssetData: (@MainActor (String, Data) throws -> Void)?
    public var onChatRequest: (@MainActor (String, String, String?) -> Void)?
    public var onChatCancel: (@MainActor (String) -> Void)?
    public var onChatChunk: (@MainActor (String, String) -> Void)?
    public var onChatDone: (@MainActor (String, String, String?) -> Void)?
    public var onChatError: (@MainActor (String, String) -> Void)?
    public var onDisconnected: (@MainActor () -> Void)?

    private let session: MCSession
    private let advertiser: MCNearbyServiceAdvertiser
    private let browser: MCNearbyServiceBrowser
    private var secret: String?
    private var channel: SecureChannel?
    private var transportPeer: MCPeerID?
    private var recipientChallenge: String?
    private var started = false
    private var assetTransfer: Task<Void, Never>?
    private var awaitingAsset: String?
    private var assetAccepted: Bool?

    public init(displayName: String) {
        let peer = MCPeerID(displayName: String(displayName.prefix(50)))
        session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        advertiser = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: ["protocol": "2"], serviceType: Self.serviceType)
        browser = MCNearbyServiceBrowser(peer: peer, serviceType: Self.serviceType)
        super.init()
        session.delegate = self; advertiser.delegate = self; browser.delegate = self
        do { secret = try PairingSecret.load(); paired = secret != nil }
        catch { status = error.localizedDescription }
    }
    public func pair(_ value: String) throws {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        try PairingSecret.save(value)
        stop(); secret = value; paired = true; start()
    }
    public func start() {
        guard !started, secret != nil else { return }
        started = true
        advertiser.startAdvertisingPeer(); browser.startBrowsingForPeers()
        status = "Looking for your paired device…"
    }
    public func stop() {
        started = false
        advertiser.stopAdvertisingPeer(); browser.stopBrowsingForPeers(); session.disconnect()
        clearConnection(); discoveredPeers = []; status = "Disconnected"
    }
    private func clearConnection() {
        assetTransfer?.cancel(); assetTransfer = nil; awaitingAsset = nil; assetAccepted = nil
        let hadPeer = transportPeer != nil
        connectedPeers = []; transportPeer = nil; channel = nil; recipientChallenge = nil
        if hadPeer { onDisconnected?() }
    }
    public func invite(_ peer: MCPeerID) {
        guard paired, transportPeer == nil else { return }
        browser.invitePeer(peer, to: session, withContext: Data("archives-v2".utf8), timeout: 20)
        status = "Verifying pairing…"
    }
    public func sendSnapshot() {
        do {
            guard let snap = try provideSnapshot?() else { throw SyncSafetyError.invalid("Library is unavailable.") }
            try snap.validate()
            if send(WireMessage(kind: .sync, sync: snap)) { status = "Sent library · waiting for confirmation" }
        } catch { status = error.localizedDescription }
    }
    public func confirmSync(_ text: String) { status = text; sendSyncStatus(text) }
    public func sendSyncStatus(_ text: String) { _ = send(WireMessage(kind: .syncStatus, text: String(text.prefix(2000)))) }
    public func sendSyncError(_ text: String) { _ = send(WireMessage(kind: .syncError, text: String(text.prefix(2000)))) }
    @discardableResult public func sendChatRequest(_ id: String, prompt: String, sessionID: String?) -> Bool {
        send(WireMessage(kind: .chatRequest, requestID: id, text: prompt, sessionID: sessionID))
    }
    public func sendChatCancel(_ id: String) { _ = send(WireMessage(kind: .chatCancel, requestID: id)) }
    public func sendChatChunk(_ id: String, text: String) { _ = send(WireMessage(kind: .chatChunk, requestID: id, text: text)) }
    public func sendChatDone(_ id: String, text: String, sessionID: String?) { _ = send(WireMessage(kind: .chatDone, requestID: id, text: text, sessionID: sessionID)) }
    public func sendChatError(_ id: String, message: String) { _ = send(WireMessage(kind: .chatError, requestID: id, text: message)) }

    @discardableResult private func send(_ message: WireMessage, handshake: Bool = false) -> Bool {
        guard let peer = transportPeer, let challenge = recipientChallenge,
              handshake || connectedPeers.contains(peer) else { status = "Connect to your paired device first."; return false }
        do {
            guard let encrypted = try channel?.seal(JSONEncoder().encode(message), recipientChallenge: challenge) else { return false }
            try session.send(encrypted, toPeers: [peer], with: .reliable)
            return true
        } catch { status = "Transfer failed: \(error.localizedDescription)"; return false }
    }
    public func sendAssetFiles(_ files: [(name: String, url: URL)]) {
        // Encrypted, authenticated messages replace unauthenticated MCSession resource filenames.
        assetTransfer?.cancel()
        assetTransfer = Task { @MainActor [weak self] in
            guard let self else { return }
            let challenge = self.channel?.challenge
            for file in files {
                guard !Task.isCancelled, !self.connectedPeers.isEmpty, self.channel?.challenge == challenge else { return }
                do {
                    guard AssetSafety.validName(file.name) else { throw SyncSafetyError.invalid("Invalid asset filename.") }
                    let bytes = try AssetSafety.read(file.url)
                    self.awaitingAsset = file.name; self.assetAccepted = nil
                    guard self.send(WireMessage(kind: .asset, fileName: file.name, bytes: bytes)) else { return }
                    let deadline = ContinuousClock.now.advanced(by: .seconds(30))
                    while self.assetAccepted == nil && ContinuousClock.now < deadline {
                        try await Task.sleep(for: .milliseconds(100))
                    }
                    guard !Task.isCancelled, self.assetAccepted == true else {
                        throw SyncSafetyError.invalid("Image wasn't acknowledged. Reconnect and sync to retry missing images.")
                    }
                    self.awaitingAsset = nil
                } catch {
                    if !Task.isCancelled { self.status = "Image transfer failed: \(error.localizedDescription)" }
                    return
                }
            }
        }
    }
    private func connected(_ peer: MCPeerID, state: MCSessionState) {
        guard started else { return }
        if state == .notConnected {
            if transportPeer == peer { clearConnection(); status = "Disconnected · reconnect to sync" }
            return
        }
        guard state == .connected, transportPeer == nil, let secret else { return }
        do {
            transportPeer = peer
            #if os(iOS)
            channel = try SecureChannel(secret: secret, role: .phone)
            #else
            channel = try SecureChannel(secret: secret, role: .mac)
            #endif
            let hello = Hello(protocolVersion: 2, challenge: channel!.challenge)
            try session.send(JSONEncoder().encode(hello), toPeers: [peer], with: .reliable)
            let challenge = channel?.challenge
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(15))
                guard let self, self.channel?.challenge == challenge, self.connectedPeers.isEmpty else { return }
                self.session.disconnect(); self.clearConnection(); self.status = "Pairing failed. Check that both devices use the same key and updated helper."
            }
        } catch { status = error.localizedDescription; session.disconnect(); clearConnection() }
    }
    private func receive(_ data: Data, peer: MCPeerID) {
        if started, transportPeer == nil, session.connectedPeers.contains(peer) { connected(peer, state: .connected) }
        guard started, peer == transportPeer else { return }
        do {
            if recipientChallenge == nil, data.count < 256,
               let hello = try? JSONDecoder().decode(Hello.self, from: data),
               hello.protocolVersion == 2, UUID(uuidString: hello.challenge) != nil {
                recipientChallenge = hello.challenge
                _ = send(WireMessage(kind: .ready), handshake: true)
                return
            }
            guard let clear = try channel?.open(data) else { return }
            let message = try JSONDecoder().decode(WireMessage.self, from: clear)
            if message.kind == .ready {
                connectedPeers = [peer]; status = "Paired · encrypted connection"; return
            }
            guard connectedPeers.contains(peer) else { return }
            switch message.kind {
            case .ready: break
            case .syncStatus: status = String((message.text ?? "").prefix(2000))
            case .syncError: status = "Sync failed: " + String((message.text ?? "Try again.").prefix(2000))
            case .sync:
                guard let payload = message.sync else { throw SyncSafetyError.invalid("Missing sync payload.") }
                let now = Millis(Date().timeIntervalSince1970 * 1000)
                guard payload.generatedAt >= now - 300_000, payload.generatedAt <= now + 300_000 else {
                    sendSyncError("Check both devices' clocks; they must be within five minutes.")
                    status = "Sync paused · device clocks differ"
                    return
                }
                try payload.validate(); onPayload?(payload)
            case .asset:
                guard let name = message.fileName, AssetSafety.validName(name), let bytes = message.bytes,
                      !bytes.isEmpty, bytes.count <= AssetSafety.maxBytes else { throw SyncSafetyError.invalid("Invalid image transfer.") }
                do {
                    guard let onAssetData else { throw SyncSafetyError.invalid("Image storage is unavailable.") }
                    try onAssetData(name, bytes)
                    _ = send(WireMessage(kind: .assetReceipt, text: "ok", fileName: name))
                } catch {
                    status = error.localizedDescription
                    _ = send(WireMessage(kind: .assetReceipt, text: "failed", fileName: name))
                }
            case .assetReceipt:
                if message.fileName == awaitingAsset { assetAccepted = message.text == "ok" }
            case .chatRequest:
                guard let id = message.requestID, UUID(uuidString: id) != nil,
                      let text = message.text, !text.isEmpty, text.utf8.count <= 32_000 else { throw SyncSafetyError.invalid("Invalid chat request.") }
                onChatRequest?(id, text, message.sessionID)
            case .chatCancel: if let id = message.requestID { onChatCancel?(id) }
            case .chatChunk: if let id = message.requestID { onChatChunk?(id, String((message.text ?? "").prefix(200_000))) }
            case .chatDone: if let id = message.requestID { onChatDone?(id, String((message.text ?? "").prefix(200_000)), message.sessionID) }
            case .chatError: if let id = message.requestID { onChatError?(id, String((message.text ?? "Request failed").prefix(2_000))) }
            }
        } catch {
            session.disconnect(); clearConnection()
            status = "Connection rejected. Check pairing keys and app versions."
        }
    }
}

extension MultipeerSync: MCSessionDelegate {
    nonisolated public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        Task { @MainActor in self.connected(peerID, state: state) }
    }
    nonisolated public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard data.count <= SecureChannel.maxPacketBytes else { return }
        Task { @MainActor in self.receive(data, peer: peerID) }
    }
    nonisolated public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) { stream.close() }
    nonisolated public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) { progress.cancel() }
    nonisolated public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

extension MultipeerSync: MCNearbyServiceAdvertiserDelegate {
    nonisolated public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                                       withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        let reply = InvitationReply(invitationHandler)
        Task { @MainActor in
            let accept = self.started && self.paired && self.transportPeer == nil && context == Data("archives-v2".utf8)
            reply.call(accept, accept ? self.session : nil)
        }
    }
    nonisolated public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        Task { @MainActor in self.status = "Local network unavailable: \(error.localizedDescription)" }
    }
}
// Framework supplies a one-shot callback on an arbitrary queue; only the MainActor invokes it.
private final class InvitationReply: @unchecked Sendable {
    let call: (Bool, MCSession?) -> Void
    init(_ call: @escaping (Bool, MCSession?) -> Void) { self.call = call }
}

extension MultipeerSync: MCNearbyServiceBrowserDelegate {
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard info?["protocol"] == "2" else { return }
        Task { @MainActor in if !self.discoveredPeers.contains(peerID) { self.discoveredPeers.append(peerID) } }
    }
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        Task { @MainActor in self.discoveredPeers.removeAll { $0 == peerID } }
    }
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        Task { @MainActor in self.status = "Local network unavailable: \(error.localizedDescription)" }
    }
}
