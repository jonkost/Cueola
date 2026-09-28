import AppKit
import AVFoundation
import Combine

/// The playback engine: the cue list, what is on air, and the transport
/// (GO, Pause, Stop, All Stop).
///
/// There are two lanes. The picture lane plays videos and stills to the
/// output. The sound lane plays sound-only cues, so a sound effect never
/// knocks the picture off air.
final class Engine: ObservableObject {
    enum Status: String {
        case ready = "READY"
        case playing = "ON AIR"
        case paused = "PAUSED"
        case holding = "HOLD"
    }

    @Published var cues: [Cue] { didSet { save(); loadDurations() } }
    @Published var standbyID: UUID?
    @Published var outputScreen: String? { didSet { save(); if output.isOpen { output.open(on: outputScreen) } } }

    @Published private(set) var status: Status = .ready
    @Published private(set) var pictureCue: Cue?
    @Published private(set) var soundCue: Cue?
    /// Seconds left on what is on air. nil when nothing is counting.
    @Published private(set) var remaining: Double?
    @Published private(set) var durations: [UUID: Double] = [:]
    @Published private(set) var outputIsOpen = false
    @Published var notice: String?

    let output = OutputWindowController()
    private let picturePlayer = AVPlayer()
    private let soundPlayer = AVPlayer()
    private var lastLane: CueKind = .video
    private var clock: Timer?
    private var endWatchers: [NSObjectProtocol] = []

    init() {
        let show = ShowStore.load()
        cues = show.cues
        outputScreen = show.outputScreen
        standbyID = show.cues.first?.id
        // Play on time even when the app is behind other windows. Without
        // this, macOS may slow a background app down to save power.
        picturePlayer.automaticallyWaitsToMinimizeStalling = false
        soundPlayer.automaticallyWaitsToMinimizeStalling = false
        loadDurations()
        startClock()
    }

    var standbyCue: Cue? { cues.first { $0.id == standbyID } }

    // MARK: Transport

    /// GO: fires the standby cue, then stands by the next one.
    func go() {
        guard let cue = standbyCue else { notice = "Nothing is standing by."; return }
        guard cue.fileIsThere else { notice = "Can't find the file for \"\(cue.name)\". It may have moved."; return }
        notice = nil
        switch cue.kind {
        case .video:
            play(cue, on: picturePlayer)
            output.showVideo(picturePlayer)
            pictureCue = cue
        case .still:
            guard let image = NSImage(contentsOf: cue.url) else { notice = "Can't open the still \"\(cue.name)\"."; return }
            picturePlayer.pause()
            picturePlayer.replaceCurrentItem(with: nil)
            output.showStill(image)
            pictureCue = cue
        case .audio:
            play(cue, on: soundPlayer)
            soundCue = cue
        }
        lastLane = cue.kind == .audio ? .audio : .video
        if let i = cues.firstIndex(of: cue), i + 1 < cues.count { standbyID = cues[i + 1].id }
        updateStatus()
    }

    /// Pause holds everything where it is. Press again to carry on.
    func togglePause() {
        if status == .paused {
            if pictureCue?.kind == .video { picturePlayer.play() }
            if soundCue != nil { soundPlayer.play() }
            status = .ready
            updateStatus()
        } else if pictureCue?.kind == .video || soundCue != nil {
            picturePlayer.pause()
            soundPlayer.pause()
            status = .paused
        }
    }

    /// Stop: stops the lane that fired last (picture or sound).
    func stop() {
        if lastLane == .audio && soundCue != nil { stopSound() } else { stopPicture() }
        updateStatus()
    }

    /// All Stop: everything off, output to black.
    func allStop() {
        stopPicture()
        stopSound()
        updateStatus()
    }

    // MARK: Cue list

    func add(urls: [URL]) {
        let made = urls.compactMap(Cue.make(from:))
        if made.count < urls.count { notice = "Some files were skipped. Outrangutan plays video, sound and still pictures." }
        guard !made.isEmpty else { return }
        cues.append(contentsOf: made)
        if standbyID == nil { standbyID = made.first?.id }
    }

    func remove(ids: Set<UUID>) {
        cues.removeAll { ids.contains($0.id) }
        if let id = standbyID, ids.contains(id) { standbyID = cues.first?.id }
    }

    // MARK: Output

    func toggleOutput() {
        if output.isOpen { output.close() } else { output.open(on: outputScreen) }
        outputIsOpen = output.isOpen
    }

    // MARK: Inside

    private func play(_ cue: Cue, on player: AVPlayer) {
        let item = AVPlayerItem(url: cue.url)
        player.replaceCurrentItem(with: item)
        let watcher = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in self?.ended(cue) }
        endWatchers.append(watcher)
        player.play()
    }

    /// A video that reaches its end cuts to black, like the web Outrangutan.
    private func ended(_ cue: Cue) {
        if cue == pictureCue { stopPicture() }
        if cue == soundCue { stopSound() }
        updateStatus()
    }

    private func stopPicture() {
        picturePlayer.pause()
        picturePlayer.replaceCurrentItem(with: nil)
        output.black()
        pictureCue = nil
    }

    private func stopSound() {
        soundPlayer.pause()
        soundPlayer.replaceCurrentItem(with: nil)
        soundCue = nil
    }

    private func updateStatus() {
        if status == .paused, pictureCue != nil || soundCue != nil { return }
        if pictureCue?.kind == .video || soundCue != nil {
            status = .playing
        } else if pictureCue?.kind == .still {
            status = .holding
        } else {
            status = .ready
        }
        if pictureCue == nil && soundCue == nil {
            endWatchers.forEach(NotificationCenter.default.removeObserver)
            endWatchers.removeAll()
        }
    }

    /// The clock ticks 30 times a second, on the main run loop in common
    /// mode so it keeps counting while a menu is open or the list scrolls.
    private func startClock() {
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    private func tick() {
        let player: AVPlayer?
        // Count the video if one is up. Otherwise count the sound, even over
        // a held still. A still on its own has nothing to count (HOLD).
        if pictureCue?.kind == .video { player = picturePlayer }
        else if soundCue != nil { player = soundPlayer }
        else { player = nil }
        guard let p = player, let item = p.currentItem, item.duration.isNumeric else {
            if remaining != nil { remaining = nil }
            return
        }
        remaining = max(0, item.duration.seconds - p.currentTime().seconds)
    }

    private func loadDurations() {
        for cue in cues where cue.kind != .still && durations[cue.id] == nil && cue.fileIsThere {
            let asset = AVURLAsset(url: cue.url)
            Task { @MainActor [weak self] in
                guard let time = try? await asset.load(.duration), time.isNumeric else { return }
                self?.durations[cue.id] = time.seconds
            }
        }
    }

    private func save() {
        ShowStore.save(ShowFile(cues: cues, outputScreen: outputScreen))
    }
}
