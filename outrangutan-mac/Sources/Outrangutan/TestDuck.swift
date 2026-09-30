import Foundation

extension TestSnapshot {
    /// The "duck" test: a video's sound dips while a pad sounds, comes
    /// back once the pad ends, and stays put with ducking off.
    @MainActor
    static func duckSteps(engine: Engine, note: @escaping (String) -> Void) -> Steps {
        func level() -> String { String(format: "%.2f", engine.cueLevel) }
        return [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                let bars = Cue(name: "Bed", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                var horn = Pad(id: Pad.newID(), slot: 0, bank: "bk_1", name: "Air horn", path: media.appendingPathComponent("demo-airhorn.wav").path, key: "1")
                horn.emoji = "📯"
                engine.replaceShow(cues: [bars], pads: [horn], banks: [PadBank(id: "bk_1", name: "Bank 1")], multiTrigger: true)
                engine.audio.duckUnderPads = true
                engine.audio.duckDb = 12
                engine.go()
            }),
            (1.0, {
                note("1 bed playing, no pad: level \(level()) (1.00 expected): \(engine.cueLevel > 0.99 ? "PASS" : "FAIL")")
                engine.pads.fire(engine.pads.pads[0].id)
            }),
            (0.4, {
                let l = engine.cueLevel
                note("2 air horn sounding: level \(level()) (0.25 is 12 dB down): \(abs(l - 0.25) < 0.03 ? "PASS" : "FAIL")")
            }),
            (2.6, {
                note("3 pad over, a second later: level \(level()) (back to 1.00): \(engine.cueLevel > 0.99 ? "PASS" : "FAIL")")
                engine.audio.duckUnderPads = false
                engine.pads.fire(engine.pads.pads[0].id)
            }),
            (0.4, {
                note("4 ducking off, air horn sounding: level \(level()) (stays 1.00): \(engine.cueLevel > 0.99 ? "PASS" : "FAIL")")
                engine.audio.duckUnderPads = true
            }),
            (0.4, {
                note("5 ducking switched on mid-pad: level \(level()) (dips): \(engine.cueLevel < 0.3 ? "PASS" : "FAIL")")
                engine.allStop()
            }),
        ]
    }
}
