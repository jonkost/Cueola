import AppKit
import AVFoundation

/// Test mode, for checking the app without anyone at the keyboard.
///
/// Start the app with OUTRANGUTAN_SNAPSHOT set to a folder. It saves a
/// picture of the control window there, presses GO a few times, saves more
/// pictures, writes what happened to test-log.txt, and quits. It never
/// runs in a normal launch.
enum TestSnapshot {
    static var isOn: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }

    static func runIfAsked(engine: Engine) {
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
            note("\(label): status=\(engine.status.rawValue) picture=\(engine.pictureCue?.name ?? "-") sound=\(engine.soundCue?.name ?? "-") standby=\(engine.standbyCue?.name ?? "-") clock=\(engine.remaining.map(Timecode.dropFrame) ?? "none") notice=\(engine.notice ?? "-")")
        }

        let steps: [(Double, () -> Void)] = [
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
        // Each step starts only after the one before it has finished, so a
        // slow first launch can never run the steps out of order.
        func run(_ index: Int) {
            guard index < steps.count else {
                try? log.joined(separator: "\n").write(to: dir.appendingPathComponent("test-log.txt"), atomically: true, encoding: .utf8)
                NSApp.terminate(nil)
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
}
