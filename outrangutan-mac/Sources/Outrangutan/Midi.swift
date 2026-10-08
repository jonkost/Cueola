import CoreMIDI
import OutrangutanCore
import SwiftUI

/// MIDI control: any MIDI box plugged into the Mac (a pad controller, a
/// fader box, a keyboard) can fire GO, Stop, a cue, a pad, or ride the
/// master level. Uses the Mac's own MIDI system, so a box just works when
/// plugged in, with no browser asking first.
final class MidiInput: ObservableObject {
    @Published private(set) var sources: [String] = []
    @Published private(set) var router: MidiRouter
    @Published var learning = false {
        didSet { router.learning = learning }
    }
    /// The control just learned, so Settings can point at it.
    @Published private(set) var lastLearned: String?

    private let engine: Engine
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var connected: Set<MIDIEndpointRef> = []
    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }

    init(engine: Engine) {
        self.engine = engine
        let saved = Self.off ? nil : UserDefaults.standard.data(forKey: "midiMap")
        router = MidiRouter(map: saved.flatMap { try? JSONDecoder().decode([String: MidiBinding].self, from: $0) } ?? [:])
        start()
    }

    /// The mappings, in a steady order for the list.
    var mappings: [(key: String, binding: MidiBinding)] {
        router.map.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    func set(_ key: String, action: MidiBinding.Action) {
        router.map[key]?.action = action
        router.map[key]?.pending = false
        if action != .cue && action != .pad { router.map[key]?.ref = "" }
        save()
    }

    func set(_ key: String, ref: String) {
        router.map[key]?.ref = ref
        save()
    }

    func remove(_ key: String) {
        router.map[key] = nil
        save()
    }

    // MARK: Inside

    private func start() {
        let status = MIDIClientCreateWithBlock("Outrangutan" as CFString, &client) { [weak self] note in
            // A box plugged in or out: listen to whatever is there now.
            if note.pointee.messageID == .msgSetupChanged {
                DispatchQueue.main.async { self?.connectAll() }
            }
        }
        guard status == noErr else { return }
        MIDIInputPortCreateWithProtocol(client, "Outrangutan in" as CFString, ._1_0, &port) { [weak self] list, _ in
            let messages = MidiInput.messages(in: list)
            guard !messages.isEmpty else { return }
            DispatchQueue.main.async { messages.forEach { self?.receive($0) } }
        }
        connectAll()
    }

    func connectAll() {
        var names: [String] = []
        var now: Set<MIDIEndpointRef> = []
        for i in 0..<MIDIGetNumberOfSources() {
            let source = MIDIGetSource(i)
            now.insert(source)
            if !connected.contains(source) { MIDIPortConnectSource(port, source, nil) }
            var name: Unmanaged<CFString>?
            if MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &name) == noErr, let n = name?.takeRetainedValue() {
                names.append(n as String)
            }
        }
        connected = now
        sources = names
    }

    /// Reads MIDI 1.0 channel messages out of a packet list.
    private static func messages(in list: UnsafePointer<MIDIEventList>) -> [(UInt8, UInt8, UInt8)] {
        var out: [(UInt8, UInt8, UInt8)] = []
        var packet = list.pointee.packet
        for _ in 0..<list.pointee.numPackets {
            let words = withUnsafeBytes(of: packet.words) { raw in
                Array(raw.bindMemory(to: UInt32.self).prefix(Int(packet.wordCount)))
            }
            for word in words where word >> 28 == 0x2 {
                out.append((UInt8((word >> 16) & 0xFF), UInt8((word >> 8) & 0x7F), UInt8(word & 0x7F)))
            }
            packet = MIDIEventPacketNext(&packet).pointee
        }
        return out
    }

    private func receive(_ m: (UInt8, UInt8, UInt8)) {
        let before = router.map
        let outcome = router.handle(status: m.0, d1: m.1, d2: m.2)
        // A learned control that was let go is ready: keep that.
        if router.map != before { save() }
        switch outcome {
        case .none:
            break
        case .learned(let key):
            learning = false
            lastLearned = key
            save()
        case .master(let level):
            engine.setGain(level)
        case .fire(let binding):
            engine.run(from: "MIDI, \(MidiRouter.label(MidiRouter.key(status: m.0, d1: m.1)))") {
                switch binding.action {
                case .go: engine.go()
                case .pause: engine.togglePause()
                case .stop: engine.stop()
                case .fadeStop: engine.fadeStopAll()
                case .panic: engine.allStop()
                case .cue:
                    if let cue = engine.cue(wireID: binding.ref) { engine.standbyID = cue.id; engine.go() }
                case .pad: engine.pads.fire(binding.ref)
                case .master: break
                }
            }
        }
    }

    private func save() {
        guard !Self.off else { return }
        UserDefaults.standard.set(try? JSONEncoder().encode(router.map), forKey: "midiMap")
    }

    /// Test mode only: plays a message as if a box sent it.
    func pretend(_ status: UInt8, _ d1: UInt8, _ d2: UInt8) { receive((status, d1, d2)) }
}

extension MidiBinding.Action {
    var label: String {
        switch self {
        case .go: return "GO"
        case .pause: return "Pause"
        case .stop: return "Stop"
        case .fadeStop: return "Fade and Stop All"
        case .panic: return "All Stop"
        case .cue: return "Fire a Cue"
        case .pad: return "Hit a Pad"
        case .master: return "Master Level"
        }
    }
}

/// Settings, MIDI: the boxes the Mac sees, and what each learned control does.
struct MidiSettings: View {
    @ObservedObject var midi: MidiInput
    @ObservedObject var engine: Engine

    var body: some View {
        Form {
            Section {
                if midi.sources.isEmpty {
                    Text("No MIDI box found. Plug one in; it shows up here.").foregroundStyle(.secondary)
                } else {
                    ForEach(midi.sources, id: \.self) { Label($0, systemImage: "pianokeys") }
                }
            } header: {
                Text("MIDI boxes")
            }
            Section {
                if midi.mappings.isEmpty {
                    Text("Nothing learned yet.").foregroundStyle(.secondary)
                }
                ForEach(midi.mappings, id: \.key) { item in
                    row(item.key, item.binding)
                }
                HStack {
                    Button(midi.learning ? "Waiting: Touch a Control\u{2026}" : "Learn a Control") { midi.learning.toggle() }
                        .buttonStyle(ActionStyle(prominent: true))
                        .tint(midi.learning ? .orange : .accentColor)
                    Spacer()
                }
            } header: {
                Text("Controls")
            } footer: {
                Text("Click Learn a Control, then press a button or move a fader on the box. Then pick what it does. A fader can ride the master level.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onDisappear { midi.learning = false }
    }

    @ViewBuilder
    private func row(_ key: String, _ binding: MidiBinding) -> some View {
        LabeledContent {
            HStack {
                Picker("Does", selection: Binding(get: { binding.action }, set: { midi.set(key, action: $0) })) {
                    ForEach(MidiBinding.Action.allCases.filter { $0 != .master || MidiRouter.isFader(key) }, id: \.self) {
                        Text($0.label).tag($0)
                    }
                }
                .labelsHidden()
                .frame(width: 150, alignment: .leading)
                if binding.action == .cue {
                    Picker("Cue", selection: Binding(get: { binding.ref }, set: { midi.set(key, ref: $0) })) {
                        Text("Pick a cue").tag("")
                        ForEach(Array(engine.cues.enumerated()), id: \.element.id) { i, cue in
                            Text("\(i + 1). \(cue.name)").tag(cue.wireID ?? "")
                        }
                    }
                    .labelsHidden()
                    .frame(width: 160, alignment: .leading)
                }
                if binding.action == .pad {
                    Picker("Pad", selection: Binding(get: { binding.ref }, set: { midi.set(key, ref: $0) })) {
                        Text("Pick a pad").tag("")
                        ForEach(engine.pads.pads) { pad in Text(pad.name).tag(pad.id) }
                    }
                    .labelsHidden()
                    .frame(width: 160, alignment: .leading)
                }
                if binding.action != .cue && binding.action != .pad {
                    // Keep the space, so every row's pickers line up.
                    Color.clear.frame(width: 160, height: 1)
                }
                Button(role: .destructive) { midi.remove(key) } label: { Image(systemName: "minus.circle") }
                    .buttonStyle(.borderless)
                    .help("Forget this control")
            }
        } label: {
            Text(MidiRouter.label(key))
            if midi.lastLearned == key { Text("Just learned").foregroundStyle(.orange) }
        }
    }
}
