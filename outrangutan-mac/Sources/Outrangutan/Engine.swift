import OutrangutanCore
import AppKit
import AVFoundation
import Combine
import QuartzCore

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
    /// This deck's line into the cue sound engine.
    let lane: SoundLane
    /// True while the cue on this deck plays its sound through the engine
    /// (a channel pair other than 1 and 2). The player is then muted.
    private(set) var viaLane = false
    /// On the lane path, the sound listener must be on before the cue
    /// starts, or its first frames never reach the engine. A start asked
    /// for before then waits here.
    private var listening = true
    var isListening: Bool { listening }
    private var startWhenListening: (() -> Void)?
    /// Pause pressed while the cue was still waiting for its listener: the
    /// start then parks on its first frame instead of playing.
    private var heldWhileWaiting = false
    private var tokens: [Any] = []
    private var watchers: [NSObjectProtocol] = []
    /// Set while this deck holds a cue loaded ahead of its GO: the file is
    /// open, the sound listener is on, the first frames are decoded and the
    /// player sits on the in point, so GO only has to press play. The key
    /// says what the load depended on (file, trim, sound device, key).
    private(set) var preloadKey: String?
    var isPreloaded: Bool { preloadKey != nil }
    /// True once the player has decoded ahead and can roll on the next
    /// frame; for test mode and Show Check.
    private(set) var prerolled = false
    private var readyWatch: NSKeyValueObservation?
    /// The outputs this deck's player was handed to ahead of its GO.
    var prepared: [OutputView] = []

    init(name: String, slot: PictureSlot?, lane: SoundLane) {
        self.name = name
        self.slot = slot
        self.lane = lane
        // Play on time: never wait to build a cushion, the files are local.
        player.automaticallyWaitsToMinimizeStalling = false
        // Test mode never makes a sound.
        player.isMuted = TestSnapshot.isOn
    }

    var current: Double {
        let t = player.currentTime().seconds
        return t.isFinite ? t : 0
    }

    /// The trim out point this deck was loaded with. The stop at the out
    /// point is set once, at load, so the clock reads the same point: a
    /// trim changed while the cue is on air counts from its next GO.
    private var endAt: Double?

    /// Where the cue ends: its trim out point, or the end of the file.
    var end: Double? {
        if let out = endAt { return out }
        guard let d = player.currentItem?.duration, d.isNumeric else { return nil }
        return d.seconds
    }

    var remaining: Double? { end.map { max(0, $0 - current) } }

    /// Loads a cue and calls `ended` when it reaches its end (or trim out).
    /// With `viaLane` the sound goes to the cue sound engine instead of out
    /// of the player.
    /// How many times any deck opened a file, for test mode: a scroll through
    /// the list must load only the cue it lands on.
    static var loads = 0

    func load(_ cue: Cue, device: String?, viaLane: Bool = false, ended: @escaping () -> Void) {
        clearWatchers()
        Deck.loads += 1
        preloadKey = nil
        readyWatch = nil
        prerolled = false
        self.cue = cue
        held = false
        fadingOut = false
        self.viaLane = viaLane
        lane.ring.flush()
        lane.clock.stop()
        // Which sound output this player uses. nil is the Mac's default. On
        // the lane path the player's own sound is turned down to nothing
        // (not muted: a muted player stops keeping time with its sound),
        // and it still runs on the same device, so the two clocks agree.
        player.audioOutputDeviceUniqueID = device
        // (The load-ahead timing test keeps the sound path real and turns
        // the level down instead: a muted player starts its clock differently.)
        player.isMuted = TestSnapshot.isOn && !viaLane && TestSnapshot.scenario != "preload"
        let item = AVPlayerItem(url: cue.url)
        frames = nil
        lastFrame = nil
        keyer = nil
        if cue.kind == .video && cue.key.mode != .off { key(item, cue.key) }
        let box = PeakBox()
        peaks = box
        listening = !viaLane
        startWhenListening = nil
        heldWhileWaiting = false
        // A listener on the player's sound path makes a clip start late and
        // rough (see SoundEnvelope), so the meter reads a level map instead.
        // The cue sound engine's lane needs the sound itself, every frame
        // from the top, so that path gets the listener and waits for it.
        if viaLane {
            Task { [weak self] in
                await SoundTap.attach(to: item, box: box, lane: lane)
                await MainActor.run {
                    guard let self, self.player.currentItem === item else { return }
                    self.listening = true
                    let start = self.startWhenListening
                    self.startWhenListening = nil
                    start?()
                }
            }
        }
        player.replaceCurrentItem(with: item)
        endAt = nil
        if let out = cue.trimOut, out > cue.trimIn {
            endAt = out
            let at = NSValue(time: CMTime(seconds: out, preferredTimescale: 600))
            tokens.append(player.addBoundaryTimeObserver(forTimes: [at], queue: .main, using: ended))
        }
        watchers.append(NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in ended() })
    }

    /// Loads a cue ahead of its GO and readies it: once the file is open the
    /// player seeks to the in point and decodes ahead (preroll), so GO
    /// starts it on the next frame with no stutter. The sound stays off.
    func preload(_ cue: Cue, key: String, device: String?, viaLane: Bool, ended: @escaping () -> Void) {
        load(cue, device: device, viaLane: viaLane, ended: ended)
        player.volume = 0
        // On the lane path the engine must stay quiet too: the lane's level
        // is whatever the last cue left it, and its clock must say nothing
        // is due yet, or the first frames the listener hands over during
        // the preroll would go out while the cue only stands by.
        lane.gain.outputVolume = 0
        lane.clock.note(position: -1, speed: 0, host: 0)
        preloadKey = key
        guard let item = player.currentItem else { return }
        // With an output on the item, the decoder runs now, before any
        // layer shows the picture.
        if cue.kind == .video { attachFrames() }
        let from = cue.trimIn
        readyWatch = item.observe(\.status, options: [.initial, .new]) { [weak self] it, _ in
            guard it.status == .readyToPlay else { return }
            Task { @MainActor [weak self] in self?.prime(item, from: from) }
        }
    }

    private func prime(_ item: AVPlayerItem, from: Double) {
        // Only while the cue still stands by: a "ready" that lands after GO
        // must not seek a cue that is already rolling on air.
        guard player.currentItem === item, readyWatch != nil, isPreloaded else { return }
        readyWatch = nil
        let roll: () -> Void = { [weak self] in
            guard let self, self.player.currentItem === item, self.isPreloaded else { return }
            self.player.preroll(atRate: 1) { [weak self] ok in
                Task { @MainActor [weak self] in
                    guard let self, self.player.currentItem === item else { return }
                    self.prerolled = ok
                }
            }
        }
        if from > 0 {
            player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                Task { @MainActor in roll() }
            }
        } else {
            roll()
        }
    }

    /// Frames handed over by the item: for the scopes, and to make the
    /// decoder run on a preloaded cue.
    func attachFrames() {
        guard frames == nil, let item = player.currentItem else { return }
        let out = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        item.add(out)
        frames = out
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
        // A preloaded deck already sits on its in point: seeking again would
        // throw away the frames it decoded ahead.
        let here = player.currentTime().seconds
        let positioned = isPreloaded && here.isFinite && abs(here - from) < 0.002
        // Fired: the load-ahead is over, ready or not. Settled before any
        // wait for the listener, so a "ready" that lands late cannot seek a
        // rolling cue back to its in point, and a deck waiting for its
        // listener counts as on air, not as free for the next standby.
        preloadKey = nil
        readyWatch = nil
        guard listening else { startWhenListening = { [weak self] in self?.roll(from: from, positioned: positioned) }; return }
        roll(from: from, positioned: positioned)
    }

    private func roll(from: Double, positioned: Bool) {
        lane.ring.flush()
        if from > 0 && !positioned {
            player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        if heldWhileWaiting { noteLane(position: from, moving: false); return }
        player.play()
        // Noted with the seek's target: the player may still report the old
        // place for a moment.
        noteLane(position: from, moving: true)
    }

    func rewindAndPlay() {
        preloadKey = nil
        readyWatch = nil
        guard listening else { startWhenListening = { [weak self] in self?.rewindAndPlay() }; return }
        lane.ring.flush()
        let from = cue?.trimIn ?? 0
        player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        player.play()
        noteLane(position: from, moving: true)
    }

    /// Holds the cue where it is. One still waiting for its listener stays
    /// parked when the listener arrives.
    func pause() {
        player.pause()
        heldWhileWaiting = !listening
        syncLane()
    }

    /// Carries on after a pause.
    func resume() {
        heldWhileWaiting = false
        if listening { player.play() }
        syncLane()
    }

    /// Leaves the engine path mid-cue (the pair went back to 1 and 2): the
    /// sound comes out of the player again from here on.
    func leaveLane() {
        guard viaLane else { return }
        viaLane = false
        lane.ring.flush()
        lane.clock.stop()
    }

    private func noteLane(position: Double, moving: Bool) {
        guard viaLane else { return }
        lane.clock.note(position: position, speed: moving ? 1 : 0, host: CACurrentMediaTime())
    }

    /// Tells the lane where the player is and whether it is moving, so the
    /// engine plays exactly the frames that are due. Called every tick and
    /// after each play, pause and seek.
    func syncLane() {
        // A cue only standing by keeps its clock stopped until GO notes it.
        guard viaLane, !isPreloaded else { return }
        let moving = player.timeControlStatus == .playing ? Double(player.rate) : 0
        lane.clock.note(position: current, speed: moving, host: CACurrentMediaTime())
    }

    func clear() {
        clearWatchers()
        preloadKey = nil
        readyWatch = nil
        prerolled = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        cue = nil
        endAt = nil
        held = false
        fadingOut = false
        viaLane = false
        listening = true
        startWhenListening = nil
        heldWhileWaiting = false
        lane.ring.flush()
        lane.clock.stop()
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

    @Published var cues: [Cue] { didSet { dropShowKeyClashes(); save(); loadDurations(); onCuesChanged?(); scheduleStandbyPreload(after: 0.3) } }
    /// The standby is not in the live packet, so moving it tells the show
    /// link nothing: a dial spin would only flood the cloud with writes.
    /// Loading ahead waits a moment after each move, so a held arrow key or
    /// a dial spin loads only the cue it lands on, not every cue it passes.
    @Published var standbyID: UUID? {
        didSet {
            guard standbyID != oldValue else { return }
            // A start point from a crash belongs to the cue it was offered
            // for; standing by elsewhere lets it go.
            if let r = pendingResume, r.id != standbyID { pendingResume = nil }
            scheduleStandbyPreload(after: 0.15, restart: true)
        }
    }
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
            if !locked && notice == Self.lockedNotice { notice = nil }
        }
    }
    /// Shown when a drop or a drag runs into the lock, so it is never silent.
    static let lockedNotice = "Editing is locked. Click the lock in the toolbar to add or move cues."
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
            monitors.forEach { $0.standbyText = standbyText }
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
    /// The Program box of the Multiview window: the same layer calls again.
    let multiviewProgram = OutputView()
    private var monitors: [OutputView] { [monitor, multiviewProgram] }
    /// Which output the preview shows.
    @Published var monitorOutput = 1 {
        didSet { if monitorOutput != oldValue { monitors.forEach { $0.black() } } }
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
    /// Ducking has its own clock: All Stop and Fade cancel every cue fade,
    /// and a duck climbing back must not be frozen half way by them.
    private let duckFader = Fader()
    /// Cue sound on a chosen channel pair; off while pair 1 and 2 is picked.
    let cueSound = CueSoundEngine()
    private let videoDecks: [Deck]
    private let soundDecks: [Deck]
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
    /// A still on its way out under a dissolve: its layer, where it shows,
    /// and its level when it started leaving, so Fade can take it down too.
    private var stillOut: (slot: PictureSlot, views: [OutputView], level: Double)?

    // A cue waiting out its pre-wait
    private var pending: (cue: Cue, at: Date, timer: Timer)?
    private var pendingLeft: Double?        // seconds left while paused

    private var paused = false
    private var clock: Timer?
    /// The still standing by, read from disk ahead of its GO.
    private var stillReady: (id: UUID, path: String, image: NSImage)?
    private var preloadTimer: Timer?
    /// The next fire of this cue starts at this point instead of the top.
    private var pendingResume: (id: UUID, offset: Double)?
    private var lastRecoveryWrite = Date.distantPast
    private var recoveryNoted = false

    init() {
        videoDecks = [Deck(name: "a", slot: .a, lane: cueSound.lanes[0]), Deck(name: "b", slot: .b, lane: cueSound.lanes[1])]
        soundDecks = [Deck(name: "sa", slot: nil, lane: cueSound.lanes[2]), Deck(name: "sb", slot: nil, lane: cueSound.lanes[3])]
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
        // Ducking: cue sound dips while any pad sounds, and comes back after.
        duckWatch = pads.$sounding.map { !$0.isEmpty }.removeDuplicates().sink { [weak self] busy in self?.setDuck(busy) }
        // The interface pulled or plugged back in: the cue sound engine
        // moves on its own and says so here. If it could not start, cues
        // on its path come out of their players again, at their level.
        cueSound.onHardwareChange = { [weak self] text, running in
            guard let self else { return }
            self.log.add(running ? .output : .problem, text)
            if !running { for d in self.videoDecks + self.soundDecks where d.viaLane { d.leaveLane(); self.apply(d) } }
        }
        watchShowKeys()
        applySoundRoutes()
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
        monitors.forEach { $0.standbyText = standbyText }
        startClock()
        scheduleStandbyPreload()
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
        // The notice stays as long as an open output's picked screen is
        // still missing and the output sits as a window: a lid opening or a
        // third screen appearing must not say the projector is back.
        let stillMissing = outputs.contains { config in
            guard openOutputs.contains(config.id), let screen = config.screen else { return false }
            return !now.contains(screen) && window(config.id).placement.hasPrefix("a window")
        }
        if !stillMissing && notice?.contains("screen was disconnected") == true { notice = nil }
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
            for d in [pictureDeck, soundDeck].compactMap({ $0 }) where !d.held { d.resume() }
            if let left = stillLeft { armStillTimer(left); stillLeft = nil }
            if let left = pendingLeft, let p = pending { schedulePending(p.cue, in: left); pendingLeft = nil }
            refresh()
            // The strip and the deck count from a start time, so a resume
            // re-anchors them.
            if let cue = countingCue { onClipStart?(cue, playLength(cue)) }
        } else if hasAnythingToPause {
            log.add(.pause, "Paused", from: source)
            paused = true
            for d in [pictureDeck, soundDeck].compactMap({ $0 }) {
                d.pause()
                // A fade-out under way holds too; the clock restarts it from
                // this level over the time left once the cue carries on.
                if d.fadingOut { fader.cancel(d.name); d.fadingOut = false }
            }
            if let cue = stillCue, cue.fadeOut > 0, let ends = stillEndsAt, stillTimer != nil,
               ends.timeIntervalSinceNow <= cue.fadeOut { fader.cancel("still") }
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
        if paused { paused = false; for d in [pictureDeck, soundDeck].compactMap({ $0 }) where !d.held { d.resume() } }
        // Every deck with a cue on it, not just the one on air: under a
        // dissolve the outgoing picture is still showing underneath, and
        // must fade with the rest instead of coming back through.
        let decks = (videoDecks + soundDecks).filter { $0.cue != nil && !$0.isPreloaded }
        let startPicture = decks.map { $0.pictureLevel }, startSound = decks.map { $0.soundLevel }
        let startStill = stillLevel
        let leaving = stillOut
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
            if let leaving { leaving.views.forEach { $0.setOpacity(leaving.slot, Float(leaving.level * v)) } }
        }, done: { [weak self] in self?.stopEverything() })
    }

    /// A fader ride sends many values a second; the show is saved once
    /// when the ride settles, not on every tick.
    private var gainSaveTimer: Timer?

    func setGain(_ value: Double) {
        masterGain = min(1.2, max(0, value))
        [pictureDeck, soundDeck].compactMap { $0 }.forEach(apply)
        pads.setMaster(masterGain)
        if gainSaveTimer == nil {
            let t = Timer(timeInterval: 0.5, repeats: false) { [weak self] _ in
                self?.gainSaveTimer = nil
                self?.save()
            }
            RunLoop.main.add(t, forMode: .common)
            gainSaveTimer = t
        }
        onTransport?()
    }

    // MARK: Firing

    /// Fires one cue, with its pre-wait if it has one. Matches fireCue in
    /// the web app.
    @discardableResult
    func fire(_ cue: Cue, from: String? = nil) -> WireResult {
        if let p = pending { log.add(.problem, "\u{201C}\(p.cue.name)\u{201D} was waiting and never fired: \u{201C}\(cue.name)\u{201D} came first", from: from ?? source) }
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
        // A start point from a crash is for the next cue to fire; firing
        // another cue first lets it go.
        if let r = pendingResume, r.id != cue.id { pendingResume = nil }
        let result: WireResult
        readEnvelope(cue)
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
        let device = soundDevice(for: cue), viaLane = usesLane(for: cue)
        let key = preloadKey(cue, device: device, viaLane: viaLane)
        // The deck that already holds this cue, loaded ahead of its GO; else
        // a free one.
        let deck = videoDecks.first { $0 !== pictureDeck && $0.preloadKey == key }
            ?? videoDecks.first { $0 !== pictureDeck } ?? videoDecks[0]
        fader.cancel(deck.name)
        if deck.preloadKey == key {
            // Loaded ahead: only its settings may have changed since.
            deck.cue = cue
            deck.keyer?.update(cue.key)
            let showing = views(for: cue)
            deck.prepared.filter { v in !showing.contains { $0 === v } }.forEach { $0.unprepareVideo(deck.player, in: deck.slot!) }
            deck.prepared = []
        } else {
            unprepare(deck)
            deck.load(cue, device: device, viaLane: viaLane) { [weak self, weak deck] in
                guard let self, let deck, deck.cue?.id == cue.id else { return }
                self.reachedEnd(deck)
            }
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
        let viaLane = usesLane(for: cue)
        let key = preloadKey(cue, device: audio.cueDevice, viaLane: viaLane)
        let deck = soundDecks.first { $0 !== soundDeck && $0.preloadKey == key }
            ?? soundDecks.first { $0 !== soundDeck } ?? soundDecks[0]
        fader.cancel(deck.name)
        if deck.preloadKey == key {
            deck.cue = cue
        } else {
            deck.load(cue, device: audio.cueDevice, viaLane: viaLane) { [weak self, weak deck] in
                guard let self, let deck, deck.cue?.id == cue.id else { return }
                self.reachedEnd(deck)
            }
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
            if let ready = stillReady, ready.id == cue.id, ready.path == cue.path {
                image = ready.image       // read from disk while it stood by
            } else {
                guard let loaded = NSImage(contentsOf: cue.url) else { return refuse("Can't open the still \"\(cue.name)\".") }
                image = loaded
            }
        }
        let slot: PictureSlot = stillCue == nil ? stillSlot : (stillSlot == .s1 ? .s2 : .s1)
        // An earlier still may still be dissolving away on this layer: its
        // clean-up must not blank the new one when it ends.
        fader.cancel("still-out-\(slot.rawValue)")
        if stillOut?.slot == slot { stillOut = nil }
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
            let oldLevel = stillLevel
            pads.cueLeftAir(leaving.id)
            stillCue = nil
            stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
            fader.cancel("still")
            if seconds > 0 {
                stillOut = (oldSlot, oldViews, oldLevel)
                fader.run("still-out-\(oldSlot.rawValue)", from: 1, to: 1, seconds: seconds, apply: { _ in },
                          done: { [weak self] in
                              oldViews.forEach { $0.hide(oldSlot) }
                              if self?.stillOut?.slot == oldSlot { self?.stillOut = nil }
                          })
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
            let sameLane = next.kind.hasPicture == cue.kind.hasPicture
            if !sameLane { endAction(deck, cue) }
            standbyID = nextArmed(after: next)?.id ?? next.id
            let result = fire(next, from: "Follow")
            // A Follow that cannot take over now (its file is missing, or it
            // has a pre-wait) must not leave this clip rolling past its out
            // point: it ends the way its own setting says.
            if sameLane, !result.ok || pending != nil { endAction(deck, cue); refresh() }
            return
        }
        endAction(deck, cue)
        refresh()
    }

    private func endAction(_ deck: Deck, _ cue: Cue) {
        switch cue.endAction {
        case .hold where cue.kind == .video:
            deck.pause()
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
            // A refused Follow (the file is missing) leaves the still to its
            // own end action.
            if fire(next, from: "Follow").ok { return }
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

    /// Adds files as cues, at the end or at a place in the list (a drop
    /// between two rows).
    func add(urls: [URL], at index: Int? = nil) {
        var made = urls.compactMap(Cue.make(from:))
        if made.count < urls.count { notice = "Some files were skipped. Outrangutan plays video, sound and still pictures." }
        guard !made.isEmpty else { return }
        noteUndo(made.count == 1 ? "Add Cue" : "Add Cues")
        for i in made.indices { made[i].wireID = Cue.newWireID(offsetMs: i) }
        if let index, index >= 0, index < cues.count { cues.insert(contentsOf: made, at: index) }
        else { cues.append(contentsOf: made) }
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

    /// Whether the picked cues can move one place up (-1) or down (1).
    func canMove(ids: Set<UUID>, by step: Int) -> Bool {
        let rows = cues.indices.filter { ids.contains(cues[$0].id) }
        guard !rows.isEmpty else { return false }
        return step < 0 ? rows.first! > 0 : rows.last! < cues.count - 1
    }

    /// Moves the picked cues one place up or down, keeping them together
    /// in order (Move Up and Move Down in the right-click menu, and
    /// Option-Command-Up and Down).
    func move(ids: Set<UUID>, by step: Int) {
        guard !locked, canMove(ids: ids, by: step) else { return }
        noteUndo("Move Cue")
        var list = cues
        let rows = list.indices.filter { ids.contains(list[$0].id) }
        if step < 0 {
            for r in rows { list.swapAt(r, r - 1) }
        } else {
            for r in rows.reversed() { list.swapAt(r, r + 1) }
        }
        cues = list
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
        copy.hotkey = ""        // one key, one cue
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
        Thumbnails.shared.showReplaced()
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
        let level = Float(min(1, masterGain) * (d.cue?.volume ?? 1) * d.soundLevel * duck)
        // On the lane path the engine sets the level; the player stays silent.
        d.player.volume = d.viaLane ? 0 : level
        if d.viaLane { d.lane.gain.outputVolume = level }
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
        scheduleStandbyPreload()
    }

    private func stopPicture() {
        if let d = pictureDeck { clearDeck(d) }
        // A cue loaded ahead of its GO is not on air: it stays ready.
        videoDecks.forEach { if $0.cue != nil && !$0.isPreloaded { clearDeck($0) } }
        stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
        fader.cancel("still")
        if let leaving = stillCue { pads.cueLeftAir(leaving.id) }
        stillCue = nil
        for w in windows.values { w.pictureView.hide(.s1); w.pictureView.hide(.s2) }
        monitors.forEach { $0.hide(.s1); $0.hide(.s2) }
        stillViews = []
        stillOut = nil
    }

    private func stopSound() {
        soundDecks.forEach { if $0.cue != nil && !$0.isPreloaded { clearDeck($0) } }
        soundDeck = nil
    }

    // MARK: Loading ahead

    /// What a load depends on. When any of it changes, the cue is loaded again.
    private func preloadKey(_ cue: Cue, device: String?, viaLane: Bool) -> String {
        "\(cue.id.uuidString)|\(cue.path)|\(cue.trimIn)|\(cue.trimOut ?? -1)|\(device ?? "")|\(viaLane)|\(cue.key.mode.rawValue)"
    }

    /// Readies the standby cue soon: right away for a new standby or a freed
    /// deck, a little later for a setting change (a slider drag changes a
    /// cue many times a second, and the player must not reload on each one).
    /// With `restart` the wait begins again on every call, so a run of quick
    /// moves ends in one load when the moves stop.
    private func scheduleStandbyPreload(after seconds: Double = 0, restart: Bool = false) {
        if !restart, let t = preloadTimer, t.fireDate.timeIntervalSinceNow <= seconds { return }
        preloadTimer?.invalidate()
        let t = Timer(timeInterval: max(0.001, seconds), repeats: false) { [weak self] _ in
            self?.preloadTimer = nil
            self?.preloadStandby()
        }
        RunLoop.main.add(t, forMode: .common)
        preloadTimer = t
    }

    /// Readies the cue standing by, so GO starts it on the next frame: a
    /// video or sound is loaded and decoded ahead on a free deck, a still is
    /// read from disk. Nothing happens when it is ready already. (Like a
    /// pro playback deck: the next clip is cued up, not just picked.)
    func preloadStandby() {
        guard let cue = standbyCue, cue.fileIsThere else { dropPreloads(); return }
        switch cue.kind {
        case .video, .audio:
            let picture = cue.kind == .video
            let decks = picture ? videoDecks : soundDecks
            let busy = picture ? pictureDeck : soundDeck
            let device = picture ? soundDevice(for: cue) : audio.cueDevice
            let viaLane = usesLane(for: cue)
            let key = preloadKey(cue, device: device, viaLane: viaLane)
            readEnvelope(cue)
            // The other lane's loaded cue, if any, no longer stands by.
            (picture ? soundDecks : videoDecks).forEach { if $0.isPreloaded && !onAir($0) { unprepare($0); $0.clear() } }
            stillReady = nil
            if decks.contains(where: { $0.preloadKey == key }) { return }
            // A free deck: not on air, and empty or holding an older load.
            guard let deck = decks.first(where: { $0 !== busy && ($0.cue == nil || $0.isPreloaded) }) else { return }
            if deck.isPreloaded { unprepare(deck) }
            deck.preload(cue, key: key, device: device, viaLane: viaLane) { [weak self, weak deck] in
                guard let self, let deck, deck.cue?.id == cue.id else { return }
                self.reachedEnd(deck)
            }
            // The output layers get the player now, hidden, so GO only has
            // to unhide them.
            if let slot = deck.slot {
                deck.prepared = views(for: cue)
                deck.prepared.forEach { $0.prepareVideo(deck.player, in: slot) }
            }
        case .still:
            dropDeckPreloads()
            if let ready = stillReady, ready.id == cue.id, ready.path == cue.path { return }
            let id = cue.id, path = cue.path, url = cue.url
            Task.detached(priority: .userInitiated) { [weak self] in
                guard let image = NSImage(contentsOf: url) else { return }
                await MainActor.run { [weak self] in
                    guard let self, self.standbyID == id else { return }
                    self.stillReady = (id, path, image)
                }
            }
        case .matte:
            dropPreloads()
        }
    }

    /// Drops every load-ahead. A deck on air is never one, whatever its key
    /// says (it was fired and may still be waiting for its listener).
    private func dropDeckPreloads() { (videoDecks + soundDecks).forEach { if $0.isPreloaded && !onAir($0) { unprepare($0); $0.clear() } } }
    private func onAir(_ d: Deck) -> Bool { d === pictureDeck || d === soundDeck }

    /// Takes a preloaded deck's player back off the layers it was handed to.
    private func unprepare(_ d: Deck) {
        if let slot = d.slot { d.prepared.forEach { $0.unprepareVideo(d.player, in: slot) } }
        d.prepared = []
    }
    private func dropPreloads() { dropDeckPreloads(); stillReady = nil }

    /// The picture deck's frame output and its clock, for test mode to
    /// count the frames it hands over.
    func frameProbe() -> (AVPlayerItemVideoOutput, CMTime)? {
        guard let d = pictureDeck, let item = d.player.currentItem else { return nil }
        d.attachFrames()
        guard let out = d.frames else { return nil }
        return (out, item.currentTime())
    }

    /// How many files the decks have opened so far, for test mode.
    var deckLoads: Int { Deck.loads }

    /// What is loaded ahead right now, for test mode and Show Check.
    var preloadState: String {
        var parts = (videoDecks + soundDecks).filter(\.isPreloaded).map { d in
            "\(d.name): \(d.cue?.name ?? "-") \(d.prerolled ? "ready" : "loading") at \(String(format: "%.3f", d.current)) s"
        }
        if let s = stillReady { parts.append("still: \(s.image.size.width > 0 ? "ready" : "empty") \(cues.first { $0.id == s.id }?.name ?? "-")") }
        return parts.isEmpty ? "nothing loaded ahead" : parts.joined(separator: ", ")
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
        // Fade out before the end, for cues that ask for it. A fade-in or a
        // dissolve-in still running goes first; the fade-out then takes
        // whatever time is left.
        for d in [pictureDeck, soundDeck].compactMap({ $0 }) {
            guard let cue = d.cue, cue.fadeOut > 0, !cue.loop, !d.fadingOut, !d.held, !paused, !fader.isRunning(d.name),
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
        ticks += 1
        (videoDecks + soundDecks).forEach { $0.syncLane() }
        readCueMeter()
        noteRecoveryPoint()
    }

    /// The loudest playing cue, scaled by its volume, like what goes out: the
    /// lane's listener where the cue sound engine carries the sound, the
    /// clip's level map everywhere else.
    private func readCueMeter() {
        var l: Float = 0, r: Float = 0
        for d in videoDecks + soundDecks where d.cue != nil && !d.isPreloaded && d.player.rate > 0 {
            let level = d.viaLane ? d.lane.gain.outputVolume : d.player.volume
            let pl: Float, pr: Float
            if d.viaLane, let heard = d.peaks?.take() { (pl, pr) = heard }
            else if let cue = d.cue, let map = envelopes[cue.path] { (pl, pr) = map.level(at: d.current) }
            else { continue }
            l = max(l, pl * level); r = max(r, pr * level)
        }
        if l > 0.0005 || r > 0.0005 || cueMeter.left > 0.0005 || cueMeter.right > 0.0005 { cueMeter.take(l, r) }
    }

    /// Each clip's level over time, read once in the background: for the
    /// cue standing by, and for any cue the moment it fires.
    private var envelopes: [String: SoundEnvelope] = [:]
    private var envelopeReads: Set<String> = []
    private func readEnvelope(_ cue: Cue) {
        let path = cue.path, url = cue.url
        // Only the part that can play is read (a trimmed hour-long file is
        // not scanned end to end while another clip plays from the same
        // disk), quietly in the background. A map that already covers the
        // trim is kept.
        let from = cue.trimIn, to = cue.trimOut
        guard cue.kind == .video || cue.kind == .audio, !envelopeReads.contains(path),
              envelopes[path]?.covers(from: from, to: to) != true else { return }
        envelopeReads.insert(path)
        Task.detached(priority: .background) { [weak self] in
            let map = await SoundEnvelope.read(url, from: from, to: to)
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.envelopeReads.remove(path)
                if let map { self.envelopes[path] = map }
            }
        }
    }

    /// Once a second, notes what is on air, so a crash can pick up there.
    /// With nothing on air the note is cleared.
    private func noteRecoveryPoint() {
        guard Date().timeIntervalSince(lastRecoveryWrite) >= 1 else { return }
        lastRecoveryWrite = Date()
        // The picture first (a video, then a still), then a sound, then a
        // cue waiting out its pre-wait: the program picture is what the
        // show must get back, not the music bed under it.
        func playing(_ d: Deck?) -> Deck? { d.flatMap { !$0.held && $0.cue != nil ? $0 : nil } }
        let point: RecoveryPoint?
        if let deck = playing(pictureDeck), let cue = deck.cue, let wire = cue.wireID {
            point = RecoveryPoint(wireID: wire, name: cue.name, offset: deck.current)
        } else if let still = stillCue, let wire = still.wireID {
            point = RecoveryPoint(wireID: wire, name: still.name, offset: 0)
        } else if let deck = playing(soundDeck), let cue = deck.cue, let wire = cue.wireID {
            point = RecoveryPoint(wireID: wire, name: cue.name, offset: deck.current)
        } else if let p = pending, let wire = p.cue.wireID {
            point = RecoveryPoint(wireID: wire, name: p.cue.name, offset: 0)
        } else {
            point = nil
        }
        lastRecoveryPoint = point
        if let point {
            point.save()
            recoveryNoted = true
        } else if recoveryNoted {
            RecoveryPoint.clear()
            recoveryNoted = false
        }
    }

    /// What the crash note last said, for test mode (which never writes it).
    private(set) var lastRecoveryPoint: RecoveryPoint?

    /// A clean quit leaves nothing to recover.
    func quitting() {
        clock?.invalidate()
        if gainSaveTimer != nil { gainSaveTimer?.invalidate(); gainSaveTimer = nil; save() }
        RecoveryPoint.clear()
    }

    /// Loads any clip lengths still unknown, so a show file written right
    /// after clips were added carries their lengths for the web app.
    @MainActor
    func loadDurationsNow() async {
        for cue in cues where !cue.kind.holds && durations[cue.id] == nil && cue.fileIsThere {
            if let time = try? await AVURLAsset(url: cue.url).load(.duration), time.isNumeric { durations[cue.id] = time.seconds }
        }
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
        w.onClose = { [weak self] in
            guard let self else { return }
            // The red button, Command-W: logged like any other close.
            if self.openOutputs.contains(id) { self.log.add(.output, "\(self.outputLabel(id)) closed by its window") }
            self.openOutputs.remove(id)
            self.onTransport?()
        }
        windows[id] = w
        return w
    }

    /// Closes an output the way its red button does, for test mode.
    func debugCloseWindow(_ id: Int) { windows[id]?.closeFromWindow() }

    /// The outputs a cue shows on: its own, or every one for "every output".
    /// A cue pointed at an output that was removed uses the first output.
    private func views(for cue: Cue) -> [OutputView] {
        let preview = outputs.contains { $0.id == monitorOutput } ? monitorOutput : outputs[0].id
        if cue.output == 0 { return outputs.map { window($0.id).pictureView } + monitors }
        let id = outputs.contains { $0.id == cue.output } ? cue.output : outputs[0].id
        return [window(id).pictureView] + (id == preview ? monitors : [])
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
        guard let frame = stillFrame?.image else { return nil }
        if still.key.mode == .alpha {
            let bg = CIImage(color: CIColor(color: NSColor(hex: still.key.bg) ?? .black) ?? .black).cropped(to: frame.extent)
            return frame.composited(over: bg)
        }
        return frame
    }

    private func attachFrames(_ d: Deck) {
        guard wantsFrames else { return }
        d.attachFrames()
    }

    /// A video's sound goes to its output's sound device if it has one,
    /// else to the cue sound device.
    private func soundDevice(for cue: Cue) -> String? {
        if cue.output != 0, let d = outputs.first(where: { $0.id == cue.output })?.audioDevice { return d }
        return audio.cueDevice
    }

    /// How many clock ticks have run; for test mode.
    private var ticks = 0

    /// The level the playing cues' sound is at (volume times fades times
    /// ducking), for test mode. 0 with nothing playing.
    var cueLevel: Double {
        (videoDecks + soundDecks).filter { $0.cue != nil && !$0.isPreloaded }
            .map { Double($0.viaLane ? $0.lane.gain.outputVolume : $0.player.volume) }.max() ?? 0
    }

    /// Which path each playing cue's sound takes, for test mode and Show
    /// Check: "player" straight out of its player, "engine" through the cue
    /// sound engine.
    var soundRoutes: String {
        (videoDecks + soundDecks).filter { $0.cue != nil && !$0.isPreloaded }
            .map { d in
                let status: String
                switch d.player.timeControlStatus {
                case .playing: status = "playing"
                case .paused: status = "paused"
                default: status = "waiting: \(d.player.reasonForWaitingToPlay?.rawValue ?? "?")"
                }
                let item = d.player.currentItem.map { "\($0.status.rawValue)\($0.error.map { " " + $0.localizedDescription } ?? "") timebase \($0.timebase.map { CMTimebaseGetRate($0) } ?? -1) keepUp \($0.isPlaybackLikelyToKeepUp) listening \(d.isListening) ticks \(self.ticks)" } ?? "no item"
                return "\(d.cue?.name ?? "-") via \(d.viaLane ? "engine" : "player") vol \(d.player.volume) rate \(d.player.rate) \(status) item \(item) at \(String(format: "%.3f", d.current - (d.cue?.trimIn ?? 0))) s"
            }.joined(separator: ", ")
    }

    /// The cue a hotkey fires, if any cue has that key.
    func cue(forHotkey key: String) -> Cue? {
        key.isEmpty ? nil : cues.first { $0.hotkey == key }
    }

    /// Gives a cue a hotkey. A key belongs to one cue at a time, so any
    /// other cue that had it lets go. "" takes the key away.
    func setHotkey(_ id: UUID, _ key: String) {
        let k = key.lowercased()
        guard cues.contains(where: { $0.id == id }), cues.first(where: { $0.id == id })?.hotkey != k else { return }
        // A show key (GO, Stop...) always wins, so a cue can never take one.
        if KeyMap.shared.keys.values.contains(where: { !$0.padName.isEmpty && $0.padName == k }) {
            log.add(.problem, "\(k.uppercased()) is a show key, so a cue cannot have it")
            return
        }
        noteUndo("Hotkey", key: "hotkey:\(id)")
        for i in cues.indices {
            if cues[i].id == id { cues[i].hotkey = k } else if !k.isEmpty && cues[i].hotkey == k { cues[i].hotkey = "" }
        }
    }

    /// A show key (GO, Pause...) always wins, so a cue hotkey it takes is
    /// cleared, the way a pad's is.
    private var showKeyWatch: AnyCancellable?
    private func watchShowKeys() {
        showKeyWatch = KeyMap.shared.$keys.sink { [weak self] keys in self?.dropShowKeyClashes(keys) }
    }

    /// Takes a show key off any cue that has it: when a show key changes,
    /// and when cues arrive (a show file made on a Mac with other keys).
    private func dropShowKeyClashes(_ keys: [KeyMap.Action: KeyMap.Key] = KeyMap.shared.keys) {
        let taken = Set(keys.values.map(\.padName).filter { !$0.isEmpty })
        let clashing = cues.filter { !$0.hotkey.isEmpty && taken.contains($0.hotkey) }
        guard !clashing.isEmpty else { return }
        for c in clashing { log.add(.problem, "\u{201C}\(c.name)\u{201D} lost its hotkey \(c.hotkey.uppercased()): a show key took it") }
        for i in cues.indices where taken.contains(cues[i].hotkey) { cues[i].hotkey = "" }
    }

    /// Where the player on a lane is, in seconds into its file; for test mode.
    func soundPosition(lane: Int) -> Double? {
        (videoDecks + soundDecks).first { $0.lane === cueSound.lanes[lane] && $0.cue != nil && !$0.isPreloaded }?.current
    }

    /// A cue's sound goes through the cue sound engine when a pair other
    /// than 1 and 2 is picked and the cue plays to the cue sound device (not
    /// to an output's own sound device).
    private func usesLane(for cue: Cue) -> Bool {
        cueSound.isOn && soundDevice(for: cue) == audio.cueDevice
    }

    private func outputsChanged() {
        save()
        scheduleStandbyPreload()
        // Move open windows to a newly picked screen, and keep titles current.
        for config in outputs where openOutputs.contains(config.id) {
            window(config.id).open(on: config.screen, title: config.label)
        }
        onTransport?()
    }

    private func audioChanged() {
        save()
        applySoundRoutes()
        scheduleStandbyPreload()
        setDuck(!pads.sounding.isEmpty)
    }

    /// How much cue sound is turned down while pads sound: 1 is not at all.
    private(set) var duck: Double = 1
    private var duckWatch: AnyCancellable?

    /// Turns cue sound down while pads sound (Settings, Sound), fast on the
    /// way down and gently on the way back, like a board operator's hand.
    private func setDuck(_ busy: Bool) {
        let target = audio.duckUnderPads && busy ? pow(10, -audio.duckDb / 20) : 1
        guard target != duck else { return }
        let from = duck
        duckFader.run("duck", from: 0, to: 1, seconds: target < from ? 0.15 : 0.8) { [weak self] v in
            guard let self else { return }
            self.duck = from + (target - from) * v
            (self.videoDecks + self.soundDecks).forEach(self.apply)
        }
    }

    private var padsRoute: (device: String?, channel: Int)?
    private var cueRoute: (device: String?, channel: Int)?

    /// Sends the pads and cue sound where Settings says, but only the part
    /// that changed: re-routing stops sounding pads and restarts the cue
    /// engine, so touching one picker must not disturb the other.
    private func applySoundRoutes() {
        if padsRoute == nil || padsRoute! != (audio.padDevice, audio.padFirstChannel) {
            pads.setOutput(device: audio.padDevice, firstChannel: audio.padFirstChannel)
            padsRoute = (audio.padDevice, audio.padFirstChannel)
        }
        // A pair other than 1 and 2 with the engine off means it would not
        // start last time: picking it again is a fresh try.
        if cueRoute == nil || cueRoute! != (audio.cueDevice, audio.cueFirstChannel) || (audio.cueFirstChannel > 0 && !cueSound.isOn) {
            cueSound.setOutput(device: audio.cueDevice, firstChannel: audio.cueFirstChannel)
            cueRoute = (audio.cueDevice, audio.cueFirstChannel)
            if !cueSound.isOn {
                // Back to 1 and 2: cues on the engine path come out of
                // their players again, at their level.
                for d in videoDecks + soundDecks where d.viaLane { d.leaveLane(); apply(d) }
            }
        }
    }
}
