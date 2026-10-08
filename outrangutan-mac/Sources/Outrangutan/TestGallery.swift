import AppKit
import Foundation
import SwiftUI

extension TestSnapshot {
    /// The "gallery" test: a picture of every screen that is not the
    /// control window, with a small show loaded, for looking at the design.
    @MainActor
    static func gallerySteps(engine: Engine, link: ShowLink, files: ShowFiles, midi: MidiInput, watch: WatchFolder,
                             dir: URL, note: @escaping (String) -> Void) -> Steps {
        [
            (0.5, {
                let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
                let bars = Cue(name: "Open: bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                let still = Cue(name: "Title card", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                func pad(_ n: Int, _ name: String, _ file: String, _ emoji: String) -> Pad {
                    var p = Pad(id: Pad.newID(offsetMs: n), slot: n, bank: "bk_1", name: name, path: media.appendingPathComponent(file).path, key: "\(n + 1)")
                    p.emoji = emoji
                    return p
                }
                engine.replaceShow(cues: [bars, still],
                                   pads: [pad(0, "Air horn", "demo-airhorn.wav", "📯"), pad(1, "Applause", "demo-applause.wav", "👏"),
                                          pad(2, "Rimshot", "demo-rimshot.wav", "🥁")],
                                   banks: [PadBank(id: "bk_1", name: "Show open"), PadBank(id: "bk_2", name: "Game")], multiTrigger: true)
                engine.pads.selectedPadID = engine.pads.pads[0].id
                let shots: [(String, AnyView, CGSize)] = [
                    ("sfx-board", AnyView(PadBoardView(board: engine.pads)), CGSize(width: 980, height: 620)),
                    ("sfx-inspector", AnyView(PadInspectorView(board: engine.pads)), CGSize(width: 340, height: 720)),
                    ("settings-general", AnyView(GeneralSettings(watch: watch)), CGSize(width: 560, height: 470)),
                    ("settings-outputs", AnyView(OutputSettings(engine: engine)), CGSize(width: 560, height: 470)),
                    ("settings-keys", AnyView(KeySettings(board: engine.pads)), CGSize(width: 560, height: 470)),
                    ("settings-midi", AnyView(MidiSettings(midi: midi, engine: engine)), CGSize(width: 560, height: 470)),
                    ("settings-obs", AnyView(ObsSettings(obs: ObsClient.shared)), CGSize(width: 560, height: 470)),
                    ("connect", AnyView(ConnectView(link: link)), CGSize(width: 460, height: 420)),
                    ("show-check", AnyView(ShowCheckView(engine: engine, link: link)), CGSize(width: 560, height: 560)),
                    ("show-log", AnyView(ShowLogView(log: engine.log) { "Gallery" }), CGSize(width: 720, height: 480)),
                    ("help", AnyView(HelpView()), CGSize(width: 860, height: 560)),
                    ("inspector-cue", AnyView(InspectorView(engine: engine)), CGSize(width: 340, height: 720)),
                ]
                for (name, view, size) in shots {
                    picture(view, size: size, to: dir.appendingPathComponent(name + ".png"))
                }
                note("pictured \(shots.count) screens")
            }),
            (2.0, { note("done") }),
        ]
    }
}
