import OutrangutanCore
import AppKit
import AVFoundation
import SwiftUI

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
    @MainActor static let fake: FakeRecordStore? = isOn && (scenario == "link" || scenario == "pads") ? FakeRecordStore() : nil
    @MainActor static var store: ShowRecordStore? { fake }

    @MainActor
    static func runIfAsked(engine: Engine, link: ShowLink) {
        guard let folder = ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] else { return }
        let dir = URL(fileURLWithPath: folder, isDirectory: true)
        var log: [String] = []
        func note(_ line: String) { log.append(line) }

        func snap(_ name: String) {
            for window in NSApp.windows where window.isVisible {
                // The frame view includes the title bar and toolbar.
                guard let view = window.contentView?.superview ?? window.contentView,
                      let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
                view.cacheDisplay(in: view.bounds, to: rep)
                let which: String
                if window.title == "Outrangutan" { which = "control" }
                else if window.contentView is OutputView { which = "output-" + window.title.replacingOccurrences(of: " ", with: "") }
                else { which = "window-" + window.title.replacingOccurrences(of: " ", with: "") }
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
        case "pads": steps = padSteps(engine: engine, link: link, dir: dir, note: note, state: state)
        case "outputs": steps = outputSteps(engine: engine, note: note, state: state, snap: snap)
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
                // Test mode never saves anything, so it can simply end here.
                // (A normal quit waits on any open sheet.)
                exit(0)
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

    /// Outputs: two outputs, a cue on each, a cue on every output, Identify,
    /// what the rundown hears about them, sound devices, and pad routing.
    private static func outputSteps(engine: Engine, note: @escaping (String) -> Void,
                                    state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        var still = Cue(name: "Still on Program", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID())
        still.output = 1
        var matte = Cue.matte(named: "Blue on IMAG", color: "#0047BB")
        matte.output = 2
        var both = Cue.matte(named: "White on every output", color: "#FFFFFF")
        both.output = 0
        let defaults = UserDefaults.standard
        let savedTab = defaults.string(forKey: "ui.tab")
        return [
            (1.0, {
                engine.outputs = [OutputConfig(id: 1, label: "Program"), OutputConfig(id: 2, label: "IMAG")]
                engine.cues = [still, matte, both]
                engine.standbyID = engine.cues[0].id
                engine.openOutput()
                let devices = AudioDevices.outputs()
                note("sound devices: " + devices.map { "\($0.name) (\($0.channels) ch)" }.joined(separator: ", "))
                note("default output: \(AudioDevices.defaultOutput()?.name ?? "-")")
            }),
            (0.8, { engine.go() }),
            (0.5, { note("1 still on Program: " + engine.outputsShowing()) }),
            (0.1, { engine.go() }),
            (0.5, { note("2 matte on IMAG (the picture moves there): " + engine.outputsShowing()) }),
            (0.1, { engine.go() }),
            (0.5, {
                note("3 white on every output: " + engine.outputsShowing())
                let live = LivePacket.outputs(engine.liveState(), now: 1)
                note("   the rundown hears: status=\(live["status"] ?? "-") \(live["detail"] ?? "-")")
                snap("o-3-all")
            }),
            (0.1, { engine.closeOutput(2) }),
            (0.3, {
                let live = LivePacket.outputs(engine.liveState(), now: 1)
                note("4 IMAG closed, the rundown hears: status=\(live["status"] ?? "-") \(live["detail"] ?? "-")")
                engine.openOutput(2)
            }),
            (0.4, { engine.identifyOutputs() }),
            (0.4, { snap("o-5-identify") }),
            (0.1, {
                engine.audio.padFirstChannel = 0
                note("6 pads play to: \(engine.pads.channelMapNote)")
                if engine.pads.pads.isEmpty {
                    engine.pads.add(urls: [media.appendingPathComponent("demo-applause.wav")])
                }
            }),
            (0.4, { if let p = engine.pads.pads.first { engine.pads.fire(p.id) } }),
            (0.4, { note("7 pad meter while the applause plays: left \(String(format: "%.2f", engine.pads.meter.left)) right \(String(format: "%.2f", engine.pads.meter.right))") }),
            (0.1, { engine.pads.stopAll(); defaults.set("cues", forKey: "ui.tab") }),
            (0.8, { snap("o-8-cues") }),
            (0.1, { defaults.set("pads", forKey: "ui.tab") }),
            (0.8, { snap("o-9-pads") }),
            (0.1, {
                if let savedTab { defaults.set(savedTab, forKey: "ui.tab") } else { defaults.removeObject(forKey: "ui.tab") }
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }),
            (1.0, { snap("o-10-settings") }),
        ]
    }

    /// Pads: loading, the three hit-again modes, a hit from the rundown, a
    /// pad tied to a cue, Stop letting pads ring, PANIC, and one-at-a-time.
    @MainActor
    private static func padSteps(engine: Engine, link: ShowLink, dir: URL, note: @escaping (String) -> Void,
                                 state: @escaping (String) -> Void) -> Steps {
        guard let fake else { return [] }
        let board = engine.pads
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func ids() -> [String] { board.pads.sorted { $0.slot < $1.slot }.map(\.id) }
        func sounding() -> String {
            let names = board.pads.filter { board.sounding[$0.id] != nil }.map(\.name).sorted()
            return names.isEmpty ? "none" : names.joined(separator: ", ")
        }
        func og() -> [String: Any] { fake.doc["outrangutan"] as? [String: Any] ?? [:] }
        var n = 0
        func send(_ action: String, cueId: String = "", padId: String = "") {
            n += 1
            let t = ShowLink.now
            let c: [String: Any] = ["commandId": "pad_TEST_\(n)", "origId": "pad_TEST_\(n)", "ts": t, "expiresAt": t + 8000,
                                    "by": "Test", "sender": "flowmingo_test", "action": action, "cueId": cueId, "padId": padId]
            fake.set(["outrangutan", "commandQueue"], [c])
            fake.set(["outrangutan", "command"], c)
        }
        func snapBoard(_ name: String) {
            let root = HStack(spacing: 0) {
                PadBoardView(board: board)
                Divider()
                PadInspectorView(board: board).frame(width: 330)
            }
            .frame(width: 1100, height: 560)
            .background(Color(nsColor: .windowBackgroundColor))
            .preferredColorScheme(.dark)
            let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 560), styleMask: [.titled], backing: .buffered, defer: false)
            win.appearance = NSAppearance(named: .darkAqua)
            win.contentView = NSHostingView(rootView: root)
            win.orderBack(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if let view = win.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                    view.cacheDisplay(in: view.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name).png"))
                }
                win.orderOut(nil)
            }
        }
        return [
            (1.0, {
                board.add(urls: ["demo-applause.wav", "demo-airhorn.wav", "demo-rimshot.wav", "demo-aww.wav"].map { media.appendingPathComponent($0) })
                let i = ids()
                board.update(i[1]) { $0.retrigger = .poly; $0.emoji = "📯" }
                board.update(i[3]) { $0.retrigger = .toggle; $0.loop = true; $0.emoji = "😢" }
                board.update(i[0]) { $0.emoji = "👏"; $0.eq.high = 3; $0.comp = true }
                note("loaded: " + board.pads.sorted { $0.slot < $1.slot }.map { "\($0.name) key=\($0.key) \(board.length($0.id).map { String(format: "%.1fs", $0) } ?? "not loaded")" }.joined(separator: " | "))
            }),
            (0.2, { board.fire(ids()[0]); board.fire(ids()[0]) }),
            (0.3, { note("1 applause hit twice (restart): sounding \(sounding())") }),
            (0.1, { board.fire(ids()[3]) }),
            (0.3, { note("2 aww (toggle, loop) hit once: sounding \(sounding())"); board.selectedPadID = ids()[0]; snapBoard("pads-board") }),
            (0.7, { board.fire(ids()[3]) }),
            (0.3, { note("3 aww hit again (toggle stops it): sounding \(sounding())") }),
            (0.1, { engine.openOutput(); link.join(code: "TEST1") }),
            (1.2, {
                let padsMap = og()["pads"] as? [String: Any] ?? [:]
                let first = padsMap[ids()[0]] as? [String: Any]
                note("4 joined: published \(padsMap.count) pads, first: \(first?["emoji"] ?? "") \(first?["name"] ?? "-") bank=\(first?["bank"] ?? "-") dur=\(first?["dur"] ?? "-")")
                send("pad", padId: ids()[1])
            }),
            (0.8, {
                let ack = og()["cmdAck"] as? [String: Any]
                let fire = og()["sfxFire"] as? [String: Any]
                note("5 rundown fired the airhorn: ack ok=\(ack?["ok"] ?? "-") \(ack?["reason"] ?? ""), sfxFire=\(fire?["name"] ?? "-") durMs=\(fire?["durMs"] ?? "-"), sounding \(sounding())")
                send("pad", padId: "p_missing")
            }),
            (0.8, { let ack = og()["cmdAck"] as? [String: Any]; note("6 a pad this Mac lacks: ok=\(ack?["ok"] ?? "-") reason=\(ack?["reason"] ?? "")") }),
            (0.1, {
                board.stopAll()
                // Tie the applause to the first cue, half a second in.
                if let cue = engine.cues.first { engine.update(cue.id) { $0.sfxPadId = ids()[0]; $0.sfxDelay = 0.5 } }
                send("cue", cueId: engine.cues.first?.wireID ?? "")
            }),
            (0.9, { state("7 the cue fired; its tied pad came in after 0.5 s"); note("   sounding \(sounding())") }),
            (0.1, { board.update(ids()[0]) { $0.loop = true }; send("stop") }),
            (0.4, { note("8 remote Stop: the cue stopped, the tied pad is fading: sounding \(sounding())") }),
            (0.8, { note("   a moment later: sounding \(sounding())"); board.fire(ids()[2]); board.fire(ids()[3]) }),
            (0.2, { note("9 rimshot and aww playing: sounding \(sounding())"); send("panic") }),
            (0.8, { note("10 PANIC: sounding \(sounding())") }),
            (0.1, { board.multiTrigger = false; board.update(ids()[0]) { $0.loop = false }; board.fire(ids()[3]); board.fire(ids()[0]) }),
            (0.3, { note("11 one at a time: aww then applause: sounding \(sounding())"); board.stopAll() }),
            (0.2, {
                // A pad's hotkey, the way the keyboard hits it.
                let key = board.pads.first { $0.slot == 2 }?.key ?? ""
                if let pad = board.pad(forKey: key) { board.fire(pad.id) }
                note("12 hotkey \(key.uppercased()) hit: sounding \(sounding())")
            }),
            (0.8, { note("   writes: \(fake.writeCount)") }),
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
            (0.9, { report("11 an SFX pad this Mac does not have") }),
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
