import OutrangutanCore
import AppKit
import AVFoundation

/// Test mode, for checking the app without anyone at the keyboard.
///
/// Start the app with OUTRANGUTAN_SNAPSHOT set to a folder. It saves
/// pictures of its windows there, presses buttons by itself, writes what
/// happened to test-log.txt, and quits. It never runs in a normal launch.
///
/// OUTRANGUTAN_SCENARIO picks the test:
/// - "transport" (the default): GO, Pause, All Stop from this Mac.
/// - "link": a pretend show record in memory plays the rundown's part,
///   sending the same commands the rundown and KeyWi Bird send.
enum TestSnapshot {
    static var isOn: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }
    static var scenario: String { ProcessInfo.processInfo.environment["OUTRANGUTAN_SCENARIO"] ?? "transport" }

    /// The pretend show record, only in the link test.
    @MainActor static let fake: FakeRecordStore? = isOn && scenario == "link" ? FakeRecordStore() : nil
    @MainActor static var store: ShowRecordStore? { fake }

    @MainActor
    static func runIfAsked(engine: Engine, link: ShowLink) {
        guard let folder = ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] else { return }
        let dir = URL(fileURLWithPath: folder, isDirectory: true)
        var log: [String] = []
        func note(_ line: String) { log.append(line) }

        func snap(_ name: String) {
            for window in NSApp.windows where window.isVisible {
                guard let view = window.contentView,
                      let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
                view.cacheDisplay(in: view.bounds, to: rep)
                let which = window.title == "Outrangutan Output" || !window.styleMask.contains(.titled) ? "output" : "control"
                try? rep.representation(using: .png, properties: [:])?
                    .write(to: dir.appendingPathComponent("\(name)-\(which).png"))
            }
        }

        func state(_ label: String) {
            note("\(label): status=\(engine.status.rawValue) picture=\(engine.pictureCue?.name ?? "-") sound=\(engine.soundCue?.name ?? "-") standby=\(engine.standbyCue?.name ?? "-") clock=\(engine.remaining.map(Timecode.dropFrame) ?? "none") gain=\(engine.masterGain) notice=\(engine.notice ?? "-")")
        }

        let steps: Steps
        switch scenario {
        case "link": steps = linkSteps(engine: engine, link: link, note: note, state: state, snap: snap)
        case "timing": steps = timingSteps(engine: engine, note: note, state: state, snap: snap)
        case "connect": steps = [
            (1.5, { NotificationCenter.default.post(name: .showConnect, object: nil) }),
            (1.0, {
                // The sheet is its own window: save each window by number.
                for (i, window) in NSApp.windows.enumerated() where window.isVisible {
                    guard let view = window.contentView?.superview ?? window.contentView,
                          let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
                    view.cacheDisplay(in: view.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("connect-window-\(i).png"))
                }
            }),
        ]
        default: steps = transportSteps(engine: engine, state: state, snap: snap)
        }

        // Each step starts only after the one before it has finished, so a
        // slow first launch can never run the steps out of order.
        func run(_ index: Int) {
            guard index < steps.count else {
                try? log.joined(separator: "\n").write(to: dir.appendingPathComponent("test-log.txt"), atomically: true, encoding: .utf8)
                // An open sheet would hold up quitting.
                for window in NSApp.windows { window.sheets.forEach { window.endSheet($0) } }
                DispatchQueue.main.async { NSApp.terminate(nil) }
                return
            }
            let (wait, step) = steps[index]
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                step()
                run(index + 1)
            }
        }
        run(0)
    }

    typealias Steps = [(Double, () -> Void)]

    private static func transportSteps(engine: Engine, state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        [
            (1.5, { state("start"); snap("1-start") }),
            (0.2, { engine.toggleOutput(); engine.go() }),
            (1.5, { state("after GO 1"); snap("2-video") }),
            (0.2, { engine.togglePause() }),
            (0.8, { state("after pause") }),
            (0.2, { engine.togglePause(); engine.go() }),
            (0.8, { state("after GO 2"); snap("3-still") }),
            (0.2, { engine.go() }),
            (0.8, { state("after GO 3"); snap("4-sound") }),
            (0.2, { engine.allStop() }),
            (0.5, { state("after All Stop"); snap("5-allstop") }),
        ]
    }

    /// Step 2 rules: pre-wait, a still timer that follows into a dissolve, a
    /// trimmed video that holds its last frame, Continue, a matte, a trimmed
    /// loop, Pause and Fade. Uses a pretend cue list; the real show is untouched.
    private static func timingSteps(engine: Engine, note: @escaping (String) -> Void,
                                    state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func file(_ name: String, _ kind: CueKind, _ label: String) -> Cue {
            Cue(name: label, path: media.appendingPathComponent(name).path, kind: kind, wireID: Cue.newWireID())
        }
        var still = file("still-16x9.png", .still, "1 Still, pre-wait 1, up 1.5, Follow")
        still.preWait = 1; still.duration = 1.5; still.continueMode = .autoFollow
        var video = file("bars-16x9.mp4", .video, "2 Bars, last 5 s, dissolve 1, hold")
        video.trimIn = 95; video.xfade = 1; video.endAction = .hold
        var sound = file("demo-applause.wav", .audio, "3 Applause, fade in, Continue")
        sound.fadeIn = 0.5; sound.continueMode = .autoContinue
        var matte = Cue.matte(named: "4 Red matte, dissolve 0.5", color: "#C8102E")
        matte.xfade = 0.5
        var loop = file("bars-4x3.mp4", .video, "5 Bars 4x3, 10 to 13 s, loop")
        loop.trimIn = 10; loop.trimOut = 13; loop.loop = true
        return [
            (1.0, {
                engine.cues = [still, video, sound, matte, loop]
                engine.standbyID = engine.cues[0].id
                engine.openOutput()
            }),
            (0.5, { engine.go() }),
            (0.4, { state("a GO on the still: waiting out its pre-wait"); note("   pre-wait left: \(engine.preRemaining.map { String(format: "%.1f", $0) } ?? "-")") }),
            (1.0, { state("b the still is up, its timer counting"); snap("t-b-still") }),
            (1.6, { state("c the timer ended, Follow started the video under a dissolve") }),
            (0.4, { snap("t-c-dissolve") }),
            (5.5, { state("d the trimmed video ended and holds its last frame") }),
            (0.1, { engine.go() }),
            (0.8, { state("e GO: applause fades in, Continue brought up the matte"); snap("t-e-matte") }),
            (0.2, { engine.standbyID = engine.cues[4].id; engine.go() }),
            (4.2, { state("f the 3 second loop has gone round (clock stays under 3 s)") }),
            (0.1, { engine.togglePause() }),
            (0.6, { state("g paused") }),
            (0.1, { engine.togglePause() }),
            (0.4, { state("h carrying on") }),
            (0.1, { engine.fadeStopAll() }),
            (0.5, { state("i half way through Fade") }),
            (0.9, { state("j after Fade"); snap("t-j-end") }),
        ]
    }

    /// Plays the rundown's part against a pretend show record, with commands
    /// shaped exactly like fireOutrangutanCommand in cueola-app.js.
    @MainActor
    private static func linkSteps(engine: Engine, link: ShowLink, note: @escaping (String) -> Void,
                                  state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        guard let fake else { return [] }
        var n = 0
        var queue: [[String: Any]] = []
        func command(_ action: String, cueId: String = "", padId: String = "", orig: String? = nil,
                     ts: Double? = nil, armCueId: String? = nil) -> [String: Any] {
            n += 1
            let t = ts ?? ShowLink.now
            var c: [String: Any] = ["commandId": "out_TEST_\(n)", "origId": orig ?? "out_TEST_\(n)", "ts": t,
                                    "expiresAt": t + 8000, "by": "Test Director", "sender": "flowmingo_test",
                                    "action": action, "cueId": cueId, "padId": padId]
            if let armCueId { c["armCueId"] = armCueId }
            return c
        }
        func send(_ cmds: [[String: Any]]) {
            queue.append(contentsOf: cmds)
            queue = Array(queue.suffix(8))
            fake.set(["outrangutan", "commandQueue"], queue)
            if let last = cmds.last { fake.set(["outrangutan", "command"], last) }
        }
        func og() -> [String: Any] { fake.doc["outrangutan"] as? [String: Any] ?? [:] }
        func report(_ label: String) {
            state(label)
            if let live = og()["live"] as? [String: Any] {
                let rem = live["remaining"].map { $0 is NSNull ? "null" : "\($0)" } ?? "-"
                note("   live: status=\(live["status"] ?? "-") name=\(live["name"] ?? "-") type=\(live["type"] ?? "-") remaining=\(rem) hold=\(live["hold"] ?? "-") gain=\(live["gain"] ?? "-") proto=\(live["proto"] ?? "-") seq=\(live["seq"] ?? "-")")
            }
            if let ack = og()["cmdAck"] as? [String: Any] {
                note("   ack: \(ack["commandId"] ?? "-") ok=\(ack["ok"] ?? "-") reason=\(ack["reason"] ?? "")")
            }
        }
        func wire(_ i: Int) -> String { engine.cues.indices.contains(i) ? (engine.cues[i].wireID ?? "") : "" }

        return [
            (1.0, {
                // Something already sits in the slot from before we joined.
                fake.set(["outrangutan", "command"], command("go"))
                engine.openOutput()
                link.join(code: "TEST1")
            }),
            (1.2, {
                report("1 joined (the old GO must not run)")
                let cues = og()["cues"] as? [String: Any] ?? [:]
                note("   published cues: \(cues.count), pads: \((og()["pads"] as? [String: Any])?.count ?? -1)")
            }),
            (0.1, { send([command("cue", cueId: wire(1), armCueId: wire(0))]) }),
            (0.9, { report("2 TAKE fired the still, stood by cue 1"); snap("link-2-still") }),
            (0.1, { send([command("cue", cueId: wire(0), orig: "orig_video")]) }),
            (1.2, {
                report("3 TAKE fired the video")
                let ps = og()["playingStart"] as? [String: Any]
                note("   playingStart: \(ps?["name"] ?? "-") durMs=\(ps?["durMs"] ?? "-")")
                snap("link-3-video")
            }),
            (0.1, { fake.set(["outrangutan", "gain"], ["v": 0.5, "id": "gain_1", "ts": ShowLink.now, "sender": "flowmingo_test"]) }),
            (0.8, { report("4 deck dial set volume to 0.5") }),
            (0.1, { send([command("pause")]) }),
            (0.9, { report("5 deck Pause") }),
            (0.1, { send([command("pause")]) }),
            (0.9, { report("6 deck Pause again (resume)") }),
            (0.1, { send([command("cue", cueId: wire(0), orig: "orig_video")]) }),
            (0.9, { report("7 a retry of the video fire (must not restart it)") }),
            (0.1, {
                let now = ShowLink.now
                send([command("go", ts: now - 300), command("fadeStop", ts: now)])
            }),
            (1.6, { report("8 a GO and a Fade arrive together (the GO is cancelled)") }),
            (0.1, { send([command("cue", cueId: wire(0))]) }),
            (0.9, { report("9 video again") }),
            (0.1, { fake.set(["outrangutan", "panic"], ["id": "panic_1", "origId": "panic_1", "ts": ShowLink.now, "by": "Test Director", "sender": "flowmingo_test"]) }),
            (0.9, { report("10 PANIC lane") }),
            (0.1, { send([command("pad", padId: "p1")]) }),
            (0.9, { report("11 an SFX pad (not in the Mac app yet)") }),
            (0.1, {
                fake.set(["fixRequests", "fix_1"], ["id": "fix_1", "target": "playout", "kind": "preflight", "detail": "",
                                                     "ts": ShowLink.now, "by": "Test Director", "byClient": "test", "status": "open"])
            }),
            (1.0, {
                let fix = (fake.doc["fixRequests"] as? [String: Any])?["fix_1"] as? [String: Any]
                note("12 Go Live check asked for a media check: status=\(fix?["status"] ?? "-") result=\(fix?["result"] ?? "-")")
                let pf = og()["preflight"] as? [String: Any]
                note("   preflight: cues=\(pf?["cues"] ?? "-") bad=\((pf?["bad"] as? [Any])?.count ?? -1)")
                note("   writes so far: \(fake.writeCount), reads so far: \(fake.readCount)")
                snap("link-12-end")
            }),
        ]
    }
}

/// A pretend show record that lives in memory, for the link test.
@MainActor
final class FakeRecordStore: ShowRecordStore {
    private(set) var doc: [String: Any] = [:]
    private(set) var readCount = 0
    private(set) var writeCount = 0

    func read(code: String) async throws -> [String: Any] {
        readCount += 1
        return doc
    }

    func write(code: String, _ updates: [[String]: Any]) async throws {
        writeCount += 1
        // Go through the written form and back, like the real cloud.
        for (path, value) in updates { set(path, FirestoreValue.decode(FirestoreValue.encode(value))) }
    }

    func set(_ path: [String], _ value: Any) {
        Self.insert(&doc, path[...], value)
    }

    private static func insert(_ tree: inout [String: Any], _ path: ArraySlice<String>, _ value: Any) {
        guard let head = path.first else { return }
        if path.count == 1 { tree[head] = value; return }
        var child = (tree[head] as? [String: Any]) ?? [:]
        insert(&child, path.dropFirst(), value)
        tree[head] = child
    }
}
