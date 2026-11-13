import AppKit
import AVFoundation
import OutrangutanCore

/// One demo graphic in the built-in Library: a see-through picture, 1920 by
/// 1080, that goes to air on chroma green so a class can key it.
struct LibraryGraphic: Identifiable, Equatable {
    let id: String
    let name: String
    /// One short line: what it is and where it sits.
    let about: String

    static let all: [LibraryGraphic] = [
        LibraryGraphic(id: "lower-third", name: "Lower Third", about: "A name and a title, low on the left."),
        LibraryGraphic(id: "bug", name: "Bug", about: "A small station mark in the corner."),
        LibraryGraphic(id: "ots", name: "OTS", about: "An over-the-shoulder box beside the anchor."),
    ]
}

/// The Library that comes with Outrangutan: common sound effects and demo
/// graphics for teaching a key. Nothing is downloaded and nothing is a
/// recording. The app makes every file itself the first time, and keeps
/// them in ~/Library/Application Support/Outrangutan/Library, where a cue
/// or a pad finds them like any other media.
final class BuiltInLibrary: ObservableObject {
    static let shared = BuiltInLibrary()

    /// The green the graphics go to air on, the same as Add Matte, Chroma Green.
    static let chromaGreen = "#00B140"
    /// Goes up when a graphic's drawing changes, so the files are made again.
    static let graphicsVersion = 1

    /// Test mode keeps its Library in the test's own folder.
    static var testFolder: URL?
    static var folder: URL {
        testFolder ?? ShowStore.fileURL.deletingLastPathComponent().appendingPathComponent("Library", isDirectory: true)
    }

    /// True once every file is on the disk.
    @Published private(set) var ready = false
    /// Why the Library could not be made, in plain words.
    @Published private(set) var problem: String?
    private var making = false

    func url(for sound: LibrarySound) -> URL {
        Self.folder.appendingPathComponent("Sounds", isDirectory: true).appendingPathComponent(sound.name + ".wav")
    }

    func url(for graphic: LibraryGraphic) -> URL {
        Self.folder.appendingPathComponent("Graphics", isDirectory: true).appendingPathComponent(graphic.name + ".png")
    }

    private static var stamp: String { "\(LibrarySounds.version).\(graphicsVersion)" }
    private var stampURL: URL { Self.folder.appendingPathComponent("version.txt") }

    /// Makes any file that is missing (all of them, the first time or after
    /// an update changed a sound). The sounds are made off the main thread,
    /// so the show never waits for them.
    func prepare(then done: (() -> Void)? = nil) {
        let fm = FileManager.default
        let current = (try? String(contentsOf: stampURL, encoding: .utf8)) == Self.stamp
        let sounds = LibrarySounds.all.filter { !current || !fm.fileExists(atPath: url(for: $0).path) }
        let graphics = LibraryGraphic.all.filter { !current || !fm.fileExists(atPath: url(for: $0).path) }
        if sounds.isEmpty && graphics.isEmpty { ready = true; done?(); return }
        guard !making else { return }
        making = true
        ready = false
        problem = nil
        do {
            try fm.createDirectory(at: Self.folder.appendingPathComponent("Sounds"), withIntermediateDirectories: true)
            try fm.createDirectory(at: Self.folder.appendingPathComponent("Graphics"), withIntermediateDirectories: true)
            for g in graphics {
                guard let png = LibraryArt.png(g.id) else { throw CocoaError(.fileWriteUnknown) }
                try png.write(to: url(for: g), options: .atomic)
            }
        } catch {
            making = false
            problem = "The Library could not be saved on this Mac. (\(error.localizedDescription))"
            done?()
            return
        }
        let jobs = sounds.map { ($0.id, url(for: $0)) }
        let stampURL = stampURL, stamp = Self.stamp
        Task.detached(priority: .userInitiated) { [weak self] in
            var failure: String?
            for (id, file) in jobs {
                guard let sound = LibrarySounds.render(id) else { continue }
                do { try LibrarySounds.wav(sound).write(to: file, options: .atomic) }
                catch { failure = error.localizedDescription; break }
            }
            if failure == nil { try? stamp.write(to: stampURL, atomically: true, encoding: .utf8) }
            await MainActor.run { [failure] in
                guard let self else { return }
                self.making = false
                self.problem = failure.map { "The Library could not be saved on this Mac. (\($0))" }
                self.ready = failure == nil
                done?()
            }
        }
    }

    /// How long a sound runs, in seconds (read from its file).
    func length(of sound: LibrarySound) -> Double? {
        guard let file = try? AVAudioFile(forReading: url(for: sound)) else { return nil }
        return Double(file.length) / file.processingFormat.sampleRate
    }
}

/// Plays a Library sound so it can be heard before it is used. It plays on
/// the Mac's own sound output (System Settings, Sound), never through the
/// SFX pads or a cue, so trying a sound cannot change the show.
final class LibraryPreview: NSObject, ObservableObject, AVAudioPlayerDelegate {
    /// The sound playing now, by its Library id.
    @Published private(set) var playing: String?
    private var player: AVAudioPlayer?

    func toggle(_ sound: LibrarySound, at url: URL) {
        if playing == sound.id { stop(); return }
        stop()
        guard let p = try? AVAudioPlayer(contentsOf: url) else { return }
        // Test mode never makes a sound.
        if TestSnapshot.isOn { p.volume = 0 }
        p.delegate = self
        player = p
        playing = sound.id
        p.play()
    }

    func stop() {
        player?.stop()
        player = nil
        playing = nil
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player === player else { return }
            self.player = nil
            self.playing = nil
        }
    }
}

extension Engine {
    /// Adds a Library graphic to the end of the cue list as a still, keyed
    /// the way the Inspector's Key section does it: an Alpha key over chroma
    /// green. On air it is the graphic on green, full screen, ready for the
    /// switcher to key. Returns the new cue, or nil while editing is locked.
    @discardableResult
    func addLibraryGraphic(_ graphic: LibraryGraphic, at url: URL) -> Cue? {
        guard !locked else { notice = Engine.lockedNotice; return nil }
        guard var cue = Cue.make(from: url) else { return nil }
        noteUndo("Add Cue")
        cue.name = graphic.name
        cue.key.mode = .alpha
        cue.key.bg = BuiltInLibrary.chromaGreen
        cues.append(cue)
        standbyID = cue.id
        return cue
    }

    /// Adds a Library sound to the end of the cue list as a sound cue.
    @discardableResult
    func addLibrarySound(_ sound: LibrarySound, at url: URL) -> Cue? {
        guard !locked else { notice = Engine.lockedNotice; return nil }
        guard var cue = Cue.make(from: url) else { return nil }
        noteUndo("Add Cue")
        cue.name = sound.name
        cue.loop = sound.loops
        cues.append(cue)
        standbyID = cue.id
        return cue
    }
}
