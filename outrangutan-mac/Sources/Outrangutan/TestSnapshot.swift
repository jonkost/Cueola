import Network
import CoreMIDI
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
/// - "files": saves a show file, opens it again, opens one shaped like the
///   web app's, and picks up after a pretend crash.
/// - "watch": a watched folder: a file that is still arriving waits, a
///   finished one joins, a sound becomes a pad, and a lock holds new files.
/// - "obs": a pretend OBS checks the password proof, takes a cue's scene
///   switch, and fires a cue with its own scene change.
/// - "key": color bars with the green bar keyed to magenta, then a luma key
///   switched on while on air; reads the real frames.
/// - "scopes": the program preview, waveform and vectorscope on color bars,
///   a still and a red matte; saves each scope and the frame it read.
/// - "listen": joins show WEBTEST with two cues and waits 60 seconds, for
///   trying the direct link from a real browser; writes the log at the end.
/// - "direct": a pretend Cueola page on this Mac using the direct link, a
///   page from another website being turned away, and the cloud copy of a
///   direct command not playing twice. Run with OUTRANGUTAN_DIRECT_PORT set
///   to a spare port so it never meets the real app.
/// - "midi": learning a button and a fader, then using them.
/// - "keys": changed show keys, a held key, the lock, and the time of day.
/// - "log": a short show from this Mac and from the rundown, then pictures
///   of the Show Log, and the cue sheet and log printed to PDF.
enum TestSnapshot {
    static var isOn: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }
    static var scenario: String { ProcessInfo.processInfo.environment["OUTRANGUTAN_SCENARIO"] ?? "transport" }

    /// The pretend show record, only in the link test.
    @MainActor static let fake: FakeRecordStore? = isOn && ["link", "pads", "log", "direct", "listen"].contains(scenario) ? FakeRecordStore() : nil
    @MainActor static var store: ShowRecordStore? { fake }

    @MainActor
    static func runIfAsked(engine: Engine, link: ShowLink, files: ShowFiles, midi: MidiInput, scopes: Scopes, watch: WatchFolder) {
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
                if window.toolbar != nil { which = "control" }
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
        case "padsearch": steps = [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                let b1 = PadBank(id: "bk_1", name: "Show open"), b2 = PadBank(id: "bk_2", name: "Game segment")
                func pad(_ n: Int, _ bank: String, _ name: String, _ file: String, _ emoji: String) -> Pad {
                    var p = Pad(id: Pad.newID(offsetMs: n), slot: n % 4, bank: bank, name: name, path: media.appendingPathComponent(file).path, key: "")
                    p.emoji = emoji
                    return p
                }
                engine.replaceShow(cues: [], pads: [
                    pad(0, "bk_1", "Air horn", "demo-airhorn.wav", "📯"), pad(1, "bk_1", "Applause", "demo-applause.wav", "👏"),
                    pad(4, "bk_2", "Horn fail", "demo-aww.wav", "😢"), pad(5, "bk_2", "Rimshot", "demo-rimshot.wav", "🥁"),
                ], banks: [b1, b2], multiTrigger: true)
                picture(PadBoardView(board: engine.pads, startSearch: "horn"), size: CGSize(width: 760, height: 420), to: dir.appendingPathComponent("pad-search.png"))
                picture(PadBoardView(board: engine.pads, startSearch: "kazoo"), size: CGSize(width: 760, height: 420), to: dir.appendingPathComponent("pad-search-none.png"))
            }),
            (1.2, {}),
        ]
        case "watch": steps = watchSteps(engine: engine, watch: watch, dir: dir, note: note)
        case "obs": steps = obsSteps(engine: engine, dir: dir, note: note)
        case "key": steps = keySteps2(engine: engine, scopes: scopes, dir: dir, note: note, snap: snap)
        case "scopes": steps = scopeSteps(engine: engine, scopes: scopes, dir: dir, note: note, state: state, snap: snap)
        case "listen": steps = listenSteps(engine: engine, link: link, note: note)
        case "direct": steps = directSteps(engine: engine, link: link, note: note, state: state)
        case "midi": steps = midiSteps(engine: engine, midi: midi, dir: dir, note: note, state: state)
        case "keys": steps = keySteps(engine: engine, dir: dir, note: note, state: state, snap: snap)
        case "log": steps = logSteps(engine: engine, link: link, files: files, dir: dir, note: note, state: state)
        case "files": steps = fileSteps(engine: engine, files: files, dir: dir, note: note, state: state, snap: snap)
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

    private static var virtualBox = MIDIEndpointRef()
    private static var sockets: [URLSessionWebSocketTask] = []

    private static var fakeObs: FakeObs?

    @MainActor private static func watchSteps(engine: Engine, watch: WatchFolder, dir: URL, note: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let folder = dir.appendingPathComponent("Shared clips", isDirectory: true)
        let fm = FileManager.default
        func names() -> String { engine.cues.map(\.name).joined(separator: ", ") }
        func pads() -> String { engine.pads.pads.map(\.name).joined(separator: ", ") }
        return [
            (0.5, {
                try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
                try? fm.copyItem(at: media.appendingPathComponent("still-16x9.png"), to: folder.appendingPathComponent("Already here.png"))
                engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
                WatchFolder.every = 0.4
                watch.soundsToPads = true
                watch.watch(folder, takeWhatIsThere: false)
                // A clip still arriving: the first half now, the rest later.
                let clip = try! Data(contentsOf: media.appendingPathComponent("bars-4x3.mp4"))
                try? clip.prefix(clip.count / 2).write(to: folder.appendingPathComponent("Arriving clip.mp4"))
            }),
            (2.5, {
                note("a a half-copied clip that stopped changing is tested and waits: cues [\(names())]")
                let clip = try! Data(contentsOf: media.appendingPathComponent("bars-4x3.mp4"))
                try? clip.write(to: folder.appendingPathComponent("Arriving clip.mp4"))
                try? fm.copyItem(at: media.appendingPathComponent("demo-rimshot.wav"), to: folder.appendingPathComponent("Rimshot.wav"))
            }),
            (2.5, {
                note("b once finished: cues [\(names())], pads [\(pads())]; the file already there was left out")
                engine.locked = true
                try? fm.copyItem(at: media.appendingPathComponent("bars-16x9.mp4"), to: folder.appendingPathComponent("During the show.mp4"))
            }),
            (2.5, { note("c locked: the new file waits: cues [\(names())]"); engine.locked = false }),
            (2.5, {
                note("d unlocked: cues [\(names())]")
                engine.log.entries.filter { $0.kind == .file }.forEach { note("   log: \($0.line)") }
                picture(GeneralSettings(watch: watch), size: CGSize(width: 560, height: 470), to: dir.appendingPathComponent("watch-settings.png"))
            }),
            (1.0, { watch.stop(); WatchFolder.every = 2 }),
        ]
    }

    /// Saves a picture of a SwiftUI view in its own dark window. `store`
    /// keeps remembered settings (like an Inspector tab) away from the real app's.
    @MainActor static func picture<V: View>(_ view: V, size: CGSize, to url: URL, store: UserDefaults? = nil) {
        let root = view
            .defaultAppStorage(store ?? UserDefaults(suiteName: "live.cueola.outrangutan.test")!)
            .frame(width: size.width, height: size.height)
            .background(Color(nsColor: .windowBackgroundColor))
        let win = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        win.appearance = NSAppearance(named: .darkAqua)
        win.contentView = NSHostingView(rootView: root)
        win.orderBack(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            if let v = win.contentView, let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                v.cacheDisplay(in: v.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: url)
            }
            win.orderOut(nil)
        }
    }

    @MainActor private static func obsSteps(engine: Engine, dir: URL, note: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let obs = ObsClient.shared
        let fake = FakeObs(port: 44559, password: "showtime", note: note)
        fakeObs = fake
        func gos() -> [String] { engine.log.entries.filter { $0.kind == .cue }.map { "\($0.text) (\($0.from))" } }
        return [
            (0.5, {
                var a = Cue(name: "Open on the tight shot", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                a.obs.action = .scene; a.obs.scene = "Tight"; a.obsTriggerScene = "Tight"
                var b = Cue(name: "Break slate", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                b.obsTriggerScene = "Break"
                var c = Cue(name: "Roll and record", path: media.appendingPathComponent("bars-4x3.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 2))
                c.obs.action = .startRecord
                engine.replaceShow(cues: [a, b, c], pads: [], banks: [], multiTrigger: nil)
                obs.host = "localhost"; obs.port = 44559; obs.password = "wrong"
                obs.connect()
            }),
            (1.0, { note("a wrong password: \(obs.status)"); obs.password = "showtime"; obs.connect() }),
            (1.0, { note("b right password: \(obs.status); scenes \(obs.scenes); program \(obs.current)"); engine.go() }),
            (1.0, { note("c after GO on cue 1 (it asks for Tight, and waits for Tight): GOs \(gos())"); fake.switchScene("Break") }),
            (1.0, {
                note("d OBS switched to Break by itself: GOs \(gos())")
                picture(ObsSettings(obs: obs), size: CGSize(width: 560, height: 470), to: dir.appendingPathComponent("obs-settings.png"))
                let store = UserDefaults(suiteName: "live.cueola.outrangutan.test")!
                store.set("cue", forKey: "inspector.cueTab")
                engine.standbyID = engine.cues[0].id
                picture(InspectorView(engine: engine), size: CGSize(width: 340, height: 760), to: dir.appendingPathComponent("obs-inspector.png"), store: store)
            }),
            (1.0, { engine.standbyID = engine.cues[2].id; engine.go() }),
            (1.0, {
                note("e cue 3 started recording: OBS recording = \(obs.recording)")
                engine.log.entries.filter { $0.from == "OBS" }.forEach { note("   log: \($0.line)") }
                engine.allStop()
                obs.disconnect()
            }),
            (0.3, {}),
        ]
    }

    @MainActor private static func keySteps2(engine: Engine, scopes: Scopes, dir: URL, note: @escaping (String) -> Void,
                                             snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let ctx = CIContext()
        // The color at a spot in the program frame, as 0-255 values.
        func sample(_ name: String, x: CGFloat, y: CGFloat) -> String {
            guard let f = engine.programFrame(), let cg = ctx.createCGImage(f, from: f.extent) else { return "\(name): no frame" }
            let rep = NSBitmapImageRep(cgImage: cg)
            guard let c = rep.colorAt(x: Int(x * CGFloat(rep.pixelsWide)), y: Int(y * CGFloat(rep.pixelsHigh)))?.usingColorSpace(.sRGB) else { return "\(name): ?" }
            return String(format: "%@ = %d,%d,%d", name, Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
        }
        func save(_ name: String) {
            guard let f = engine.programFrame(), let cg = ctx.createCGImage(f, from: f.extent) else { return }
            try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(name + ".png"))
        }
        // Bar centers across the top: gray, yellow, cyan, green, magenta, red, blue.
        func bars(_ label: String) {
            let names = ["gray", "yellow", "cyan", "green", "magenta", "red", "blue"]
            note(label)
            for (i, n) in names.enumerated() { note("   " + sample(n, x: (CGFloat(i) + 0.5) / 7, y: 0.3)) }
            note("   " + sample("black corner", x: 0.9, y: 0.9))
        }
        return [
            (1.0, {
                var bars = Cue(name: "Bars, green keyed", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                bars.trimIn = 5
                bars.key.mode = .chroma; bars.key.color = "#00BF00"; bars.key.sim = 0.2; bars.key.smooth = 0.05; bars.key.bg = "#FF00FF"
                engine.replaceShow(cues: [bars], pads: [], banks: [], multiTrigger: nil)
                scopes.isOn = true
                engine.openOutput()
                engine.go()
            }),
            (1.5, { bars("a chroma key on the green bar, background magenta:"); save("k1-chroma") }),
            (0.2, {
                engine.update(engine.cues[0].id) { $0.key.mode = .luma; $0.key.sim = 0.1; $0.key.smooth = 0.02; $0.key.bg = "#0000FF" }
            }),
            (0.8, {
                bars("b switched to a luma key on air, background blue:"); save("k2-luma")
                // The Inspector's Picture tab, in a separate settings store so
                // the real app's remembered tab is untouched.
                let store = UserDefaults(suiteName: "live.cueola.outrangutan.test")!
                store.set("picture", forKey: "inspector.cueTab")
                engine.standbyID = engine.cues[0].id
                let root = InspectorView(engine: engine)
                    .defaultAppStorage(store)
                    .frame(width: 340, height: 820)
                    .background(Color(nsColor: .windowBackgroundColor))
                let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 820), styleMask: [.titled], backing: .buffered, defer: false)
                win.appearance = NSAppearance(named: .darkAqua)
                win.contentView = NSHostingView(rootView: root)
                win.orderBack(nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    if let view = win.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                        view.cacheDisplay(in: view.bounds, to: rep)
                        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("k2-inspector.png"))
                    }
                    win.orderOut(nil)
                }
            }),
            (0.8, {}),
            (0.2, { engine.update(engine.cues[0].id) { $0.key.mode = .off } }),
            (0.8, { bars("c key off:"); engine.allStop(); scopes.isOn = false }),
        ]
    }

    @MainActor private static func scopeSteps(engine: Engine, scopes: Scopes, dir: URL, note: @escaping (String) -> Void,
                                              state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func save(_ image: CGImage?, _ name: String) {
            guard let image else { return note("   \(name): no picture") }
            let rep = NSBitmapImageRep(cgImage: image)
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(name + ".png"))
        }
        func frame(_ name: String) {
            guard let f = engine.programFrame() else { return note("   \(name): no program frame (black)") }
            let ctx = CIContext()
            if let cg = ctx.createCGImage(f, from: f.extent) { save(cg, name) }
            note("   \(name): program frame \(Int(f.extent.width))x\(Int(f.extent.height))")
        }
        func read(_ name: String, then: @escaping () -> Void = {}) {
            scopes.tick {
                save(scopes.waveform, name + "-waveform")
                save(scopes.vectorscope, name + "-vectorscope")
                then()
            }
        }
        return [
            (1.0, {
                var bars = Cue(name: "Color bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                bars.trimIn = 5
                let still = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                let red = Cue.matte(named: "Red matte", color: "#BF0000")
                engine.replaceShow(cues: [bars, still, red], pads: [], banks: [], multiTrigger: nil)
                scopes.isOn = true
                engine.openOutput()
                engine.go()
            }),
            (1.5, { frame("s1-frame-bars"); read("s1-bars") }),
            (0.8, { snap("s1-control"); engine.go() }),
            (1.0, { frame("s2-frame-still"); read("s2-still") }),
            (0.8, { engine.go() }),
            (1.0, { frame("s3-frame-matte"); read("s3-matte") }),
            (0.8, { snap("s3-control"); note("   preview shows: \(engine.monitor.showing)"); engine.allStop() }),
            (0.8, { frame("s4-frame-black"); note("   after All Stop, preview shows: \(engine.monitor.showing)"); scopes.isOn = false }),
        ]
    }

    @MainActor private static func listenSteps(engine: Engine, link: ShowLink, note: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        return [
            (0.5, {
                var a = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: "og_web_bars")
                a.volume = 0
                let b = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: "og_web_still")
                engine.replaceShow(cues: [a, b], pads: [], banks: [], multiTrigger: nil)
                link.join(code: "WEBTEST")
                note("listening on \(DirectLink.port) for show WEBTEST")
            }),
            (60, {
                engine.log.entries.forEach { note("log: \($0.line)") }
                engine.allStop()
            }),
        ]
    }

    @MainActor private static func directSteps(engine: Engine, link: ShowLink, note: @escaping (String) -> Void,
                                               state: @escaping (String) -> Void) -> Steps {
        guard let fake else { return [] }
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let url = URL(string: "ws://127.0.0.1:\(DirectLink.port)")!
        func socket(origin: String) -> URLSessionWebSocketTask {
            var request = URLRequest(url: url)
            request.setValue(origin, forHTTPHeaderField: "Origin")
            let task = URLSession.shared.webSocketTask(with: request)
            task.resume()
            sockets.append(task)
            return task
        }
        func send(_ task: URLSessionWebSocketTask, _ object: [String: Any]) {
            let text = String(data: try! JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
            task.send(.string(text)) { _ in }
        }
        func listen(_ task: URLSessionWebSocketTask, _ label: String, sentAt: @escaping () -> Date? = { nil }) {
            task.receive { result in
                let heard = Date()
                DispatchQueue.main.async {
                    switch result {
                    case .success(.string(let text)):
                        let ms = sentAt().map { String(format: " (%.1f ms after sending)", heard.timeIntervalSince($0) * 1000) } ?? ""
                        note("   \(label) heard: \(text)\(ms)")
                        listen(task, label, sentAt: sentAt)
                    case .failure(let e):
                        note("   \(label) closed: \((e as NSError).code == 57 || (e as NSError).domain == NSPOSIXErrorDomain ? "connection refused or closed" : e.localizedDescription)")
                    default:
                        listen(task, label, sentAt: sentAt)
                    }
                }
            }
        }
        func gos() -> Int { engine.log.entries.filter { $0.kind == .cue }.count }
        var good: URLSessionWebSocketTask!
        var sentAt: Date?
        let t0 = ShowLink.now
        let fire: [String: Any] = ["commandId": "out_D1", "origId": "out_D1", "ts": t0, "expiresAt": t0 + 8000,
                                   "by": "Jon Kost", "sender": "flowmingo_test", "action": "cue", "cueId": ""]
        return [
            (1.0, {
                let a = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                let b = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                engine.replaceShow(cues: [a, b], pads: [], banks: [], multiTrigger: nil)
                link.join(code: "DIR1")
                note("a listening on port \(DirectLink.port); joined DIR1")
                let bad = socket(origin: "https://not-cueola.example")
                listen(bad, "page from another website")
                send(bad, ["type": "hello", "code": "DIR1"])
                var sneaky = fire
                sneaky["commandId"] = "out_BAD"; sneaky["origId"] = "out_BAD"; sneaky["cueId"] = engine.cues[0].wireID ?? ""
                send(bad, ["type": "command", "code": "DIR1", "command": sneaky])
            }),
            (1.0, {
                good = socket(origin: "https://cueola.live")
                listen(good, "cueola.live page", sentAt: { sentAt })
                send(good, ["type": "hello", "code": "DIR1"])
            }),
            (0.8, {
                note("b browsers connected directly: \(link.directBrowsers); GOs from the other website: \(gos())")
                var cmd = fire
                cmd["cueId"] = engine.cues[0].wireID ?? ""
                sentAt = Date()
                send(good, ["type": "command", "code": "DIR1", "command": cmd])
            }),
            (0.8, {
                note("c GOs=\(gos()) on air=\(engine.pictureCue?.name ?? "-")")
                // The same command's cloud copy lands afterwards.
                var cmd = fire
                cmd["cueId"] = engine.cues[0].wireID ?? ""
                fake.set(["outrangutan", "commandQueue"], [cmd])
                fake.set(["outrangutan", "command"], cmd)
            }),
            (0.8, {
                note("d after the cloud copy: GOs=\(gos()) (must still be 1)")
                if let ack = fake.doc["outrangutan"].flatMap({ ($0 as? [String: Any])?["cmdAck"] }) { note("   cloud reply: \(ack)") }
                var other = fire
                other["commandId"] = "out_D2"; other["origId"] = "out_D2"; other["action"] = "go"
                sentAt = Date()
                send(good, ["type": "command", "code": "WRONG", "command": other])
            }),
            (0.5, {
                send(good, ["type": "gain", "code": "DIR1", "v": 0.3, "id": "g_D1"])
            }),
            (0.4, {
                note("e level after a direct volume change: \(engine.masterGain)")
                let t = ShowLink.now
                sentAt = Date()
                send(good, ["type": "command", "code": "DIR1", "command": ["commandId": "out_D3", "origId": "out_D3", "ts": t, "expiresAt": t + 8000,
                                                                           "by": "Jon Kost", "sender": "flowmingo_test", "action": "panic"]])
            }),
            (0.6, {
                state("f after a direct PANIC")
                link.leave(keepSignIn: true)
            }),
            (1.0, {
                note("g after leaving the show the page was told (hello with no code above)")
                engine.setGain(1)
                engine.log.entries.filter { $0.kind == .link || $0.from.contains("Jon") }.forEach { note("   log: \($0.line)") }
                sockets.forEach { $0.cancel(with: .goingAway, reason: nil) }
            }),
            (0.5, {}),
        ]
    }

    /// MIDI: learn a button and a fader, pick what they do, use them. The
    /// messages are pretend ones; no box is needed.
    @MainActor private static func midiSteps(engine: Engine, midi: MidiInput, dir: URL, note: @escaping (String) -> Void,
                                             state: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func gos() -> Int { engine.log.entries.filter { $0.kind == .cue }.count }
        return [
            (1.0, {
                let a = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                let b = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                engine.replaceShow(cues: [a, b], pads: [], banks: [], multiTrigger: nil)
                note("a MIDI boxes the Mac sees: \(midi.sources.isEmpty ? "none" : midi.sources.joined(separator: ", "))")
                midi.learning = true
                midi.pretend(0x90, 60, 100)
                note("b learned: \(midi.mappings.map { "\(MidiRouter.label($0.key)) -> \($0.binding.action.label)" })  GOs=\(gos())")
                midi.pretend(0x80, 60, 0)
                midi.pretend(0x90, 60, 100)
                note("c pressed again: GOs=\(gos())")
                state("c")
                midi.learning = true
                midi.pretend(0xB0, 7, 90)
                midi.pretend(0xB0, 7, 0)
                midi.pretend(0xB0, 7, 64)
                note("d fader learned as \(midi.router.map["cc:0:7"]?.action.label ?? "-"); set to 64 of 127: gain \(String(format: "%.2f", engine.masterGain))")
                midi.learning = true
                midi.pretend(0x90, 62, 100)
                midi.set("n:0:62", action: .cue)
                midi.set("n:0:62", ref: engine.cues[0].wireID ?? "")
                midi.pretend(0x90, 62, 100)
                note("e D4 fires cue 1: GOs=\(gos()) on air=\(engine.pictureCue?.name ?? "-")")
                engine.allStop()
                engine.setGain(1)
                // Now through the Mac's own MIDI system: a pretend box that
                // shows up like a real one.
                var client = MIDIClientRef(), source = MIDIEndpointRef()
                MIDIClientCreateWithBlock("Outrangutan test" as CFString, &client, nil)
                MIDISourceCreateWithProtocol(client, "Test Box" as CFString, ._1_0, &source)
                virtualBox = source
                midi.connectAll()
            }),
            (0.5, {
                note("f MIDI boxes now: \(midi.sources.joined(separator: ", "))")
                func send(_ status: UInt32, _ d1: UInt32, _ d2: UInt32) {
                    var list = MIDIEventList()
                    let packet = MIDIEventListInit(&list, ._1_0)
                    var word: UInt32 = 0x2 << 28 | status << 16 | d1 << 8 | d2
                    MIDIEventListAdd(&list, MemoryLayout<MIDIEventList>.size, packet, 0, 1, &word)
                    MIDIReceivedEventList(virtualBox, &list)
                }
                send(0x90, 60, 100)   // C4 press, mapped to GO
            }),
            (0.5, {
                note("g C4 from the box fired GO: GOs=\(gos()) on air=\(engine.pictureCue?.name ?? "-")")
                engine.log.entries.filter { $0.from.hasPrefix("MIDI") }.forEach { note("   log: \($0.line)") }
                engine.allStop()
                let root = MidiSettings(midi: midi, engine: engine)
                    .frame(width: 560, height: 470)
                    .background(Color(nsColor: .windowBackgroundColor))
                let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 470), styleMask: [.titled], backing: .buffered, defer: false)
                win.appearance = NSAppearance(named: .darkAqua)
                win.contentView = NSHostingView(rootView: root)
                win.orderBack(nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    if let view = win.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                        view.cacheDisplay(in: view.bounds, to: rep)
                        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("midi-settings.png"))
                    }
                    win.orderOut(nil)
                }
            }),
            (1.0, {}),
        ]
    }

    /// Show keys, the lock and the time of day. Key presses are pretend
    /// ones, sent to this app only.
    @MainActor private static func keySteps(engine: Engine, dir: URL, note: @escaping (String) -> Void,
                                            state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let keys = KeyMap.shared
        func press(_ code: UInt16, _ chars: String, repeating: Bool = false) {
            guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: 0, context: nil, characters: chars, charactersIgnoringModifiers: chars,
                                           isARepeat: repeating, keyCode: code) else { return }
            NSApp.postEvent(e, atStart: false)
        }
        func gos() -> Int { engine.log.entries.filter { $0.kind == .cue }.count }
        func keyList() -> String { KeyMap.Action.allCases.map { "\($0.label)=\(keys.name($0))" }.joined(separator: " ") }
        return [
            (1.0, {
                let a = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                let b = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                let c = Cue(name: "Bars 4x3", path: media.appendingPathComponent("bars-4x3.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 2))
                engine.replaceShow(cues: [a, b, c], pads: [], banks: [], multiTrigger: nil)
                note("a standard keys: \(keyList())")
                keys.set(.go, to: KeyMap.Key(code: 36, name: "Return"))
                note("b GO moved to Return: \(keyList())")
            }),
            (0.2, { press(49, " ") }),
            (0.3, { note("c Space no longer fires: GOs=\(gos())"); press(36, "\r") }),
            (0.3, { press(36, "\r", repeating: true); press(36, "\r", repeating: true) }),
            (0.4, { note("d Return fired once, holding it did not repeat: GOs=\(gos())"); state("d") }),
            (0.1, {
                keys.set(.go, to: KeyMap.Key(code: 1, name: "S"))
                note("e GO set to S, which Stop had: they swap: \(keyList())")
                engine.locked = true
            }),
            (0.4, {
                note("f locked: \(engine.locked), pads locked: \(engine.pads.locked)")
                press(1, "s")
            }),
            (0.4, { note("g S fires GO while locked (show keys still work): GOs=\(gos())"); state("g"); snap("k-locked") }),
            (0.3, {
                let root = KeySettings(board: engine.pads)
                    .frame(width: 560, height: 470)
                    .background(Color(nsColor: .windowBackgroundColor))
                let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 470), styleMask: [.titled], backing: .buffered, defer: false)
                win.appearance = NSAppearance(named: .darkAqua)
                win.contentView = NSHostingView(rootView: root)
                win.orderBack(nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    if let view = win.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                        view.cacheDisplay(in: view.bounds, to: rep)
                        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("k-settings-keys.png"))
                    }
                    win.orderOut(nil)
                }
            }),
            (1.0, {
                note("h time of day: \(ControlView.timeText(Date(), twentyFour: true)) / \(ControlView.timeText(Date(), twentyFour: false))")
                keys.resetAll()
                note("i back to standard: \(keyList())")
                engine.allStop()
            }),
        ]
    }

    /// The show log and printing. Silent, like every test.
    @MainActor private static func logSteps(engine: Engine, link: ShowLink, files: ShowFiles, dir: URL,
                                            note: @escaping (String) -> Void, state: @escaping (String) -> Void) -> Steps {
        guard let fake else { return [] }
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func file(_ name: String, _ kind: CueKind, _ label: String) -> Cue {
            Cue(name: label, path: media.appendingPathComponent(name).path, kind: kind, wireID: Cue.newWireID())
        }
        var n = 0
        func send(_ action: String, cueId: String = "", padId: String = "") {
            n += 1
            let t = ShowLink.now
            let c: [String: Any] = ["commandId": "log_TEST_\(n)", "origId": "log_TEST_\(n)", "ts": t, "expiresAt": t + 8000,
                                    "by": "Jon Kost", "sender": "flowmingo_test", "action": action, "cueId": cueId, "padId": padId]
            fake.set(["outrangutan", "commandQueue"], [c])
            fake.set(["outrangutan", "command"], c)
        }
        func pictures(of pdf: URL, as name: String) {
            // Page one of each PDF, as a picture to look at.
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
            p.arguments = ["-s", "format", "png", pdf.path, "--out", dir.appendingPathComponent(name).path]
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            try? p.run(); p.waitUntilExit()
        }
        return [
            (1.0, {
                var intro = file("bars-16x9.mp4", .video, "Open: bars")
                intro.notes = "Roll on the director's call"
                var still = file("still-16x9.png", .still, "Title card")
                still.duration = 5; still.continueMode = .autoFollow
                var applause = file("demo-applause.wav", .audio, "Applause")
                applause.preWait = 1
                let lost = Cue(name: "Clip that moved", path: "/nowhere/clip.mov", kind: .video, wireID: Cue.newWireID(offsetMs: 9))
                let bank = PadBank(id: "bk_log", name: "Bank 1")
                var horn = Pad(id: Pad.newID(), slot: 0, bank: bank.id, name: "Air horn",
                               path: media.appendingPathComponent("demo-airhorn.wav").path, key: "1")
                horn.emoji = "📯"
                engine.replaceShow(cues: [intro, still, applause, lost], pads: [horn], banks: [bank], multiTrigger: true)
                engine.update(engine.cues[0].id) { $0.sfxPadId = horn.id; $0.trimIn = 90 }
                link.join(code: "LOG1")
            }),
            (1.0, { engine.openOutput(); engine.go() }),
            (0.6, { engine.togglePause() }),
            (0.4, { engine.togglePause() }),
            (0.4, { send("cue", cueId: engine.cues[1].wireID ?? "") }),
            (0.8, { send("pad", padId: engine.pads.pads[0].id) }),
            (0.6, { send("cue", cueId: "og_not_here") }),
            (0.6, { engine.standbyID = engine.cues[3].id; engine.go() }),
            (0.3, { engine.stop(); engine.pads.fire(engine.pads.pads[0].id) }),
            (0.4, { send("panic") }),
            (0.8, {
                engine.closeOutput(1)
                engine.log.entries.forEach { note("log: \($0.line)") }
                // The Show Log window, drawn the way the test camera can.
                let root = ShowLogView(log: engine.log) { "Log Test Show" }
                    .frame(width: 760, height: 460)
                    .background(Color(nsColor: .windowBackgroundColor))
                let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 460), styleMask: [.titled], backing: .buffered, defer: false)
                win.appearance = NSAppearance(named: .darkAqua)
                win.contentView = NSHostingView(rootView: root)
                win.orderBack(nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    if let view = win.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                        view.cacheDisplay(in: view.bounds, to: rep)
                        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("log-window.png"))
                    }
                    win.orderOut(nil)
                }
            }),
            (1.0, {
                let sheet = dir.appendingPathComponent("cue-sheet.pdf"), logPDF = dir.appendingPathComponent("show-log.pdf")
                Printer.printCueSheet(engine: engine, showName: "Log Test Show", pdfTo: sheet)
                Printer.printLog(engine.log.entries, showName: "Log Test Show", pdfTo: logPDF)
                note("printed: cue sheet \(FileManager.default.fileExists(atPath: sheet.path)), log \(FileManager.default.fileExists(atPath: logPDF.path))")
                pictures(of: sheet, as: "cue-sheet.png")
                pictures(of: logPDF, as: "show-log.png")
                state("done")
            }),
        ]
    }

    /// Show files and crash recovery. Everything is written inside the test
    /// folder; the real show and the Movies folder are never touched.
    @MainActor private static func fileSteps(engine: Engine, files: ShowFiles, dir: URL, note: @escaping (String) -> Void,
                                  state: @escaping (String) -> Void, snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let showURL = dir.appendingPathComponent("Test Show.ogshow")
        let webURL = dir.appendingPathComponent("Web Show.ogshow")
        func file(_ name: String, _ kind: CueKind, _ label: String) -> Cue {
            Cue(name: label, path: media.appendingPathComponent(name).path, kind: kind, wireID: Cue.newWireID())
        }
        func cueSummary() -> [String] {
            engine.cues.map { c in
                "\(c.name) | \(c.kind.rawValue) | \(c.wireID ?? "-") | trim \(c.trimIn)-\(c.trimOut.map { "\($0)" } ?? "end") | fade \(c.fadeIn)/\(c.fadeOut) \(c.fadeCurve.rawValue) | out \(c.output) | \(c.kind == .matte ? c.color : "") | dur \(c.duration) | \(c.continueMode.rawValue) \(c.endAction.rawValue) | pad \(c.sfxPadId) | armed \(c.armed)"
            }
        }
        func padSummary() -> [String] {
            engine.pads.pads.sorted { $0.slot < $1.slot }.map { p in
                "\(p.name) | \(p.id) | slot \(p.slot) | key \(p.key) | \(p.color) | gain \(p.gain) | eq \(p.eq.low)/\(p.eq.mid)/\(p.eq.high) | \(p.retrigger.rawValue)"
            }
        }
        func filesThere() -> String {
            let missing = engine.cues.filter { !$0.fileIsThere }.map(\.name) + engine.pads.pads.filter { !$0.fileIsThere }.map(\.name)
            return missing.isEmpty ? "every file is there" : "missing: " + missing.joined(separator: ", ")
        }
        var before: (cues: [String], pads: [String]) = ([], [])
        return [
            (1.0, {
                var video = file("bars-16x9.mp4", .video, "1 Bars, 10 to 20 s, fade in")
                video.trimIn = 10; video.trimOut = 20; video.fadeIn = 0.5; video.fadeCurve = .s
                var sound = file("demo-applause.wav", .audio, "2 Applause, Continue")
                sound.continueMode = .autoContinue; sound.volume = 0.8
                var still = file("still-16x9.png", .still, "3 Still, up 3 s")
                still.duration = 3; still.fit = .cover
                var matte = Cue.matte(named: "4 Red matte", color: "#C8102E")
                matte.xfade = 0.5
                var side = file("bars-4x3.mp4", .video, "5 Bars 4x3 on output 2, off")
                side.output = 2; side.armed = false; side.notes = "Side screen"
                let bank = PadBank(id: "bk_test", name: "Bank 1")
                var horn = Pad(id: Pad.newID(), slot: 0, bank: bank.id, name: "Air horn", path: media.appendingPathComponent("demo-airhorn.wav").path, key: "1")
                horn.emoji = "📯"; horn.gain = 1.2; horn.eq = PadEQ(low: 3, mid: 0, high: -2)
                var rim = Pad(id: Pad.newID(offsetMs: 1), slot: 1, bank: bank.id, name: "Rimshot", path: media.appendingPathComponent("demo-rimshot.wav").path, key: "2")
                rim.color = "#64D2FF"; rim.retrigger = .poly
                engine.replaceShow(cues: [video, sound, still, matte, side], pads: [horn, rim], banks: [bank], multiTrigger: true)
                engine.update(engine.cues[0].id) { $0.sfxPadId = horn.id; $0.sfxDelay = 1 }
                before = (cueSummary(), padSummary())
                note("a show built: \(engine.cues.count) cues, \(engine.pads.pads.count) pads")
                Task { let ok = await files.write(to: showURL); note("b saved: \(ok) \(files.lastProblem ?? "")") }
            }),
            (2.5, {
                do {
                    let zip = try ShowArchive.Reader(url: showURL)
                    let payload = try ShowFiles.readManifest(showURL)
                    let show = payload["show"] as? [String: Any] ?? [:]
                    note("c the file holds: \(zip.names.sorted().joined(separator: ", "))")
                    note("   show.json: \((show["cues"] as? [Any])?.count ?? 0) cues, \((show["pads"] as? [Any])?.count ?? 0) pads, \((payload["mediaIndex"] as? [String: Any])?.count ?? 0) media")
                    let size = (try? FileManager.default.attributesOfItem(atPath: showURL.path)[.size] as? NSNumber)?.intValue ?? 0
                    note("   size: \(size / 1024) KB")
                } catch { note("c could not read the file back: \(error)") }
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
                p.arguments = ["-tq", showURL.path]
                p.standardOutput = FileHandle.nullDevice
                try? p.run(); p.waitUntilExit()
                note("   the Mac's zip tool checks it: \(p.terminationStatus == 0 ? "OK" : "FAILED")")
                engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
                note("d new show: \(engine.cues.count) cues, \(engine.pads.pads.count) pads")
                Task {
                    guard let payload = try? ShowFiles.readManifest(showURL) else { return note("e could not open") }
                    let ok = await files.load(showURL, payload: payload, mediaFolder: dir.appendingPathComponent("opened-mac"))
                    note("e opened again: \(ok)")
                }
            }),
            (2.0, {
                let after = (cueSummary(), padSummary())
                note("f cues match: \(after.0 == before.0)  pads match: \(after.1 == before.1)")
                if after.0 != before.0 { zip(before.0, after.0).filter { $0 != $1 }.forEach { note("   was: \($0)\n   now: \($1)") } }
                if after.1 != before.1 { zip(before.1, after.1).filter { $0 != $1 }.forEach { note("   was: \($0)\n   now: \($1)") } }
                note("   \(filesThere())")
                note("   window title: \(files.currentFile?.lastPathComponent ?? "-")")
                after.0.forEach { note("   cue: \($0)") }
                after.1.forEach { note("   pad: \($0)") }
                // A file shaped exactly like the web app's own save.
                do {
                    let cues: [[String: Any]] = [
                        ["id": "c_web0001", "num": 1, "name": "Web open", "type": "video", "mediaId": "m_vid", "color": "var(--video)",
                         "preWait": 2, "continueMode": "auto_follow", "duration": 120, "trimIn": 0, "trimOut": NSNull(), "volume": 1,
                         "loop": false, "armed": true, "notes": "", "fadeIn": 0, "fadeOut": 1, "fadeCurve": "", "xfade": 0,
                         "endAction": "black", "fit": "contain", "scale": 1, "posX": 0, "posY": 0, "output": 1, "sfxPadId": "p_web1", "sfxDelay": 0],
                        ["id": "c_web0002", "num": 2, "name": "Matte #00B140", "type": "image", "mediaId": "m_png", "color": "var(--yellow)",
                         "duration": 0, "endAction": "hold", "fit": "cover", "armed": true],
                        ["id": "c_web0003", "num": 3, "name": "Lost clip", "type": "video", "mediaId": "m_gone", "armed": true],
                    ]
                    let pads: [[String: Any]] = [
                        ["id": "p_web1", "slot": 0, "bank": "bk_web", "name": "Ding", "emoji": "🔔", "mediaId": "m_ding", "color": "var(--cyan)",
                         "key": "1", "gain": 0.9, "loop": false, "fadeIn": 0, "fadeOut": 0, "dur": 1, "eq": ["low": 0, "mid": 2, "high": 0],
                         "comp": true, "trimIn": 0, "trimOut": NSNull(), "retrigger": "toggle"],
                    ]
                    let index: [String: Any] = [
                        "m_vid": ["name": "bars.mp4", "mime": "video/mp4", "kind": "video", "file": "media/m_vid"],
                        "m_png": ["name": "Matte #00B140.png", "mime": "image/png", "kind": "image", "file": "media/m_png"],
                        "m_ding": ["name": "ding", "mime": "audio/wav", "kind": "audio", "file": "media/m_ding"],
                    ]
                    let payload: [String: Any] = ["kind": "outrangutan-show", "app": "outrangutan", "schema": 3, "container": "zip",
                                                  "show": ["cues": cues, "pads": pads, "banks": [["id": "bk_web", "name": "Web bank", "padCount": 12]],
                                                           "settings": ["fadeCurve": "s", "multiTrigger": false]] as [String: Any],
                                                  "mediaIndex": index]
                    let w = try ShowArchive.Writer(url: webURL)
                    try w.add(name: "show.json", data: try JSONSerialization.data(withJSONObject: payload))
                    try w.add(name: "media/m_vid", file: media.appendingPathComponent("bars-4x3.mp4"))
                    try w.add(name: "media/m_png", file: media.appendingPathComponent("still-16x9.png"))
                    try w.add(name: "media/m_ding", file: media.appendingPathComponent("sfx-ding.wav"))
                    try w.finish()
                } catch { note("g could not make the web file: \(error)") }
                Task {
                    guard let payload = try? ShowFiles.readManifest(webURL) else { return note("g could not open the web file") }
                    let ok = await files.load(webURL, payload: payload, mediaFolder: dir.appendingPathComponent("opened-web"))
                    note("g opened the web show: \(ok)")
                }
            }),
            (2.0, {
                cueSummary().forEach { note("   cue: \($0)") }
                padSummary().forEach { note("   pad: \($0)") }
                note("   multi-trigger: \(engine.pads.multiTrigger)  standby: \(engine.standbyCue?.name ?? "-")")
                note("   notice: \(engine.notice ?? "-")")
                let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.appendingPathComponent("opened-web").path)) ?? []
                note("   media folder: \(names.sorted().joined(separator: ", "))")
                // A pretend crash: the web show's first cue was 30 s in.
                let first = engine.cues[0]
                engine.recovered = RecoveryPoint(wireID: first.wireID ?? "", name: first.name, offset: 30, cueID: first.id)
                engine.update(first.id) { $0.preWait = 0 }
            }),
            (0.8, { snap("f-recovery") }),
            (0.2, { engine.standbyRecovered(); engine.openOutput(); engine.go() }),
            (1.2, {
                let live = engine.liveState()
                note("h picked up after the crash: \(live.name) at \(String(format: "%.1f", live.offset ?? 0)) s (should be past 30)")
                state("h")
                engine.standbyID = engine.cues[0].id
                engine.go()
            }),
            (1.0, {
                let live = engine.liveState()
                note("i the same cue again starts from the top: \(live.name) at \(String(format: "%.1f", live.offset ?? 0)) s")
                engine.allStop()
                state("j done")
            }),
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

/// A pretend OBS: the same WebSocket protocol (version 5), with a password.
/// It checks the password proof against the Mac's own openssl tool, so the
/// test does not just agree with itself.
final class FakeObs {
    private var listener: NWListener?
    private var conns: [NWConnection] = []
    private let password: String
    private let note: (String) -> Void
    private var scene = "Wide"
    private var recording = false
    let salt = "c2FsdHlzYWx0", challenge = "Y2hhbGxlbmdl"

    init(port: UInt16, password: String, note: @escaping (String) -> Void) {
        self.password = password
        self.note = note
        let ws = NWProtocolWebSocket.Options()
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.requiredInterfaceType = .loopback
        guard let l = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!) else { return }
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.start(queue: .main)
        listener = l
    }

    private func accept(_ c: NWConnection) {
        conns.append(c)
        c.stateUpdateHandler = { [weak self] state in
            if case .ready = state {
                self?.send(["op": 0, "d": ["obsWebSocketVersion": "5.5.0", "rpcVersion": 1,
                                           "authentication": ["challenge": self?.challenge ?? "", "salt": self?.salt ?? ""]]], c)
            }
        }
        c.start(queue: .main)
        receive(c)
    }

    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self, error == nil else { return }
            if let data, let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { self.handle(m, c) }
            self.receive(c)
        }
    }

    /// The proof worked out by openssl, not by the app.
    private func expected() -> String {
        func run(_ input: String) -> String {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = ["-c", "printf %s \"$IN\" | /usr/bin/openssl dgst -sha256 -binary | /usr/bin/base64"]
            p.environment = ["IN": input]
            let pipe = Pipe()
            p.standardOutput = pipe
            try? p.run(); p.waitUntilExit()
            return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return run(run(password + salt) + challenge)
    }

    private func handle(_ m: [String: Any], _ c: NWConnection) {
        let d = m["d"] as? [String: Any] ?? [:]
        switch m["op"] as? Int {
        case 1:
            if (d["authentication"] as? String) == expected() {
                note("   fake OBS: password proof matches openssl")
                send(["op": 2, "d": ["negotiatedRpcVersion": 1]], c)
            } else {
                note("   fake OBS: wrong password proof, closing with 4009")
                let meta = NWProtocolWebSocket.Metadata(opcode: .close)
                meta.closeCode = .privateCode(4009)
                c.send(content: nil, contentContext: NWConnection.ContentContext(identifier: "close", metadata: [meta]),
                       isComplete: true, completion: .contentProcessed { _ in c.cancel() })
            }
        case 6:
            let type = d["requestType"] as? String ?? ""
            let data = d["requestData"] as? [String: Any] ?? [:]
            var response: [String: Any] = [:]
            switch type {
            case "GetSceneList":
                response = ["currentProgramSceneName": scene, "scenes": [["sceneName": "Break"], ["sceneName": "Tight"], ["sceneName": "Wide"]]]
            case "GetRecordStatus": response = ["outputActive": recording]
            case "GetStreamStatus": response = ["outputActive": false]
            default: break
            }
            if type != "GetSceneList" && type != "GetRecordStatus" && type != "GetStreamStatus" {
                note("   fake OBS got: \(type) \(data.isEmpty ? "" : "\(data)")")
            }
            send(["op": 7, "d": ["requestType": type, "requestId": d["requestId"] ?? "", "requestStatus": ["result": true, "code": 100],
                                 "responseData": response]], c)
            if type == "SetCurrentProgramScene", let name = data["sceneName"] as? String { switchScene(name) }
            if type == "StartRecord" {
                recording = true
                conns.forEach { send(["op": 5, "d": ["eventType": "RecordStateChanged", "eventData": ["outputActive": true]]], $0) }
            }
        default:
            break
        }
    }

    func switchScene(_ name: String) {
        scene = name
        conns.forEach { send(["op": 5, "d": ["eventType": "CurrentProgramSceneChanged", "eventData": ["sceneName": name]]], $0) }
    }

    private func send(_ object: [String: Any], _ c: NWConnection) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        c.send(content: data, contentContext: NWConnection.ContentContext(identifier: "m", metadata: [meta]), isComplete: true, completion: .idempotent)
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
