import AppKit
import AVFoundation
import SwiftUI

/// Watch a folder: new media that lands in it joins the show by itself.
/// Point it at a shared Dropbox, Google Drive or iCloud folder, and a clip a
/// student drops in from anywhere shows up in the cue list (sounds can go to
/// the pads instead).
///
/// It only takes a file once it has finished arriving: its size and its
/// written-at time must stay the same for three looks in a row, and a cloud
/// placeholder that has not downloaded yet is left alone until it has. A
/// file that would not open is said in the Show Log and tried again when it
/// changes, and now and then meanwhile (a cloud file can finish downloading
/// without its size or time changing). A file written over after it joined
/// is a new file: it joins again, beside the old cue.
final class WatchFolder: ObservableObject {
    @Published private(set) var folder: URL?
    @Published var soundsToPads: Bool { didSet { save() } }
    @Published private(set) var lastAdded: String?

    /// What a file looked like at one look: the same file again, or a new one
    /// under the same name.
    struct Stamp: Equatable {
        let size: Int
        let modified: Date?
    }

    private let engine: Engine
    private var seen: Set<String> = []
    private var stamps: [String: Stamp] = [:]    // what each seen file looked like when it was taken
    private var growing: [String: (stamp: Stamp, steady: Int)] = [:]   // the last look, and how many looks it held
    private var checking: Set<String> = []
    private var looking = false
    private var broken: [String: (stamp: Stamp, looks: Int)] = [:]      // would not open like this; looks since
    private var timer: Timer?
    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }
    static var every: TimeInterval = 2
    /// How many looks a file that would not open waits before it is tried again unchanged.
    static var retestAfter = 15

    init(engine: Engine) {
        self.engine = engine
        let d = UserDefaults.standard
        soundsToPads = !Self.off && d.bool(forKey: "watch.soundsToPads")
        if !Self.off, let path = d.string(forKey: "watch.folder"), FileManager.default.fileExists(atPath: path) {
            folder = URL(fileURLWithPath: path, isDirectory: true)
            seen = Set(d.stringArray(forKey: "watch.seen") ?? [])
            start()
        }
    }

    /// Starts watching a folder. `takeWhatIsThere`: add the files already in
    /// it now, or only ones that arrive from here on.
    func watch(_ url: URL, takeWhatIsThere: Bool) {
        folder = url
        seen = takeWhatIsThere ? [] : Set(Self.mediaFiles(in: url).map(\.lastPathComponent))
        stamps = [:]
        growing = [:]
        broken = [:]
        save()
        start()
        engine.log.add(.file, "Watching the folder \u{201C}\(url.lastPathComponent)\u{201D} for new media")
        look()
    }

    func stop() {
        timer?.invalidate(); timer = nil
        if let folder { engine.log.add(.file, "Stopped watching \u{201C}\(folder.lastPathComponent)\u{201D}") }
        folder = nil
        seen = []
        stamps = [:]
        save()
    }

    /// Asks for a folder, then whether to take the files already there.
    func choose() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.prompt = "Watch"
        panel.message = "Pick a folder. New videos, sounds and stills that land in it join the show."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let already = Self.mediaFiles(in: url).count
        var take = false
        if already > 0 {
            let a = NSAlert()
            a.messageText = "Add the \(already) media \(already == 1 ? "file" : "files") already in \u{201C}\(url.lastPathComponent)\u{201D}?"
            a.informativeText = "New files that arrive later are added either way."
            a.addButton(withTitle: "Add Them")
            a.addButton(withTitle: "Only New Ones")
            take = a.runModal() == .alertFirstButtonReturn
        }
        watch(url, takeWhatIsThere: take)
    }

    // MARK: Inside

    private func start() {
        timer?.invalidate()
        let t = Timer(timeInterval: Self.every, repeats: true) { [weak self] _ in self?.look() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    /// One look at the folder. The listing runs off the main thread, so a
    /// slow network or cloud folder can never hold up GO.
    func look() {
        // Editing is locked for the show: new files wait until it unlocks.
        guard let folder, !engine.locked, !looking else { return }
        looking = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let found: [(url: URL, stamp: Stamp, placeholder: Bool)] = Self.mediaFiles(in: folder).map { url in
                let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .ubiquitousItemDownloadingStatusKey])
                let placeholder = v?.ubiquitousItemDownloadingStatus.map { $0 != .current && $0 != .downloaded } ?? false
                return (url, Stamp(size: v?.fileSize ?? 0, modified: v?.contentModificationDate), placeholder)
            }
            DispatchQueue.main.async { self?.consider(found, in: folder) }
        }
    }

    private func consider(_ found: [(url: URL, stamp: Stamp, placeholder: Bool)], in scanned: URL) {
        looking = false
        guard folder == scanned else { return }
        for (url, stamp, placeholder) in found {
            let name = url.lastPathComponent
            guard !checking.contains(name) else { continue }
            if seen.contains(name) {
                // Taken before. Written over since (a new size or time): it is
                // a new file, and joins again once it has finished arriving.
                guard let was = stamps[name] else { stamps[name] = stamp; continue }
                if was == stamp { continue }
                seen.remove(name); stamps[name] = nil
                save()
                engine.log.add(.file, "\u{201C}\(name)\u{201D} in the watched folder has changed. It joins once it finishes arriving.")
            }
            // A cloud file that is still only a placeholder: wait for it.
            guard !placeholder, stamp.size > 0 else { continue }
            // A file that would not open waits until it changes, or for a while:
            // a cloud file can finish downloading without its size or time changing.
            if let b = broken[name] {
                if b.stamp == stamp && b.looks < Self.retestAfter { broken[name] = (stamp, b.looks + 1); continue }
                if b.stamp == stamp { growing[name] = (stamp, 2) } else { broken[name] = nil }
            }
            // The same size and time three looks in a row, then a real test: it must open.
            if let g = growing[name], g.stamp == stamp { growing[name] = (stamp, g.steady + 1) } else { growing[name] = (stamp, 0); continue }
            guard let g = growing[name], g.steady >= 2 else { continue }
            growing[name] = nil
            checking.insert(name)
            Task { @MainActor [weak self] in
                let ok = await Self.opens(url)
                guard let self else { return }
                self.checking.remove(name)
                guard self.folder == scanned else { return }
                if ok { self.take(url, as: stamp) } else { self.wouldNotOpen(name, as: stamp) }
            }
        }
    }

    private func take(_ url: URL, as stamp: Stamp) {
        let name = url.lastPathComponent
        seen.insert(name)
        stamps[name] = stamp
        broken[name] = nil
        if soundsToPads && PadBoard.isSound(url) { engine.pads.add(urls: [url]) } else { engine.add(urls: [url]) }
        engine.log.add(.file, "Added \u{201C}\(name)\u{201D} from the watched folder")
        lastAdded = name
        save()
    }

    private func wouldNotOpen(_ name: String, as stamp: Stamp) {
        if broken[name]?.stamp != stamp {
            engine.log.add(.file, "\u{201C}\(name)\u{201D} in the watched folder would not open. It is tried again when the file changes, and now and then meanwhile.")
        }
        broken[name] = (stamp, 0)
    }

    /// True when the file really plays: a still opens as a picture; a video
    /// or sound loads, is playable and has a length.
    static func opens(_ url: URL) async -> Bool {
        if Cue.make(from: url)?.kind == .still { return NSImage(contentsOf: url) != nil }
        let asset = AVURLAsset(url: url)
        guard let playable = try? await asset.load(.isPlayable), playable,
              let length = try? await asset.load(.duration), length.isNumeric, length.seconds > 0 else { return false }
        return true
    }

    static func mediaFiles(in folder: URL) -> [URL] {
        let items = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                                                                   options: [.skipsHiddenFiles])) ?? []
        return items.filter { url in
            (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true && Cue.make(from: url) != nil
        }
    }

    private func save() {
        guard !Self.off else { return }
        let d = UserDefaults.standard
        d.set(folder?.path, forKey: "watch.folder")
        d.set(Array(seen), forKey: "watch.seen")
        d.set(soundsToPads, forKey: "watch.soundsToPads")
    }
}

/// Settings, General: the watched folder.
struct WatchFolderSection: View {
    @ObservedObject var watch: WatchFolder

    var body: some View {
        Section {
            if let folder = watch.folder {
                LabeledContent("Watching") {
                    Text(folder.lastPathComponent).lineLimit(1).truncationMode(.middle)
                }
                Toggle("Sounds become pads", isOn: $watch.soundsToPads)
                HStack {
                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([folder]) }
                    Button("Pick Another\u{2026}") { watch.choose() }
                    Spacer()
                    Button("Stop Watching", role: .destructive) { watch.stop() }
                }
                .buttonWidth(130)
                if let last = watch.lastAdded {
                    Text("Last added: \(last)").font(.callout).foregroundStyle(.secondary).lineLimit(2)
                }
            } else {
                HStack {
                    Text("Not watching a folder").foregroundStyle(.secondary)
                    Spacer()
                    Button("Watch a Folder\u{2026}") { watch.choose() }
                }
            }
        } header: {
            Text("Watch a folder")
        } footer: {
            Text("New videos, sounds and stills that land in the folder join the show on their own, once they finish arriving. Point it at a shared Dropbox or Google Drive folder so the crew can send clips from anywhere.")
                .foregroundStyle(.secondary)
        }
    }
}
