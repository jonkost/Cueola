import Foundation
import OutrangutanCore

/// The link to a Cueola show: how the director's TAKE and KeyWi Bird keys
/// reach this Mac, and how the rundown and the deck learn what is on air.
///
/// The cloud sends the show the moment it changes (a live line), and the
/// Mac also reads it on a timer as the safety net. A command from the
/// rundown or a deck on another Mac lands here as fast as the cloud can
/// carry it. A deck on this Mac goes straight to the app (DirectLink).
///
/// It reads and writes the same fields the web Outrangutan uses
/// (`outrangutan.command`, `.commandQueue`, `.panic`, `.gain`, `.cmdAck`,
/// `.live`, `.cues`, `.pads`, `.playingStart`, `.preflight`, and
/// `fixRequests`), so the rundown and KeyWi Bird work with it unchanged.
///
/// Playback never waits on the link. Every command runs on this Mac first,
/// and if the internet drops the show keeps playing.
@MainActor
final class ShowLink: ObservableObject {
    enum Phase: Equatable { case off, connecting, linked, trouble }

    @Published private(set) var phase: Phase = .off
    @Published private(set) var message = "Not connected to a show"
    @Published private(set) var code = ""
    /// Browser windows on this Mac connected over the direct link.
    @Published var directBrowsers = 0

    /// This app's name on the wire. The rundown uses it to tell playout
    /// Macs apart and to skip its own writes.
    let sender = "outrangutan_mac_" + String((0..<7).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
    let build = "mac-" + ((Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev")

    let cloud = CloudClient()
    let engine: Engine
    private let store: ShowRecordStore
    private let inbox: CommandInbox
    private var joined = false
    private var pollTask: Task<Void, Never>?
    /// The live line: the cloud sends the show the moment it changes.
    private var streamTask: Task<Void, Never>?
    /// When the live line last brought a message (this Mac's clock, in
    /// milliseconds). 0 while it is down.
    private var streamAliveAt: Double = 0
    private var streamNoted = false
    /// When reads started failing (milliseconds), while they are failing.
    private var failingSince: Double = 0
    /// When the cloud wrote the last copy applied here (seconds).
    private var lastApplied: Double = 0
    private var flushTimer: Timer?
    /// Seconds to wait before writing again after the cloud said it is busy.
    private var writeBackoff: Double = 0
    private var busyNotedAt: Double = 0
    private var heartbeat: Timer?
    private var cuesTimer: Timer?
    private var liveSeq = 0
    private var lastLiveAt: Double = 0
    private var startSeq = 0
    private var sfxSeq = 0
    private var lastSfxAt: Double = 0
    private var fixSeen: [String] = []
    private var pending: [[String]: Any] = [:]
    /// Answers waiting their turn: the show record has one cmdAck slot, so
    /// two answers go out in two writes, oldest first, none replaced.
    private var ackQueue: [[String: Any]] = []
    private static let ackKey = ["outrangutan", "cmdAck"]
    private var writing = false
    private var writeTroubleShown = false
    /// When the cloud wrote the last copy the live line delivered (seconds).
    /// 0 until the line has delivered one.
    private var streamDeliveredAt: Double = 0
    /// The forced "what is on air" write waiting its turn, while one is.
    private var liveTimer: Timer?
    /// When the live line was last opened again because a read beat it.
    private var streamReopenedAt: Double = 0

    init(engine: Engine, store: ShowRecordStore? = nil) {
        self.engine = engine
        self.store = store ?? cloud
        inbox = CommandInbox(sender: sender)
        engine.onTransport = { [weak self] in self?.publishLive(force: true) }
        engine.onTick = { [weak self] in self?.publishLive(force: false) }
        engine.onClipStart = { [weak self] cue, seconds in self?.publishPlayingStart(cue, seconds: seconds) }
        engine.onCuesChanged = { [weak self] in self?.scheduleCues() }
        engine.pads.onFire = { [weak self] pad, seconds in self?.publishSfxFire(pad, seconds: seconds) }
    }

    static var now: Double { Date().timeIntervalSince1970 * 1000 }

    // MARK: Connecting

    /// Signs in the same way as the web front door, then joins the show.
    func connect(username: String, secret: String, instructor: Bool, code rawCode: String) async {
        let user = username.trimmingCharacters(in: .whitespaces).lowercased()
        let showCode = rawCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard showCode.range(of: "^[A-Z0-9_.-]{3,24}$", options: .regularExpression) != nil else {
            return trouble("A show code is 3 to 24 letters or numbers.")
        }
        phase = .connecting
        message = "Signing in"
        do {
            if !cloud.isSignedIn || !secret.isEmpty {
                if instructor { try await cloud.signInInstructor(username: user, password: secret) }
                else { try await cloud.signInStudent(username: user, pin: secret) }
            }
        } catch {
            return trouble(error.localizedDescription)
        }
        join(code: showCode)
    }

    /// Starts listening to a show. Test mode calls this directly.
    func join(code showCode: String) {
        leave(keepSignIn: true)
        code = showCode
        phase = .connecting
        message = "Joining \(showCode)"
        inbox.reset()
        lastApplied = 0
        failingSince = 0
        streamAliveAt = 0
        streamDeliveredAt = 0
        streamNoted = false
        startPolling()
        startStream()
        startHeartbeat()
    }

    func leave(keepSignIn: Bool = false) {
        if !code.isEmpty { engine.log.add(.link, "Left \(code)") }
        pollTask?.cancel()
        pollTask = nil
        streamTask?.cancel()
        streamTask = nil
        streamAliveAt = 0
        heartbeat?.invalidate()
        heartbeat = nil
        flushTimer?.invalidate()
        flushTimer = nil
        liveTimer?.invalidate()
        liveTimer = nil
        writeBackoff = 0
        joined = false
        pending = [:]
        ackQueue = []
        code = ""
        phase = .off
        message = "Not connected to a show"
        if !keepSignIn { cloud.signOut() }
    }

    /// Reads the show on a timer: five times a second on its own, or every
    /// two seconds as the safety net while the live line is up.
    private func startPolling() {
        let showCode = code
        pollTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let doc = try await self.store.read(code: showCode)
                    guard !Task.isCancelled, self.code == showCode else { return }
                    failures = 0
                    self.failingSince = 0
                    self.onRecord(doc, fromLine: false)
                } catch {
                    guard !Task.isCancelled else { return }
                    failures += 1
                    let e = error as? CloudError
                    if e?.permission == true && !self.cloud.isSignedIn && self.store === self.cloud {
                        self.trouble(e?.message ?? "Sign in first.")
                        return
                    }
                    // One read failing is a blip: the Wi-Fi hiccups for a
                    // second in every show, and the show keeps playing. Reads
                    // failing for five seconds, or three in a row, is trouble.
                    let now = Self.now
                    if self.failingSince == 0 { self.failingSince = now }
                    if e?.permission == true || e?.notFound == true || failures >= 3 || now - self.failingSince >= 5000 {
                        self.trouble(e?.message ?? "Lost the show. Trying again.")
                    }
                }
                let wait: Double
                if failures > 0 { wait = min(5, Double(failures)) }
                else if self.streamIsAlive { wait = 2 }
                else { wait = 0.2 }
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
        }
    }

    /// True while the live line has spoken in the last 45 seconds.
    private var streamIsAlive: Bool { streamAliveAt > 0 && Self.now - streamAliveAt < 45_000 }

    /// Asks the cloud to send the show the moment it changes, so a fire from
    /// the rundown or a deck on another Mac lands here as fast as the cloud
    /// can carry it, instead of waiting for the next read. Reading carries
    /// on underneath as the safety net. When the cloud closes the line (it
    /// does now and then) it is opened again; when the cloud will not open
    /// one at all, the reads carry the show alone, as before.
    private func startStream() {
        let showCode = code
        streamTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    try await self.store.listen(code: showCode) { [weak self] message in
                        guard let self, self.code == showCode else { return }
                        self.onStreamMessage(message)
                    }
                    failures = 0
                } catch is CancellationError {
                    return
                } catch {
                    guard !Task.isCancelled, self.code == showCode else { return }
                    failures += 1
                    let e = error as? CloudError
                    if e?.refused == true {
                        if self.store === self.cloud {
                            self.engine.log.add(.link, "The cloud has no live line for \(showCode) (\(e?.message ?? "")). Reading it five times a second instead.")
                        }
                        self.streamAliveAt = 0
                        return
                    }
                    if failures == 1 {
                        self.engine.log.add(.link, self.streamNoted
                            ? "The live line dropped (\(e?.message ?? "lost")). Opening it again; reading five times a second meanwhile."
                            : "The live line did not open (\(e?.message ?? "lost")). Trying again; reading five times a second meanwhile.")
                    }
                }
                self.streamAliveAt = 0
                let wait = min(10, 0.5 * pow(2, Double(failures)))
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
        }
    }

    private func onStreamMessage(_ message: [String: Any]) {
        streamAliveAt = Self.now
        if ListenRequest.isCurrent(message) {
            if !streamNoted { engine.log.add(.link, "Live line open: the cloud sends \(code) the moment it changes") }
            streamNoted = true
        }
        guard let doc = ListenRequest.document(in: message) else { return }
        var fields = FirestoreValue.decodeFields(doc.fields)
        if let when = doc.updateTime {
            fields[ShowRecordKeys.updateTime] = when
            if let seconds = ListenRequest.seconds(when) { streamDeliveredAt = max(streamDeliveredAt, seconds) }
        }
        onRecord(fields, fromLine: true)
    }

    /// A read brought a change the live line never did. The line is dead
    /// without saying so (the Mac moved to another access point, say, and
    /// the old socket just sits there). Read five times a second again and
    /// open a new line now, instead of after the old one's long silence.
    private func reopenStream() {
        guard streamIsAlive, Self.now - streamReopenedAt > 5000 else { return }
        streamReopenedAt = Self.now
        streamAliveAt = 0
        engine.log.add(.link, "A read brought a change the live line missed. Opening the line again; reading five times a second meanwhile.")
        streamTask?.cancel()
        startStream()
    }

    private func startHeartbeat() {
        // An idle playout still says "I'm here" every 3 seconds, so the
        // rundown can tell healthy and idle from gone.
        let timer = Timer(timeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.publishLive(force: false) }
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeat = timer
    }

    private func trouble(_ text: String) {
        // Log a problem once, not on every retry.
        if phase != .trouble || message != text { engine.log.add(.problem, text) }
        phase = .trouble
        message = text
    }

    // MARK: The direct link

    /// A command straight from a browser on this Mac. Same run-once rules
    /// as the cloud, so its cloud copy never plays it twice.
    func runDirect(_ cmd: WireCommand) -> WireAck {
        inbox.direct(cmd, now: Self.now,
                     run: { [engine] in engine.runRemote($0) },
                     panic: { [engine] in
                         engine.run(from: cmd.by.isEmpty ? "Cueola" : "\(cmd.by), in Cueola") { engine.allStop() }
                     })
    }

    func directGain(id: String, value: Double) {
        inbox.directGain(id: id, value: value) { [engine] in engine.setGain($0) }
    }

    // MARK: Reading

    private func onRecord(_ doc: [String: Any], fromLine: Bool) {
        // Two copies can cross on the way here: a read that started before a
        // change, arriving after the live line already brought the change.
        // An older copy is dropped, or it would run the volume and the
        // command slot backwards for a moment.
        if let when = ListenRequest.seconds(doc[ShowRecordKeys.updateTime] as? String) {
            if when < lastApplied { return }
            lastApplied = when
            // A read newer than anything the line has delivered means the
            // line is no longer carrying changes.
            if !fromLine, streamDeliveredAt > 0, when > streamDeliveredAt { reopenStream() }
        }
        if !joined {
            joined = true
            writeTroubleShown = false
            publishCues()
            publishLive(force: true)
        }
        if phase != .linked {
            phase = .linked
            message = "Connected to \(code)"
            engine.log.add(.link, "Connected to \(code)")
        }
        if let fixes = doc["fixRequests"] as? [String: Any] { handleFixRequests(fixes) }
        let og = doc["outrangutan"] as? [String: Any] ?? [:]
        let acks = inbox.handle(og, now: Self.now,
                                run: { [engine] in engine.runRemote($0) },
                                panic: { [engine] in engine.allStop() },
                                gain: { [engine] in engine.setGain($0) })
        for ack in acks {
            queueWrite([Self.ackKey: ack.record(ts: Self.now, sender: sender)])
        }
    }

    // MARK: Publishing

    /// What is on air. At once on a change, at most every 2 seconds while
    /// playing, and every 3 seconds when idle. (The strip and the deck count
    /// down on their own from the clip's start time, so they need no more.
    /// Every 0.7 seconds, as before, was too many: the show record is one
    /// document the rundown, the deck and this Mac all write to, and the
    /// cloud starts refusing writes past about one a second. It did, in the
    /// show on Oct 16.)
    ///
    /// A change forces a write, but at most four a second: a spin of the
    /// volume dial or a held arrow key is dozens of changes in a second, and
    /// the cloud would start refusing. The last state always goes out, a
    /// moment later.
    func publishLive(force: Bool) {
        guard joined else { return }
        let now = Self.now
        if !force && now - lastLiveAt < 2000 { return }
        if force && now - lastLiveAt < 250 {
            if liveTimer == nil {
                let t = Timer(timeInterval: max(0.01, (250 - (now - lastLiveAt)) / 1000), repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.liveTimer = nil
                        self?.publishLive(force: true)
                    }
                }
                RunLoop.main.add(t, forMode: .common)
                liveTimer = t
            }
            return
        }
        liveTimer?.invalidate()
        liveTimer = nil
        lastLiveAt = now
        liveSeq += 1
        let packet = LivePacket.make(engine.liveState(), ts: now, seq: liveSeq, sender: sender, build: build)
        queueWrite([["outrangutan", "live"]: packet])
    }

    /// The cue list and the pads, without media, so the rundown can link
    /// them and the deck can fill its cue and pad keys.
    func publishCues() {
        guard joined else { return }
        var map: [String: Any] = [:]
        for (i, cue) in engine.cues.enumerated() {
            guard let id = cue.wireID else { continue }
            map[id] = [
                "num": i + 1,
                "name": cue.name,
                "type": cue.kind == .still ? "image" : cue.kind.rawValue,
                "dur": (engine.durations[cue.id] ?? 0).rounded(),
            ]
        }
        var padMap: [String: Any] = [:]
        let board = engine.pads
        for pad in board.pads where pad.fileIsThere {
            var entry: [String: Any] = [
                "name": pad.name.isEmpty ? "Pad" : pad.name,
                "bank": board.banks.first { $0.id == pad.bank }?.name ?? "",
                "emoji": pad.emoji,
            ]
            if let len = board.length(pad.id), len > 0 { entry["dur"] = len.rounded() }
            padMap[pad.id] = entry
        }
        queueWrite([
            ["outrangutan", "cues"]: map,
            ["outrangutan", "pads"]: padMap,
            ["outrangutan", "cuesTs"]: Self.now,
            ["outrangutan", "sender"]: sender,
        ])
    }

    private func scheduleCues() {
        cuesTimer?.invalidate()
        cuesTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.publishCues() }
        }
    }

    /// Each pad hit, so the rundown can show a short chip. At most one every
    /// quarter second, so mashing a pad cannot flood the show record.
    private func publishSfxFire(_ pad: Pad, seconds: Double?) {
        guard joined else { return }
        let now = Self.now
        guard now - lastSfxAt >= 250 else { return }
        lastSfxAt = now
        sfxSeq += 1
        var fire: [String: Any] = ["padId": pad.id, "name": pad.name.isEmpty ? "SFX" : pad.name, "emoji": pad.emoji,
                                   "startedAt": now, "ts": now, "seq": sfxSeq, "sender": sender]
        if let seconds { fire["durMs"] = (seconds * 1000).rounded() } else { fire["loop"] = true }
        queueWrite([["outrangutan", "sfxFire"]: fire])
    }

    /// One write per clip start. Every screen counts down from this on its own.
    private func publishPlayingStart(_ cue: Cue, seconds: Double) {
        guard joined, let id = cue.wireID else { return }
        let live = engine.liveState()
        // The player's clock counts from the start of the file; the clip
        // starts at its trim-in point, so the time played is measured from there.
        let elapsed = live.cueId == id ? max(0, (live.offset ?? 0) - cue.trimIn) * 1000 : 0
        startSeq += 1
        let now = Self.now
        queueWrite([["outrangutan", "playingStart"]: [
            "cueId": id, "name": cue.name, "startedAt": (now - elapsed).rounded(),
            "durMs": (seconds * 1000).rounded(), "loop": false,
            "sender": sender, "seq": startSeq, "ts": now,
        ] as [String: Any]])
    }

    /// Writes go out one at a time, in order, and a few hundredths of a
    /// second late on purpose: everything one GO produces (the "got it",
    /// what is on air, the clip's start time) piles up and goes out as ONE
    /// write. Anything that piles up while a write is on its way goes out
    /// together in the next one, newest value winning, so a slow network
    /// never builds a backlog.
    private func queueWrite(_ updates: [[String]: Any]) {
        guard !code.isEmpty else { return }
        for (k, v) in updates {
            // Two answers to two commands must both go out: the second waits
            // in line for a later write instead of replacing the first.
            if k == Self.ackKey, let new = v as? [String: Any] {
                if let old = pending[k] as? [String: Any] {
                    // The same command answered again (the rundown sent it
                    // twice): the newer answer replaces the one waiting.
                    if Wire.string(old["commandId"]) == Wire.string(new["commandId"]) { pending[k] = v; continue }
                    flushWrites()
                }
                if pending[k] != nil || !ackQueue.isEmpty {
                    ackQueue.append(new)
                    if ackQueue.count > 32 { ackQueue.removeFirst() }
                    continue
                }
            }
            pending[k] = v
        }
        scheduleFlush(after: 0.04)
    }

    private func scheduleFlush(after seconds: Double) {
        guard flushTimer == nil else { return }
        let t = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.flushTimer = nil
                self?.flushWrites()
            }
        }
        RunLoop.main.add(t, forMode: .common)
        flushTimer = t
    }

    private func flushWrites() {
        guard !writing, !pending.isEmpty, !code.isEmpty else { return }
        let batch = pending
        let showCode = code
        pending = [:]
        // The next answer in line rides the write after this one.
        if !ackQueue.isEmpty { pending[Self.ackKey] = ackQueue.removeFirst() }
        writing = true
        Task { [weak self] in
            guard let self else { return }
            var failed = false
            do {
                try await self.store.write(code: showCode, batch)
                self.writeBackoff = 0
            } catch {
                failed = true
                let e = error as? CloudError
                if e?.busy == true {
                    // The cloud asked everyone to slow down. Wait a little
                    // longer each time it says so.
                    self.writeBackoff = min(8, max(1, self.writeBackoff * 2))
                    if Self.now - self.busyNotedAt > 120_000 {
                        self.busyNotedAt = Self.now
                        self.engine.log.add(.problem, "The cloud is busy and refused a write. Sending less often for a moment.")
                    }
                } else if !self.writeTroubleShown, let e {
                    self.writeTroubleShown = true
                    self.trouble(e.permission
                        ? "The cloud refused this Mac's answers. Sign in again, then reconnect."
                        : e.message)
                }
                // Whatever the reason (busy, a Wi-Fi blip, a timeout), nothing
                // is thrown away: the batch goes out with the next write. A
                // value with a newer copy already waiting is the one thing
                // dropped. The clip's start time is written once per clip, so
                // losing it would stop every countdown on the other Mac.
                self.keep(batch)
            }
            self.writing = false
            if !self.pending.isEmpty { self.scheduleFlush(after: failed ? max(1, self.writeBackoff) : 0.04) }
        }
    }

    /// Puts a write that did not land back under whatever arrived since.
    private func keep(_ batch: [[String]: Any]) {
        for (k, v) in batch {
            if k == Self.ackKey, let waiting = pending[k] as? [String: Any], let mine = v as? [String: Any],
               Wire.string(waiting["commandId"]) != Wire.string(mine["commandId"]) {
                // The answer that did not land goes first; the one already
                // waiting steps back in line.
                ackQueue.insert(waiting, at: 0)
                pending[k] = v
            } else if pending[k] == nil {
                pending[k] = v
            }
        }
    }

    // MARK: Fix requests from the rundown's Go Live checks

    private func handleFixRequests(_ map: [String: Any]) {
        for value in map.values {
            guard let r = value as? [String: Any],
                  Wire.string(r["target"]) == "playout", Wire.string(r["status"]) == "open",
                  let id = Wire.string(r["id"]), id.range(of: "^[A-Za-z0-9_]{1,120}$", options: .regularExpression) != nil,
                  !fixSeen.contains(id),
                  Self.now - (Wire.number(r["ts"]) ?? 0) < 10 * 60 * 1000 else { continue }
            let to = Wire.string(r["toEndpoint"]) ?? ""
            if !to.isEmpty && to != sender { continue }
            fixSeen.append(id)
            if fixSeen.count > 64 { fixSeen.removeFirst() }
            fixPatch(id, ["status": "ack", "ackTs": Self.now, "ackBy": sender])
            let (ok, result) = runFix(kind: Wire.string(r["kind"]) ?? "", id: id)
            fixPatch(id, ["status": ok ? "done" : "failed", "doneTs": Self.now, "result": result])
            publishLive(force: true)
        }
    }

    private func runFix(kind: String, id: String) -> (Bool, String) {
        switch kind {
        case "rejoin", "reload":
            inbox.reset()
            publishCues()
            return (true, "listening on \(code)")
        case "republish":
            publishCues()
            let n = engine.cues.count
            return (true, "republished \(n) cue\(n == 1 ? "" : "s")")
        case "preflight":
            let bad = engine.cues.enumerated().filter { !$0.element.fileIsThere }.prefix(50).map { i, c -> [String: Any] in
                ["id": c.wireID ?? "", "num": i + 1, "name": c.name, "issue": "file missing on this Mac"]
            }
            let board = engine.pads
            let badPads = board.pads.filter { !$0.fileIsThere }.prefix(50).map { p -> [String: Any] in
                ["id": p.id, "name": p.name, "bank": board.banks.first { $0.id == p.bank }?.name ?? "", "issue": "file missing on this Mac"]
            }
            queueWrite([["outrangutan", "preflight"]: [
                "ts": Self.now, "sender": sender, "fixId": id,
                "cues": engine.cues.count, "pads": board.pads.count, "bad": Array(bad), "badPads": Array(badPads),
            ] as [String: Any]])
            return (bad.isEmpty && badPads.isEmpty,
                    "\(bad.count) bad cue\(bad.count == 1 ? "" : "s"), \(badPads.count) bad pad\(badPads.count == 1 ? "" : "s")")
        case "openOutput":
            engine.openOutput()
            let open = engine.openOutputs.count, total = engine.outputs.count
            return (open > 0, open > 0 ? "\(open) of \(total) output\(total == 1 ? "" : "s") open" : "output did not open")
        case "arm", "armPlayback":
            return (true, "armed: the Mac app needs no click to play")
        case "syncMedia":
            return (true, "no kiosk helper needed: the Mac app plays its own files")
        default:
            return (false, "the Mac app does not know \(kind)")
        }
    }

    private func fixPatch(_ id: String, _ fields: [String: Any]) {
        var updates: [[String]: Any] = [:]
        for (k, v) in fields { updates[["fixRequests", id, k]] = v }
        queueWrite(updates)
    }
}
