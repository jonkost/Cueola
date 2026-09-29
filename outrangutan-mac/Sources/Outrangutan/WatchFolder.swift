import AppKit
import AVFoundation
import SwiftUI

/// Watch a folder: new media that lands in it joins the show by itself.
/// Point it at a shared Dropbox, Google Drive or iCloud folder, and a clip a
/// student drops in from anywhere shows up in the cue list (sounds can go to
/// the pads instead).
///
/// It only takes a file once it has finished arriving: its size must stay
/// the same for two looks in a row, and a cloud placeholder that has not
/// downloaded yet is left alone until it has.
final class WatchFolder: ObservableObject {
    @Published private(set) var folder: URL?
    @Published var soundsToPads: Bool { didSet { save() } }
    @Published private(set) var lastAdded: String?

    private let engine: Engine
    private var seen: Set<String> = []
    private var growing: [String: (size: Int, steady: Int)] = [:]   // size at the last look, and how many looks it held
    private var checking: Set<String> = []
    private var broken: [String: Int] = [:]      // would not open at this size
    private var timer: Timer?
    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }
    static var every: TimeInterval = 2

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
        growing = [:]
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

    /// One look at the folder.
    func look() {
        // Editing is locked for the show: new files wait until it unlocks.
        guard let folder, !engine.locked else { return }
        for url in Self.mediaFiles(in: folder) {
            let name = url.lastPathComponent
            guard !seen.contains(name), !checking.contains(name) else { continue }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .ubiquitousItemDownloadingStatusKey])
            // A cloud file that is still only a placeholder: wait for it.
            if let status = values?.ubiquitousItemDownloadingStatus, status != .current, status != .downloaded { continue }
            let size = values?.fileSize ?? 0
            guard size > 0 else { continue }
            // A file that would not open waits until it changes.
            if broken[name] == size { continue }
            // The same size three looks in a row, then a real test: it must open.
            if let g = growing[name], g.size == size { growing[name] = (size, g.steady + 1) } else { growing[name] = (size, 0); continue }
            guard let g = growing[name], g.steady >= 2 else { continue }
            growing[name] = nil
            checking.insert(name)
            Task { @MainActor [weak self] in
                let ok = await Self.opens(url)
                guard let self else { return }
                self.checking.remove(name)
                guard self.folder == folder else { return }
                if ok { self.take(url) } else { self.broken[name] = size }
            }
        }
    }

    private func take(_ url: URL) {
        seen.insert(url.lastPathComponent)
        if soundsToPads && PadBoard.isSound(url) { engine.pads.add(urls: [url]) } else { engine.add(urls: [url]) }
        engine.log.add(.file, "Added \u{201C}\(url.lastPathComponent)\u{201D} from the watched folder")
        lastAdded = url.lastPathComponent
        save()
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
