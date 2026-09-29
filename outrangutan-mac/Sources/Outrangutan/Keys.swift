import AppKit
import SwiftUI

/// The show keys: which key does GO, Pause, Stop, Fade and All Stop. Change
/// them in Settings, Keys. They work anywhere in the app except while typing
/// in a box.
final class KeyMap: ObservableObject {
    enum Action: String, CaseIterable, Identifiable {
        case go, pause, stop, fade, allStop
        var id: String { rawValue }

        var label: String {
            switch self {
            case .go: return "GO"
            case .pause: return "Pause"
            case .stop: return "Stop"
            case .fade: return "Fade"
            case .allStop: return "All Stop"
            }
        }

        var help: String {
            switch self {
            case .go: return "Fires the cue standing by. While paused, carries on."
            case .pause: return "Holds everything. Press again to carry on."
            case .stop: return "Stops what fired last."
            case .fade: return "Fades picture, sound and pads out over one second."
            case .allStop: return "Everything off at once, pads too."
            }
        }

        var standard: Key {
            switch self {
            case .go: return Key(code: 49, name: "Space")
            case .pause: return Key(code: 35, name: "P")
            case .stop: return Key(code: 1, name: "S")
            case .fade: return Key(code: 3, name: "F")
            case .allStop: return Key(code: 53, name: "Esc")
            }
        }
    }

    /// One key on the keyboard: its code, and the name printed on it.
    struct Key: Codable, Equatable {
        var code: UInt16
        var name: String

        /// The name a pad hotkey would use for this key, if it is one.
        var padName: String { name.count == 1 ? name.lowercased() : "" }

        init(code: UInt16, name: String) { self.code = code; self.name = name }

        init(event: NSEvent) {
            code = event.keyCode
            let special: [UInt16: String] = [49: "Space", 53: "Esc", 36: "Return", 76: "Enter", 48: "Tab", 51: "Delete",
                                             117: "Forward Delete", 123: "\u{2190}", 124: "\u{2192}", 125: "\u{2193}", 126: "\u{2191}",
                                             122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7",
                                             100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12"]
            name = special[event.keyCode] ?? (event.charactersIgnoringModifiers ?? "?").uppercased()
        }
    }

    static let shared = KeyMap()

    @Published private(set) var keys: [Action: Key] = [:]
    /// True while Settings waits for a new key, so the key is not also
    /// taken as a show key.
    @Published var recording: Action?

    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }

    init() {
        let saved = Self.off ? nil : UserDefaults.standard.data(forKey: "showKeys")
        let stored = saved.flatMap { try? JSONDecoder().decode([String: Key].self, from: $0) } ?? [:]
        for action in Action.allCases { keys[action] = stored[action.rawValue] ?? action.standard }
    }

    func key(_ action: Action) -> Key { keys[action] ?? action.standard }
    func name(_ action: Action) -> String { key(action).name }

    /// The show action for a key press, if it is one.
    func action(for event: NSEvent) -> Action? {
        Action.allCases.first { key($0).code == event.keyCode }
    }

    /// Sets a key. If another show key had it, the two swap, so no key ever
    /// does two things.
    func set(_ action: Action, to key: Key) {
        if let other = Action.allCases.first(where: { $0 != action && self.key($0).code == key.code }) {
            keys[other] = self.key(action)
        }
        keys[action] = key
        save()
    }

    func resetAll() {
        for action in Action.allCases { keys[action] = action.standard }
        save()
    }

    var isStandard: Bool { Action.allCases.allSatisfy { key($0) == $0.standard } }

    private func save() {
        guard !Self.off else { return }
        let stored = Dictionary(uniqueKeysWithValues: keys.map { ($0.key.rawValue, $0.value) })
        UserDefaults.standard.set(try? JSONEncoder().encode(stored), forKey: "showKeys")
    }
}

/// Settings, Keys: one row per show key. Click a key, then press the new one.
struct KeySettings: View {
    @ObservedObject var keys = KeyMap.shared
    @ObservedObject var board: PadBoard
    @State private var watcher: Any?

    var body: some View {
        Form {
            Section {
                ForEach(KeyMap.Action.allCases) { action in
                    LabeledContent {
                        Button {
                            record(action)
                        } label: {
                            Text(keys.recording == action ? "Press a key\u{2026}" : keys.name(action))
                                .font(.body.weight(.semibold))
                                .frame(minWidth: 110)
                        }
                        .buttonStyle(.bordered)
                        .tint(keys.recording == action ? .accentColor : nil)
                    } label: {
                        Text(action.label)
                        Text(action.help)
                    }
                }
            } header: {
                Text("Show keys")
            } footer: {
                Text(conflictNote ?? "Click a key, then press the one you want. Picking a key another show key has swaps the two. Keys with Command, Control or Option stay with the menus.")
                    .foregroundStyle(conflictNote == nil ? Color.secondary : Color.orange)
            }
            Section {
                Button("Use the Standard Keys") { keys.resetAll() }
                    .disabled(keys.isStandard)
            }
        }
        .formStyle(.grouped)
        .onDisappear(perform: stopRecording)
    }

    /// A pad whose hotkey is also a show key: the show key wins.
    private var conflictNote: String? {
        let clashes = KeyMap.Action.allCases.compactMap { action -> String? in
            let name = keys.key(action).padName
            guard !name.isEmpty, let pad = board.pad(forKey: name) else { return nil }
            return "\u{201C}\(pad.name)\u{201D} also uses \(keys.name(action)). The \(action.label) key wins; give the pad another key."
        }
        return clashes.first
    }

    private func record(_ action: KeyMap.Action) {
        stopRecording()
        keys.recording = action
        watcher = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard keys.recording == action else { return event }
            if event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
                keys.set(action, to: KeyMap.Key(event: event))
            }
            stopRecording()
            return nil
        }
    }

    private func stopRecording() {
        if let watcher { NSEvent.removeMonitor(watcher) }
        watcher = nil
        keys.recording = nil
    }
}
