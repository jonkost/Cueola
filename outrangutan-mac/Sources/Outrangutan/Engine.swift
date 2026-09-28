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
    private var tokens: [Any] = []
    private var watchers: [NSObjectProtocol] = []

    init(name: String, slot: PictureSlot?) {
        self.name = name
        self.slot = slot
        // Play on time: never wait to build a cushion, the files are local.
        player.automaticallyWaitsToMinimizeStalling = false
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
    func load(_ cue: Cue, ended: @escaping () -> Void) {
        clearWatchers()
        self.cue = cue
        held = false
        fadingOut = false
        let item = AVPlayerItem(url: cue.url)
        player.replaceCurrentItem(with: item)
        if let out = cue.trimOut, out > cue.trimIn {
            let at = NSValue(time: CMTime(seconds: out, preferredTimescale: 600))
            tokens.append(player.addBoundaryTimeObserver(forTimes: [at], queue: .main, using: ended))
        }
        watchers.append(NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in ended() })
    }

    /// Starts from the trim in point.
    func start() {
        guard let cue else { return }
        if cue.trimIn > 0 {
            player.seek(to: CMTime(seconds: cue.trimIn, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
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
    @Published var outputScreen: String? { didSet { save(); if output.isOpen { output.open(on: outputScreen) } } }

    @Published private(set) var status: Status = .ready
    @Published private(set) var pictureCue: Cue?
    @Published private(set) var soundCue: Cue?
    /// Seconds left on what is on air. nil when nothing is counting.
    @Published private(set) var remaining: Double?
    /// Seconds left in a pre-wait, while one runs.
    @Published private(set) var preRemaining: Double?
    @Published private(set) var pendingCue: Cue?
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
    /// The sound effect board.
    let pads: PadBoard
    private var view: OutputView { output.pictureView }
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
        pads = PadBoard(banks: show.banks, pads: show.pads, multiTrigger: show.multiTrigger)
        pads.setMaster(masterGain)
        pads.onChange = { [weak self] in self?.save(); self?.onCuesChanged?() }
        save()
        loadDurations()
        startClock()
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

    /// Pause holds everything where it is: players, still timers and a
    /// pre-wait count. Press again to carry on.
    func togglePause() {
        if paused {
            paused = false
            for d in [pictureDeck, soundDeck].compactMap({ $0 }) where !d.held { d.player.play() }
            if let left = stillLeft { armStillTimer(left); stillLeft = nil }
            if let left = pendingLeft, let p = pending { schedulePending(p.cue, in: left); pendingLeft = nil }
            refresh()
            // The strip and the deck count from a start time, so a resume
            // re-anchors them.
            if let cue = countingCue { onClipStart?(cue, playLength(cue)) }
        } else if hasAnythingToPause {
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
        cancelPending()
        if lastLane == .audio && soundDeck != nil { stopSound() } else { stopPicture() }
        refresh()
    }

    /// All Stop (PANIC): everything off at once, pads too, output to black.
    func allStop() {
        stopCues()
        pads.stopAll()
    }

    /// Stops every cue at once, but lets pads ring. What a remote Stop does,
    /// like the web app.
    func stopCues() {
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
        guard pictureDeck != nil || soundDeck != nil || stillCue != nil else { return allStop() }
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
        }, done: { [weak self] in self?.allStop() })
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
    func fire(_ cue: Cue) -> WireResult {
        cancelPending()
        guard cue.fileIsThere else { return refuse("Can't find the file for \"\(cue.name)\". It may have moved.") }
        notice = nil
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
        // Continue: the next cue fires as this one starts.
        if cue.continueMode == .autoContinue { fireNext(after: cue) }
        return result
    }

    private func beginVideo(_ cue: Cue) -> WireResult {
        let deck = videoDecks.first { $0 !== pictureDeck } ?? videoDecks[0]
        fader.cancel(deck.name)
        deck.load(cue) { [weak self, weak deck] in
            guard let self, let deck, deck.cue?.id == cue.id else { return }
            self.reachedEnd(deck)
        }
        let dissolve = cue.xfade > 0 && (pictureDeck != nil || stillCue != nil)
        deck.pictureLevel = (dissolve || cue.fadeIn > 0) ? 0 : 1
        deck.soundLevel = deck.pictureLevel
        view.showVideo(deck.player, in: deck.slot!, cue: cue, opacity: Float(deck.pictureLevel))
        apply(deck)
        deck.start()
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
        deck.load(cue) { [weak self, weak deck] in
            guard let self, let deck, deck.cue?.id == cue.id else { return }
            self.reachedEnd(deck)
        }
        let old = soundDeck
        let dissolve = cue.xfade > 0 && old != nil
        deck.soundLevel = (dissolve || cue.fadeIn > 0) ? 0 : 1
        apply(deck)
        deck.start()
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
        let dissolve = cue.xfade > 0 && (pictureDeck != nil || stillCue != nil)
        let startLevel: Double = (dissolve || cue.fadeIn > 0) ? 0 : 1
        view.showStill(image, in: slot, cue: cue, opacity: Float(startLevel))
        takeOverPicture(with: dissolve ? cue.xfade : 0, curve: cue.fadeCurve)
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
            pads.cueLeftAir(leaving.id)
            stillCue = nil
            stillTimer?.invalidate(); stillTimer = nil; stillEndsAt = nil; stillLeft = nil
            fader.cancel("still")
            if seconds > 0 {
                fader.run("still-out-\(oldSlot.rawValue)", from: 1, to: 1, seconds: seconds, apply: { _ in },
                          done: { [weak self] in self?.view.hide(oldSlot) })
            } else {
                view.hide(oldSlot)
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
            fire(next)
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
            fire(next)
            return
        }
        if cue.endAction == .black {
            let slot = stillSlot
            fader.run("still", from: stillLevel, to: 0, seconds: 0.6, curve: cue.fadeCurve, apply: { [weak self] v in
                self?.stillLevel = v; self?.applyStill()
            }, done: { [weak self] in
                guard let self, self.stillSlot == slot, self.stillCue?.id == cue.id else { return }
                self.view.hide(slot); self.stillCue = nil; self.pads.cueLeftAir(cue.id); self.refresh()
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
        fire(next)
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
        s.outputsOpen = output.isOpen ? 1 : 0
        s.outputsReady = s.outputsOpen
        s.outputsTotal = 1
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
        for i in made.indices { made[i].wireID = Cue.newWireID(offsetMs: i) }
        cues.append(contentsOf: made)
        if standbyID == nil { standbyID = made.first?.id }
    }

    func addMatte(color: String, name: String) {
        let cue = Cue.matte(named: name, color: color)
        cues.append(cue)
        standbyID = cue.id
    }

    func remove(ids: Set<UUID>) {
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
        cues[i] = cue
        for d in [pictureDeck, soundDeck].compactMap({ $0 }) where d.cue?.id == id {
            d.cue = cue
            apply(d)
            if let slot = d.slot { view.restyle(slot, cue) }
        }
        if stillCue?.id == id {
            stillCue = cue
            view.restyle(stillSlot, cue)
        }
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
        notice = reason
        return .refused(reason)
    }

    private func apply(_ d: Deck) {
        d.player.volume = Float(min(1, masterGain) * (d.cue?.volume ?? 1) * d.soundLevel)
        if let slot = d.slot { view.setOpacity(slot, Float(d.pictureLevel)) }
    }

    private func applyStill() {
        view.setOpacity(stillSlot, Float(stillLevel))
    }

    private func clearDeck(_ d: Deck) {
        if let leaving = d.cue { pads.cueLeftAir(leaving.id) }
        fader.cancel(d.name)
        d.clear()
        if let slot = d.slot { view.hide(slot) }
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
        view.hide(.s1); view.hide(.s2)
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
        ShowStore.save(ShowFile(cues: cues, outputScreen: outputScreen, masterGain: masterGain,
                                pads: pads.pads, banks: pads.banks, multiTrigger: pads.multiTrigger))
    }
}
