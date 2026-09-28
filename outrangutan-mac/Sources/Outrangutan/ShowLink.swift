import Foundation
import OutrangutanCore

/// The link to a Cueola show: how the director's TAKE and KeyWi Bird keys
/// reach this Mac, and how the rundown and the deck learn what is on air.
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

    /// This app's name on the wire. The rundown uses it to tell playout
    /// Macs apart and to skip its own writes.
    let sender = "outrangutan_mac_" + String((0..<7).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
    let build = "mac-" + ((Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev")

    let cloud = CloudClient()
    private let engine: Engine
    private let store: ShowRecordStore
    private let inbox: CommandInbox
    private var joined = false
    private var pollTask: Task<Void, Never>?
    private var heartbeat: Timer?
    private var cuesTimer: Timer?
    private var liveSeq = 0
    private var lastLiveAt: Double = 0
    private var startSeq = 0
    private var sfxSeq = 0
    private var lastSfxAt: Double = 0
    private var fixSeen: [String] = []
    private var pending: [[String]: Any] = [:]
    private var writing = false
    private var writeTroubleShown = false

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
        startPolling()
        startHeartbeat()
    }

    func leave(keepSignIn: Bool = false) {
        pollTask?.cancel()
        pollTask = nil
        heartbeat?.invalidate()
        heartbeat = nil
        joined = false
        pending = [:]
        code = ""
        phase = .off
        message = "Not connected to a show"
        if !keepSignIn { cloud.signOut() }
    }

    /// Reads the show about four times a second. The web app gets a push
    /// instead; reading this often keeps a fire from the rundown within about
    /// a quarter second.
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
                    self.onRecord(doc)
                } catch {
                    guard !Task.isCancelled else { return }
                    failures += 1
                    let e = error as? CloudError
                    self.trouble(e?.message ?? "Lost the show. Trying again.")
                    if e?.permission == true && !self.cloud.isSignedIn && self.store === self.cloud { return }
                }
                let wait: Double = failures == 0 ? 0.2 : min(5, Double(failures))
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
        }
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
        phase = .trouble
        message = text
    }

    // MARK: Reading

    private func onRecord(_ doc: [String: Any]) {
        if !joined {
            joined = true
            writeTroubleShown = false
            publishCues()
            publishLive(force: true)
        }
        if phase != .linked {
            phase = .linked
            message = "Connected to \(code)"
        }
        if let fixes = doc["fixRequests"] as? [String: Any] { handleFixRequests(fixes) }
        let og = doc["outrangutan"] as? [String: Any] ?? [:]
        let acks = inbox.handle(og, now: Self.now,
                                run: { [engine] in engine.runRemote($0) },
                                panic: { [engine] in engine.allStop() },
                                gain: { [engine] in engine.setGain($0) })
        for ack in acks {
            queueWrite([["outrangutan", "cmdAck"]: ack.record(ts: Self.now, sender: sender)])
        }
    }

    // MARK: Publishing

    /// What is on air. At most every 0.7 seconds while playing, at once on a
    /// change, and every 3 seconds when idle.
    func publishLive(force: Bool) {
        guard joined else { return }
        let now = Self.now
        if !force && now - lastLiveAt < 700 { return }
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
        let elapsed = live.cueId == id ? (live.offset ?? 0) * 1000 : 0
        startSeq += 1
        let now = Self.now
        queueWrite([["outrangutan", "playingStart"]: [
            "cueId": id, "name": cue.name, "startedAt": (now - elapsed).rounded(),
            "durMs": (seconds * 1000).rounded(), "loop": false,
            "sender": sender, "seq": startSeq, "ts": now,
        ] as [String: Any]])
    }

    /// Writes go out one at a time, in order. Anything that piles up while a
    /// write is on its way goes out together in the next one, newest value
    /// winning, so a slow network never builds a backlog.
    private func queueWrite(_ updates: [[String]: Any]) {
        guard !code.isEmpty else { return }
        for (k, v) in updates { pending[k] = v }
        flushWrites()
    }

    private func flushWrites() {
        guard !writing, !pending.isEmpty, !code.isEmpty else { return }
        let batch = pending
        let showCode = code
        pending = [:]
        writing = true
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.store.write(code: showCode, batch)
            } catch {
                if !self.writeTroubleShown, let e = error as? CloudError {
                    self.writeTroubleShown = true
                    self.trouble(e.permission
                        ? "The cloud refused this Mac's answers. Sign in again, then reconnect."
                        : e.message)
                }
            }
            self.writing = false
            self.flushWrites()
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
            return (engine.output.isOpen, engine.output.isOpen ? "output open" : "output did not open")
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
