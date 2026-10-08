import AppKit
import Foundation

extension TestSnapshot {
    /// The "cuekeys" test: a cue's hotkey fires it from anywhere, a pad
    /// with the same key wins, a show key still wins over both, the key
    /// rides in a show file, and Go to Cue finds cues by number and name.
    @MainActor
    static func cueKeySteps(engine: Engine, files: ShowFiles, dir: URL, note: @escaping (String) -> Void,
                            state: @escaping (String) -> Void) -> Steps {
        func press(_ code: UInt16, _ chars: String) {
            guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: 0, context: nil, characters: chars, charactersIgnoringModifiers: chars,
                                           isARepeat: false, keyCode: code) else { return }
            NSApp.postEvent(e, atStart: false)
        }
        return [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                let bars = Cue(name: "Open: bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                var still = Cue(name: "Title card", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                still.hotkey = "t"
                var applause = Cue(name: "Applause bed", path: media.appendingPathComponent("demo-applause.wav").path, kind: .audio, wireID: Cue.newWireID(offsetMs: 2))
                applause.hotkey = "q"      // the air horn pad has Q too: the pad wins
                var b2 = Cue(name: "Bars 4x3", path: media.appendingPathComponent("bars-4x3.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 3))
                b2.hotkey = "w"
                var horn = Pad(id: Pad.newID(), slot: 0, bank: "bk_1", name: "Air horn", path: media.appendingPathComponent("demo-airhorn.wav").path, key: "q")
                horn.emoji = "📯"
                engine.replaceShow(cues: [bars, still, applause, b2], pads: [horn], banks: [PadBank(id: "bk_1", name: "Bank 1")], multiTrigger: true)
                state("1 start")
                press(17, "t")   // T: the title card's hotkey
            }),
            (0.6, {
                state("2 after T")
                note("   title card on air by its key: \(engine.pictureCue?.name == "Title card" ? "PASS" : "FAIL"); standby still 1: \(engine.standbyCue?.name == "Open: bars" ? "PASS" : "FAIL")")
                press(12, "q")   // Q: the pad and a cue both want it
            }),
            (0.6, {
                note("3 after Q: pad sounding \(engine.pads.sounding.keys.count), sound cue \(engine.soundCue?.name ?? "-"): pad won \(engine.pads.sounding.count == 1 && engine.soundCue == nil ? "PASS" : "FAIL")")
                press(13, "w")   // W: a video cue's hotkey while a still is up
            }),
            (0.8, {
                state("4 after W")
                note("   bars 4x3 took over the picture: \(engine.pictureCue?.name == "Bars 4x3" ? "PASS" : "FAIL")")
                press(49, " ")   // Space is GO: a show key, never a hotkey
            }),
            (0.6, {
                state("5 after Space (GO fired cue 1)")
                note("   GO fired the standby: \(engine.pictureCue?.name == "Open: bars" ? "PASS" : "FAIL")")
                engine.allStop()
                // Go to Cue: by number, by a number's first digit, by words.
                let byNumber = GoToCueView.matches("3", in: engine.cues).map(\.name)
                let byWords = GoToCueView.matches("bars 4x3", in: engine.cues).map(\.name)
                let byPart = GoToCueView.matches("card", in: engine.cues).map(\.name)
                let none = GoToCueView.matches("zebra", in: engine.cues)
                note("6 go to cue: 3 -> \(byNumber) \(byNumber == ["Applause bed"] ? "PASS" : "FAIL"); 'bars 4x3' -> \(byWords) \(byWords == ["Bars 4x3"] ? "PASS" : "FAIL"); 'card' -> \(byPart) \(byPart == ["Title card"] ? "PASS" : "FAIL"); 'zebra' -> \(none.count) \(none.isEmpty ? "PASS" : "FAIL")")
            }),
            (0.3, {
                // The hotkey rides in a show file and comes back.
                let url = dir.appendingPathComponent("Keys.ogshow")
                Task { @MainActor in
                    let saved = await files.write(to: url)
                    engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
                    guard let payload = try? ShowFiles.readManifest(url) else { return note("7 could not read the file back") }
                    let opened = await files.load(url, payload: payload, mediaFolder: dir.appendingPathComponent("opened"))
                    let keys = engine.cues.map { $0.hotkey.isEmpty ? "-" : $0.hotkey }
                    note("7 saved \(saved), opened \(opened): hotkeys \(keys) \(keys == ["-", "t", "q", "w"] ? "PASS" : "FAIL")")
                }
            }),
            (3.0, { note("8 done") }),
        ]
    }
}
