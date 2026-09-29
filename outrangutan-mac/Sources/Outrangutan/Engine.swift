import OutrangutanCore
import AppKit
import AVFoundation
import Combine

/// One player: a video or a sound, with its own fade levels.
final class Deck {
    let name: String
    let player = AVPlayer()
    let slot: PictureSlot?          // nil for the sound lane
    var cue: Cue?
    var pictureLevel: Double = 1    // 0 is black
    var soundLevel: Double = 1      // 0 is silent
    var held = false                // parked on its last frame: finished
    var fadingOut = false
    var views: [OutputView] = []    // the outputs this deck's picture is on
    /// The key on this deck's video, if the cue has one.
    var keyer: Keyer?
    /// How loud this deck's sound is, for the cue meter.
    var peaks: PeakBox?
    /// Hands over frames for the scopes; only there while the scopes are on.
    var frames: AVPlayerItemVideoOutput?
    var lastFrame: CIImage?
    private var tokens: [Any] = []
    private var watchers: [NSObjectProtocol] = []

    init(name: String, slot: PictureSlot?) {
        self.name = name
        self.slot = slot
        // Play on time: never wait to build a cushion, the files are local.
        player.automaticallyWaitsToMinimizeStalling = false
        // Test mode never makes a sound.
        player.isMuted = TestSnapshot.isOn
    }

    var current: Double {
        let t = player.currentTime().seconds
        return t.isFinite ? t : 0
    }

    /// Where the cue ends: its trim out point, or the end of the file.
    var end: Double? {
        if let out = cue?.trimOut { return out }
        guard let d = player.currentItem?.duration, d.isNumeric else { return nil }
        return d.seconds
    }

    var remaining: Double? { end.map { max(0, $0 - current) } }

    /// Loads a cue and calls `ended` when it reaches its end (or trim out).
    func load(_ cue: Cue, device: String?, ended: @escaping () -> Void) {
        clearWatchers()
        self.cue = cue
        held = false
        fadingOut = false
        // Which sound output this player uses. nil is the Mac's default.
        player.audioOutputDeviceUniqueID = device
        let item = AVPlayerItem(url: cue.url)
        frames = nil
        lastFrame = nil
        keyer = nil
        if cue.kind == .video && cue.key.mode != .off { key(item, cue.key) }
        let box = PeakBox()
        peaks = box
        Task { await SoundTap.attach(to: item, box: box) }
        player.replaceCurrentItem(with: item)
        if let out = cue.trimOut, out > cue.trimIn {
            let at = NSValue(time: CMTime(seconds: out, preferredTimescale: 600))
            tokens.append(player.addBoundaryTimeObserver(forTimes: [at], queue: .main, using: ended))
        }
        watchers.append(NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in ended() })
    }

    /// Runs the key on this deck's video. Later changes go through
    /// `keyer.update` and show on the next frame.
    func key(_ item: AVPlayerItem, _ settings: VideoKey) {
        let k = Keyer(settings)
        item.videoComposition = k.composition(for: item.asset)
        keyer = k
    }

    /// Starts from the trim in point, or later when picking up where a
    /// show left off.
    func start(at offset: Double? = nil) {
        guard let cue else { return }
        let from = max(cue.trimIn, offset ?? 0)
        if from > 0 {
            player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        player.play()
    }

    func rewindAndPlay() {
        player.seek(to: CMTime(seconds: cue?.trimIn ?? 0, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        player.play()
    }

    func clear() {
        clearWatchers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        cue = nil
        held = false
        fadingOut = false
        pictureLevel = 1
        soundLevel = 1
    }

    private func clearWatchers() {
        tokens.forEach { player.removeTimeObserver($0) }
        tokens.removeAll()
        watchers.forEach(NotificationCenter.default.removeObserver)
        watchers.removeAll()
    }
}

/// The playback engine: the cue list, what is on air, and the transport
/// (GO, Pause, Stop, Fade, All Stop). The rules follow the web Outrangutan:
/// pre-wait, Continue and Follow, end actions, still timers, trim and loop.
///
/// There are two lanes. The picture lane plays videos, stills and mattes to
/// the output. The sound lane plays sound-only cues, so a sound never knocks
/// the picture off air. Each lane has two players, so one cue can dissolve
/// into the next.
final class Engine: ObservableObject {
    enum Status: String {
        case ready = "READY"
        case pre = "PRE-WAIT"
        case playing = "ON AIR"
        case paused = "PAUSED"
        case holding = "HOLD"
    }

    @Published var cues: [Cue] { didSet { save(); loadDurations(); onCuesChanged?() } }
    @Published var standbyID: UUID? { didSet { if standbyID != oldValue { onTransport?() } } }
    /// The outputs, in order. There is always at least one.
    @Published var outputs: [OutputConfig] { didSet { outputsChanged() } }
    /// Where sound goes.
    @Published var audio: AudioSettings { didSet { audioChanged() } }

    @Published private(set) var status: Status = .ready
    @Published private(set) var pictureCue: Cue?
    @Published private(set) var soundCue: Cue?
    /// Seconds left on what is on air. nil when nothing is counting.
    @Published private(set) var remaining: Double?
    /// Seconds left in a pre-wait, while one runs.
    @Published private(set) var preRemaining: Double?
    @Published private(set) var pendingCue: Cue?
    @Published private(set) var durations: [UUID: Double] = [:]
    /// Outputs whose window is open now.
    @Published private(set) var openOutputs: Set<Int> = []
    /// Master volume, 0 to 1.2, like the web fader. The Mac plays 1.0 at most.
    @Published private(set) var masterGain: Double = 1
    @Published var notice: String?
    /// Locked: the show runs, but nothing can be added, removed, moved or
    /// changed. Keeps a stray click from editing the show on air.
    @Published var locked = !TestSnapshot.isOn && UserDefaults.standard.bool(forKey: "showLock") {
        didSet {
            guard locked != oldValue else { return }
            pads.locked = locked
            if !TestSnapshot.isOn { UserDefaults.standard.set(locked, forKey: "showLock") }
            log.add(.file, locked ? "Editing locked" : "Editing unlocked")
        }
    }
    /// What was on air when Outrangutan last closed without quitting, if
    /// anything (a crash, a force quit, a pulled plug).
    @Published var recovered: RecoveryPoint?

    /// Called when what is on air changes, so the show link can tell the rundown.
    var onTransport: (() -> Void)?
    /// Called when a cue starts (after its pre-wait), for OBS.
    var onCueBegan: ((Cue) -> Void)?
    /// Called when a video, sound or still starts, with its length in seconds.
    var onClipStart: ((Cue, Double) -> Void)?
    /// Called when the cue list changes.
    var onCuesChanged: (() -> Void)?
    /// Called on every clock tick while something is counting.
    var onTick: (() -> Void)?

    /// Words on every output while nothing is on air ("We'll be right
    /// back"). Empty shows black.
    @Published var standbyText = "" {
        didSet {
            guard standbyText != oldValue else { return }
            windows.values.forEach { $0.pictureView.standbyText = standbyText }
            monitor.standbyText = standbyText
            save()
        }
    }

    /// How long the counting cue runs, for a clock that counts up.
    var countingLength: Double? {
        guard let cue = countingCue else { return nil }
        return cue.kind.holds ? cue.duration : playLength(cue)
    }

    /// The program preview in the control window: a copy of one output,
    /// drawn by the same layers.
    let monitor = OutputView()
    /// Which output the preview shows.
    @Published var monitorOutput = 1 {
        didSet { if monitorOutput != oldValue { monitor.black() } }
    }
    /// True while the scopes want frames.
    var wantsFrames = false {
        didSet { if wantsFrames { videoDecks.forEach(attachFrames) } }
    }
    private var stillFrame: (id: UUID, image: CIImage)?

    /// How loud the cues are (videos and sound cues), for the meter.
    let cueMeter = LevelMeter()

    /// The sound effect board.
    let pads: PadBoard
    /// What happened in the show, for the Show Log window.
    let log = ShowLog()
    /// Who asked for what is happening now, for the log.
    private var source = ShowLog.thisMac
    private var windows: [Int: OutputWindowController] = [:]
    private var stillViews: [OutputView] = []
    private let fader = Fader()
    private let videoDecks = [Deck(name: "a", slot: .a), Deck(name: "b", slot: .b)]
    private let soundDecks = [Deck(name: "sa", slot: nil), Deck(name: "sb", slot: nil)]
    private var pictureDeck: Deck?
    private var soundDeck: Deck?
    private var lastLane: CueKind = .video

    // The still or matte on air
    private var stillCue: Cue?
    private var stillSlot: PictureSlot = .s1
    private var stillLevel: Double = 1
    private var stillHeld = false
    private var stillTimer: Timer?
    private var stillEndsAt: Date?
    private var stillLeft: Double?          // seconds left while paused

    // A cue waiting out its pre-wait
    private var pending: (cue: Cue, at: Date, timer: Timer)?
    private var pendingLeft: Double?        // seconds left while paused

    private var paused = false
    private var clock: Timer?
    /// The next fire of this cue starts at this point instead of the top.
    private var pendingResume: (id: UUID, offset: Double)?
    private var lastRecoveryWrite = Date.distantPast
    private var recoveryNoted = false

    init() {
        var show = ShowStore.load()
        // Cues saved before the rundown link had no lasting id, and ids made
        // before 9/29 sorted backwards. Give them new ones, in list order.
        for i in show.cues.indices where show.cues[i].wireID == nil || Cue.isBackwardsID(show.cues[i].wireID) {
            show.cues[i].wireID = Cue.newWireID(offsetMs: i)
        }
        if var saved = show.pads {
            var renamed: [String: String] = [:]
            for i in saved.indices where Cue.isBackwardsID(saved[i].id) {
                let id = Pad.newID(offsetMs: i)
                renamed[saved[i].id] = id
                saved[i].id = id
            }
            for i in show.cues.indices { if let id = renamed[show.cues[i].sfxPadId] { show.cues[i].sfxPadId = id } }
            show.pads = saved
        }
        cues = show.cues
        outputs = (show.outputs?.isEmpty == false) ? show.outputs! : [OutputConfig(id: 1, screen: show.outputScreen)]
        audio = show.audio ?? AudioSettings()
        masterGain = show.masterGain ?? 1
        standbyText = show.standbyText ?? ""
        standbyID = show.cues.first?.id
        pads = PadBoard(banks: show.banks, pads: show.pads, multiTrigger: show.multiTrigger)
        pads.setMaster(masterGain)
        pads.onChange = { [weak self] in self?.save(); self?.onCuesChanged?() }
        pads.setOutput(device: audio.padDevice, firstChannel: audio.padFirstChannel)
        pads.locked = locked
        pads.onLog = { [weak self] text in self?.log.add(.pad, text, from: self?.source ?? ShowLog.thisMac) }
        log.add(.file, "Outrangutan opened: \(ShowFiles.count(cues.count, "cue")), \(ShowFiles.count(pads.pads.count, "pad"))")
        save()
        loadDurations()
        if let point = RecoveryPoint.load(), let cue = cues.first(where: { $0.wireID == point.wireID }) {
            var p = point
            p.cueID = cue.id
            recovered = p
            log.add(.problem, "Outrangutan had closed during the show. \u{201C}\(point.name)\u{201D} was on air"
                    + (point.offset > 0 ? " at \(Timecode.short(point.offset))." : "."))
        }
        RecoveryPoint.clear()
        monitor.standbyText = standbyText
        startClock()
        // A screen plugged in or out (a bumped HDMI cable): put every open
        // output where it belongs again, never over the controls.
        lastScreens = NSScreen.screens.map(\.localizedName)
        lastFrames = NSScreen.screens.map(\.frame)
        screenWatch = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                                             object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            // The same screens at a new size or place (a quick HDMI
            // re-handshake) also need the outputs placed again.
            let frames = NSScreen.screens.map(\.frame)
            let moved = frames != self.lastFrames
            self.lastFrames = frames
            self.screensChanged(NSScreen.screens.map(\.localizedName), force: moved)
        }
    }

    private var lastScreens: [String] = []
    private var lastFrames: [CGRect] = []
    private var screenWatch: NSObjectProtocol?

    /// The screens changed. Each open output is placed again: on its own
    /// screen if it is there, otherwise as a normal window on the control
    /// screen, so a full-screen output can never land on top of GO.
    func screensChanged(_ now: [String], force: Bool = false) {
        let gone = lastScreens.filter { !now.contains($0) }, back = now.filter { !lastScreens.contains($0) }
        lastScreens = now
        guard !gone.isEmpty || !back.isEmpty || force else { return }
        for name in gone { log.add(.problem, "Screen \u{201C}\(name)\u{201D} was disconnected") }
        for name in back { log.add(.output, "Screen \u{201C}\(name)\u{201D} connected") }
        for config in outputs where openOutputs.contains(config.id) {
            window(config.id).open(on: config.screen, title: config.label)
            let placed = window(config.id).placement
            log.add(.output, "\(config.label) is now \(placed)")
            if placed.hasPrefix("a window") && !gone.isEmpty {
                notice = "\(config.label)'s screen was disconnected. It is a window for now and goes back when the screen returns."
            }
        }
        if gone.isEmpty && notice?.contains("screen was disconnected") == true { notice = nil }
    }

    /// Stands by the cue that was on air when the app closed. With a point
    /// to start from, its next GO picks up there.
    func standbyRecovered() {
        guard let point = recovered, let id = point.cueID else { return }
        standbyID = id
        if point.offset > 0 { pendingResume = (id, point.offset) }
        recovered = nil
    }

    var standbyCue: Cue? { cues.first { $0.id == standbyID } }
    var isPaused: Bool { paused }

    func cue(wireID: String) -> Cue? {
        cues.first { $0.wireID == wireID }
            // Like the web app, a cue number works too.
            ?? Int(wireID).flatMap { n in cues.indices.contains(n - 1) ? cues[n - 1] : nil }
    }

    /// How long a cue plays, after trim. 0 for a still that holds.
    func playLength(_ cue: Cue) -> Double {
        if cue.kind.holds { return cue.duration }
        let full = durations[cue.id] ?? 0
        return max(0, (cue.trimOut ?? full) - cue.trimIn)
    }

    // MARK: Transport

    /// GO: fires the standby cue, then stands by the next armed one. While
    /// paused, GO carries on instead, like the web app.
    @discardableResult
    func go() -> WireResult {
        if paused { togglePause(); return .done }
        guard let cue = standbyCue else { return refuse("Nothing is standing by.") }
        let next = nextArmed(after: cue)
        let result = fire(cue)
        // Move the standby on, unless the cue already did (Continue moves it
        // past the cue it fired).
        if result.ok, standbyID == cue.id, let next { standbyID = next.id }
        return result
    }

    /// Runs something on behalf of someone other than this Mac's keyboard
    /// and mouse, so the show log says who.
    func run(from who: String, _ body: () -> Void) {
        let was = source
        source = who
        body()
        source = was
    }

    /// OBS switched to a scene: fire the cue waiting for it, if one is.
    func obsSceneChanged(_ scene: String) {
        guard !scene.isEmpty, let cue = cues.first(where: { $0.obsTriggerScene == scene }) else { return }
        run(from: "OBS, scene \(scene)") {
            standbyID = cue.id
            go()
        }
    }

    /// Where an output is placed, for tests.
    func debugPlacement(_ id: Int) -> String { windows[id]?.placement ?? "closed" }

    /// Moves the standby up or down the list (the arrow keys). Picking what
    /// stands by is not an edit, so it works while locked.
    func moveStandby(_ step: Int) {
        guard !cues.isEmpty else { return }
        let i = cues.firstIndex { $0.id == standbyID } ?? (step > 0 ? -1 : cues.count)
        standbyID = cues[min(cues.count - 1, max(0, i + step))].id
    }

    /// Runs a show key.
    func perform(_ action: KeyMap.Action) {
        switch action {
        case .go: go()
        case .pause: togglePause()
        case .stop: stop()
        case .fade: fadeStopAll()
        case .allStop: allStop()
        }
    }

    /// Pause holds everything where it is: players, still timers and a
    /// pre-wait count. Press again to carry on.
    func togglePause() {
        if paused {
            log.add(.pause, "Carried on after a pause", from: source)
            paused = false
            for d in [pictureDeck, soundDeck].compactMap({ $0 }) where !d.held { d.player.play() }
            if let left = stillLeft { armStillTimer(left); stillLeft = nil }
            if let left = pendingLeft, let p = pending { schedulePending(p.cue, in: left); pendingLeft = nil }
            refresh()
            // The strip and the deck count from a start time, so a resume
            // re-anchors them.
            if let cue = countingCue { onClipStart?(cue, playLength(cue)) }
        } else if hasAnythingToPause {
            log.add(.pause, "Paused", from: source)
            paused = true
            for d in [pictureDeck, soundDeck].compactMap({ $0 }) { d.player.pause() }
            if let ends = stillEndsAt, stillTimer != nil {
                stillLeft = max(0, ends.timeIntervalSinceNow)
                stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil
            }
            if let p = pending {
                pendingLeft = max(0, p.at.timeIntervalSinceNow)
                p.timer.invalidate()
            }
            refresh()
        }
    }

    /// Stop: stops the lane that fired last (picture or sound).
    func stop() {
        log.add(.stop, "Stop", from: source)
        cancelPending()
        if lastLane == .audio && soundDeck != nil { stopSound() } else { stopPicture() }
        refresh()
    }

    /// All Stop (PANIC): everything off at once, pads too, output to black.
    func allStop() {
        log.add(.panic, "All Stop: every cue and pad off", from: source)
        stopEverything()
    }

    private func stopEverything() {
        stopCuesQuietly()
        pads.stopAll()
    }

    /// Stops every cue at once, but lets pads ring. What a remote Stop does,
    /// like the web app.
    func stopCues() {
        log.add(.stop, "Stop every cue (pads keep ringing)", from: source)
        stopCuesQuietly()
    }

    private func stopCuesQuietly() {
        fader.cancelAll()
        cancelPending()
        stopPicture()
        stopSound()
        paused = false
        refresh()
    }

    /// Fade and Stop All: picture and sound fade out together over one
    /// second, then everything stops.
    func fadeStopAll() {
        cancelPending()
        log.add(.stop, "Fade and stop everything", from: source)
        guard pictureDeck != nil || soundDeck != nil || stillCue != nil else { return stopEverything() }
        if fader.isRunning("all") { return }
        if paused { paused = false; for d in [pictureDeck, soundDeck].compactMap({ $0 }) where !d.held { d.player.play() } }
        let decks = [pictureDeck, soundDeck].compactMap { $0 }
        let startPicture = decks.map { $0.pictureLevel }, startSound = decks.map { $0.soundLevel }
        let startStill = stillLevel
        decks.forEach { fader.cancel($0.name) }
        pads.fadeOutAll()
        fader.run("all", from: 1, to: 0, seconds: 1, apply: { [weak self] v in
            guard let self else { return }
            for (i, d) in decks.enumerated() {
                d.pictureLevel = startPicture[i] * v
                d.soundLevel = startSound[i] * v
                self.apply(d)
            }
            self.stillLevel = startStill * v
            self.applyStill()
        }, done: { [weak self] in self?.stopEverything() })
    }

    func setGain(_ value: Double) {
        masterGain = min(1.2, max(0, value))
        [pictureDeck, soundDeck].compactMap { $0 }.forEach(apply)
        pads.setMaster(masterGain)
        save()
        onTransport?()
    }

    // MARK: Firing

    /// Fires one cue, with its pre-wait if it has one. Matches fireCue in
    /// the web app.
    @discardableResult
    func fire(_ cue: Cue, from: String? = nil) -> WireResult {
        cancelPending()
        guard cue.fileIsThere else { return refuse("Can't find the file for \"\(cue.name)\". It may have moved.") }
        notice = nil
        let number = (cues.firstIndex { $0.id == cue.id } ?? 0) + 1
        log.add(.cue, "\(number). \(cue.name)" + (cue.preWait > 0 ? ", waits \(Timecode.short(cue.preWait))" : ""), from: from ?? source)
        if cue.preWait > 0 {
            schedulePending(cue, in: cue.preWait)
            refresh()
            return .done
        }
        return begin(cue)
    }

    @discardableResult
    private func begin(_ cue: Cue) -> WireResult {
        if paused {
            // A new cue un-pauses the show; what was paused stays where it is.
            paused = false
            stillLeft = nil
        }
        let result: WireResult
        switch cue.kind {
        case .video: result = beginVideo(cue)
        case .audio: result = beginSound(cue)
        case .still, .matte: result = beginStill(cue)
        }
        guard result.ok else { return result }
        lastLane = cue.kind == .audio ? .audio : .video
        pads.tie(cue)
        refresh()
        onClipStart?(cue, playLength(cue))
        onCueBegan?(cue)
        // Continue: the next cue fires as this one starts.
        if cue.continueMode == .autoContinue { fireNext(after: cue) }
        return result
    }

    private func beginVideo(_ cue: Cue) -> WireResult {
        let deck = videoDecks.first { $0 !== pictureDeck } ?? videoDecks[0]
        fader.cancel(deck.name)
        deck.load(cue, device: soundDevice(for: cue)) { [weak self, weak deck] in
            guard let self, let deck, deck.cue?.id == cue.id else { return }
            self.reachedEnd(deck)
        }
        let dissolve = cue.xfade > 0 && (pictureDeck != nil || stillCue != nil)
        deck.pictureLevel = (dissolve || cue.fadeIn > 0) ? 0 : 1
        deck.soundLevel = deck.pictureLevel
        deck.views = views(for: cue)
        deck.views.forEach { $0.showVideo(deck.player, in: deck.slot!, cue: cue, opacity: Float(deck.pictureLevel)) }
        apply(deck)
        deck.start(at: resumePoint(for: cue))
        takeOverPicture(with: dissolve ? cue.xfade : 0, curve: cue.fadeCurve)
        pictureDeck = deck
        if dissolve {
            fader.run(deck.name, from: 0, to: 1, seconds: cue.xfade, curve: cue.fadeCurve) { [weak self] v in
                deck.pictureLevel = v; deck.soundLevel = v; self?.apply(deck)
            }
        } else if cue.fadeIn > 0 {
            fader.run(deck.name, from: 0, to: 1, seconds: cue.fadeIn, curve: cue.fadeCurve) { [weak self] v in
                deck.pictureLevel = v; deck.soundLevel = v; self?.apply(deck)
            }
        }
        return .done
    }

    private func beginSound(_ cue: Cue) -> WireResult {
        let deck = soundDecks.first { $0 !== soundDeck } ?? soundDecks[0]
        fader.cancel(deck.name)
        deck.load(cue, device: audio.cueDevice) { [weak self, weak deck] in
            guard let self, let deck, deck.cue?.id == cue.id else { return }
            self.reachedEnd(deck)
        }
        let old = soundDeck
        let dissolve = cue.xfade > 0 && old != nil
        deck.soundLevel = (dissolve || cue.fadeIn > 0) ? 0 : 1
        apply(deck)
        deck.start(at: resumePoint(for: cue))
        if let old {
            if dissolve {
                let from = old.soundLevel
                fader.run(old.name, from: 1, to: 0, seconds: cue.xfade, curve: cue.fadeCurve, apply: { [weak self] v in
                    old.soundLevel = from * v; self?.apply(old)
                }, done: { old.clear() })
            } else {
                fader.cancel(old.name)
                old.clear()
            }
        }
        soundDeck = deck
        let seconds = dissolve ? cue.xfade : cue.fadeIn
        if seconds > 0 {
            fader.run(deck.name, from: 0, to: 1, seconds: seconds, curve: cue.fadeCurve) { [weak self] v in
                deck.soundLevel = v; self?.apply(deck)
            }
        }
        return .done
    }

    private func beginStill(_ cue: Cue) -> WireResult {
        var image: NSImage?
        if cue.kind == .still {
            guard let loaded = NSImage(contentsOf: cue.url) else { return refuse("Can't open the still \"\(cue.name)\".") }
            image = loaded
        }
        let slot: PictureSlot = stillCue == nil ? stillSlot : (stillSlot == .s1 ? .s2 : .s1)
        // An earlier still may still be dissolving away on this layer: its
        // clean-up must not blank the new one when it ends.
        fader.cancel("still-out-\(slot.rawValue)")
        let dissolve = cue.xfade > 0 && (pictureDeck != nil || stillCue != nil)
        let startLevel: Double = (dissolve || cue.fadeIn > 0) ? 0 : 1
        let targets = views(for: cue)
        targets.forEach { $0.showStill(image, in: slot, cue: cue, opacity: Float(startLevel)) }
        takeOverPicture(with: dissolve ? cue.xfade : 0, curve: cue.fadeCurve)
        stillViews = targets
        stillCue = cue
        stillSlot = slot
        stillHeld = cue.duration <= 0
        stillLevel = startLevel
        stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
        if cue.duration > 0 { armStillTimer(cue.duration) }
        let seconds = dissolve ? cue.xfade : cue.fadeIn
        if seconds > 0 {
            fader.run("still", from: 0, to: 1, seconds: seconds, curve: cue.fadeCurve) { [weak self] v in
                self?.stillLevel = v; self?.applyStill()
            }
        } else {
            fader.cancel("still")
            applyStill()
        }
        return .done
    }

    /// Where a cue starts if it is picking up after a crash. Used once.
    private func resumePoint(for cue: Cue) -> Double? {
        guard let r = pendingResume, r.id == cue.id else { return nil }
        pendingResume = nil
        return r.offset
    }

    /// Clears whatever picture was on air, at once or under a dissolve. In
    /// a dissolve the new picture fades up on top while the old one stays
    /// put underneath (its sound fades out), so there is no dip to black.
    private func takeOverPicture(with seconds: Double, curve: FadeCurve) {
        if let old = pictureDeck {
            pictureDeck = nil
            if seconds > 0 {
                let from = old.soundLevel
                fader.run(old.name, from: 1, to: 0, seconds: seconds, curve: curve, apply: { [weak self] v in
                    old.soundLevel = from * v; self?.apply(old)
                }, done: { [weak self] in self?.clearDeck(old) })
            } else {
                clearDeck(old)
            }
        }
        if let leaving = stillCue {
            let oldSlot = stillSlot
            let oldViews = stillViews
            pads.cueLeftAir(leaving.id)
            stillCue = nil
            stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
            fader.cancel("still")
            if seconds > 0 {
                fader.run("still-out-\(oldSlot.rawValue)", from: 1, to: 1, seconds: seconds, apply: { _ in },
                          done: { oldViews.forEach { $0.hide(oldSlot) } })
            } else {
                oldViews.forEach { $0.hide(oldSlot) }
            }
        }
    }

    // MARK: Endings

    /// A video or sound reached its end or its trim out point. Matches
    /// handleEnded in the web app.
    private func reachedEnd(_ deck: Deck) {
        guard let cue = deck.cue, !deck.held else { return }
        if cue.loop {
            deck.rewindAndPlay()
            onClipStart?(cue, playLength(cue))
            return
        }
        if cue.continueMode == .autoFollow, let next = nextArmed(after: cue) {
            // The next cue on the same lane takes over on its own. On the
            // other lane, this one does its end action first.
            if next.kind.hasPicture != cue.kind.hasPicture { endAction(deck, cue) }
            standbyID = nextArmed(after: next)?.id ?? next.id
            fire(next, from: "Follow")
            return
        }
        endAction(deck, cue)
        refresh()
    }

    private func endAction(_ deck: Deck, _ cue: Cue) {
        switch cue.endAction {
        case .hold where cue.kind == .video:
            deck.player.pause()
            deck.held = true
        case .black:
            let p = deck.pictureLevel, s = deck.soundLevel
            fader.run(deck.name, from: 1, to: 0, seconds: 0.6, curve: cue.fadeCurve, apply: { [weak self] v in
                deck.pictureLevel = p * v; deck.soundLevel = s * v; self?.apply(deck)
            }, done: { [weak self] in self?.clearDeck(deck); self?.refresh() })
        default:
            clearDeck(deck)
        }
    }

    /// A still's timer ran out. A still never cuts to black on its own:
    /// Follow fires the next cue, Fade to black fades, anything else holds.
    private func stillEnded() {
        guard let cue = stillCue else { return }
        stillTimer = nil
        stillEndsAt = nil
        stillHeld = true
        if cue.continueMode == .autoFollow, let next = nextArmed(after: cue) {
            standbyID = nextArmed(after: next)?.id ?? next.id
            fire(next, from: "Follow")
            return
        }
        if cue.endAction == .black {
            let slot = stillSlot
            fader.run("still", from: stillLevel, to: 0, seconds: 0.6, curve: cue.fadeCurve, apply: { [weak self] v in
                self?.stillLevel = v; self?.applyStill()
            }, done: { [weak self] in
                guard let self, self.stillSlot == slot, self.stillCue?.id == cue.id else { return }
                self.stillViews.forEach { $0.hide(slot) }; self.stillCue = nil; self.pads.cueLeftAir(cue.id); self.refresh()
            })
        }
        refresh()
    }

    private func armStillTimer(_ seconds: Double) {
        stillTimer?.invalidate()
        stillEndsAt = Date().addingTimeInterval(seconds)
        let t = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in self?.stillEnded() }
        RunLoop.main.add(t, forMode: .common)
        stillTimer = t
    }

    private func fireNext(after cue: Cue) {
        guard let next = nextArmed(after: cue) else { return }
        standbyID = nextArmed(after: next)?.id ?? next.id
        fire(next, from: "Continue")
    }

    private func nextArmed(after cue: Cue) -> Cue? {
        guard let i = cues.firstIndex(where: { $0.id == cue.id }) else { return nil }
        return cues[(i + 1)...].first { $0.armed }
    }

    // MARK: Pre-wait

    private func schedulePending(_ cue: Cue, in seconds: Double) {
        pending?.timer.invalidate()
        let t = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in
            guard let self, let p = self.pending, p.cue.id == cue.id else { return }
            self.pending = nil
            self.pendingCue = nil
            self.preRemaining = nil
            self.begin(p.cue)
        }
        RunLoop.main.add(t, forMode: .common)
        pending = (cue, Date().addingTimeInterval(seconds), t)
        pendingCue = cue
    }

    private func cancelPending() {
        pending?.timer.invalidate()
        pending = nil
        pendingLeft = nil
        pendingCue = nil
        preRemaining = nil
    }

    // MARK: Commands from the rundown and KeyWi Bird

    /// Runs one command from the show's shared record and says how it went.
    /// The actions and refusals match applyRemoteCommand in the web app.
    func runRemote(_ cmd: WireCommand) -> WireResult {
        source = cmd.by.isEmpty ? "Cueola" : "\(cmd.by), in Cueola"
        defer { source = ShowLog.thisMac }
        var result = WireResult.done
        switch cmd.action {
        case "go": result = go()
        case "stop": stopCues()
        case "panic": allStop()
        case "fadeStop": fadeStopAll()
        case "pause":
            if !hasAnythingToPause && !paused { result = .refused("nothing playing") }
            else { togglePause() }
        case "cue":
            if let c = cue(wireID: cmd.cueId) {
                standbyID = c.id
                result = go()
            } else {
                result = .refused("cue \(cmd.cueId) is not on this Mac")
            }
        case "pad":
            result = pads.fire(cmd.padId)
        case "arm":
            if !arm(cmd.cueId) { result = .refused("cue \(cmd.cueId) is not on this Mac") }
        default:
            result = .refused("unknown action \(cmd.action)")
        }
        // A fire can carry the rundown's next standby on the same write.
        if !cmd.armCueId.isEmpty { arm(cmd.armCueId) }
        // TAKE-linked sound effects ride the same write.
        for id in cmd.pads where pads.fire(id).ok == false {
            notice = "The rundown fired a pad this Mac doesn't have."
        }
        // Refusals from refuse() are logged already; log the rest here.
        if !result.ok, log.entries.last?.text != result.reason {
            log.add(.problem, "Could not run \(cmd.action): \(result.reason)", from: source)
        }
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
        let counting: Deck? = (pictureDeck.map { $0.held ? nil : $0 } ?? nil) ?? (soundDeck.map { $0.held ? nil : $0 } ?? nil)
        if let p = pending, counting == nil, stillCue == nil {
            s.status = .pre
            s.cueId = p.cue.wireID ?? ""
            s.name = p.cue.name
            s.type = p.cue.kind.wireType
        } else if let d = counting, let cue = d.cue {
            s.status = paused ? .pause : .play
            s.cueId = cue.wireID ?? ""
            s.name = cue.name
            s.type = cue.kind.wireType
            s.duration = durations[cue.id] ?? 0
            s.offset = d.current
            s.remaining = d.remaining ?? max(0, playLength(cue) - (d.current - cue.trimIn))
        } else if let still = stillCue {
            s.status = paused ? .pause : .play
            s.cueId = still.wireID ?? ""
            s.name = still.name
            s.type = "image"
            s.duration = still.duration
            s.remaining = stillHeld ? nil : (stillLeft ?? stillEndsAt.map { max(0, $0.timeIntervalSinceNow) })
        }
        s.outputList = outputs.map { OutputLive(id: $0.id, label: $0.label, open: openOutputs.contains($0.id)) }
        s.outputsOpen = s.outputList.filter(\.open).count
        s.outputsReady = s.outputsOpen
        s.outputsTotal = outputs.count
        s.gain = masterGain
        s.firstCueId = cues.first { $0.armed }?.wireID ?? ""
        s.firstCueName = cues.first { $0.armed }?.name ?? ""
        return s
    }

    // MARK: Cue list

    func add(urls: [URL]) {
        var made = urls.compactMap(Cue.make(from:))
        if made.count < urls.count { notice = "Some files were skipped. Outrangutan plays video, sound and still pictures." }
        guard !made.isEmpty else { return }
        noteUndo(made.count == 1 ? "Add Cue" : "Add Cues")
        for i in made.indices { made[i].wireID = Cue.newWireID(offsetMs: i) }
        cues.append(contentsOf: made)
        if standbyID == nil { standbyID = made.first?.id }
    }

    func addMatte(color: String, name: String) {
        noteUndo("Add Matte")
        let cue = Cue.matte(named: name, color: color)
        cues.append(cue)
        standbyID = cue.id
    }

    /// Moves cues in the list (drag and drop).
    func move(from offsets: IndexSet, to offset: Int) {
        noteUndo("Move Cue")
        cues.move(fromOffsets: offsets, toOffset: offset)
    }

    /// The same change to several cues, as one Undo step.
    func updateAll(_ ids: Set<UUID>, _ name: String, _ change: (inout Cue) -> Void) {
        guard cues.contains(where: { ids.contains($0.id) }) else { return }
        noteUndo(name)
        restoring = true
        defer { restoring = false; lastUndo = nil }
        for cue in cues where ids.contains(cue.id) { update(cue.id, change) }
    }

    /// Copies of several cues, each right after itself, as one Undo step.
    func duplicate(ids: Set<UUID>) {
        let order = cues.filter { ids.contains($0.id) }.map(\.id)
        guard !order.isEmpty else { return }
        if order.count == 1 { return duplicate(order[0]) }
        noteUndo("Duplicate Cues")
        restoring = true
        defer { restoring = false; lastUndo = nil }
        order.forEach(duplicate)
    }

    /// A copy of a cue right after it, with its own id, standing by.
    func duplicate(_ id: UUID) {
        guard let i = cues.firstIndex(where: { $0.id == id }) else { return }
        noteUndo("Duplicate Cue")
        var copy = cues[i]
        copy.id = UUID()
        copy.wireID = Cue.newWireID()
        copy.name += " copy"
        cues.insert(copy, at: i + 1)
        standbyID = copy.id
    }

    // MARK: Undo

    /// The window's undo manager, set by the control window.
    weak var undoManager: UndoManager? {
        didSet { pads.willChange = { [weak self] name, key in self?.noteUndo(name, key: key) } }
    }
    private struct Snapshot { let cues: [Cue]; let pads: [Pad]; let banks: [PadBank] }
    private var lastUndo: (key: String, at: Date)?
    private var restoring = false

    /// Saves how the show looks now, so Edit, Undo can bring it back. Call
    /// just before a change. Changes with the same key within a second and a
    /// half count as one step.
    func noteUndo(_ name: String, key: String? = nil) {
        guard let um = undoManager, !restoring else { return }
        if let key, let last = lastUndo, last.key == key, Date().timeIntervalSince(last.at) < 1.5 {
            lastUndo = (key, Date())
            return
        }
        lastUndo = key.map { ($0, Date()) }
        let snap = Snapshot(cues: cues, pads: pads.pads, banks: pads.banks)
        um.registerUndo(withTarget: self) { $0.restore(snap, name: name) }
        um.setActionName(name)
    }

    private func restore(_ snap: Snapshot, name: String) {
        let now = Snapshot(cues: cues, pads: pads.pads, banks: pads.banks)
        restoring = true
        defer { restoring = false; lastUndo = nil }
        undoManager?.registerUndo(withTarget: self) { $0.restore(now, name: name) }
        undoManager?.setActionName(name)
        cues = snap.cues
        pads.restore(banks: snap.banks, pads: snap.pads)
        if let id = standbyID, !cues.contains(where: { $0.id == id }) { standbyID = cues.first?.id }
        // Keep what is on air in step with the restored settings.
        for d in [pictureDeck, soundDeck].compactMap({ $0 }) {
            if let c = d.cue, let back = cues.first(where: { $0.id == c.id }) {
                d.cue = back
                d.keyer?.update(back.key)
                apply(d)
                if let slot = d.slot { d.views.forEach { $0.restyle(slot, back) } }
            }
        }
    }

    /// Swaps in a whole show: a show file opened, or a new empty show.
    /// Everything on air stops first.
    func replaceShow(cues newCues: [Cue], pads newPads: [Pad], banks: [PadBank], multiTrigger: Bool?) {
        stopEverything()
        durations = [:]
        // A new or opened show starts a fresh undo history, like any Mac app,
        // and a crash note about the old show no longer applies.
        undoManager?.removeAllActions()
        recovered = nil
        pendingResume = nil
        cues = newCues
        standbyID = newCues.first { $0.armed }?.id ?? newCues.first?.id
        pads.replace(banks: banks, pads: newPads, multiTrigger: multiTrigger)
        notice = nil
    }

    func remove(ids: Set<UUID>) {
        guard cues.contains(where: { ids.contains($0.id) }) else { return }
        noteUndo(ids.count == 1 ? "Remove Cue" : "Remove Cues")
        cues.removeAll { ids.contains($0.id) }
        if let id = standbyID, ids.contains(id) { standbyID = cues.first?.id }
    }

    /// Changes one cue's settings. If it is on air, volume and framing
    /// change on air at once; timing changes count from its next GO.
    func update(_ id: UUID, _ change: (inout Cue) -> Void) {
        guard let i = cues.firstIndex(where: { $0.id == id }) else { return }
        var cue = cues[i]
        change(&cue)
        cue.preWait = max(0, cue.preWait)
        cue.duration = max(0, cue.duration)
        cue.trimIn = max(0, cue.trimIn)
        if let out = cue.trimOut, out <= cue.trimIn { cue.trimOut = nil }
        cue.volume = min(1, max(0, cue.volume))
        cue.fadeIn = max(0, cue.fadeIn); cue.fadeOut = max(0, cue.fadeOut); cue.xfade = max(0, cue.xfade)
        cue.scale = min(4, max(0.1, cue.scale))
        guard cue != cues[i] else { return }
        // Quick changes to one cue (a slider drag, typing a name) are one step.
        noteUndo("Change Cue", key: "cue:\(id)")
        cues[i] = cue
        for d in [pictureDeck, soundDeck].compactMap({ $0 }) where d.cue?.id == id {
            d.cue = cue
            // The key changes on the next frame, even on air.
            if let k = d.keyer { k.update(cue.key) }
            else if cue.kind == .video, cue.key.mode != .off, let item = d.player.currentItem { d.key(item, cue.key) }
            apply(d)
            if let slot = d.slot { d.views.forEach { $0.restyle(slot, cue) } }
        }
        if stillCue?.id == id {
            stillCue = cue
            stillViews.forEach { $0.restyle(stillSlot, cue) }
        }
    }

    // MARK: Output

    /// Opens every output, or closes them all if any is open.
    func toggleOutput() {
        if openOutputs.isEmpty { outputs.forEach { openOutput($0.id) } }
        else { outputs.forEach { closeOutput($0.id) } }
    }

    /// Opens every output (the Go Live check's "open the output").
    func openOutput() {
        outputs.forEach { openOutput($0.id) }
    }

    func openOutput(_ id: Int) {
        guard let config = outputs.first(where: { $0.id == id }) else { return }
        window(id).open(on: config.screen, title: config.label)
        if !openOutputs.contains(id) { log.add(.output, "\(config.label) opened", from: source) }
        openOutputs.insert(id)
        onTransport?()
    }

    func closeOutput(_ id: Int) {
        windows[id]?.close()
        if openOutputs.contains(id) { log.add(.output, "\(outputLabel(id)) closed", from: source) }
        openOutputs.remove(id)
        onTransport?()
    }

    /// Shows each output's number and name on it for three seconds, so you
    /// can tell which screen is which.
    func identifyOutputs() {
        for config in outputs where openOutputs.contains(config.id) {
            window(config.id).pictureView.identify(number: config.id, label: config.label)
        }
    }

    func addOutput() {
        guard outputs.count < OutputConfig.most else { return }
        let id = (1...OutputConfig.most).first { n in !outputs.contains { $0.id == n } } ?? outputs.count + 1
        outputs.append(OutputConfig(id: id))
    }

    func removeOutput(_ id: Int) {
        guard outputs.count > 1 else { return }
        closeOutput(id)
        outputs.removeAll { $0.id == id }
        windows[id] = nil
    }

    /// What each output shows now, for tests.
    func outputsShowing() -> String {
        outputs.map { o in "\(o.label): \(windows[o.id]?.pictureView.showing.joined(separator: " + ") ?? "")" }
            .joined(separator: " | ")
    }

    func outputLabel(_ id: Int) -> String {
        id == 0 ? "Every output" : (outputs.first { $0.id == id }?.label ?? "Output \(id)")
    }

    // MARK: Inside

    private var hasAnythingToPause: Bool {
        (pictureDeck.map { !$0.held } ?? false) || (soundDeck.map { !$0.held } ?? false)
            || stillTimer != nil || pending != nil
    }

    /// The cue whose clock is counting: a playing video, else a sound,
    /// else a still with a timer.
    private var countingCue: Cue? {
        if let d = pictureDeck, !d.held { return d.cue }
        if let d = soundDeck, !d.held { return d.cue }
        if !stillHeld { return stillCue }
        return nil
    }

    private func refuse(_ reason: String) -> WireResult {
        log.add(.problem, reason, from: source)
        notice = reason
        return .refused(reason)
    }

    private func apply(_ d: Deck) {
        d.player.volume = Float(min(1, masterGain) * (d.cue?.volume ?? 1) * d.soundLevel)
        if let slot = d.slot { d.views.forEach { $0.setOpacity(slot, Float(d.pictureLevel)) } }
    }

    private func applyStill() {
        stillViews.forEach { $0.setOpacity(stillSlot, Float(stillLevel)) }
    }

    private func clearDeck(_ d: Deck) {
        if let leaving = d.cue { pads.cueLeftAir(leaving.id) }
        fader.cancel(d.name)
        d.clear()
        if let slot = d.slot { d.views.forEach { $0.hide(slot) } }
        d.views = []
        if pictureDeck === d { pictureDeck = nil }
        if soundDeck === d { soundDeck = nil }
    }

    private func stopPicture() {
        if let d = pictureDeck { clearDeck(d) }
        videoDecks.forEach { if $0.cue != nil { clearDeck($0) } }
        stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
        fader.cancel("still")
        if let leaving = stillCue { pads.cueLeftAir(leaving.id) }
        stillCue = nil
        for w in windows.values { w.pictureView.hide(.s1); w.pictureView.hide(.s2) }
        monitor.hide(.s1); monitor.hide(.s2)
        stillViews = []
    }

    private func stopSound() {
        soundDecks.forEach { if $0.cue != nil { clearDeck($0) } }
        soundDeck = nil
    }

    private func refresh() {
        pictureCue = pictureDeck?.cue ?? stillCue
        soundCue = soundDeck?.cue
        let playing = (pictureDeck.map { !$0.held } ?? false) || (soundDeck.map { !$0.held } ?? false)
            || (stillCue != nil && !stillHeld)
        let holding = stillCue != nil || (pictureDeck?.held ?? false)
        if paused, playing || pending != nil || stillLeft != nil { status = .paused }
        else if playing { status = .playing }
        else if pending != nil { status = .pre }
        else if holding { status = .holding }
        else { status = .ready; paused = false }
        onTransport?()
    }

    /// The clock ticks 30 times a second, on the main run loop in common
    /// mode so it keeps counting while a menu is open or the list scrolls.
    private func startClock() {
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    private func tick() {
        preRemaining = pendingLeft ?? pending.map { max(0, $0.at.timeIntervalSinceNow) }
        // Fade out before the end, for cues that ask for it.
        for d in [pictureDeck, soundDeck].compactMap({ $0 }) {
            guard let cue = d.cue, cue.fadeOut > 0, !cue.loop, !d.fadingOut, !d.held, !paused,
                  let left = d.remaining, left <= cue.fadeOut, left > 0 else { continue }
            d.fadingOut = true
            let p = d.pictureLevel, s = d.soundLevel
            fader.run(d.name, from: 1, to: 0, seconds: left, curve: cue.fadeCurve) { [weak self] v in
                d.pictureLevel = p * v; d.soundLevel = s * v; self?.apply(d)
            }
        }
        if let cue = stillCue, cue.fadeOut > 0, !stillHeld, !paused, let ends = stillEndsAt,
           ends.timeIntervalSinceNow <= cue.fadeOut, !fader.isRunning("still") {
            let from = stillLevel
            fader.run("still", from: 1, to: 0, seconds: max(0.05, ends.timeIntervalSinceNow), curve: cue.fadeCurve) { [weak self] v in
                self?.stillLevel = from * v; self?.applyStill()
            }
        }
        let left: Double?
        if let d = pictureDeck, !d.held { left = d.remaining }
        else if let d = soundDeck, !d.held { left = d.remaining }
        else if stillCue != nil, !stillHeld { left = stillLeft ?? stillEndsAt.map { max(0, $0.timeIntervalSinceNow) } }
        else { left = nil }
        if left != remaining { remaining = left }
        if left != nil || pending != nil { onTick?() }
        readCueMeter()
        noteRecoveryPoint()
    }

    /// The loudest playing cue, scaled by its volume, like what goes out.
    private func readCueMeter() {
        var l: Float = 0, r: Float = 0
        for d in videoDecks + soundDecks where d.cue != nil && d.player.rate > 0 {
            guard let (pl, pr) = d.peaks?.take() else { continue }
            l = max(l, pl * d.player.volume); r = max(r, pr * d.player.volume)
        }
        if l > 0.0005 || r > 0.0005 || cueMeter.left > 0.0005 || cueMeter.right > 0.0005 { cueMeter.take(l, r) }
    }

    /// Once a second, notes what is on air, so a crash can pick up there.
    /// With nothing on air the note is cleared.
    private func noteRecoveryPoint() {
        guard Date().timeIntervalSince(lastRecoveryWrite) >= 1 else { return }
        lastRecoveryWrite = Date()
        let deck = [pictureDeck, soundDeck].compactMap { $0 }.first { !$0.held && $0.cue != nil }
        if let deck, let cue = deck.cue, let wire = cue.wireID {
            RecoveryPoint(wireID: wire, name: cue.name, offset: deck.current).save()
            recoveryNoted = true
        } else if let still = stillCue, let wire = still.wireID {
            RecoveryPoint(wireID: wire, name: still.name, offset: 0).save()
            recoveryNoted = true
        } else if recoveryNoted {
            RecoveryPoint.clear()
            recoveryNoted = false
        }
    }

    /// A clean quit leaves nothing to recover.
    func quitting() {
        clock?.invalidate()
        RecoveryPoint.clear()
    }

    private func loadDurations() {
        for cue in cues where !cue.kind.holds && durations[cue.id] == nil && cue.fileIsThere {
            let asset = AVURLAsset(url: cue.url)
            Task { @MainActor [weak self] in
                guard let time = try? await asset.load(.duration), time.isNumeric else { return }
                self?.durations[cue.id] = time.seconds
                self?.onCuesChanged?()
            }
        }
    }

    private func save() {
        ShowStore.save(ShowFile(cues: cues, outputs: outputs, audio: audio, masterGain: masterGain,
                                pads: pads.pads, banks: pads.banks, multiTrigger: pads.multiTrigger,
                                standbyText: standbyText.isEmpty ? nil : standbyText))
    }

    // MARK: Outputs and sound

    private func window(_ id: Int) -> OutputWindowController {
        if let w = windows[id] { return w }
        let w = OutputWindowController()
        w.pictureView.standbyText = standbyText
        w.onClose = { [weak self] in self?.openOutputs.remove(id); self?.onTransport?() }
        windows[id] = w
        return w
    }

    /// The outputs a cue shows on: its own, or every one for "every output".
    /// A cue pointed at an output that was removed uses the first output.
    private func views(for cue: Cue) -> [OutputView] {
        let preview = outputs.contains { $0.id == monitorOutput } ? monitorOutput : outputs[0].id
        if cue.output == 0 { return outputs.map { window($0.id).pictureView } + [monitor] }
        let id = outputs.contains { $0.id == cue.output } ? cue.output : outputs[0].id
        return [window(id).pictureView] + (id == preview ? [monitor] : [])
    }

    /// What is on the program picture now, for the scopes: the newest video
    /// frame, the still, or the matte. nil when the picture is black.
    func programFrame() -> CIImage? {
        if let d = pictureDeck, let item = d.player.currentItem {
            attachFrames(d)
            if let out = d.frames, out.hasNewPixelBuffer(forItemTime: item.currentTime()),
               let buffer = out.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) {
                d.lastFrame = CIImage(cvPixelBuffer: buffer)
            }
            return d.lastFrame
        }
        guard let still = stillCue else { return nil }
        if still.kind == .matte {
            return CIImage(color: CIColor(color: NSColor(hex: still.color) ?? .black) ?? .black)
                .cropped(to: CGRect(x: 0, y: 0, width: 1920, height: 1080))
        }
        if stillFrame?.id != still.id {
            stillFrame = CIImage(contentsOf: still.url).map { (still.id, $0) }
        }
        return stillFrame?.image
    }

    private func attachFrames(_ d: Deck) {
        guard wantsFrames, d.frames == nil, let item = d.player.currentItem else { return }
        let out = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        item.add(out)
        d.frames = out
    }

    /// A video's sound goes to its output's sound device if it has one,
    /// else to the cue sound device.
    private func soundDevice(for cue: Cue) -> String? {
        if cue.output != 0, let d = outputs.first(where: { $0.id == cue.output })?.audioDevice { return d }
        return audio.cueDevice
    }

    private func outputsChanged() {
        save()
        // Move open windows to a newly picked screen, and keep titles current.
        for config in outputs where openOutputs.contains(config.id) {
            window(config.id).open(on: config.screen, title: config.label)
        }
        onTransport?()
    }

    private func audioChanged() {
        save()
        pads.setOutput(device: audio.padDevice, firstChannel: audio.padFirstChannel)
    }
}
