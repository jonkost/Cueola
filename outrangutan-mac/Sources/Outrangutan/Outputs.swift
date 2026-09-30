import Foundation

/// One output: a screen the picture goes to, like the web app's output
/// windows. Cues pick an output by number.
struct OutputConfig: Identifiable, Codable, Equatable {
    var id: Int                     // 1, 2, 3 or 4
    var label: String
    var screen: String?             // screen name; nil picks one on its own
    var audioDevice: String?        // for this output's video sound; nil uses the cue sound device

    static let most = 4

    init(id: Int, label: String? = nil, screen: String? = nil, audioDevice: String? = nil) {
        self.id = id
        self.label = label ?? "Output \(id)"
        self.screen = screen
        self.audioDevice = audioDevice
    }
}

/// Where sound goes, for the whole show.
struct AudioSettings: Codable, Equatable {
    var cueDevice: String?          // sound cues and video sound; nil is the Mac's default output
    var cueFirstChannel = 0         // cue sound plays on this channel and the next (0 is 1 and 2)
    var padDevice: String?          // pads; nil is the Mac's default output
    var padFirstChannel = 0         // pads play on this channel and the next (0 is 1 and 2)
    var duckUnderPads = false       // cue sound dips while a pad sounds
    var duckDb: Double = 12         // by this much

    init() {}

    // Shows saved before a setting existed still open.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cueDevice = try c.decodeIfPresent(String.self, forKey: .cueDevice)
        cueFirstChannel = try c.decodeIfPresent(Int.self, forKey: .cueFirstChannel) ?? 0
        padDevice = try c.decodeIfPresent(String.self, forKey: .padDevice)
        padFirstChannel = try c.decodeIfPresent(Int.self, forKey: .padFirstChannel) ?? 0
        duckUnderPads = try c.decodeIfPresent(Bool.self, forKey: .duckUnderPads) ?? false
        duckDb = try c.decodeIfPresent(Double.self, forKey: .duckDb) ?? 12
    }
}
