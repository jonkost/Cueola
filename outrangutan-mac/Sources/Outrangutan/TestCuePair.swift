import AVFoundation
import Foundation

extension TestSnapshot {
    /// The "cuepair" test: cue sound on channels 3 and 4 goes through the
    /// cue sound engine, for a 44.1 kHz mono file, a 48 kHz stereo one and a
    /// video, through a pause, and back to channels 1 and 2 straight from
    /// the player.
    @MainActor
    static func cuePairSteps(engine: Engine, dir: URL, note: @escaping (String) -> Void) -> Steps {
        // Sound deck A and B are lanes 2 and 3; video deck A is lane 0.
        func tally(_ lane: Int) -> String {
            let t = engine.cueSound.lanes[lane].ring.tally
            let st = engine.cueSound.lanes[lane].ring.stamps
            return "in \(t.pushed) out \(t.delivered) dry \(t.dry) late \(t.late) stamp \(st.last) restarts \(st.restarts)"
        }
        func meter() -> String { String(format: "%.2f / %.2f", engine.cueMeter.left, engine.cueMeter.right) }
        /// Where in the file the lane's ring stands: frames handed out plus
        /// frames skipped to catch up.
        func place(_ lane: Int) -> Int {
            let t = engine.cueSound.lanes[lane].ring.tally
            return t.delivered + t.late
        }
        /// Where each lane's ring stood when its cue went, so the lag counts
        /// this cue's sound only, not every cue the lane ever played.
        var goneAt: [Int: Int] = [:]
        func markGo(_ lane: Int) { goneAt[lane] = place(lane) }
        /// How far the lane's sound is behind the player's own position, in
        /// milliseconds; below zero means ahead.
        func lagMs(_ lane: Int) -> Double {
            let out = Double(place(lane) - (goneAt[lane] ?? 0)) / 48000
            let at = engine.soundPosition(lane: lane) ?? 0
            return (at - out) * 1000
        }
        func lag(_ lane: Int) -> String { String(format: "lag %.0f ms", lagMs(lane)) }
        var pausedAt = 0
        var stoppedAt = 0
        var standbyAt = 0
        var lagBeforePause = 0.0
        return [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                // A 48 kHz stereo tone, which needs no resampling on the way.
                let toneURL = dir.appendingPathComponent("tone-48k.wav")
                if let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false),
                   let file = try? AVAudioFile(forWriting: toneURL, settings: fmt.settings, commonFormat: .pcmFormatFloat32, interleaved: false),
                   let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 48000 * 3) {
                    buf.frameLength = 48000 * 3
                    for i in 0..<Int(buf.frameLength) {
                        let v = Float(sin(Double(i) * 2 * .pi * 440 / 48000)) * 0.5
                        buf.floatChannelData![0][i] = v
                        buf.floatChannelData![1][i] = v * 0.5
                    }
                    try? file.write(from: buf)
                }
                let applause = Cue(name: "Applause", path: media.appendingPathComponent("demo-applause.wav").path, kind: .audio, wireID: Cue.newWireID())
                let tone = Cue(name: "Tone", path: toneURL.path, kind: .audio, wireID: Cue.newWireID(offsetMs: 1))
                let bars = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 2))
                let still = Cue(name: "Still", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 3))
                engine.replaceShow(cues: [applause, tone, bars, still], pads: [], banks: [], multiTrigger: nil)
                engine.audio.cueFirstChannel = 2
                note("a channels 3 and 4 picked: engine on=\(engine.cueSound.isOn) note=\(engine.cueSound.note)")
                markGo(2)
                engine.go()
            }),
            (0.5, {
                // The tone stands by on lane 3, loaded ahead: nothing of it
                // may go out the engine until GO.
                standbyAt = engine.cueSound.lanes[3].ring.tally.delivered
                note("a2 tone standing by: \(engine.preloadState); lane 3 level \(engine.cueSound.lanes[3].gain.outputVolume)")
            }),
            (0.5, {
                note("a3 half a second on, lane 3 handed out \(engine.cueSound.lanes[3].ring.tally.delivered - standbyAt) frames while the tone only stood by (must be 0)")
                note("b applause (44.1 kHz mono): \(engine.soundRoutes); lane 2 \(tally(2)) \(lag(2)); meter \(meter())")
                markGo(3)
                engine.go()
            }),
            (1.0, {
                lagBeforePause = lagMs(3)
                note("c tone (48 kHz stereo): \(engine.soundRoutes); lane 3 \(tally(3)) \(lag(3)); lane 2 now \(tally(2)); meter \(meter())")
                engine.togglePause()
            }),
            (0.6, {
                pausedAt = engine.cueSound.lanes[3].ring.tally.delivered
                note("d paused: \(engine.soundRoutes); lane 3 \(tally(3)) \(lag(3))")
            }),
            (0.6, {
                let now = engine.cueSound.lanes[3].ring.tally.delivered
                note("e still paused 0.6 s later: lane 3 handed out \(now - pausedAt) more frames; \(tally(3))")
                engine.togglePause()
            }),
            (0.6, {
                // After a resume the sound must sit where it sat before the
                // pause (within 15 ms), not a frame or two behind for good.
                let drift = lagMs(3) - lagBeforePause
                note("e2 resumed: \(engine.soundRoutes); lane 3 \(tally(3)) \(lag(3)); \(String(format: "%.0f", drift)) ms later than at c: \(abs(drift) <= 15 ? "PASS" : "FAIL")")
                markGo(0)
                engine.go()
            }),
            (1.0, {
                note("f bars video: \(engine.soundRoutes); lane 0 \(tally(0)) \(lag(0)); meter \(meter())")
                // Back to channels 1 and 2 while both play: their sound must
                // come out of the players again, at their level.
                engine.audio.cueFirstChannel = 0
                stoppedAt = engine.cueSound.lanes[0].ring.tally.delivered
                note("f2 pair changed to 1 and 2 mid-cue: engine on=\(engine.cueSound.isOn); \(engine.soundRoutes)")
            }),
            (0.5, {
                note("f3 half a second on: \(engine.soundRoutes); lane 0 handed out \(engine.cueSound.lanes[0].ring.tally.delivered - stoppedAt) more; meter \(meter())")
                engine.allStop()
                stoppedAt = engine.cueSound.lanes.map { $0.ring.tally.delivered }.reduce(0, +)
            }),
            (0.5, {
                let now = engine.cueSound.lanes.map { $0.ring.tally.delivered }.reduce(0, +)
                note("g after All Stop: waiting frames \(engine.cueSound.lanes.map { $0.ring.available }), handed out since \(now - stoppedAt)")
                // Pause pressed right after GO, before the listener is on:
                // the cue must park, not play under a PAUSED status.
                engine.audio.cueFirstChannel = 2
                engine.standbyID = engine.cues[0].id
                markGo(2)
                engine.go()
                engine.togglePause()
                note("h GO then Pause at once on the engine path: status=\(engine.status.rawValue)")
            }),
            (0.6, {
                note("h2 0.6 s later: status=\(engine.status.rawValue); \(engine.soundRoutes); lane 2 \(tally(2))")
                engine.togglePause()
            }),
            (0.6, {
                note("h3 resumed: status=\(engine.status.rawValue); \(engine.soundRoutes); lane 2 \(tally(2)) \(lag(2)); meter \(meter())")
                engine.allStop()
                engine.audio.cueFirstChannel = 0
                note("i channels 1 and 2 picked: engine on=\(engine.cueSound.isOn)")
                engine.standbyID = engine.cues[0].id
                engine.go()
            }),
            (0.8, {
                note("i2 applause again: \(engine.soundRoutes); lane 2 \(tally(2)); meter \(meter())")
                engine.allStop()
            }),
            (0.3, {
                // GO on a video the moment it is loaded ahead, before its
                // listener is on, then a still standing by: the load-ahead
                // for the still must not clear the deck that is on air.
                engine.audio.cueFirstChannel = 2
                engine.openOutput()
                engine.standbyID = engine.cues[2].id
                engine.preloadStandby()
                engine.go()
                note("j GO on a video before its listener is on: \(engine.soundRoutes)")
                engine.standbyID = engine.cues[3].id
                engine.preloadStandby()
                note("j2 a still standing by at once: loaded ahead: \(engine.preloadState)")
            }),
            (1.0, {
                note("j3 a second on: status=\(engine.status.rawValue) showing \(engine.outputsShowing()); \(engine.soundRoutes)")
                engine.allStop()
            }),
            (0.3, {
                // The Sound settings, with channels 3 and 4 picked on a Mac
                // whose speakers only have 1 and 2.
                engine.audio.cueFirstChannel = 2
                picture(SoundSettings(engine: engine), size: CGSize(width: 560, height: 470), to: dir.appendingPathComponent("sound-settings.png"))
            }),
            (1.0, { engine.audio.cueFirstChannel = 0 }),
        ]
    }
}
