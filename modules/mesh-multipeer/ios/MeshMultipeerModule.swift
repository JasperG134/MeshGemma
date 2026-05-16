import ExpoModulesCore
import MultipeerConnectivity
import UIKit

// MARK: - Event names

private let kEventStateChange    = "onStateChange"
private let kEventPeerFound      = "onPeerFound"
private let kEventPeerLost       = "onPeerLost"
private let kEventPeerStateChange = "onPeerStateChange"
private let kEventDataReceived   = "onDataReceived"

// MARK: - Records (JS <-> Swift bridge)

struct StartOptions: Record {
    @Field var serviceType: String = "meshgemma-mc"
    @Field var displayName: String = ""
    @Field var discoveryInfo: [String: String]?
}

struct DiscoveredPeerInfo: Record {
    @Field var name: String = ""
    @Field var info: [String: String] = [:]
}

// MARK: - Module

public final class MeshMultipeerModule: Module {

    // Strong refs — must live for the lifetime of the session.
    private var controller: MeshController?

    public func definition() -> ModuleDefinition {
        Name("MeshMultipeerModule")

        Events(
            kEventStateChange,
            kEventPeerFound,
            kEventPeerLost,
            kEventPeerStateChange,
            kEventDataReceived
        )

        AsyncFunction("start") { (options: StartOptions) -> Void in
            self.startMesh(options: options)
        }

        AsyncFunction("stop") { () -> Void in
            self.stopMesh()
        }

        AsyncFunction("send") { (payloadBase64: String, peerIds: [String]?) -> Bool in
            return self.sendPayload(base64: payloadBase64, peerNames: peerIds)
        }

        AsyncFunction("getConnectedPeers") { () -> [String] in
            return self.controller?.connectedPeerNames() ?? []
        }

        AsyncFunction("getDiscoveredPeers") { () -> [DiscoveredPeerInfo] in
            return self.controller?.discoveredPeerInfos() ?? []
        }

        AsyncFunction("invitePeer") { (peerName: String) -> Bool in
            return self.controller?.invitePeer(byName: peerName) ?? false
        }

        OnDestroy {
            self.stopMesh()
        }
    }

    // MARK: - Lifecycle

    private func startMesh(options: StartOptions) {
        if controller?.isRunning == true {
            NSLog("[MeshMultipeer] start() called while already running — ignoring")
            return
        }

        let rawName = options.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = rawName.isEmpty ? UIDevice.current.name : rawName
        // MCPeerID raises NSException for empty or > 63 UTF-8 bytes.
        let displayName = MeshMultipeerModule.truncateToUTF8Bytes(candidate, maxBytes: 63)
        if displayName.isEmpty {
            DispatchQueue.main.async { [weak self] in
                self?.sendEvent(kEventStateChange, [
                    "state": "error",
                    "message": "invalid displayName (empty after truncation)"
                ])
            }
            return
        }

        let serviceType = options.serviceType.isEmpty ? "meshgemma-mc" : options.serviceType

        // Apple requires serviceType: 1-15 chars, ASCII lowercase letters,
        // digits, or hyphens, must contain at least one ASCII letter, no
        // adjacent hyphens, no leading/trailing hyphens. Validate here
        // because invalid values raise NSException (not Swift Error) inside
        // MCNearbyServiceBrowser/Advertiser, which would crash the app.
        guard MeshMultipeerModule.isValidServiceType(serviceType) else {
            DispatchQueue.main.async { [weak self] in
                self?.sendEvent(kEventStateChange, [
                    "state": "error",
                    "message": "invalid serviceType '\(serviceType)' (1-15 chars, [a-z0-9-], must include a letter, no leading/trailing/adjacent hyphens)"
                ])
            }
            return
        }

        let ctrl = MeshController(
            displayName: displayName,
            serviceType: serviceType,
            discoveryInfo: options.discoveryInfo,
            emit: { [weak self] name, body in
                guard let self else { return }
                self.sendEvent(name, body)
            }
        )

        ctrl.start()
        self.controller = ctrl
        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(kEventStateChange, ["state": "started"])
        }
    }

    private func stopMesh() {
        guard let ctrl = self.controller else { return }
        ctrl.stop()
        self.controller = nil
        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(kEventStateChange, ["state": "stopped"])
        }
    }

    private static func truncateToUTF8Bytes(_ s: String, maxBytes: Int) -> String {
        if s.utf8.count <= maxBytes { return s }
        var out = ""
        var bytes = 0
        for ch in s {
            let chBytes = String(ch).utf8.count
            if bytes + chBytes > maxBytes { break }
            out.append(ch)
            bytes += chBytes
        }
        return out
    }

    private static func isValidServiceType(_ s: String) -> Bool {
        guard (1...15).contains(s.count) else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
        guard s.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        if s.hasPrefix("-") || s.hasSuffix("-") { return false }
        if s.contains("--") { return false }
        let letters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz")
        guard s.unicodeScalars.contains(where: { letters.contains($0) }) else { return false }
        return true
    }

    private func sendPayload(base64: String, peerNames: [String]?) -> Bool {
        guard let ctrl = self.controller else { return false }
        guard let data = Data(base64Encoded: base64) else {
            DispatchQueue.main.async { [weak self] in
                self?.sendEvent(kEventStateChange, [
                    "state": "error",
                    "message": "send failed: invalid base64 payload"
                ])
            }
            return false
        }
        return ctrl.send(data: data, peerNames: peerNames)
    }
}

// MARK: - Controller (delegate target)

final class MeshController: NSObject,
    MCSessionDelegate,
    MCNearbyServiceBrowserDelegate,
    MCNearbyServiceAdvertiserDelegate {

    typealias EventEmit = (String, [String: Any?]) -> Void

    private let myPeerID: MCPeerID
    private let serviceType: String
    private let discoveryInfo: [String: String]?
    private let emit: EventEmit

    private(set) var session: MCSession?
    private(set) var browser: MCNearbyServiceBrowser?
    private(set) var advertiser: MCNearbyServiceAdvertiser?

    // Synchronization queue for all internal state.
    private let stateQueue = DispatchQueue(label: "mesh-multipeer.state")

    // Discovered (not necessarily connected) peers, keyed by displayName.
    private var discovered: [String: (peerID: MCPeerID, info: [String: String])] = [:]

    private(set) var isRunning: Bool = false

    init(
        displayName: String,
        serviceType: String,
        discoveryInfo: [String: String]?,
        emit: @escaping EventEmit
    ) {
        self.myPeerID = MCPeerID(displayName: displayName)
        self.serviceType = serviceType
        self.discoveryInfo = discoveryInfo
        self.emit = emit
        super.init()
    }

    // MARK: - Lifecycle

    func start() {
        let session = MCSession(
            peer: myPeerID,
            securityIdentity: nil,
            encryptionPreference: .required
        )
        session.delegate = self
        self.session = session

        let browser = MCNearbyServiceBrowser(peer: myPeerID, serviceType: serviceType)
        browser.delegate = self
        self.browser = browser

        let advertiser = MCNearbyServiceAdvertiser(
            peer: myPeerID,
            discoveryInfo: discoveryInfo,
            serviceType: serviceType
        )
        advertiser.delegate = self
        self.advertiser = advertiser

        browser.startBrowsingForPeers()
        advertiser.startAdvertisingPeer()

        stateQueue.sync {
            self.isRunning = true
            self.discovered.removeAll()
        }
    }

    func stop() {
        browser?.stopBrowsingForPeers()
        advertiser?.stopAdvertisingPeer()
        session?.disconnect()

        browser?.delegate = nil
        advertiser?.delegate = nil
        session?.delegate = nil

        browser = nil
        advertiser = nil
        session = nil

        stateQueue.sync {
            self.isRunning = false
            self.discovered.removeAll()
        }
    }

    // MARK: - Public queries

    func connectedPeerNames() -> [String] {
        guard let session = self.session else { return [] }
        return session.connectedPeers.map { $0.displayName }
    }

    func discoveredPeerInfos() -> [DiscoveredPeerInfo] {
        return stateQueue.sync {
            return self.discovered.values.map { entry in
                var r = DiscoveredPeerInfo()
                r.name = entry.peerID.displayName
                r.info = entry.info
                return r
            }
        }
    }

    // MARK: - Send

    func send(data: Data, peerNames: [String]?) -> Bool {
        guard let session = self.session else { return false }
        let connected = session.connectedPeers
        if connected.isEmpty { return false }

        let targets: [MCPeerID]
        if let names = peerNames, !names.isEmpty {
            let nameSet = Set(names)
            targets = connected.filter { nameSet.contains($0.displayName) }
        } else {
            targets = connected
        }
        if targets.isEmpty { return false }

        do {
            try session.send(data, toPeers: targets, with: .reliable)
            return true
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.emit(kEventStateChange, [
                    "state": "error",
                    "message": "send failed: \(error.localizedDescription)"
                ])
            }
            return false
        }
    }

    // MARK: - Invite

    func invitePeer(byName name: String) -> Bool {
        guard let session = self.session, let browser = self.browser else { return false }
        let target: MCPeerID? = stateQueue.sync {
            return self.discovered[name]?.peerID
        }
        guard let peerID = target else { return false }
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 30)
        return true
    }

    // MARK: - MCNearbyServiceBrowserDelegate

    func browser(
        _ browser: MCNearbyServiceBrowser,
        foundPeer peerID: MCPeerID,
        withDiscoveryInfo info: [String: String]?
    ) {
        let safeInfo = info ?? [:]
        stateQueue.sync {
            self.discovered[peerID.displayName] = (peerID: peerID, info: safeInfo)
        }

        // Auto-invite the peer (mesh: both sides advertise + browse).
        if let session = self.session {
            browser.invitePeer(peerID, to: session, withContext: nil, timeout: 30)
        }

        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventPeerFound, [
                "name": peerID.displayName,
                "info": safeInfo
            ])
        }
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        stateQueue.sync {
            self.discovered.removeValue(forKey: peerID.displayName)
        }
        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventPeerLost, ["name": peerID.displayName])
        }
    }

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventStateChange, [
                "state": "error",
                "message": "browser didNotStart: \(error.localizedDescription)"
            ])
        }
    }

    // MARK: - MCNearbyServiceAdvertiserDelegate

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didReceiveInvitationFromPeer peerID: MCPeerID,
        withContext context: Data?,
        invitationHandler: @escaping (Bool, MCSession?) -> Void
    ) {
        // Auto-accept all invitations into our session.
        guard let session = self.session else {
            invitationHandler(false, nil)
            return
        }
        invitationHandler(true, session)
    }

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didNotStartAdvertisingPeer error: Error
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventStateChange, [
                "state": "error",
                "message": "advertiser didNotStart: \(error.localizedDescription)"
            ])
        }
    }

    // MARK: - MCSessionDelegate

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let stateString: String
        switch state {
        case .connecting:    stateString = "connecting"
        case .connected:     stateString = "connected"
        case .notConnected:  stateString = "notConnected"
        @unknown default:    stateString = "notConnected"
        }
        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventPeerStateChange, [
                "name": peerID.displayName,
                "state": stateString
            ])
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        let b64 = data.base64EncodedString()
        DispatchQueue.main.async { [weak self] in
            self?.emit(kEventDataReceived, [
                "from": peerID.displayName,
                "payloadBase64": b64
            ])
        }
    }

    func session(
        _ session: MCSession,
        didReceive stream: InputStream,
        withName streamName: String,
        fromPeer peerID: MCPeerID
    ) {
        // Streams are unused; close immediately.
        stream.close()
    }

    func session(
        _ session: MCSession,
        didStartReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        with progress: Progress
    ) {
        // Resource transfer is unused.
    }

    func session(
        _ session: MCSession,
        didFinishReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        at localURL: URL?,
        withError error: Error?
    ) {
        // Resource transfer is unused.
    }

    func session(
        _ session: MCSession,
        didReceiveCertificate certificate: [Any]?,
        fromPeer peerID: MCPeerID,
        certificateHandler: @escaping (Bool) -> Void
    ) {
        // Accept all certs (encryption is .required which gives us TLS).
        certificateHandler(true)
    }
}
