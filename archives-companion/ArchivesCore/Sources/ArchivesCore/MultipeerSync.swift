import Foundation
@preconcurrency import MultipeerConnectivity

/// Everything sent over the link is wrapped in this envelope so one channel
/// carries both database sync and the Claude chat request/reply RPC.
struct WireMessage: Codable {
    enum Kind: String, Codable { case sync, chatRequest, chatChunk, chatDone, chatError }
    var kind: Kind
    var sync: SyncPayload? = nil
    var requestID: String? = nil
    var text: String? = nil
    var sessionID: String? = nil   // Claude session for multi-turn --resume
}

// Peer-to-peer transport for sync. MultipeerConnectivity finds nearby devices
// over peer Wi-Fi / Bluetooth with no internet, no server, no account — the
// phone and the Mac helper discover each other when they're near each other and
// exchange a SyncPayload (+ the asset files it references).
//
// NOTE: on iOS 14+ and current macOS, this silently does nothing unless the
// app's Info.plist declares NSLocalNetworkUsageDescription and lists the
// service under NSBonjourServices (_archives-sync._tcp / ._udp). project.yml
// sets both — that single gotcha is the #1 reason Multipeer "just won't connect."

@MainActor
public final class MultipeerSync: NSObject, ObservableObject {
    /// Must be 1–15 chars, lowercase letters/digits/hyphen, and match the
    /// `_<type>._tcp` entries in NSBonjourServices.
    public static let serviceType = "archives-sync"

    @Published public private(set) var discoveredPeers: [MCPeerID] = []
    @Published public private(set) var connectedPeers: [MCPeerID] = []
    @Published public private(set) var status: String = "idle"

    /// Supplies this device's current full snapshot when it's time to send.
    public var provideSnapshot: (@MainActor () -> SyncPayload)?
    /// A peer's snapshot arrived — merge it into the local store.
    public var onPayload: (@MainActor (SyncPayload) -> Void)?
    /// An asset file arrived at `localURL`; move it into the assets dir.
    public var onAssetFile: (@MainActor (_ fileName: String, _ localURL: URL) -> Void)?
    /// Mac side: the phone asked Claude something — run it (resuming `sessionID` if given).
    public var onChatRequest: (@MainActor (_ id: String, _ prompt: String, _ sessionID: String?) -> Void)?
    /// Phone side: a streaming text snapshot, the final reply (+ session to resume), or an error.
    public var onChatChunk: (@MainActor (_ id: String, _ text: String) -> Void)?
    public var onChatDone: (@MainActor (_ id: String, _ text: String, _ sessionID: String?) -> Void)?
    public var onChatError: (@MainActor (_ id: String, _ message: String) -> Void)?
    /// Fired when the link drops (no connected peers) — lets the UI fail a pending request.
    public var onDisconnected: (@MainActor () -> Void)?

    private let myPeerID: MCPeerID
    // Read from nonisolated delegate callbacks (auto-accept); an immutable,
    // internally-thread-safe framework reference, so opting out of isolation is safe.
    private nonisolated(unsafe) let session: MCSession
    private let advertiser: MCNearbyServiceAdvertiser
    private let browser: MCNearbyServiceBrowser

    public init(displayName: String) {
        let trimmed = String(displayName.prefix(63))
        myPeerID = MCPeerID(displayName: trimmed.isEmpty ? "device" : trimmed)
        session = MCSession(peer: myPeerID, securityIdentity: nil, encryptionPreference: .required)
        advertiser = MCNearbyServiceAdvertiser(peer: myPeerID, discoveryInfo: nil,
                                               serviceType: MultipeerSync.serviceType)
        browser = MCNearbyServiceBrowser(peer: myPeerID, serviceType: MultipeerSync.serviceType)
        super.init()
        session.delegate = self
        advertiser.delegate = self
        browser.delegate = self
    }

    public func start() {
        advertiser.startAdvertisingPeer()
        browser.startBrowsingForPeers()
        status = "looking for nearby devices…"
    }

    public func stop() {
        advertiser.stopAdvertisingPeer()
        browser.stopBrowsingForPeers()
        session.disconnect()
        status = "idle"
    }

    public func invite(_ peer: MCPeerID) {
        browser.invitePeer(peer, to: session, withContext: nil, timeout: 30)
        status = "inviting \(peer.displayName)…"
    }

    /// Push the local snapshot (JSON only) to every connected peer.
    public func sendSnapshot() {
        guard let snap = provideSnapshot?() else { return }
        if send(WireMessage(kind: .sync, sync: snap)) { status = "sent \(snap.notes.count) notes" }
    }

    public func sendChatRequest(_ id: String, prompt: String, sessionID: String?) {
        _ = send(WireMessage(kind: .chatRequest, requestID: id, text: prompt, sessionID: sessionID))
    }
    public func sendChatChunk(_ id: String, text: String) {
        _ = send(WireMessage(kind: .chatChunk, requestID: id, text: text))
    }
    public func sendChatDone(_ id: String, text: String, sessionID: String?) {
        _ = send(WireMessage(kind: .chatDone, requestID: id, text: text, sessionID: sessionID))
    }
    public func sendChatError(_ id: String, message: String) {
        _ = send(WireMessage(kind: .chatError, requestID: id, text: message))
    }

    @discardableResult
    private func send(_ msg: WireMessage) -> Bool {
        let peers = session.connectedPeers
        guard !peers.isEmpty else { return false }
        do {
            try session.send(try JSONEncoder().encode(msg), toPeers: peers, with: .reliable)
            return true
        } catch {
            status = "send failed: \(error.localizedDescription)"
            return false
        }
    }

    /// Stream asset files to connected peers, ONE AT A TIME. Serializing (vs the
    /// old fire-all-at-once double loop) keeps concurrent AWDL load low — the link
    /// flap that produced "Not in connected state … channel [3]" — and re-reads
    /// the live peer set before each file so a mid-batch disconnect aborts the rest.
    public func sendAssetFiles(_ files: [(name: String, url: URL)]) {
        guard !session.connectedPeers.isEmpty, !files.isEmpty else { return }
        sendAssetFile(files, 0)
    }

    private func sendAssetFile(_ files: [(name: String, url: URL)], _ index: Int) {
        guard index < files.count else {
            status = "sent \(files.count) image\(files.count == 1 ? "" : "s")"
            return
        }
        let peers = session.connectedPeers   // re-read per file (liveness)
        guard !peers.isEmpty else { return }
        let f = files[index]
        let group = DispatchGroup()
        for peer in peers {
            group.enter()
            session.sendResource(at: f.url, withName: f.name, toPeer: peer) { _ in group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            Task { @MainActor in self?.sendAssetFile(files, index + 1) }
        }
    }

    // MARK: main-actor mutations called from nonisolated delegate callbacks

    fileprivate func addDiscovered(_ peer: MCPeerID) {
        if !discoveredPeers.contains(peer) { discoveredPeers.append(peer) }
    }
    fileprivate func removeDiscovered(_ peer: MCPeerID) {
        discoveredPeers.removeAll { $0 == peer }
    }
    fileprivate func refreshConnected() {
        let wasConnected = !connectedPeers.isEmpty
        connectedPeers = session.connectedPeers
        status = connectedPeers.isEmpty ? "looking for nearby devices…"
                                        : "connected to \(connectedPeers.map(\.displayName).joined(separator: ", "))"
        if wasConnected && connectedPeers.isEmpty { onDisconnected?() }
    }
    fileprivate func handle(_ msg: WireMessage) {
        switch msg.kind {
        case .sync: if let s = msg.sync { onPayload?(s) }
        case .chatRequest: if let id = msg.requestID { onChatRequest?(id, msg.text ?? "", msg.sessionID) }
        case .chatChunk: if let id = msg.requestID { onChatChunk?(id, msg.text ?? "") }
        case .chatDone: if let id = msg.requestID { onChatDone?(id, msg.text ?? "", msg.sessionID) }
        case .chatError: if let id = msg.requestID { onChatError?(id, msg.text ?? "error") }
        }
    }
    fileprivate func deliverAsset(_ fileName: String, _ url: URL) { onAssetFile?(fileName, url) }
    fileprivate func setStatus(_ s: String) { status = s }
}

// Delegate callbacks arrive on framework queues; each hops to the main actor.
// `@preconcurrency import` lets the non-Sendable MC* types cross that boundary.

extension MultipeerSync: MCSessionDelegate {
    nonisolated public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        Task { @MainActor in self.refreshConnected() }
    }
    nonisolated public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let msg = try? JSONDecoder().decode(WireMessage.self, from: data) else { return }
        Task { @MainActor in self.handle(msg) }
    }
    nonisolated public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String,
                                    fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        guard error == nil, let localURL else { return }
        Task { @MainActor in self.deliverAsset(resourceName, localURL) }
    }
    nonisolated public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    nonisolated public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
}

extension MultipeerSync: MCNearbyServiceAdvertiserDelegate {
    nonisolated public func advertiser(_ advertiser: MCNearbyServiceAdvertiser,
                                       didReceiveInvitationFromPeer peerID: MCPeerID,
                                       withContext context: Data?,
                                       invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        // Single-user, both devices are mine → auto-accept.
        invitationHandler(true, session)
    }
    nonisolated public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        Task { @MainActor in self.setStatus("advertise failed: \(error.localizedDescription)") }
    }
}

extension MultipeerSync: MCNearbyServiceBrowserDelegate {
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID,
                                    withDiscoveryInfo info: [String: String]?) {
        Task { @MainActor in self.addDiscovered(peerID) }
    }
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        Task { @MainActor in self.removeDiscovered(peerID) }
    }
    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        Task { @MainActor in self.setStatus("browse failed: \(error.localizedDescription)") }
    }
}
