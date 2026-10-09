import CryptoKit
import Foundation
import SwiftUI

/// What a cue does to OBS when it starts, the same choices as the web app.
enum ObsAction: String, Codable, CaseIterable {
    case none, scene, startRecord, stopRecord, startStream, stopStream

    var label: String {
        switch self {
        case .none: return "Nothing"
        case .scene: return "Switch Scene"
        case .startRecord: return "Start Recording"
        case .stopRecord: return "Stop Recording"
        case .startStream: return "Start Streaming"
        case .stopStream: return "Stop Streaming"
        }
    }
}

struct CueObs: Codable, Equatable {
    var action: ObsAction = .none
    var scene = ""

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = (try? c.decode(ObsAction.self, forKey: .action)) ?? .none
        scene = (try? c.decode(String.self, forKey: .scene)) ?? ""
    }
}

/// OBS Studio control, through OBS's own WebSocket server (OBS: Tools,
/// WebSocket Server Settings). The same protocol as the web app (version 5):
/// OBS says hello, we answer with the password proof, then send requests
/// and hear events.
///
/// A cue can switch a scene or start and stop recording or streaming when it
/// starts. A cue can also fire itself when OBS switches to a scene.
final class ObsClient: ObservableObject {
    static let shared = ObsClient()
    enum Status: Equatable { case off, connecting, connected, failed(String) }

    @Published private(set) var status: Status = .off
    @Published private(set) var scenes: [String] = []
    @Published private(set) var current = ""
    @Published private(set) var recording = false
    @Published private(set) var streaming = false

    // Where OBS is. Kept on this Mac only (Settings, OBS).
    @Published var host = UserDefaults.standard.string(forKey: "obs.host") ?? "localhost" { didSet { save() } }
    @Published var port = UserDefaults.standard.object(forKey: "obs.port") as? Int ?? 4455 { didSet { save() } }
    @Published var password = UserDefaults.standard.string(forKey: "obs.password") ?? "" { didSet { save() } }
    @Published var autoConnect = UserDefaults.standard.bool(forKey: "obs.auto") { didSet { save() } }

    /// Called when OBS switches its program scene.
    var onScene: ((String) -> Void)?
    /// Called with a line for the show log.
    var onLog: ((ShowLog.Kind, String) -> Void)?

    private var task: URLSessionWebSocketTask?
    /// The scene a cue just asked for. Its own switch never fires a cue, so
    /// a cue can not start itself again through OBS.
    private var ownScene: (name: String, at: Date)?
    private var seq = 0
    private var wanted = false
    private var retry: Timer?
    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }

    init() {
        if autoConnect && !Self.off { DispatchQueue.main.async { self.connect() } }
    }

    var isConnected: Bool { status == .connected }

    func connect() {
        wanted = true
        retry?.invalidate(); retry = nil
        task?.cancel(with: .goingAway, reason: nil)
        guard let url = URL(string: "ws://\(host.trimmingCharacters(in: .whitespaces)):\(port)") else {
            status = .failed("That address does not look right.")
            return
        }
        status = .connecting
        let t = URLSession.shared.webSocketTask(with: url)
        task = t
        t.resume()
        listen(t)
    }

    func disconnect() {
        wanted = false
        retry?.invalidate(); retry = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        status = .off
    }

    /// Runs a cue's OBS action, if OBS is connected.
    func fire(_ obs: CueObs, for cueName: String) {
        guard obs.action != .none, isConnected else { return }
        switch obs.action {
        case .scene:
            guard !obs.scene.isEmpty else { return }
            ownScene = (obs.scene, Date())
            request("SetCurrentProgramScene", ["sceneName": obs.scene])
        case .startRecord: request("StartRecord")
        case .stopRecord: request("StopRecord")
        case .startStream: request("StartStream")
        case .stopStream: request("StopStream")
        case .none: break
        }
        onLog?(.link, "OBS: \(obs.action == .scene ? "switch to \(obs.scene)" : obs.action.label.lowercased()) (with \(cueName))")
    }

    func refreshScenes() { request("GetSceneList") }

    // MARK: Inside

    private func listen(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.task === t else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(text)
                    self.listen(t)
                case .success(.data(let data)):
                    self.handle(String(decoding: data, as: UTF8.self))
                    self.listen(t)
                case .failure:
                    self.dropped(closeCode: t.closeCode.rawValue)
                @unknown default:
                    self.listen(t)
                }
            }
        }
    }

    private func dropped(closeCode: Int) {
        let was = status
        task = nil
        // 4009: OBS turned the password down. Trying again will not help.
        if closeCode == 4009 {
            wanted = false
            status = .failed("OBS turned down the password.")
            onLog?(.problem, "OBS turned down the password")
            return
        }
        status = .failed(was == .connected ? "Lost OBS. Trying again." : "Can't reach OBS. Is it open, with its WebSocket server on?")
        if was == .connected { onLog?(.problem, "Lost the connection to OBS") }
        // Keep trying every 5 seconds while it should be connected.
        guard wanted else { return }
        retry?.invalidate()
        retry = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            guard let self, self.wanted, self.task == nil else { return }
            self.connect()
        }
    }

    private func handle(_ text: String) {
        guard let m = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let op = m["op"] as? Int, let d = m["d"] as? [String: Any] else { return }
        switch op {
        case 0:   // Hello: prove we know the password, if OBS asks.
            var identify: [String: Any] = ["rpcVersion": 1]
            if let auth = d["authentication"] as? [String: Any], let salt = auth["salt"] as? String,
               let challenge = auth["challenge"] as? String {
                identify["authentication"] = Self.proof(password: password, salt: salt, challenge: challenge)
            }
            send(["op": 1, "d": identify])
        case 2:   // Identified
            status = .connected
            onLog?(.link, "Connected to OBS")
            request("GetSceneList")
            request("GetRecordStatus")
            request("GetStreamStatus")
        case 7:   // A reply
            let rd = d["responseData"] as? [String: Any] ?? [:]
            switch d["requestType"] as? String {
            case "GetSceneList":
                scenes = ((rd["scenes"] as? [[String: Any]]) ?? []).compactMap { $0["sceneName"] as? String }.reversed()
                current = rd["currentProgramSceneName"] as? String ?? current
            case "GetRecordStatus": recording = rd["outputActive"] as? Bool ?? false
            case "GetStreamStatus": streaming = rd["outputActive"] as? Bool ?? false
            default: break
            }
            if let st = d["requestStatus"] as? [String: Any], st["result"] as? Bool == false {
                onLog?(.problem, "OBS could not \(d["requestType"] as? String ?? "do that"): \(st["comment"] as? String ?? "no reason given")")
            }
        case 5:   // An event
            let data = d["eventData"] as? [String: Any] ?? [:]
            switch d["eventType"] as? String {
            case "CurrentProgramSceneChanged":
                current = data["sceneName"] as? String ?? ""
                if let own = ownScene, own.name == current, Date().timeIntervalSince(own.at) < 2 {
                    ownScene = nil
                } else {
                    onScene?(current)
                }
            case "SceneListChanged": request("GetSceneList")
            case "RecordStateChanged": recording = data["outputActive"] as? Bool ?? recording
            case "StreamStateChanged": streaming = data["outputActive"] as? Bool ?? streaming
            default: break
            }
        default:
            break
        }
    }

    private func request(_ type: String, _ data: [String: Any] = [:]) {
        seq += 1
        send(["op": 6, "d": ["requestType": type, "requestId": "og\(seq)", "requestData": data]])
    }

    private func send(_ object: [String: Any]) {
        guard let t = task, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        t.send(.string(text)) { _ in }
    }

    /// OBS's password proof: base64(sha256(base64(sha256(password + salt)) + challenge)).
    static func proof(password: String, salt: String, challenge: String) -> String {
        let secret = Data(SHA256.hash(data: Data((password + salt).utf8))).base64EncodedString()
        return Data(SHA256.hash(data: Data((secret + challenge).utf8))).base64EncodedString()
    }

    private func save() {
        guard !Self.off else { return }
        let d = UserDefaults.standard
        d.set(host, forKey: "obs.host"); d.set(port, forKey: "obs.port")
        d.set(password, forKey: "obs.password"); d.set(autoConnect, forKey: "obs.auto")
    }
}

/// Settings, OBS.
struct ObsSettings: View {
    @ObservedObject var obs: ObsClient

    var body: some View {
        Form {
            Section {
                TextField("Address", text: $obs.host)
                TextField("Port", value: $obs.port, format: .number.grouping(.never))
                SecureField("Password", text: $obs.password)
                Toggle("Connect when Outrangutan opens", isOn: $obs.autoConnect)
                HStack {
                    statusLabel
                    Spacer()
                    if obs.status == .off || isFailed {
                        Button("Connect") { obs.connect() }.keyboardShortcut(.defaultAction)
                    } else {
                        Button("Disconnect") { obs.disconnect() }
                    }
                }
                .buttonWidth(110)
            } header: {
                Text("OBS Studio")
            } footer: {
                Text("In OBS, open Tools, WebSocket Server Settings, turn the server on, and copy its port and password here. OBS on this Mac uses the address localhost.")
                    .foregroundStyle(.secondary)
            }
            if obs.isConnected {
                Section("Right now") {
                    LabeledContent("Program scene", value: obs.current.isEmpty ? "None" : obs.current)
                    LabeledContent("Recording") { onOff(obs.recording) }
                    LabeledContent("Streaming") { onOff(obs.streaming) }
                    LabeledContent("Scenes", value: "\(obs.scenes.count)")
                }
            }
        }
        .formStyle(.grouped)
    }

    private var isFailed: Bool { if case .failed = obs.status { return true }; return false }

    @ViewBuilder
    private var statusLabel: some View {
        switch obs.status {
        case .off: Label("Not connected", systemImage: "circle").foregroundStyle(.secondary)
        case .connecting: Label("Connecting\u{2026}", systemImage: "circle.dotted").foregroundStyle(.yellow)
        case .connected: Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed(let m): Label(m, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }

    private func onOff(_ on: Bool) -> some View {
        Text(on ? "On" : "Off").foregroundStyle(on ? .red : .secondary)
    }
}
