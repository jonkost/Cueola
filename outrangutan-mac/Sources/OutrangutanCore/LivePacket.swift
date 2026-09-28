import Foundation

/// What Outrangutan is doing right now, in the words the rundown and KeyWi
/// Bird read from `outrangutan.live`. Built exactly like publishLive in the
/// web outrangutan.js, so the playback strip, the key lights, the rundown
/// cell and the Go Live checks all read the Mac the same way.
public struct LiveState: Equatable {
    public enum Status: String { case idle, pre, play, pause }

    public var status: Status = .idle
    public var cueId = ""
    public var name = ""
    public var type = ""                 // video, audio or image
    public var duration: Double = 0      // seconds
    public var remaining: Double?        // seconds, nil for a held still
    public var offset: Double?           // seconds into a video or sound
    /// Every output, for the rundown's Go Live checks.
    public var outputList: [OutputLive] = []
    public var outputsOpen = 0
    public var outputsReady = 0
    public var outputsTotal = 1
    public var gain: Double = 1
    public var firstCueId = ""
    public var firstCueName = ""

    public init() {}
}

/// One output as the rundown sees it.
public struct OutputLive: Equatable {
    public var id: Int
    public var label: String
    public var open: Bool
    public init(id: Int, label: String, open: Bool) { self.id = id; self.label = label; self.open = open }
}

public enum LivePacket {
    /// Protocol 4: answers every command in `outrangutan.cmdAck`, reads the
    /// panic lane and the command queue. Senders only retry against 2 or more.
    public static let proto = 4

    public static func make(_ s: LiveState, ts: Double, seq: Int, sender: String, build: String) -> [String: Any] {
        var live: [String: Any] = ["status": s.status.rawValue, "ts": ts, "sender": sender]
        if s.status != .idle && !s.cueId.isEmpty {
            live["cueId"] = s.cueId
            live["name"] = s.name
            live["type"] = s.type
            if s.status != .pre {
                live["dur"] = s.duration.rounded()
                live["thumb"] = ""
                if s.type == "image" {
                    // A held still has no clock: remaining is null and hold is
                    // true, so the strip and the deck print HOLD, not 0:00.
                    live["remaining"] = s.remaining.map { $0.rounded() as Any } ?? NSNull()
                    live["hold"] = s.remaining == nil
                } else {
                    live["remaining"] = (s.remaining ?? 0).rounded()
                    live["offset"] = ((s.offset ?? 0) * 10).rounded() / 10
                }
            }
        }
        live["outputs"] = outputs(s, now: ts)
        live["gain"] = (s.gain * 100).rounded() / 100
        live["armed"] = armed(s)
        live["seq"] = seq
        live["proto"] = proto
        live["build"] = build
        return live
    }

    /// Same shape as outputStatus() in the web app. The Mac has one native
    /// output, so there is no kiosk helper and no separate window program.
    public static func outputs(_ s: LiveState, now: Double) -> [String: Any] {
        let list = s.outputList.isEmpty ? [OutputLive(id: 1, label: "Output 1", open: s.outputsOpen > 0)] : s.outputList
        let items = list.map { item(s, $0, now: now) }
        let open = list.filter(\.open).count
        let closed = list.filter { !$0.open }
        let status = open == 0 ? "closed" : (closed.isEmpty ? "ready" : "degraded")
        let detail: String
        switch status {
        case "ready": detail = "\(open) of \(list.count) outputs ready"
        case "degraded": detail = "\(open) of \(list.count) outputs ready · " + closed.map { $0.label + " closed" }.joined(separator: ", ")
        default: detail = "No output window open"
        }
        return [
            "status": status,
            "detail": detail,
            "open": open,
            "ready": open,
            "total": list.count,
            "items": items,
            "kioskMediaMissing": 0,
            "helper": ["wanted": false, "connected": false, "version": "", "chromeFound": false],
        ]
    }

    private static func item(_ s: LiveState, _ o: OutputLive, now: Double) -> [String: Any] {
        let open = o.open
        return [
            "id": String(o.id),
            "label": o.label,
            "status": open ? "ready" : "closed",
            "detail": open ? "Output on screen" : "Output window closed",
            "outputInstanceId": "",
            "communicationStatus": open ? "connected" : "disconnected",
            "mediaLoadStatus": s.status == .idle ? "empty" : "ready",
            "playbackStatus": s.status == .play ? "playing" : (s.status == .pause ? "paused" : "stopped"),
            "rendererStatus": "idle",
            "heartbeatStatus": open ? "ok" : "unknown",
            "lastHeartbeatAt": open ? now : 0,
            "lastAck": NSNull(),
            "recoverability": "none",
            "pendingAcks": 0,
            "error": "",
            "mode": "native",
            "mediaMissing": 0,
            "foreignWindow": false,
        ]
    }

    /// Same shape as playoutArmed() in the web app. A Mac app needs no click
    /// to wake its sound, so sound always reads "running".
    public static func armed(_ s: LiveState) -> [String: Any] {
        [
        "audio": "running",
        "firstCueId": s.firstCueId,
        "firstCueName": s.firstCueName,
        "firstCueStaged": true,
        "outputsOpen": s.outputsOpen,
        "outputsReady": s.outputsReady,
        "outputsTotal": s.outputsTotal,
        "armed": s.outputsOpen == 0 || s.outputsReady > 0,
        ]
    }
}
