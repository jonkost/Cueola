import AppKit
import Foundation

extension TestSnapshot {
    /// The "multiview" test: bars on air, a still on standby, the preview
    /// following the standby as it moves, a preview roll, and a picture of
    /// the window.
    @MainActor
    static func multiviewSteps(engine: Engine, dir: URL, note: @escaping (String) -> Void,
                               state: @escaping (String) -> Void) -> Steps {
        let preview = PreviewPlayer()
        return [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                var bars = Cue(name: "Open: bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                bars.trimIn = 10; bars.trimOut = 20
                let still = Cue(name: "Title card", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                let applause = Cue(name: "Applause", path: media.appendingPathComponent("demo-applause.wav").path, kind: .audio, wireID: Cue.newWireID(offsetMs: 2))
                let matte = Cue.matte(named: "Red matte", color: "#C8102E")
                var b2 = Cue(name: "Bars 4x3", path: media.appendingPathComponent("bars-4x3.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 3))
                b2.trimIn = 2; b2.trimOut = 5
                engine.replaceShow(cues: [bars, still, applause, matte, b2], pads: [], banks: [], multiTrigger: nil)
                preview.show(engine.standbyCue)
                note("1 before GO: preview \(preview.describe)")
                engine.go()
            }),
            (1.0, {
                state("2 bars on air, still on standby")
                preview.show(engine.standbyCue)
                note("   program box shows \(engine.multiviewProgram.visibleSlots.map { "\($0)" }); preview \(preview.describe)")
                picture(MultiviewView(engine: engine, preview: preview), size: CGSize(width: 1280, height: 720), to: dir.appendingPathComponent("multiview.png"))
            }),
            (1.0, {
                // Standby moves down the list: the preview follows.
                engine.standbyID = engine.cues[2].id
                preview.show(engine.standbyCue)
                note("3 standby on the sound cue: preview \(preview.describe)")
                engine.standbyID = engine.cues[3].id
                preview.show(engine.standbyCue)
                note("4 standby on the matte: preview \(preview.describe)")
                engine.standbyID = engine.cues[4].id
                preview.show(engine.standbyCue)
            }),
            (0.4, {
                note("5 standby on a trimmed video: preview \(preview.describe); parked at 2.0 s: \(preview.seconds == 2 ? "PASS" : "FAIL")")
                preview.toggleRoll()
            }),
            (1.2, {
                let t = preview.seconds
                note("6 rolling 1.2 s later: preview \(preview.describe); between 2 and 5 s: \(t > 2 && t < 5 ? "PASS" : "FAIL")")
                preview.toggleRoll()
            }),
            (0.3, {
                note("7 stopped: preview \(preview.describe); back at 2.0 s: \(preview.seconds == 2 ? "PASS" : "FAIL")")
                // A short clip with no trim out rolls round at the end of the file.
                engine.updateAll([engine.cues[4].id], "Trim") { $0.trimIn = 99; $0.trimOut = nil }
                preview.show(engine.standbyCue)
                preview.toggleRoll()
            }),
            (2.0, {
                let t = preview.seconds
                note("8 rolling from 99 s of a 100 s clip, 2 s later: preview \(preview.describe); went round (under 100 s, still rolling): \(t < 100 && preview.rolling ? "PASS" : "FAIL")")
                preview.toggleRoll()
                engine.allStop()
            }),
            (0.5, {
                state("9 after All Stop")
                note("   program box shows \(engine.multiviewProgram.visibleSlots.map { "\($0)" })")
            }),
        ]
    }
}
