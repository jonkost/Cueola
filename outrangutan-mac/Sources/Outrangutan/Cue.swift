import Foundation
import UniformTypeIdentifiers

/// What a cue puts out: picture with sound, sound only, or a still picture.
enum CueKind: String, Codable {
    case video, audio, still

    var symbol: String {
        switch self {
        case .video: return "film"
        case .audio: return "speaker.wave.2.fill"
        case .still: return "photo"
        }
    }
}

/// One line in the cue list. The media file stays where it is on this Mac;
/// the cue only remembers where to find it.
struct Cue: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var path: String
    var kind: CueKind
    /// The name the rundown and KeyWi Bird use for this cue. It never changes,
    /// so a rundown row linked to it stays linked when the list is reordered.
    /// New ids sort in the order cues were added, like the web app's.
    var wireID: String?

    static func newWireID(offsetMs: Int = 0) -> String {
        let ms = Int(Date().timeIntervalSince1970 * 1000) + offsetMs
        let tail = String((0..<3).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
        return String(format: "og_%013d", ms) + tail
    }

    var url: URL { URL(fileURLWithPath: path) }
    var fileIsThere: Bool { FileManager.default.fileExists(atPath: path) }

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
}

/// Everything Outrangutan saves between launches.
struct ShowFile: Codable {
    var cues: [Cue] = []
    var outputScreen: String?
    var masterGain: Double?
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
