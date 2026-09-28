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
    var padDevice: String?          // pads; nil is the Mac's default output
    var padFirstChannel = 0         // pads play on this channel and the next (0 is 1 and 2)
}
