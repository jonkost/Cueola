import Foundation
import Network

/// Local WebSocket control surface. Accepts plain-text commands
/// ("A on" / "A off" / "B on" / "B off" / "state?") and pushes the current
/// state as JSON to every connected client on any change, so buttons can
/// light up. Bound to loopback only.
final class WSServer {

    private let state: ControlState
    private let port: UInt16
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private let queue = DispatchQueue(label: "talkbackd.ws")

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
    }

    func stop() {
        listener?.cancel()
        for (_, connection) in connections { connection.cancel() }
        connections.removeAll()
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
        switch command.lowercased() {
        case "a on":   state.set(bus: .a, on: true)
        case "a off":  state.set(bus: .a, on: false)
        case "b on":   state.set(bus: .b, on: true)
        case "b off":  state.set(bus: .b, on: false)
        case "state?": send(stateJSON(), to: connection)
        default:
            send(#"{"type":"error","message":"unknown command"}"#, to: connection)
        }
    }

    private func stateJSON() -> String {
        #"{"type":"state","talkA":\#(state.talkA),"talkB":\#(state.talkB)}"#
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
