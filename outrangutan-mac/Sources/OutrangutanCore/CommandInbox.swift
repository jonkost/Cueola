import Foundation

/// One command from the rundown or KeyWi Bird, as it sits in the show's
/// shared record (`outrangutan.command`, or one entry of
/// `outrangutan.commandQueue`).
public struct WireCommand: Equatable {
    public var commandId: String
    public var origId: String
    public var ts: Double          // sender's clock, milliseconds
    public var expiresAt: Double   // sender's clock, milliseconds, 0 = none
    public var sender: String
    public var by: String          // the person who sent it, when the sender says
    public var action: String      // go, stop, pause, panic, fadeStop, cue, pad, arm
    public var cueId: String
    public var padId: String
    public var armCueId: String
    public var pads: [String]

    public init(commandId: String, origId: String = "", ts: Double = 0, expiresAt: Double = 0,
                sender: String = "", by: String = "", action: String, cueId: String = "", padId: String = "",
                armCueId: String = "", pads: [String] = []) {
        self.commandId = commandId
        self.origId = origId.isEmpty ? commandId : origId
        self.ts = ts
        self.expiresAt = expiresAt
        self.sender = sender
        self.by = by
        self.action = action
        self.cueId = cueId
        self.padId = padId
        self.armCueId = armCueId
        self.pads = pads
    }

    /// Reads a command from the shared record. nil when it has no id.
    public init?(_ raw: Any?) {
        guard let d = raw as? [String: Any], let id = Wire.string(d["commandId"]), !id.isEmpty else { return nil }
        self.init(commandId: id,
                  origId: Wire.string(d["origId"]) ?? "",
                  ts: Wire.number(d["ts"]) ?? 0,
                  expiresAt: Wire.number(d["expiresAt"]) ?? 0,
                  sender: Wire.string(d["sender"]) ?? "",
                  by: Wire.string(d["by"]) ?? "",
                  action: Wire.string(d["action"]) ?? "",
                  cueId: Wire.string(d["cueId"]) ?? "",
                  padId: Wire.string(d["padId"]) ?? "",
                  armCueId: Wire.string(d["armCueId"]) ?? "",
                  pads: (d["pads"] as? [Any])?.compactMap(Wire.string) ?? [])
    }

    /// Commands that put something on air (or bring it back).
    var fires: Bool { ["go", "cue", "pad", "pause"].contains(action) }
    /// Commands that take things off air.
    var kills: Bool { ["panic", "stop", "fadeStop"].contains(action) }
}

/// What happened when the Mac ran a command. The sender shows the reason
/// when ok is false.
public struct WireResult: Equatable {
    public var ok: Bool
    public var reason: String
    public init(ok: Bool, reason: String = "") { self.ok = ok; self.reason = reason }
    public static let done = WireResult(ok: true)
    public static func refused(_ reason: String) -> WireResult { WireResult(ok: false, reason: reason) }
}

/// The "got it" reply for one command (`outrangutan.cmdAck`).
public struct WireAck: Equatable {
    public var commandId: String
    public var origId: String
    public var result: WireResult

    public init(commandId: String, origId: String, result: WireResult) {
        self.commandId = commandId; self.origId = origId; self.result = result
    }

    public func record(ts: Double, sender: String) -> [String: Any] {
        [
            "commandId": commandId,
            "origId": origId,
            "ts": ts,
            "sender": sender,
            "ok": result.ok,
            "reason": result.ok ? "" : String(result.reason.prefix(200)),
        ]
    }
}

/// The rules for reading commands out of the shared record. These copy the
/// web Outrangutan exactly (onSessionDoc, consumeCommandQueue and
/// runRemoteCommand in outrangutan.js), so the rundown and KeyWi Bird cannot
/// tell the two apart.
///
/// - The first look after joining is a baseline: whatever already sits there
///   is old and never runs. Queue entries within 10 seconds still run.
/// - Our own writes are skipped.
/// - Each command runs once. A retry of it (same origId, new commandId) is
///   answered again with the same result, never run twice.
/// - A queue entry more than 18 seconds past its expiry is dropped.
/// - A stop, fade or panic cancels older fires that arrive with it.
/// - Order: volume, then the panic lane, then the queue, then the single slot.
public final class CommandInbox {
    public let sender: String

    private var primed = false
    private var lastCmdId: String?
    private var lastGainId: String?
    private var lastPanicId: String?
    private var clockOffset: Double?
    // These memories last as long as the app runs, on purpose: rejoining a
    // show must never replay a fire that already ran here.
    private var origSeen: [String] = []
    private var origResult: [String: WireResult] = [:]
    private var idSeen: [String] = []

    public init(sender: String) { self.sender = sender }

    /// Call when leaving or rejoining a show. The next look is a baseline again.
    public func reset() {
        primed = false
        lastCmdId = nil
        lastGainId = nil
        lastPanicId = nil
    }

    /// Reads the `outrangutan` part of the shared record and runs whatever is
    /// new. Returns the replies to write back.
    ///
    /// - now: this Mac's clock in milliseconds.
    /// - run: runs one command on the engine and says how it went.
    public func handle(_ og: [String: Any], now: Double,
                       run: (WireCommand) -> WireResult,
                       panic: () -> Void,
                       gain: (Double) -> Void) -> [WireAck] {
        var acks: [WireAck] = []
        let g = og["gain"] as? [String: Any]
        let gainId = Wire.string(g?["id"])
        let pn = og["panic"] as? [String: Any]
        let panicId = Wire.string(pn?["id"])
        let cmd = WireCommand(og["command"])
        let queue: [WireCommand]? = (og["commandQueue"] as? [Any]).map { $0.compactMap { WireCommand($0) } }
        let panicTs = Wire.number(pn?["ts"]) ?? 0

        if !primed {
            primed = true
            if let gainId { lastGainId = gainId }
            if let panicId { lastPanicId = panicId }
            if let cmd { lastCmdId = cmd.commandId }
            if let queue {
                for q in queue where abs(senderNow(now) - q.ts) > 10_000 {
                    noteOrig(q.origId)
                    noteId(q.commandId)
                }
                consume(queue, now: now, panicTs: panicTs, run: run, acks: &acks)
            }
            return acks
        }

        // Master volume rides its own field.
        if let gainId, gainId != lastGainId, Wire.string(g?["sender"]) != sender {
            lastGainId = gainId
            if let v = Wire.number(g?["v"]), v.isFinite { gain(min(1.2, max(0, v))) }
        }

        // The panic lane runs before the queue: kill first, then the next move.
        if let panicId, panicId != lastPanicId, Wire.string(pn?["sender"]) != sender {
            lastPanicId = panicId
            let orig = Wire.string(pn?["origId"]).flatMap { $0.isEmpty ? nil : $0 } ?? panicId
            if !isOrigSeen(orig) {
                noteOrig(orig)
                panic()
            }
            acks.append(WireAck(commandId: panicId, origId: orig, result: .done))
        }

        if let queue {
            for q in queue where !isIdSeen(q.commandId) && q.sender != sender { learnClock(q, now: now) }
            consume(queue, now: now, panicTs: panicTs, run: run, acks: &acks)
            // When the queue carries the slot's command, the queue already ran it.
            guard let cmd, !queue.contains(where: { $0.commandId == cmd.commandId }) else { return acks }
        }

        guard let cmd, cmd.commandId != lastCmdId, cmd.sender != sender else { return acks }
        lastCmdId = cmd.commandId
        learnClock(cmd, now: now)
        acks.append(runOnce(cmd, run: run))
        return acks
    }

    /// A command that came straight from a browser on this Mac (the direct
    /// link), not through the shared record. It runs once by origId, so when
    /// its cloud copy arrives later it is answered again, never run twice.
    /// A panic also marks the panic lane's copy as done.
    public func direct(_ cmd: WireCommand, now: Double,
                       run: (WireCommand) -> WireResult,
                       panic: () -> Void) -> WireAck {
        // Same Mac, same clock: a command this late was given up on.
        if cmd.expiresAt > 0 && now - cmd.expiresAt > 2_000 {
            noteOrig(cmd.origId)
            let result = WireResult.refused("arrived too late")
            storeResult(cmd.origId, result)
            return WireAck(commandId: cmd.commandId, origId: cmd.origId, result: result)
        }
        if cmd.action == "panic" {
            if !isOrigSeen(cmd.origId) {
                noteOrig(cmd.origId)
                panic()
                storeResult(cmd.origId, .done)
            }
            return WireAck(commandId: cmd.commandId, origId: cmd.origId, result: .done)
        }
        return runOnce(cmd, run: run)
    }

    /// A volume change from the direct link. Remembers its id, so the same
    /// change arriving through the cloud is not applied again.
    public func directGain(id: String, value: Double, gain: (Double) -> Void) {
        guard !id.isEmpty, id != lastGainId, value.isFinite else { return }
        lastGainId = id
        gain(min(1.2, max(0, value)))
    }

    // MARK: Inside

    private func consume(_ queue: [WireCommand], now: Double, panicTs: Double,
                         run: (WireCommand) -> WireResult, acks: inout [WireAck]) {
        let senderClock = senderNow(now)
        let killTs = queue.filter { !isIdSeen($0.commandId) && $0.kills }.map(\.ts).reduce(panicTs, max)
        for q in queue {
            guard !isIdSeen(q.commandId) else { continue }
            noteId(q.commandId)
            if q.sender == sender { continue }
            if q.expiresAt > 0 && senderClock - q.expiresAt > (clockOffset == nil ? 18_000 : 10_000) {
                // The sender gave up on this one. A late fire would be wrong.
                noteOrig(q.origId)
                continue
            }
            // Already ran (the direct link got it first): answer with what
            // happened, never "superseded".
            if isOrigSeen(q.origId) {
                acks.append(runOnce(q, run: run))
                continue
            }
            if q.fires && q.ts < killTs {
                noteOrig(q.origId)
                let result = WireResult.refused("superseded by stop")
                storeResult(q.origId, result)
                acks.append(WireAck(commandId: q.commandId, origId: q.origId, result: result))
                continue
            }
            acks.append(runOnce(q, run: run))
        }
    }

    private func runOnce(_ cmd: WireCommand, run: (WireCommand) -> WireResult) -> WireAck {
        if isOrigSeen(cmd.origId) {
            return WireAck(commandId: cmd.commandId, origId: cmd.origId, result: origResult[cmd.origId] ?? .done)
        }
        noteOrig(cmd.origId)
        let result = run(cmd)
        storeResult(cmd.origId, result)
        return WireAck(commandId: cmd.commandId, origId: cmd.origId, result: result)
    }

    /// Every command that arrives live teaches us how far the sender's clock
    /// is from ours, so two Macs with drifted clocks still agree on "too old".
    private func learnClock(_ cmd: WireCommand, now: Double) {
        guard cmd.ts > 0 else { return }
        let off = now - cmd.ts
        guard off.isFinite, abs(off) <= 6 * 3600 * 1000 else { return }
        clockOffset = clockOffset.map { ($0 * 0.7 + off * 0.3).rounded() } ?? off
    }

    private func senderNow(_ now: Double) -> Double { now - (clockOffset ?? 0) }

    private func isOrigSeen(_ id: String) -> Bool { !id.isEmpty && origSeen.contains(id) }
    private func noteOrig(_ id: String) {
        guard !id.isEmpty, !isOrigSeen(id) else { return }
        origSeen.append(id)
        if origSeen.count > 64 { origResult.removeValue(forKey: origSeen.removeFirst()) }
    }
    private func storeResult(_ id: String, _ result: WireResult) {
        origResult[id] = result
    }
    private func isIdSeen(_ id: String) -> Bool { !id.isEmpty && idSeen.contains(id) }
    private func noteId(_ id: String) {
        guard !id.isEmpty, !isIdSeen(id) else { return }
        idSeen.append(id)
        if idSeen.count > 64 { idSeen.removeFirst() }
    }
}

/// Small helpers for reading values out of the shared record.
public enum Wire {
    public static func string(_ v: Any?) -> String? {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    public static func number(_ v: Any?) -> Double? {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let s = v as? String { return Double(s) }
        return nil
    }
}
