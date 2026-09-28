import OutrangutanCore
import AppKit
import AVFoundation
import Combine

/// The playback engine: the cue list, what is on air, and the transport
/// (GO, Pause, Stop, Fade, All Stop).
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

    @Published var cues: [Cue] { didSet { save(); loadDurations(); onCuesChanged?() } }
    @Published var standbyID: UUID? { didSet { if standbyID != oldValue { onTransport?() } } }
    @Published var outputScreen: String? { didSet { save(); if output.isOpen { output.open(on: outputScreen) } } }

    @Published private(set) var status: Status = .ready
    @Published private(set) var pictureCue: Cue?
    @Published private(set) var soundCue: Cue?
    /// Seconds left on what is on air. nil when nothing is counting.
    @Published private(set) var remaining: Double?
    @Published private(set) var durations: [UUID: Double] = [:]
    @Published private(set) var outputIsOpen = false
    /// Master volume, 0 to 1.2, like the web fader. The Mac plays 1.0 at most.
    @Published private(set) var masterGain: Double = 1
    @Published var notice: String?

    /// Called when what is on air changes, so the show link can tell the rundown.
    var onTransport: (() -> Void)?
    /// Called when a video, sound or still starts, with its length in seconds.
    var onClipStart: ((Cue, Double) -> Void)?
    /// Called when the cue list changes.
    var onCuesChanged: (() -> Void)?
    /// Called on every clock tick while something is counting.
    var onTick: (() -> Void)?

    let output = OutputWindowController()
    private let picturePlayer = AVPlayer()
    private let soundPlayer = AVPlayer()
    private var lastLane: CueKind = .video
    private var clock: Timer?
    private var endWatchers: [NSObjectProtocol] = []
    private var fadeTimer: Timer?
    private var fadeLevel: Double = 1

    init() {
        var show = ShowStore.load()
        // Cues saved before the rundown link had no lasting id. Give them one
        // each, in list order.
        for i in show.cues.indices where show.cues[i].wireID == nil {
            show.cues[i].wireID = Cue.newWireID(offsetMs: i)
        }
        cues = show.cues
        outputScreen = show.outputScreen
        masterGain = show.masterGain ?? 1
        standbyID = show.cues.first?.id
        // Play on time even when the app is behind other windows. Without
        // this, macOS may slow a background app down to save power.
        picturePlayer.automaticallyWaitsToMinimizeStalling = false
        soundPlayer.automaticallyWaitsToMinimizeStalling = false
        applyVolume()
        save()
        loadDurations()
        startClock()
    }

    var standbyCue: Cue? { cues.first { $0.id == standbyID } }

    func cue(wireID: String) -> Cue? {
        cues.first { $0.wireID == wireID }
            // Like the web app, a cue number works too.
            ?? Int(wireID).flatMap { n in cues.indices.contains(n - 1) ? cues[n - 1] : nil }
    }

    // MARK: Transport

    /// GO: fires the standby cue, then stands by the next one.
    @discardableResult
    func go() -> WireResult {
        guard let cue = standbyCue else { return refuse("Nothing is standing by.") }
        guard cue.fileIsThere else { return refuse("Can't find the file for \"\(cue.name)\". It may have moved.") }
        notice = nil
        cancelFade()
        switch cue.kind {
        case .video:
            play(cue, on: picturePlayer)
            output.showVideo(picturePlayer)
            pictureCue = cue
        case .still:
            guard let image = NSImage(contentsOf: cue.url) else { return refuse("Can't open the still \"\(cue.name)\".") }
            picturePlayer.pause()
            picturePlayer.replaceCurrentItem(with: nil)
            output.showStill(image)
            pictureCue = cue
        case .audio:
            play(cue, on: soundPlayer)
            soundCue = cue
        }
        lastLane = cue.kind == .audio ? .audio : .video
        if status == .paused { status = .ready }
        if let i = cues.firstIndex(of: cue), i + 1 < cues.count { standbyID = cues[i + 1].id }
        updateStatus()
        onClipStart?(cue, cue.kind == .still ? 0 : (durations[cue.id] ?? 0))
        return .done
    }

    /// Pause holds everything where it is. Press again to carry on.
    func togglePause() {
        if status == .paused {
            if pictureCue?.kind == .video { picturePlayer.play() }
            if soundCue != nil { soundPlayer.play() }
            status = .ready
            updateStatus()
            // The strip and the deck count from a start time, so a resume
            // re-anchors them.
            if let cue = pictureCue?.kind == .video ? pictureCue : soundCue { onClipStart?(cue, durations[cue.id] ?? 0) }
        } else if pictureCue?.kind == .video || soundCue != nil {
            picturePlayer.pause()
            soundPlayer.pause()
            status = .paused
            onTransport?()
        }
    }

    /// Stop: stops the lane that fired last (picture or sound).
    func stop() {
        cancelFade()
        if lastLane == .audio && soundCue != nil { stopSound() } else { stopPicture() }
        updateStatus()
    }

    /// All Stop: everything off, output to black.
    func allStop() {
        cancelFade()
        stopPicture()
        stopSound()
        updateStatus()
    }

    /// Fade and Stop All: picture and sound fade out together over one
    /// second, then everything stops.
    func fadeStopAll() {
        guard pictureCue != nil || soundCue != nil else { return allStop() }
        guard fadeTimer == nil else { return }
        let started = Date()
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let t = min(1, Date().timeIntervalSince(started) / 1.0)
            self.fadeLevel = 1 - t
            self.applyVolume()
            self.output.setLevel(Float(self.fadeLevel))
            if t >= 1 { self.allStop() }
        }
        RunLoop.main.add(timer, forMode: .common)
        fadeTimer = timer
    }

    func setGain(_ value: Double) {
        masterGain = min(1.2, max(0, value))
        applyVolume()
        save()
        onTransport?()
    }

    // MARK: Commands from the rundown and KeyWi Bird

    /// Runs one command from the show's shared record and says how it went.
    /// The actions and refusals match applyRemoteCommand in the web app.
    func runRemote(_ cmd: WireCommand) -> WireResult {
        var result = WireResult.done
        switch cmd.action {
        case "go": result = go()
        case "stop", "panic": allStop()
        case "fadeStop": fadeStopAll()
        case "pause":
            if pictureCue?.kind != .video && soundCue == nil { result = .refused("nothing playing") }
            else { togglePause() }
        case "cue":
            if let c = cue(wireID: cmd.cueId) {
                standbyID = c.id
                result = go()
            } else {
                result = .refused("cue \(cmd.cueId) is not on this Mac")
            }
        case "pad":
            result = .refused("sound effect pads are not in the Mac app yet")
        case "arm":
            if !arm(cmd.cueId) { result = .refused("cue \(cmd.cueId) is not on this Mac") }
        default:
            result = .refused("unknown action \(cmd.action)")
        }
        // A fire can carry the rundown's next standby on the same write.
        if !cmd.armCueId.isEmpty { arm(cmd.armCueId) }
        if !cmd.pads.isEmpty { notice = "The rundown fired sound effect pads. Pads are not in the Mac app yet." }
        return result
    }

    /// Stands a cue by without firing it. An empty id clears the standby.
    @discardableResult
    func arm(_ wireID: String) -> Bool {
        if wireID.isEmpty { standbyID = nil; return true }
        guard let c = cue(wireID: wireID) else { return false }
        standbyID = c.id
        return true
    }

    /// What is on air right now, for the rundown and KeyWi Bird.
    func liveState() -> LiveState {
        var s = LiveState()
        let counting: (Cue, AVPlayer)? = pictureCue?.kind == .video ? (pictureCue!, picturePlayer)
            : soundCue.map { ($0, soundPlayer) }
        if let (cue, player) = counting {
            s.status = status == .paused ? .pause : .play
            s.cueId = cue.wireID ?? ""
            s.name = cue.name
            s.type = cue.kind == .audio ? "audio" : "video"
            s.duration = durations[cue.id] ?? 0
            s.offset = player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0
            // Right after GO the clock has not ticked yet, so count from the
            // clip's length instead of saying 0 left.
            s.remaining = remaining ?? max(0, s.duration - (s.offset ?? 0))
        } else if let still = pictureCue {
            s.status = .play
            s.cueId = still.wireID ?? ""
            s.name = still.name
            s.type = "image"
            s.remaining = nil
        }
        s.outputsOpen = output.isOpen ? 1 : 0
        s.outputsReady = s.outputsOpen
        s.outputsTotal = 1
        s.gain = masterGain
        s.firstCueId = cues.first?.wireID ?? ""
        s.firstCueName = cues.first?.name ?? ""
        return s
    }

    // MARK: Cue list

    func add(urls: [URL]) {
        var made = urls.compactMap(Cue.make(from:))
        if made.count < urls.count { notice = "Some files were skipped. Outrangutan plays video, sound and still pictures." }
        guard !made.isEmpty else { return }
        for i in made.indices { made[i].wireID = Cue.newWireID(offsetMs: i) }
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
        onTransport?()
    }

    func openOutput() {
        if !output.isOpen { toggleOutput() }
    }

    // MARK: Inside

    private func refuse(_ reason: String) -> WireResult {
        notice = reason
        return .refused(reason)
    }

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

    private func cancelFade() {
        fadeTimer?.invalidate()
        fadeTimer = nil
        fadeLevel = 1
        applyVolume()
        output.setLevel(1)
    }

    private func applyVolume() {
        let v = Float(min(1, masterGain) * fadeLevel)
        picturePlayer.volume = v
        soundPlayer.volume = v
    }

    private func updateStatus() {
        defer { onTransport?() }
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
        onTick?()
    }

    private func loadDurations() {
        for cue in cues where cue.kind != .still && durations[cue.id] == nil && cue.fileIsThere {
            let asset = AVURLAsset(url: cue.url)
            Task { @MainActor [weak self] in
                guard let time = try? await asset.load(.duration), time.isNumeric else { return }
                self?.durations[cue.id] = time.seconds
                self?.onCuesChanged?()
            }
        }
    }

    private func save() {
        ShowStore.save(ShowFile(cues: cues, outputScreen: outputScreen, masterGain: masterGain))
    }
}
