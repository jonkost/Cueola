import Foundation
import OutrangutanCore
import UniformTypeIdentifiers

/// What a cue puts out: picture with sound, sound only, a still picture, or
/// a solid color matte (no file).
enum CueKind: String, Codable {
    case video, audio, still, matte

    var symbol: String {
        switch self {
        case .video: return "film"
        case .audio: return "speaker.wave.2.fill"
        case .still: return "photo"
        case .matte: return "square.fill"
        }
    }

    /// Stills and mattes are both pictures that hold; the rundown calls them "image".
    var holds: Bool { self == .still || self == .matte }
    var hasPicture: Bool { self != .audio }
    /// The type the rundown and KeyWi Bird read.
    var wireType: String { holds ? "image" : rawValue }
}

/// What happens after a cue starts, the same three as the web app.
enum ContinueMode: String, Codable, CaseIterable {
    case manual
    case autoContinue = "auto_continue"   // the next cue fires as this one starts
    case autoFollow = "auto_follow"       // the next cue fires when this one ends

    var label: String {
        switch self {
        case .manual: return "Manual"
        case .autoContinue: return "Continue"
        case .autoFollow: return "Follow"
        }
    }

    var help: String {
        switch self {
        case .manual: return "Waits for the next GO."
        case .autoContinue: return "The next cue fires as this one starts."
        case .autoFollow: return "The next cue fires when this one ends."
        }
    }
}

/// What a cue does when it reaches its end.
enum EndAction: String, Codable, CaseIterable {
    case stop    // cut: the picture goes to black, the sound stops
    case hold    // freeze on the last frame
    case black   // fade to black over 0.6 seconds

    var label: String {
        switch self {
        case .stop: return "Cut to black"
        case .hold: return "Hold last frame"
        case .black: return "Fade to black"
        }
    }
}

/// How a picture fills the screen.
enum Fit: String, Codable, CaseIterable {
    case contain   // all of it shows, bars where the shape differs
    case cover     // fills the screen, the edges may be cut
    case fill      // stretched to the screen

    var label: String {
        switch self {
        case .contain: return "Fit (show all)"
        case .cover: return "Fill (crop edges)"
        case .fill: return "Stretch"
        }
    }
}

/// One line in the cue list. The media file stays where it is on this Mac;
/// the cue only remembers where to find it. The settings use the web app's
/// names, so a show means the same thing in both.
struct Cue: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var path: String
    var kind: CueKind
    /// The name the rundown and KeyWi Bird use for this cue. It never changes,
    /// so a rundown row linked to it stays linked when the list is reordered.
    /// New ids sort in the order cues were added, like the web app's.
    var wireID: String?

    // Timing
    var preWait: Double = 0                     // seconds between GO and the cue starting
    var continueMode: ContinueMode = .manual
    var endAction: EndAction = .stop
    var duration: Double = 0                    // stills and mattes: seconds on screen, 0 holds
    // Trim and loop (video and sound)
    var trimIn: Double = 0
    var trimOut: Double?                        // nil plays to the end
    var loop = false
    // Sound
    var volume: Double = 1                      // 0 to 1
    // Fades
    var fadeIn: Double = 0                      // seconds, from black and silence
    var fadeOut: Double = 0                     // seconds before the end
    var xfade: Double = 0                       // seconds to dissolve from what is on air
    var fadeCurve: FadeCurve = .linear
    // Picture
    var fit: Fit = .contain
    var scale: Double = 1
    var posX: Double = 0                        // percent of the screen width, + is right
    var posY: Double = 0                        // percent of the screen height, + is down
    var color = "#000000"                       // mattes only
    // A sound effect pad that fires with this cue, after a delay
    var sfxPadId = ""
    var sfxDelay: Double = 0
    // Other
    var notes = ""
    var armed = true                            // false: GO skips this cue

    init(name: String, path: String, kind: CueKind, wireID: String? = nil) {
        self.name = name
        self.path = path
        self.kind = kind
        self.wireID = wireID
        // A still parks on its last frame by default, so an accidental timer
        // never blacks program (the web app's rule).
        endAction = kind.holds ? .hold : .stop
    }

    /// Reads a saved cue. Settings missing from an older save get their
    /// normal values, so every show saved before still opens.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        kind = try c.decode(CueKind.self, forKey: .kind)
        wireID = try c.decodeIfPresent(String.self, forKey: .wireID)
        preWait = try c.decodeIfPresent(Double.self, forKey: .preWait) ?? 0
        continueMode = try c.decodeIfPresent(ContinueMode.self, forKey: .continueMode) ?? .manual
        endAction = try c.decodeIfPresent(EndAction.self, forKey: .endAction) ?? (kind.holds ? .hold : .stop)
        duration = try c.decodeIfPresent(Double.self, forKey: .duration) ?? 0
        trimIn = try c.decodeIfPresent(Double.self, forKey: .trimIn) ?? 0
        trimOut = try c.decodeIfPresent(Double.self, forKey: .trimOut)
        loop = try c.decodeIfPresent(Bool.self, forKey: .loop) ?? false
        volume = try c.decodeIfPresent(Double.self, forKey: .volume) ?? 1
        fadeIn = try c.decodeIfPresent(Double.self, forKey: .fadeIn) ?? 0
        fadeOut = try c.decodeIfPresent(Double.self, forKey: .fadeOut) ?? 0
        xfade = try c.decodeIfPresent(Double.self, forKey: .xfade) ?? 0
        fadeCurve = try c.decodeIfPresent(FadeCurve.self, forKey: .fadeCurve) ?? .linear
        fit = try c.decodeIfPresent(Fit.self, forKey: .fit) ?? .contain
        scale = try c.decodeIfPresent(Double.self, forKey: .scale) ?? 1
        posX = try c.decodeIfPresent(Double.self, forKey: .posX) ?? 0
        posY = try c.decodeIfPresent(Double.self, forKey: .posY) ?? 0
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#000000"
        sfxPadId = try c.decodeIfPresent(String.self, forKey: .sfxPadId) ?? ""
        sfxDelay = try c.decodeIfPresent(Double.self, forKey: .sfxDelay) ?? 0
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        armed = try c.decodeIfPresent(Bool.self, forKey: .armed) ?? true
    }

    static func newWireID(offsetMs: Int = 0) -> String {
        let ms = Int(Date().timeIntervalSince1970 * 1000) + offsetMs
        let tail = String((0..<3).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
        return String(format: "og_%013d", ms) + tail
    }

    var url: URL { URL(fileURLWithPath: path) }
    /// A matte has no file, so it is always there.
    var fileIsThere: Bool { kind == .matte || FileManager.default.fileExists(atPath: path) }

    /// Makes a cue from a dropped or chosen file, or nil if it is not
    /// something Outrangutan can play.
    static func make(from url: URL) -> Cue? {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else { return nil }
        let kind: CueKind
        if type.conforms(to: .movie) || type.conforms(to: .video) {
            kind = .video
        } else if type.conforms(to: .audio) {
            kind = .audio
        } else if type.conforms(to: .image) {
            kind = .still
        } else {
            return nil
        }
        return Cue(name: url.deletingPathExtension().lastPathComponent, path: url.path, kind: kind, wireID: newWireID())
    }

    /// A solid color picture, like the web app's mattes.
    static func matte(named name: String, color: String) -> Cue {
        var cue = Cue(name: name, path: "", kind: .matte, wireID: newWireID())
        cue.color = color
        return cue
    }
}

/// Everything Outrangutan saves between launches.
struct ShowFile: Codable {
    var cues: [Cue] = []
    var outputScreen: String?
    var masterGain: Double?
    var pads: [Pad]?
    var banks: [PadBank]?
    var multiTrigger: Bool?
}

/// Saves the show to this Mac only, in
/// ~/Library/Application Support/Outrangutan/show.json.
/// Every change is saved at once, so a crash or a pulled plug loses nothing.
enum ShowStore {
    static var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Outrangutan", isDirectory: true)
            .appendingPathComponent("show.json")
    }

    static func load() -> ShowFile {
        guard let data = try? Data(contentsOf: fileURL),
              let show = try? JSONDecoder().decode(ShowFile.self, from: data) else { return ShowFile() }
        return show
    }

    static func save(_ show: ShowFile) {
        // Test mode reads your show but never changes it.
        if ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil { return }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(show).write(to: fileURL, options: .atomic)
        } catch {
            NSLog("Outrangutan could not save the show: \(error)")
        }
    }
}
