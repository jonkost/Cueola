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
    public var outputsOpen = 0
    public var outputsReady = 0
    public var outputsTotal = 1
    public var gain: Double = 1
    public var firstCueId = ""
    public var firstCueName = ""

    public init() {}
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
        let open = s.outputsOpen > 0
        let item: [String: Any] = [
            "id": "1",
            "label": "Output 1",
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
        return [
            "status": open ? "ready" : "closed",
            "detail": open ? "1 of 1 outputs ready" : "No output window open",
            "open": s.outputsOpen,
            "ready": s.outputsReady,
            "total": s.outputsTotal,
            "items": [item],
            "kioskMediaMissing": 0,
            "helper": ["wanted": false, "connected": false, "version": "", "chromeFound": false],
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
