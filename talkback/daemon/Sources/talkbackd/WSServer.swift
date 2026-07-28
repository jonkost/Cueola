import Foundation
import Network

/// Local WebSocket control surface. Accepts plain-text commands
/// ("A on" / "A off" / "B on" / "B off" / "A gain 0.8" / "B gain 0.8" /
/// "state?") and pushes the current state as JSON to every connected client on
/// any change, so buttons can light up. Live peak levels stream at 10 Hz for
/// meters. Bound to loopback only; browser clients must also present an
/// allowed Origin header or the upgrade is rejected.
final class WSServer {

    private let state: ControlState
    private let port: UInt16
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private let queue = DispatchQueue(label: "talkbackd.ws")
    private var levelTimer: DispatchSourceTimer?

    init(state: ControlState, port: UInt16) {
        self.state = state
        self.port = port
    }

    func start() throws {
        let params = NWParameters.tcp
        // Loopback only: this is a local control surface, not a network service.
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        params.allowLocalEndpointReuse = true
        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        // Any webpage in a local browser can open a loopback socket, so gate
        // the upgrade on the Origin header before the handshake completes.
        wsOptions.setClientRequestHandler(queue) { _, additionalHeaders in
            let origin = additionalHeaders.first { $0.name.lowercased() == "origin" }?.value
            guard WSServer.isAllowed(origin: origin) else {
                log("rejected WebSocket upgrade from origin: \(origin ?? "(none)")")
                return NWProtocolWebSocket.Response(status: .reject, subprotocol: nil)
            }
            return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil)
        }
        params.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        let listener = try NWListener(using: params)
        self.listener = listener

        listener.newConnectionHandler = { [weak self] connection in
            self?.queue.async { self?.accept(connection) }
        }
        listener.stateUpdateHandler = { newState in
            switch newState {
            case .ready:
                log("WebSocket API listening on ws://127.0.0.1:\(self.port)")
            case .failed(let error):
                log("WebSocket listener failed: \(error)")
                exit(1)
            default:
                break
            }
        }
        listener.start(queue: queue)

        state.onChange = { [weak self] _, _ in
            self?.queue.async { self?.broadcastState() }
        }

        // Meters: peak levels to every client at 10 Hz. Quiet by design: no
        // log lines, nothing sent while nobody is connected.
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        timer.setEventHandler { [weak self] in self?.broadcastLevels() }
        timer.resume()
        levelTimer = timer
    }

    func stop() {
        levelTimer?.cancel()
        levelTimer = nil
        listener?.cancel()
        for (_, connection) in connections { connection.cancel() }
        connections.removeAll()
    }

    // MARK: - Origin allowlist

    /// Native clients (the Stream Deck plugin, CLI tools) send no Origin
    /// header; browser pages always do. Accept only the production site and
    /// local development hosts on any port.
    private static func isAllowed(origin: String?) -> Bool {
        guard let origin else { return true }
        let lower = origin.lowercased()
        if lower == "https://cueola.live" { return true }
        for host in ["http://localhost", "http://127.0.0.1"] {
            if lower == host || lower.hasPrefix(host + ":") { return true }
        }
        return false
    }

    // MARK: - Connections

    private func accept(_ connection: NWConnection) {
        let key = ObjectIdentifier(connection)
        connections[key] = connection
        connection.stateUpdateHandler = { [weak self] newState in
            switch newState {
            case .ready:
                self?.queue.async { self?.send(self?.stateJSON() ?? "", to: connection) }
            case .failed, .cancelled:
                self?.queue.async { self?.connections.removeValue(forKey: key) }
            default:
                break
            }
        }
        receiveLoop(connection)
        connection.start(queue: queue)
    }

    private func receiveLoop(_ connection: NWConnection) {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self else { return }
            if let data, let context, error == nil {
                let isText = context.protocolMetadata(definition: NWProtocolWebSocket.definition)
                    .flatMap { ($0 as? NWProtocolWebSocket.Metadata)?.opcode == .text } ?? false
                if isText, let text = String(data: data, encoding: .utf8) {
                    self.handle(command: text.trimmingCharacters(in: .whitespacesAndNewlines), from: connection)
                }
                self.receiveLoop(connection)
            } else {
                connection.cancel()
                self.connections.removeValue(forKey: ObjectIdentifier(connection))
            }
        }
    }

    // MARK: - Protocol

    private func handle(command: String, from connection: NWConnection) {
        let lower = command.lowercased()
        switch lower {
        case "a on":   state.set(bus: .a, on: true)
        case "a off":  state.set(bus: .a, on: false)
        case "b on":   state.set(bus: .b, on: true)
        case "b off":  state.set(bus: .b, on: false)
        case "state?": send(stateJSON(), to: connection)
        default:
            // "A gain 0.8" / "B gain 0.8": per-bus volume, clamped 0-1.
            let parts = lower.split(separator: " ")
            if parts.count == 3, parts[1] == "gain", let value = Float(parts[2]),
               parts[0] == "a" || parts[0] == "b" {
                state.set(bus: parts[0] == "a" ? .a : .b, gain: value)
            } else {
                send(#"{"type":"error","message":"unknown command"}"#, to: connection)
            }
        }
    }

    private func stateJSON() -> String {
        let gainA = String(format: "%.2f", state.gainA)
        let gainB = String(format: "%.2f", state.gainB)
        return #"{"type":"state","talkA":\#(state.talkA),"talkB":\#(state.talkB),"gainA":\#(gainA),"gainB":\#(gainB)}"#
    }

    private func broadcastLevels() {
        guard !connections.isEmpty else { return }
        let levels = state.levels
        let json = String(format: #"{"type":"levels","mic":%.3f,"a":%.3f,"b":%.3f}"#,
                          min(levels.mic, 1), min(levels.a, 1), min(levels.b, 1))
        for (_, connection) in connections { send(json, to: connection) }
    }

    private func broadcastState() {
        let json = stateJSON()
        log("state: A=\(state.talkA ? "ON " : "off") B=\(state.talkB ? "ON " : "off")")
        for (_, connection) in connections { send(json, to: connection) }
    }

    private func send(_ text: String, to connection: NWConnection) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        connection.send(content: text.data(using: .utf8),
                        contentContext: context,
                        isComplete: true,
                        completion: .contentProcessed { _ in })
    }
}
