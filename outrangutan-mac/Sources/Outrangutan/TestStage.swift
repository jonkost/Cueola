import AppKit
import Foundation

extension TestSnapshot {
    /// The "stage" test: opens the control window (cues, and both panels)
    /// and the SFX board as real windows, behind everything, and holds
    /// them for ten seconds so a screen capture from the shell can show
    /// them with real glass. Writes nothing.
    @MainActor
    static func stageSteps(engine: Engine, link: ShowLink, files: ShowFiles, scopes: Scopes, note: @escaping (String) -> Void) -> Steps {
        [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                let bars = Cue(name: "Open: bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                var still = Cue(name: "Title card", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                still.preWait = 2; still.continueMode = .autoFollow; still.duration = 5; still.hotkey = "t"
                var applause = Cue(name: "Applause", path: media.appendingPathComponent("demo-applause.wav").path, kind: .audio, wireID: Cue.newWireID(offsetMs: 2))
                applause.loop = true; applause.label = .green
                var matte = Cue.matte(named: "Red matte", color: "#C8102E")
                matte.armed = false
                var b2 = Cue(name: "Bars 4x3, output 2", path: media.appendingPathComponent("bars-4x3.mp4").path, kind: .video, wireID: Cue.newWireID(offsetMs: 3))
                b2.output = 2; b2.xfade = 1
                func pad(_ n: Int, _ name: String, _ file: String, _ emoji: String) -> Pad {
                    var p = Pad(id: Pad.newID(offsetMs: n), slot: n, bank: "bk_1", name: name, path: media.appendingPathComponent(file).path, key: "\(n + 1)")
                    p.emoji = emoji
                    return p
                }
                engine.replaceShow(cues: [bars, still, applause, matte, b2],
                                   pads: [pad(0, "Air horn", "demo-airhorn.wav", "📯"), pad(1, "Applause", "demo-applause.wav", "👏"),
                                          pad(2, "Rimshot", "demo-rimshot.wav", "🥁"), pad(3, "Aww", "demo-aww.wav", "😢")],
                                   banks: [PadBank(id: "bk_1", name: "Show open")], multiTrigger: true)
                scopes.isOn = true
                engine.go()
            }),
            (1.5, {
                let cues = UserDefaults(suiteName: "live.cueola.outrangutan.test.stage.cues")!
                cues.set("cues", forKey: "ui.tab"); cues.set(true, forKey: "ui.inspector")
                stage(ControlView(engine: engine, link: link, files: files, scopes: scopes), size: CGSize(width: 1300, height: 860), title: "Stage Cues", store: cues)
                let both = UserDefaults(suiteName: "live.cueola.outrangutan.test.stage.both")!
                both.set("both", forKey: "ui.tab"); both.set("side", forKey: "ui.layout"); both.set(false, forKey: "ui.inspector")
                stage(ControlView(engine: engine, link: link, files: files, scopes: scopes), size: CGSize(width: 1300, height: 860), title: "Stage Both", store: both)
                stage(GoToCueView(engine: engine), size: CGSize(width: 460, height: 400), title: "Stage Go to Cue")
                stage(ShowCheckView(engine: engine, link: link), size: CGSize(width: 560, height: 560), title: "Stage Show Check")
                note("staged 4 windows")
            }),
            (10.0, { engine.allStop(); note("done") }),
        ]
    }
}
