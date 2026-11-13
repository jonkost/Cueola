import AppKit
import CoreImage
import Foundation
import OutrangutanCore
import SwiftUI

extension TestSnapshot {
    /// The "overlay" test: a video on air, then a see-through PNG (a lower
    /// third) fired over it. The video must keep playing under it with its
    /// own clock; the overlay comes off when fired again, when its length
    /// runs out, on Stop and on All Stop; it rides across a cut; and it
    /// comes back from a saved show file.
    @MainActor
    static func overlaySteps(engine: Engine, files: ShowFiles, scopes: Scopes, dir: URL, note: @escaping (String) -> Void,
                             snap: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../demo-media").standardized
        let showURL = dir.appendingPathComponent("Overlay Show.ogshow")
        let ctx = CIContext()
        func verdict(_ ok: Bool) -> String { ok ? "PASS" : "FAIL" }

        // Two see-through 16:9 pictures drawn here, so the repo needs no new
        // media: a magenta bar low on the left (a lower third; magenta
        // because the color bars under it have white and black there) and a
        // red box top right (a bug).
        func draw(_ name: String, _ color: NSColor, _ rect: NSRect) -> URL {
            let url = dir.appendingPathComponent(name)
            let size = NSSize(width: 1920, height: 1080)
            let image = NSImage(size: size)
            image.lockFocus()
            NSColor.clear.setFill(); NSRect(origin: .zero, size: size).fill()
            color.setFill(); rect.fill()
            image.unlockFocus()
            if let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
                try? rep.representation(using: .png, properties: [:])?.write(to: url)
            }
            return url
        }
        let thirdPNG = draw("lower-third-alpha.png", NSColor(srgbRed: 1, green: 0, blue: 1, alpha: 1), NSRect(x: 120, y: 120, width: 1200, height: 160))
        let bugPNG = draw("bug-alpha.png", .red, NSRect(x: 1600, y: 880, width: 200, height: 120))
        // Spots to read, as fractions from the top left.
        let inBar = (x: CGFloat(0.3), y: CGFloat(0.81)), inBug = (x: CGFloat(0.885), y: CGFloat(0.13))

        /// A spot in the program frame (what the scopes read), 0 to 255.
        func frame(_ at: (x: CGFloat, y: CGFloat)) -> (r: Int, g: Int, b: Int)? {
            guard let f = engine.programFrame(), let cg = ctx.createCGImage(f, from: f.extent) else { return nil }
            let rep = NSBitmapImageRep(cgImage: cg)
            guard let c = rep.colorAt(x: Int(at.x * CGFloat(rep.pixelsWide)), y: Int(at.y * CGFloat(rep.pixelsHigh)))?.usingColorSpace(.sRGB) else { return nil }
            return (Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
        }
        func saveFrame(_ name: String) {
            guard let f = engine.programFrame(), let cg = ctx.createCGImage(f, from: f.extent) else { return note("   (no program frame to save for \(name))") }
            try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(name + ".png"))
        }
        /// A spot on the real output window's layers. (A video frame does
        /// not draw into this kind of picture; the overlay layer does.)
        func output(_ at: (x: CGFloat, y: CGFloat)) -> (r: Int, g: Int, b: Int)? {
            guard let window = NSApp.windows.first(where: { $0.contentView is OutputView }), let view = window.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
            view.cacheDisplay(in: view.bounds, to: rep)
            guard let c = rep.colorAt(x: Int(at.x * CGFloat(rep.pixelsWide - 1)), y: Int(at.y * CGFloat(rep.pixelsHigh - 1)))?.usingColorSpace(.sRGB) else { return nil }
            return (Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
        }
        func text(_ p: (r: Int, g: Int, b: Int)?) -> String { p.map { "\($0.r),\($0.g),\($0.b)" } ?? "none" }
        func isBar(_ p: (r: Int, g: Int, b: Int)?) -> Bool { p.map { $0.r > 200 && $0.g < 80 && $0.b > 200 } ?? false }
        func isRed(_ p: (r: Int, g: Int, b: Int)?) -> Bool { p.map { $0.r > 200 && $0.g < 80 && $0.b < 80 } ?? false }
        func cue(_ name: String) -> Cue { engine.cues.first { $0.name == name }! }
        func outputView() -> OutputView? { NSApp.windows.compactMap { $0.contentView as? OutputView }.first }
        /// Where the overlay shows: the output, the control window's
        /// monitor and the Multiview program box.
        func where_() -> String {
            "output \(outputView()?.overlayShowing ?? "-"), monitor \(engine.monitor.overlayShowing ?? "-"), multiview \(engine.multiviewProgram.overlayShowing ?? "-")"
        }
        func everywhere(_ name: String?) -> Bool {
            outputView()?.overlayShowing == name && engine.monitor.overlayShowing == name && engine.multiviewProgram.overlayShowing == name
        }
        var clockBefore: Double = 0
        var firedAt = Date()
        var barUnder: (r: Int, g: Int, b: Int)?

        return [
            (1.0, {
                var bars = Cue(name: "Bars", path: media.appendingPathComponent("bars-16x9.mp4").path, kind: .video, wireID: Cue.newWireID())
                bars.trimIn = 5
                var third = Cue(name: "Lower third", path: thirdPNG.path, kind: .still, wireID: Cue.newWireID(offsetMs: 1))
                third.key.mode = .alpha; third.key.bg = "#00B140"; third.key.over = true
                var bug = Cue(name: "Bug", path: bugPNG.path, kind: .still, wireID: Cue.newWireID(offsetMs: 2))
                bug.key.mode = .alpha; bug.key.over = true; bug.duration = 2.0
                let card = Cue(name: "Card", path: media.appendingPathComponent("still-16x9.png").path, kind: .still, wireID: Cue.newWireID(offsetMs: 3))
                engine.replaceShow(cues: [bars, third, bug, card], pads: [], banks: [], multiTrigger: nil)
                scopes.isOn = true
                engine.openOutput()
                note("a the cues: " + engine.cues.map { "\($0.name)\($0.isOverlay ? " (overlay)" : "")" }.joined(separator: ", "))
                engine.go()
            }),
            (1.5, {
                barUnder = frame(inBar)
                clockBefore = engine.remaining ?? -1
                note("b the video is on air: picture \(engine.pictureCue?.name ?? "-"), status \(engine.status.rawValue), \(String(format: "%.2f", clockBefore)) s left; the frame where the bar will go reads \(text(barUnder))")
                saveFrame("ov-1-video-alone")
                // GO: the lower third is standing by.
                let r = engine.go()
                note("c GO on the lower third: \(r.ok ? "fired" : "refused")")
            }),
            (1.0, {
                let left = engine.remaining ?? -1
                let ran = clockBefore - left
                note("d one second later:")
                note("   picture cue is still \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "-"), status \(engine.status.rawValue): \(verdict(engine.pictureCue?.name == "Bars" && engine.overlayCue?.name == "Lower third" && engine.status == .playing))")
                note(String(format: "   the video clock went from %.2f to %.2f s left (%.2f s ran): %@", clockBefore, left, ran, verdict(ran > 0.7 && ran < 1.4)))
                note("   it shows on: \(where_()): \(verdict(everywhere("Lower third")))")
                let f = frame(inBar), o = output(inBar)
                note("   program frame inside the bar reads \(text(f)) (magenta): \(verdict(isBar(f)))")
                note("   the output window's own layers inside the bar read \(text(o)) (magenta): \(verdict(isBar(o)))")
                let top = frame((x: 0.5, y: 0.3))
                note("   program frame in the bars above reads \(text(top)) (the video, not magenta, not black): \(verdict(!isBar(top) && (top.map { $0.r + $0.g + $0.b > 60 } ?? false)))")
                saveFrame("ov-2-video-with-lower-third")
                snap("ov-2")
                // The Inspector's Picture tab for the lower third.
                let store = UserDefaults(suiteName: "live.cueola.outrangutan.test")!
                store.set("picture", forKey: "inspector.cueTab")
                engine.standbyID = cue("Lower third").id
                picture(InspectorView(engine: engine), size: CGSize(width: 340, height: 720), to: dir.appendingPathComponent("ov-inspector.png"), store: store)
            }),
            (1.0, {
                // Fired again: it comes off; the video stays.
                engine.fire(cue("Lower third"))
            }),
            (0.4, {
                let f = frame(inBar)
                note("e fired again: overlay \(engine.overlayCue?.name ?? "off"), picture \(engine.pictureCue?.name ?? "-"), shows on: \(where_()): \(verdict(engine.overlayCue == nil && engine.pictureCue?.name == "Bars" && everywhere(nil)))")
                note("   program frame where the bar was reads \(text(f)) (the video again, was \(text(barUnder)) before): \(verdict(!isBar(f)))")
                // With fades: 1.2 seconds up, 1.2 seconds down. (Long enough
                // that a busy Mac running the steps late still lands inside.)
                engine.update(cue("Lower third").id) { $0.fadeIn = 1.2; $0.fadeOut = 1.2 }
                engine.fire(cue("Lower third"))
                firedAt = Date()
            }),
            (0.4, {
                let level = outputView()?.debugOverlayOpacity ?? -1
                // Judged against the time that really passed: a busy Mac runs the steps late.
                let passed = Date().timeIntervalSince(firedAt), want = min(1, passed / 1.2)
                note(String(format: "f a 1.2 second fade in, %.2f s after GO: the overlay is at %.0f%% (should be near %.0f%%, part way up): %@", passed, level * 100, want * 100, verdict(level > 0.05 && level < 0.95 && abs(Double(level) - want) < 0.15)))
            }),
            (1.3, {
                let level = outputView()?.debugOverlayOpacity ?? -1
                note(String(format: "   after the fade: %.0f%%: %@", level * 100, verdict(level > 0.99)))
                engine.fire(cue("Lower third"))
                firedAt = Date()
            }),
            (0.4, {
                let level = outputView()?.debugOverlayOpacity ?? -1
                let passed = Date().timeIntervalSince(firedAt), want = max(0, 1 - passed / 1.2)
                note(String(format: "g fired again with a 1.2 second fade out, %.2f s later: %.0f%% (should be near %.0f%%, part way down), still listed as on: %@", passed, level * 100, want * 100, verdict(level > 0.02 && level < 0.98 && abs(Double(level) - want) < 0.15 && engine.overlayCue != nil)))
            }),
            (1.3, {
                note("   after the fade: overlay \(engine.overlayCue?.name ?? "off"): \(verdict(engine.overlayCue == nil && everywhere(nil)))")
                engine.update(cue("Lower third").id) { $0.fadeIn = 0; $0.fadeOut = 0 }
                // A timed overlay: the bug, 2 seconds.
                engine.fire(cue("Bug"))
            }),
            (0.5, {
                let f = frame(inBug)
                note("h the Bug, 2 s long, half a second in: \(engine.debugOverlay); program frame in the box reads \(text(f)) (red): \(verdict(engine.overlayCue?.name == "Bug" && isRed(f)))")
                saveFrame("ov-3-video-with-bug")
            }),
            (2.0, {
                note("   after its length ran out: overlay \(engine.overlayCue?.name ?? "off"), picture \(engine.pictureCue?.name ?? "-"): \(verdict(engine.overlayCue == nil && engine.pictureCue?.name == "Bars"))")
                // One overlay at a time: the second takes the first one's place.
                engine.fire(cue("Lower third"))
                engine.update(cue("Bug").id) { $0.duration = 0 }
                engine.fire(cue("Bug"))
            }),
            (0.4, {
                let bar = frame(inBar), box = frame(inBug)
                note("i the Bug fired while the lower third was on: overlay \(engine.overlayCue?.name ?? "off"); bar spot \(text(bar)) (not magenta), box spot \(text(box)) (red): \(verdict(engine.overlayCue?.name == "Bug" && !isBar(bar) && isRed(box)))")
                engine.fire(cue("Bug"))             // off
                engine.fire(cue("Lower third"))     // on
                // A cut under it: a still takes the picture.
                engine.fire(cue("Card"))
            }),
            (0.5, {
                let f = frame(inBar)
                note("j a still took the picture under the lower third: picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"), bar spot \(text(f)) (magenta): \(verdict(engine.pictureCue?.name == "Card" && engine.overlayCue?.name == "Lower third" && isBar(f)))")
                saveFrame("ov-4-rides-across-a-cut")
                // Stop: the picture fired last, so Stop takes the picture
                // and the overlay with it.
                engine.stop()
                note("k Stop (the picture fired last): picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"): \(verdict(engine.pictureCue == nil && engine.overlayCue == nil && everywhere(nil)))")
                // Stop when the overlay fired last: only the overlay goes.
                engine.fire(cue("Bars"))
                engine.fire(cue("Lower third"))
            }),
            (0.6, {
                engine.stop()
                note("l Stop (the overlay fired last): picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"): \(verdict(engine.pictureCue?.name == "Bars" && engine.overlayCue == nil))")
                // A paused show stays paused when an overlay comes on.
                engine.togglePause()
                engine.fire(cue("Lower third"))
                note("m the video paused, then the lower third fired: status \(engine.status.rawValue), overlay \(engine.overlayCue?.name ?? "off"): \(verdict(engine.status == .paused && engine.overlayCue?.name == "Lower third"))")
                engine.togglePause()
            }),
            (0.4, {
                // Switched to a color while it is on: no longer an overlay, it comes off.
                engine.update(cue("Lower third").id) { $0.key.over = false }
                note("n Background switched to a color while it was on: overlay \(engine.overlayCue?.name ?? "off"), picture \(engine.pictureCue?.name ?? "-"): \(verdict(engine.overlayCue == nil && engine.pictureCue?.name == "Bars"))")
                engine.update(cue("Lower third").id) { $0.key.over = true }
                engine.fire(cue("Lower third"))
                engine.allStop()
                note("o All Stop: picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"), shows on: \(where_()): \(verdict(engine.pictureCue == nil && engine.overlayCue == nil && everywhere(nil)))")
                // Nothing under it: the overlay stands over black.
                engine.fire(cue("Lower third"))
            }),
            (0.4, {
                let f = frame(inBar), dark = frame((x: 0.5, y: 0.3))
                note("p fired with nothing on air: overlay \(engine.overlayCue?.name ?? "off"), bar spot \(text(f)) (magenta), above it \(text(dark)) (black): \(verdict(isBar(f) && (dark.map { $0.r + $0.g + $0.b < 30 } ?? false)))")
                engine.allStop()
                // Save the show and open it again.
                Task { @MainActor in
                    let ok = await files.write(to: showURL)
                    note("q saved the show: \(verdict(ok))")
                    guard let payload = try? ShowFiles.readManifest(showURL),
                          let saved = (payload["show"] as? [String: Any])?["cues"] as? [[String: Any]] else { return note("   could not read the show file: FAIL") }
                    let third = saved.first { ($0["name"] as? String) == "Lower third" }
                    let key = third?["key"] as? [String: Any], mac = third?["mac"] as? [String: Any]
                    let mode = key?["mode"] as? String ?? "-", bg = key?["bg"] as? String ?? "-"
                    note("   in the file the lower third has key mode \(mode), background \(bg), and the Mac's own mark over = \(mac?["over"] as? Bool ?? false): \(verdict(mode == "alpha" && bg == "#00b140" && (mac?["over"] as? Bool) == true))")
                    note("   (the web app and older Macs read only the mode and the color, so there it stands on chroma green)")
                    let bars = saved.first { ($0["name"] as? String) == "Bars" }
                    note("   the video has no such mark: \(verdict(((bars?["mac"] as? [String: Any])?["over"]) == nil))")
                    engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
                    let opened = await files.load(showURL, payload: payload, mediaFolder: dir.appendingPathComponent("opened"))
                    let back = engine.cues.first { $0.name == "Lower third" }
                    note("r opened it again: \(verdict(opened)); cues \(engine.cues.map { "\($0.name)\($0.isOverlay ? " (overlay)" : "")" }.joined(separator: ", ")): \(verdict(back?.isOverlay == true && engine.cues.filter(\.isOverlay).count == 2))")
                }
            }),
            (4.0, {
                // And it still works after the round trip.
                engine.fire(cue("Bars"))
                engine.fire(cue("Lower third"))
            }),
            (1.2, {
                let f = frame(inBar)
                note("s after the round trip, the lower third over the video: picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"), bar spot \(text(f)) (magenta): \(verdict(engine.pictureCue?.name == "Bars" && engine.overlayCue?.name == "Lower third" && isBar(f)))")
                engine.allStop()
            }),
            (0.5, {
                // For the picture: the Library's own lower third over the video.
                guard let data = LibraryArt.png(LibraryGraphic.all[0].id) else { return note("t no Library lower third to draw: FAIL") }
                let url = dir.appendingPathComponent("library-\(LibraryGraphic.all[0].id).png")
                try? data.write(to: url)
                var real = Cue(name: LibraryGraphic.all[0].name, path: url.path, kind: .still, wireID: Cue.newWireID(offsetMs: 9))
                real.key.mode = .alpha; real.key.bg = BuiltInLibrary.chromaGreen; real.key.over = true
                engine.cues.append(real)
                engine.fire(cue("Bars"))
                engine.fire(cue(real.name))
            }),
            (1.2, {
                note("t the Library's \(LibraryGraphic.all[0].name) over the video: picture \(engine.pictureCue?.name ?? "-"), overlay \(engine.overlayCue?.name ?? "off"): \(verdict(engine.pictureCue?.name == "Bars" && engine.overlayCue?.name == LibraryGraphic.all[0].name))")
                saveFrame("ov-5-library-lower-third-over-video")
                snap("ov-5")
                engine.allStop()
            }),
            (0.3, {}),
        ]
    }
}
