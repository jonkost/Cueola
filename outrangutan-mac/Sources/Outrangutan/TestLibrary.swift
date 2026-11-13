import AppKit
import AVFoundation
import Foundation
import OutrangutanCore
import SwiftUI

extension TestSnapshot {
    /// The "library" test: makes the built-in Library in the test's own
    /// folder, checks every sound and graphic, adds a sound to the SFX pads
    /// and a graphic to the cue list, puts the graphic on air on chroma
    /// green, saves the show to a file and opens it again, and takes
    /// pictures of the Library window's two tabs.
    @MainActor
    static func librarySteps(engine: Engine, files: ShowFiles, dir: URL, note: @escaping (String) -> Void,
                             snap: @escaping (String) -> Void) -> Steps {
        let library = BuiltInLibrary.shared
        let preview = LibraryPreview()
        let showURL = dir.appendingPathComponent("Library Show.ogshow")
        func verdict(_ ok: Bool) -> String { ok ? "PASS" : "FAIL" }
        func sound(_ id: String) -> LibrarySound { LibrarySounds.all.first { $0.id == id }! }
        func graphic(_ id: String) -> LibraryGraphic { LibraryGraphic.all.first { $0.id == id }! }
        /// The color of a spot on the output, as the screen shows it.
        func pixel(x: CGFloat, y: CGFloat) -> (r: Int, g: Int, b: Int)? {
            guard let window = NSApp.windows.first(where: { $0.contentView is OutputView }), let view = window.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
            view.cacheDisplay(in: view.bounds, to: rep)
            guard let c = rep.colorAt(x: Int(x * CGFloat(rep.pixelsWide - 1)), y: Int(y * CGFloat(rep.pixelsHigh - 1)))?.usingColorSpace(.sRGB) else { return nil }
            return (Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
        }
        var made = Date()
        return [
            (0.5, {
                BuiltInLibrary.testFolder = dir.appendingPathComponent("Library")
                try? FileManager.default.removeItem(at: BuiltInLibrary.folder)
                // The pads use the Mac's own speakers here (silently, like all
                // of test mode): a monitor's sound output that is asleep can
                // keep the sound engine from starting, and the test would hang.
                if let own = AudioDevices.outputs().first(where: { $0.name.hasSuffix("Speakers") }) {
                    engine.audio.padDevice = own.uid
                    note("  (pads routed to \(own.name) for this test)")
                }
                engine.replaceShow(cues: [], pads: [], banks: [PadBank(id: "bk_1", name: "Bank 1")], multiTrigger: true)
                made = Date()
                library.prepare { note(String(format: "a the Library was made in %.1f s: ready %@", Date().timeIntervalSince(made), library.ready ? "yes PASS" : "no FAIL (\(library.problem ?? "-"))")) }
            }),
            (6.0, {
                // Every sound: there, the right shape, not silent, not clipped.
                var bad: [String] = []
                var bytes = 0
                for s in LibrarySounds.all {
                    let url = library.url(for: s)
                    guard let file = try? AVAudioFile(forReading: url),
                          let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
                          (try? file.read(into: buffer)) != nil, let data = buffer.floatChannelData else { bad.append(s.name + " (unreadable)"); continue }
                    bytes += (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
                    var peak: Float = 0
                    var sum: Float = 0
                    let frames = Int(buffer.frameLength)
                    for i in 0..<frames { let v = data[0][i]; peak = max(peak, abs(v)); sum += v * v }
                    let rms = (sum / Float(max(1, frames))).squareRoot()
                    let seconds = Double(file.length) / file.processingFormat.sampleRate
                    let ok = file.processingFormat.sampleRate == 48_000 && file.processingFormat.channelCount == 2 && peak > 0.05 && peak <= 0.9 && rms > 0.003 && seconds > 0.2
                    note(String(format: "   %@ %@: %.2f s, peak %.2f, average %.3f%@", s.emoji, s.name, seconds, peak, rms, ok ? "" : "  FAIL"))
                    if !ok { bad.append(s.name) }
                }
                note("b \(LibrarySounds.all.count) sounds, \(bytes / 1024) KB in all, 48 kHz stereo, none silent, none clipped: \(verdict(bad.isEmpty))\(bad.isEmpty ? "" : " (" + bad.joined(separator: ", ") + ")")")
                // Every graphic: 1920 by 1080, see-through in a corner, solid somewhere.
                var art: [String] = []
                for g in LibraryGraphic.all {
                    guard let rep = NSBitmapImageRep(data: (try? Data(contentsOf: library.url(for: g))) ?? Data()) else { art.append(g.name + " (unreadable)"); continue }
                    var solid = 0
                    var greenish = 0
                    for y in stride(from: 0, to: rep.pixelsHigh, by: 6) {
                        for x in stride(from: 0, to: rep.pixelsWide, by: 6) {
                            guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB), c.alphaComponent > 0.5 else { continue }
                            solid += 1
                            if c.greenComponent > c.redComponent + 0.15 && c.greenComponent > c.blueComponent + 0.15 { greenish += 1 }
                        }
                    }
                    let corner = rep.colorAt(x: 4, y: 4)?.alphaComponent ?? 1
                    let ok = rep.pixelsWide == 1920 && rep.pixelsHigh == 1080 && corner == 0 && solid > 200 && greenish == 0
                    note("   \(g.name): \(rep.pixelsWide) by \(rep.pixelsHigh), corner alpha \(corner), solid spots \(solid), green spots \(greenish)\(ok ? "" : "  FAIL")")
                    if !ok { art.append(g.name) }
                    // The same picture on green, for looking at.
                    if let image = NSImage(contentsOf: library.url(for: g)) {
                        let on = NSImage(size: NSSize(width: 960, height: 540))
                        on.lockFocus()
                        (NSColor(hex: BuiltInLibrary.chromaGreen) ?? .green).setFill()
                        NSRect(x: 0, y: 0, width: 960, height: 540).fill()
                        image.draw(in: NSRect(x: 0, y: 0, width: 960, height: 540))
                        on.unlockFocus()
                        if let tiff = on.tiffRepresentation, let out = NSBitmapImageRep(data: tiff) {
                            try? out.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("graphic-\(g.id)-on-green.png"))
                        }
                    }
                }
                note("c \(LibraryGraphic.all.count) graphics, see-through outside the art, no green in the art: \(verdict(art.isEmpty))")
            }),
            (0.5, {
                // A sound onto the SFX pads.
                let s = sound("applause")
                let pad = engine.pads.addFromLibrary(url: library.url(for: s), name: s.name, emoji: s.emoji, loops: s.loops)
                let okPad = pad?.name == "Applause" && pad?.emoji == "👏" && pad?.slot == 0 && pad?.fileIsThere == true && pad?.loop == false && pad?.key == "1"
                note("e Applause to SFX: pad \(pad.map { "\($0.slot + 1), key \($0.key), \($0.emoji) \($0.name)" } ?? "none"): \(verdict(okPad))")
                let h = sound("heartbeat")
                let beat = engine.pads.addFromLibrary(url: library.url(for: h), name: h.name, emoji: h.emoji, loops: h.loops)
                note("f Heartbeat to SFX (made to loop): pad \(beat.map { "\($0.slot + 1)" } ?? "none"), loop \(beat?.loop == true), second hit stops \(beat?.retrigger == .toggle): \(verdict(beat?.slot == 1 && beat?.loop == true && beat?.retrigger == .toggle))")
                // A graphic and a sound onto the cue list.
                let g = graphic("lower-third")
                let cue = engine.addLibraryGraphic(g, at: library.url(for: g))
                let okCue = cue?.kind == .still && cue?.name == "Lower Third" && cue?.key.mode == .alpha && cue?.key.bg == "#00B140" && engine.standbyID == cue?.id
                note("g Lower Third to Cues: \(cue.map { "\($0.kind.rawValue), key \($0.key.mode.rawValue) over \($0.key.bg)" } ?? "none"), standing by \(engine.standbyID == cue?.id): \(verdict(okCue))")
                let d = sound("ding")
                let ding = engine.addLibrarySound(d, at: library.url(for: d))
                note("h Ding to Cues: \(ding.map { "\($0.kind.rawValue) \"\($0.name)\"" } ?? "none"), \(engine.cues.count) cues: \(verdict(ding?.kind == .audio && engine.cues.count == 2))")
                engine.standbyID = cue?.id
                engine.openOutput()
                engine.go()
            }),
            (1.5, {
                // The capture goes through the screen's color profile, so
                // green must simply win; the exact numbers move a little.
                let corner = pixel(x: 0.03, y: 0.05), name = pixel(x: 0.4, y: 0.765), bar = pixel(x: 0.085, y: 0.8)
                let green = corner.map { $0.g > $0.r + 60 && $0.g > $0.b + 60 } ?? false
                let white = name.map { $0.r > 215 && $0.g > 215 && $0.b > 215 } ?? false
                let red = bar.map { $0.r > $0.g + 80 && $0.r > $0.b + 60 } ?? false
                note("i Lower Third on air: corner \(corner.map { "\($0.r),\($0.g),\($0.b)" } ?? "?") (green) \(verdict(green)); name bar \(name.map { "\($0.r),\($0.g),\($0.b)" } ?? "?") (white) \(verdict(white)); accent \(bar.map { "\($0.r),\($0.g),\($0.b)" } ?? "?") (red) \(verdict(red))")
                snap("lib-on-air")
                engine.allStop()
                // Locked: nothing is added.
                engine.locked = true
                let g = graphic("bug")
                let refused = engine.addLibraryGraphic(g, at: library.url(for: g)) == nil && engine.cues.count == 2
                note("k editing locked: Bug refused, notice \"\(engine.notice ?? "-")\": \(verdict(refused && engine.notice == Engine.lockedNotice))")
                engine.locked = false
                // The bank holds twenty pads: the twenty-first is turned away.
                var count = engine.pads.pads.count
                var turnedAway = false
                for _ in 0..<3 {
                    for s in LibrarySounds.all {
                        if engine.pads.addFromLibrary(url: library.url(for: s), name: s.name, emoji: s.emoji, loops: false) == nil { turnedAway = true; break }
                        count += 1
                    }
                    if turnedAway { break }
                }
                note("l a full bank: \(count) pads, the next one turned away \(turnedAway), bank shows \(engine.pads.currentBank?.padCount ?? 0): \(verdict(count == PadBoard.padCountMax && turnedAway && engine.pads.currentBank?.padCount == PadBoard.padCountMax))")
                Task {
                    let ok = await files.write(to: showURL)
                    note("m saved to a show file: \(ok)")
                }
            }),
            (3.0, {
                engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
                Task {
                    guard let payload = try? ShowFiles.readManifest(showURL) else { return note("n could not read the show file: FAIL") }
                    let ok = await files.load(showURL, payload: payload, mediaFolder: dir.appendingPathComponent("opened"))
                    let third = engine.cues.first { $0.name == "Lower Third" }
                    let beat = engine.pads.pads.first { $0.name == "Heartbeat" && $0.slot == 1 }
                    let missing = engine.cues.filter { !$0.fileIsThere }.count + engine.pads.pads.filter { !$0.fileIsThere }.count
                    let away = !(third?.path.hasPrefix(BuiltInLibrary.folder.path) ?? true)
                    let good = ok && third?.kind == .still && third?.key.mode == .alpha && third?.key.bg.uppercased() == "#00B140"
                        && beat?.loop == true && beat?.retrigger == .toggle && beat?.emoji == "❤️" && missing == 0 && away
                        && engine.cues.count == 2 && engine.pads.pads.count == PadBoard.padCountMax
                    note("n opened again: \(engine.cues.count) cues, \(engine.pads.pads.count) pads, Lower Third key \(third?.key.mode.rawValue ?? "-") over \(third?.key.bg ?? "-"), Heartbeat loop \(beat?.loop == true), files missing \(missing), media now in the show's own folder \(away): \(verdict(good))")
                }
            }),
            (2.5, {
                let soundsStore = UserDefaults(suiteName: "live.cueola.outrangutan.test.library.sounds")!
                soundsStore.set("sounds", forKey: "library.tab")
                picture(LibraryView(engine: engine, startPicked: "applause"), size: CGSize(width: 700, height: 580),
                        to: dir.appendingPathComponent("library-sounds.png"), store: soundsStore)
                let artStore = UserDefaults(suiteName: "live.cueola.outrangutan.test.library.graphics")!
                artStore.set("graphics", forKey: "library.tab")
                picture(LibraryView(engine: engine, startPicked: "ots"), size: CGSize(width: 700, height: 580),
                        to: dir.appendingPathComponent("library-graphics.png"), store: artStore)
                picture(LibraryView(engine: engine, startPicked: "ots"), size: CGSize(width: 560, height: 440),
                        to: dir.appendingPathComponent("library-graphics-small.png"), store: artStore)
                picture(PadBoardView(board: engine.pads), size: CGSize(width: 980, height: 620), to: dir.appendingPathComponent("library-pads.png"))
                note("o pictured the Library: sounds, graphics, graphics at the smallest size, and the pads it filled")
            }),
            // The two checks that need the Mac's sound output come last, so a
            // sound device that will not start cannot hide the rest.
            (2.5, {
                let fired = engine.pads.pads.first { $0.name == "Applause" }.map { engine.pads.fire($0.id) }
                note("p the Applause pad plays: \(fired.map { "\($0)" } ?? "no pad")")
                engine.pads.stopAll()
            }),
            (1.0, {
                // Hear one (silently, in test mode), then stop it.
                let s = sound("applause")
                preview.toggle(s, at: library.url(for: s))
                let started = preview.playing == "applause"
                preview.toggle(s, at: library.url(for: s))
                note("q the play button: started \(started), then stopped \(preview.playing == nil): \(verdict(started && preview.playing == nil))")
            }),
            (1.5, { note("done") }),
        ]
    }
}
