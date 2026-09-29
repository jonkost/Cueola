import Foundation

/// What a MIDI control does. The same choices as the web Outrangutan.
public struct MidiBinding: Codable, Equatable {
    public enum Action: String, Codable, CaseIterable {
        case go, pause, stop, fadeStop, panic, cue, pad, master
    }
    public var action: Action
    /// The cue or pad id, for "cue" and "pad".
    public var ref: String
    /// Just learned: stays silent until the control that taught it is let go,
    /// so the very touch that learned it never fires anything.
    public var pending: Bool

    public init(action: Action, ref: String = "", pending: Bool = false) {
        self.action = action; self.ref = ref; self.pending = pending
    }
}

/// Turns MIDI messages into show actions, a line-by-line port of the web
/// app's onMidiMessage. Notes fire on note-on. A controller (CC) mapped to
/// a button fires when it crosses the middle going up; a CC mapped to
/// "master" sets the level.
public struct MidiRouter {
    public enum Outcome: Equatable {
        case none
        case learned(String)
        case fire(MidiBinding)
        case master(Double)
    }

    public var map: [String: MidiBinding]
    public var learning = false
    private var ccEdge: [String: UInt8] = [:]

    public init(map: [String: MidiBinding] = [:]) { self.map = map }

    /// A control's name in the map: "n:<channel>:<note>" or "cc:<channel>:<number>".
    public static func key(status: UInt8, d1: UInt8) -> String {
        ((status & 0xF0) == 0xB0 ? "cc" : "n") + ":\(status & 0x0F):\(d1)"
    }

    /// What a person reads: "C4, channel 1" or "CC 7, channel 1".
    public static func label(_ key: String) -> String {
        let parts = key.split(separator: ":")
        guard parts.count == 3, let ch = Int(parts[1]), let n = Int(parts[2]) else { return key }
        let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        let what = parts[0] == "cc" ? "CC \(n)" : "\(names[n % 12])\(n / 12 - 1)"
        return "\(what), channel \(ch + 1)"
    }

    public static func isFader(_ key: String) -> Bool { key.hasPrefix("cc:") }

    public mutating func handle(status: UInt8, d1: UInt8, d2: UInt8) -> Outcome {
        let type = status & 0xF0
        guard type == 0x90 || type == 0x80 || type == 0xB0 else { return .none }
        let key = Self.key(status: status, d1: d1)
        let release = type == 0x80 || d2 == 0
        if learning {
            // Learn on presses only: a release can never teach a control.
            if release { return .none }
            if map[key] == nil { map[key] = MidiBinding(action: type == 0xB0 ? .master : .go, pending: true) }
            learning = false
            return .learned(key)
        }
        guard var m = map[key] else { return .none }
        if m.pending {
            if release { m.pending = false; map[key] = m }
            if type == 0xB0 { ccEdge[key] = d2 }
            return .none
        }
        if type == 0xB0 {
            if m.action == .master { return .master(Double(d2) / 127) }
            let was = (ccEdge[key] ?? 0) > 63, now = d2 > 63
            ccEdge[key] = d2
            return now && !was ? .fire(m) : .none
        }
        if type == 0x90 && d2 > 0 { return .fire(m) }
        return .none
    }
}
