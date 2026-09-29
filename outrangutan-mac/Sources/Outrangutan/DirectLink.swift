import Foundation
import Network
import OutrangutanCore

/// The direct link: Cueola in a browser on THIS Mac (KeyWi Bird, the
/// rundown) sends playback commands straight here, in about a hundredth of a
/// second, and they keep working when the internet drops.
///
/// - Listens on this Mac only (127.0.0.1, port 47810). Nothing on the
///   network can reach it.
/// - Takes only pages from Cueola's own website (or a copy served on this
///   Mac for testing). Any other web page is turned away.
/// - Takes commands only for the show this Mac is on.
/// - Every command runs through the same run-once rules as the cloud, so
///   the cloud copy that follows it never plays it twice.
///
/// The browser side is cueola-mac-link.js.
final class DirectLink {
    static var port: UInt16 {
        // Test mode uses its own port, so it never meets the real app or a
        // real browser tab.
        ProcessInfo.processInfo.environment["OUTRANGUTAN_DIRECT_PORT"].flatMap(UInt16.init)
            ?? (TestSnapshot.isOn && TestSnapshot.scenario != "listen" ? 47819 : 47810)
    }

    private let link: ShowLink
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]
    /// Connections that said hello: only these count as Cueola pages.
    private var greeted: Set<ObjectIdentifier> = []
    private var lastCode = ""
    private var codeTimer: Timer?
    /// What went wrong starting up, if anything (another copy has the port).
    private(set) var problem: String?

    @MainActor
    init(link: ShowLink) {
        self.link = link
        start()
        // A show joined or left: tell every browser, so it knows whether its
        // fires belong here.
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkCode() }
        }
        RunLoop.main.add(t, forMode: .common)
        codeTimer = t
    }

    /// Only Cueola's own pages may connect.
    static func allowed(_ origin: String) -> Bool {
        let o = origin.lowercased()
        if ["https://cueola.live", "https://www.cueola.live", "https://jonkost.github.io"].contains(o) { return true }
        // A copy of Cueola served on this Mac, for building and testing.
        return o.range(of: #"^http://(localhost|127\.0\.0\.1)(:\d+)?$"#, options: .regularExpression) != nil
    }

    // MARK: Inside

    @MainActor
    private func start() {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.maximumMessageSize = 64 * 1024
        ws.setClientRequestHandler(.main) { _, headers in
            let origin = headers.first { $0.name.lowercased() == "origin" }?.value ?? ""
            return NWProtocolWebSocket.Response(status: DirectLink.allowed(origin) ? .accept : .reject,
                                                subprotocol: nil, additionalHeaders: nil)
        }
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.requiredInterfaceType = .loopback
        params.allowLocalEndpointReuse = true
        guard let port = NWEndpoint.Port(rawValue: Self.port), let listener = try? NWListener(using: params, on: port) else {
            problem = "The direct link could not start."
            return
        }
        listener.newConnectionHandler = { [weak self] conn in
            MainActor.assumeIsolated { self?.accept(conn) }
        }
        listener.stateUpdateHandler = { [weak self] state in
            if case .failed = state {
                MainActor.assumeIsolated {
                    self?.problem = "The direct link is off: another copy of Outrangutan is using it."
                    self?.link.engine.log.add(.problem, "The direct link to KeyWi on this Mac could not start. Is another copy of Outrangutan open?")
                }
            }
        }
        listener.start(queue: .main)
        self.listener = listener
    }

    @MainActor
    private func accept(_ conn: NWConnection) {
        let id = ObjectIdentifier(conn)
        clients[id] = conn
        conn.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch state {
                case .ready:
                    // Anything that has not said hello in 5 seconds is not a
                    // Cueola page (or was turned away): hang up.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak conn] in
                        guard let self, let conn, !self.greeted.contains(id) else { return }
                        conn.cancel()
                    }
                case .failed, .cancelled:
                    self.clients.removeValue(forKey: id)
                    if self.greeted.remove(id) != nil {
                        self.changed()
                        self.link.engine.log.add(.link, "Cueola on this Mac let go of the direct link")
                    }
                default: break
                }
            }
        }
        conn.start(queue: .main)
        receive(conn)
    }

    private func receive(_ conn: NWConnection) {
        conn.receiveMessage { [weak self] data, context, _, error in
            MainActor.assumeIsolated {
                guard let self else { return }
                if let data, !data.isEmpty,
                   let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
                   meta.opcode == .text {
                    self.handle(data, from: conn)
                }
                if error == nil { self.receive(conn) } else { conn.cancel() }
            }
        }
    }

    @MainActor
    private func handle(_ data: Data, from conn: NWConnection) {
        guard let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = msg["type"] as? String else { return }
        let theirCode = (Wire.string(msg["code"]) ?? "").uppercased()
        switch type {
        case "hello":
            if greeted.insert(ObjectIdentifier(conn)).inserted {
                changed()
                link.engine.log.add(.link, "Cueola on this Mac connected directly")
            }
            send(hello(), to: conn)
        case "command":
            guard greeted.contains(ObjectIdentifier(conn)), let cmd = WireCommand(msg["command"]) else { return }
            let ack: WireAck
            if link.code.isEmpty || theirCode != link.code {
                let why = link.code.isEmpty ? "Outrangutan for Mac is not on a show" : "Outrangutan for Mac is on show \(link.code)"
                ack = WireAck(commandId: cmd.commandId, origId: cmd.origId, result: .refused(why))
            } else {
                ack = link.runDirect(cmd)
            }
            send(["type": "ack", "commandId": ack.commandId, "origId": ack.origId, "ok": ack.result.ok,
                  "reason": ack.result.reason, "ts": ShowLink.now], to: conn)
        case "gain":
            guard greeted.contains(ObjectIdentifier(conn)), !link.code.isEmpty, theirCode == link.code, let v = Wire.number(msg["v"]) else { return }
            link.directGain(id: Wire.string(msg["id"]) ?? "", value: v)
        default:
            break
        }
    }

    @MainActor
    private func hello() -> [String: Any] {
        ["type": "hello", "app": "outrangutan-mac",
         "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
         "code": link.code]
    }

    @MainActor
    private func checkCode() {
        guard link.code != lastCode else { return }
        lastCode = link.code
        let h = hello()
        clients.values.forEach { send(h, to: $0) }
    }

    @MainActor
    private func changed() {
        link.directBrowsers = greeted.count
    }

    private func send(_ object: [String: Any], to conn: NWConnection) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "message", metadata: [meta])
        conn.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
    }
}
