import AppKit
import Foundation
import OutrangutanCore

extension TestSnapshot {
    /// The "quietlist" test: the cue list's rows must hold still unless
    /// something they show changes. A list that is redrawn while a row is
    /// being dragged loses the drop, which is why cues could not be dragged
    /// into a new order while the clock redrew the window thirty times a
    /// second. This counts the redraws with nothing happening, then with a
    /// clip playing, then makes sure a real change still redraws the rows.
    @MainActor
    static func quietListSteps(engine: Engine, note: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        func verdict(_ ok: Bool) -> String { ok ? "PASS" : "FAIL" }
        var mark = 0
        var clock: Double?
        return [
            (0.5, {
                var cues = ["Alpha", "Bravo", "Charlie", "Delta"].enumerated().map { i, n in
                    Cue(name: n, path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: i))
                }
                cues.insert(Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 9)), at: 0)
                engine.replaceShow(cues: cues, pads: [], banks: [], multiTrigger: nil)
            }),
            // Let the pictures and lengths load, then watch three quiet seconds.
            (3.0, { mark = CueRowsCount.draws }),
            (3.0, {
                let more = CueRowsCount.draws - mark
                note("nothing happening for 3 seconds: the rows were redrawn \(more) times: \(verdict(more <= 1))")
                engine.go()
            }),
            (3.0, { mark = CueRowsCount.draws; clock = engine.remaining }),
            (3.0, {
                let more = CueRowsCount.draws - mark
                let moved = clock != nil && engine.remaining != nil && engine.remaining != clock
                note("a clip playing for 3 seconds: the clock ran (\(clock.map { String(format: "%.1f", $0) } ?? "-") to \(engine.remaining.map { String(format: "%.1f", $0) } ?? "-")): \(verdict(moved))")
                note("   and the rows were redrawn \(more) times: \(verdict(more <= 1))")
                mark = CueRowsCount.draws
                engine.move(ids: [engine.cues[4].id], by: -1)
            }),
            (1.0, {
                let more = CueRowsCount.draws - mark
                note("a cue moved up: " + engine.cues.map(\.name).joined(separator: " | ") + ", and the rows were redrawn (\(more)): \(verdict(more >= 1 && engine.cues[3].name == "Delta"))")
                engine.allStop()
            }),
        ]
    }
}
