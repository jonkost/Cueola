import AppKit
import SwiftUI
import VixelCore

/// Test mode, for checking the app without anyone at the keyboard.
///
/// Start the app with VIXEL_SNAPSHOT set to a folder:
///
///     VIXEL_SNAPSHOT=/path/to/folder build/Vixel.app/Contents/MacOS/Vixel
///
/// It opens the app in the background, adds a surface, drags its corners,
/// presses the arrow keys, shows the grid, plays a video, saves pictures of
/// the control window and the output into the folder, writes what happened
/// to test-log.txt, and quits. It keeps its own setup in that folder and
/// its own settings, so it never touches the real ones.
///
/// With VIXEL_HOLD=seconds as well, it uses the real on-screen picture,
/// brings Vixel to the front and steps through four states, holding each
/// that long, so the real windows can be photographed with screencapture
/// (see holdForPictures). Then it quits.
enum TestSnapshot {
    static let folder: URL? = ProcessInfo.processInfo.environment["VIXEL_SNAPSHOT"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    static var isOn: Bool { folder != nil }
    /// How long to stay open for real pictures, in seconds; nil for the
    /// usual run.
    static let hold: Double? = isOn ? ProcessInfo.processInfo.environment["VIXEL_HOLD"].flatMap(Double.init) : nil

    /// Test mode's own setup file, emptied at the start of every run.
    static let setupFile: URL? = {
        guard let folder else { return nil }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("setup.json")
        try? FileManager.default.removeItem(at: url)
        return url
    }()

    /// Test mode's own settings (Learn Mode and the like).
    static let defaults: UserDefaults? = isOn ? UserDefaults(suiteName: "live.cueola.vixel.test") : nil

    @MainActor
    static func run(stage: Stage, output: OutputController) {
        guard let dir = folder else { return }
        if let hold { return holdForPictures(stage: stage, output: output, seconds: hold) }
        var log: [String] = []
        var failures = 0
        // Saved after every note, so a crash mid-run keeps what came before.
        func note(_ line: String) {
            log.append(line)
            try? log.joined(separator: "\n").write(to: dir.appendingPathComponent("test-log.txt"), atomically: true, encoding: .utf8)
        }
        func check(_ ok: Bool, _ what: String) {
            if !ok { failures += 1 }
            note("   \(ok ? "PASS" : "FAIL") \(what)")
        }
        func save(_ image: CGImage?, _ name: String) {
            guard let image else { return note("   (no picture for \(name))") }
            let rep = NSBitmapImageRep(cgImage: image)
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(name))
        }
        // Pictures of the control window and the output, as they look now.
        func snap(_ name: String) {
            for window in NSApp.windows where window.isVisible {
                guard let view = window.contentView?.superview ?? window.contentView,
                      let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
                view.cacheDisplay(in: view.bounds, to: rep)
                let which = window.toolbar != nil ? "control" : (window === output.debugWindow ? "output" : "window")
                try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name)-\(which).png"))
            }
        }
        /// The output's picture drawn off screen at its real pixel size,
        /// exactly as the output draws it (without the editing marks).
        func render() -> RenderedPicture? {
            let px = stage.outputPixels
            return MapRenderer.shared?.picture(stage.drawLayers(width: px.width, height: px.height), width: Int(px.width), height: Int(px.height))
        }
        func press(_ code: UInt16, shift: Bool = false) {
            if let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: shift ? [.shift] : [], timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: 0, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: code) {
                NSApp.postEvent(e, atStart: false)
            }
        }
        func pixel(_ c: Corner) -> String {
            String(format: "%.0f, %.0f", c.x * stage.outputPixels.width, c.y * stage.outputPixels.height)
        }

        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
        let video = media.appendingPathComponent("bars-16x9.mp4")
        var first = "", second = ""
        var before: Corner?

        let steps: [(Double, () -> Void)] = [
            (0.8, {
                output.place()
            }),
            (0.8, {
                note("1 Vixel opens")
                note("   screens: " + output.screens.map { "\($0.name) \(Int($0.pixels.width))x\(Int($0.pixels.height))\($0.isControl ? " (control)" : "")" }.joined(separator: ", "))
                note("   output: \(output.fullScreenOn.map { "full screen on \($0)" } ?? (output.isOpen ? "a window" : "closed")), drawing at \(Int(stage.outputPixels.width)) x \(Int(stage.outputPixels.height)) pixels")
                if let win = output.debugWindow, let content = win.contentView {
                    let backing = content.convertToBacking(content.bounds).size
                    check(backing == stage.outputPixels, "the output draws at its real pixel size (\(Int(backing.width)) x \(Int(backing.height)))")
                }
                check(stage.setup.surfaces.isEmpty && stage.editing, "a new setup starts empty, in Edit")
                snap("1-start")
                stage.addSurface()
                first = stage.selectedSurface ?? ""
            }),
            (0.5, {
                guard let s = stage.setup.surface(first) else { return note("FAIL no surface was added") }
                note("2 Add Surface: \(s.name), corners \(s.output.joined(separator: " ")), shows \(s.content.kind.rawValue)")
                check(stage.selectedSurface == first && stage.editing, "the new surface is picked and Edit is on")
                // Drag its corners onto a wall seen from the left.
                let spots = [Point2(0.14, 0.14), Point2(0.56, 0.22), Point2(0.55, 0.80), Point2(0.12, 0.88)]
                for (id, p) in zip(s.output, spots) { stage.moveCorner(id, to: p) }
                stage.selectedCorner = s.output[0]
                before = stage.setup.corner(s.output[0])
                press(124)                // right arrow: 1 pixel
                press(125, shift: true)   // Shift-down arrow: 10 pixels
            }),
            (0.5, {
                guard let start = before, let now = stage.setup.corner(start.id) else { return note("FAIL no corner") }
                let dx = (now.x - start.x) * stage.outputPixels.width, dy = (now.y - start.y) * stage.outputPixels.height
                note("3 Arrow keys on the top left corner: \(pixel(start)) to \(pixel(now))")
                check(abs(dx - 1) < 0.01 && abs(dy - 10) < 0.01, "right moved it 1 pixel and Shift-down 10 (moved \(String(format: "%.2f", dx)), \(String(format: "%.2f", dy)))")
                snap("2-grid")
                save(render()?.image, "2-grid-output-pixels.png")

                // The warp lands each corner where it was put: with the
                // surface solid white, a pixel just inside each corner is
                // white and one just outside is black.
                guard let s = stage.setup.surface(first), let shape = stage.setup.outputShape(s) else { return }
                stage.setContent(first, SurfaceContent(kind: .color, color: "#FFFFFF"))
                guard let pic = render() else { return note("FAIL nothing drawn") }
                check(pic.width == Int(stage.outputPixels.width) && pic.height == Int(stage.outputPixels.height),
                      "the picture is \(pic.width) x \(pic.height), the output's own pixels")
                let w = stage.outputPixels.width, h = stage.outputPixels.height
                let middle = Quad.diagonalCrossing(shape) ?? Point2(0.5, 0.5)
                for (i, corner) in shape.enumerated() {
                    let c = Point2(corner.x * w, corner.y * h), m = Point2(middle.x * w, middle.y * h)
                    let toward = (m - c) * (1 / c.distance(to: m))
                    let inside = c + toward * 4, outside = c - toward * 4
                    let a = pic.rgb(Int(inside.x), Int(inside.y)), b = pic.rgb(Int(outside.x), Int(outside.y))
                    check(a.r > 240 && a.g > 240 && a.b > 240 && b.r < 10 && b.g < 10 && b.b < 10,
                          "corner \(i + 1) lands at \(Int(c.x)), \(Int(c.y)): inside \(a), outside \(b)")
                }
                let far = pic.rgb(Int(w) - 5, 5)
                check(far.r == 0 && far.g == 0 && far.b == 0, "outside every surface is black")
                stage.setContent(first, SurfaceContent(kind: .grid))
            }),
            (0.3, {
                // Every test pattern, drawn at the output's pixel size.
                for kind in [SurfaceContent.Kind.crosshair, .bars] {
                    stage.setContent(first, SurfaceContent(kind: kind))
                    save(render()?.image, "pattern-\(kind.rawValue).png")
                }
                stage.setContent(first, SurfaceContent(kind: .color, color: "#FF8800"))
                if let pic = render(), let s = stage.setup.surface(first), let shape = stage.setup.outputShape(s), let m = Quad.diagonalCrossing(shape) {
                    let c = pic.rgb(Int(m.x * stage.outputPixels.width), Int(m.y * stage.outputPixels.height))
                    check(c.r == 255 && abs(c.g - 136) <= 1 && c.b == 0, "a solid color shows exactly as picked (#FF8800 reads \(c))")
                    save(pic.image, "pattern-color.png")
                }
                stage.setContent(first, SurfaceContent(kind: .grid))

                stage.addSurface()
                second = stage.selectedSurface ?? ""
                guard let s = stage.setup.surface(second) else { return }
                let spots = [Point2(0.64, 0.18), Point2(0.90, 0.12), Point2(0.92, 0.86), Point2(0.66, 0.80)]
                for (id, p) in zip(s.output, spots) { stage.moveCorner(id, to: p) }
                note("4 A second surface, \(s.name), with a video: \(video.lastPathComponent)")
                check(FileManager.default.fileExists(atPath: video.path), "the test video is there")
                stage.setVideo(video, for: second)
            }),
            (2.0, {
                let playing = stage.videos.source(video.path)?.hasFrame ?? false
                check(playing, "the video is playing into the picture")
                if let pic = render(), let s = stage.setup.surface(second), let shape = stage.setup.outputShape(s), let m = Quad.diagonalCrossing(shape) {
                    let c = pic.rgb(Int(m.x * stage.outputPixels.width), Int(m.y * stage.outputPixels.height))
                    check(c.r + c.g + c.b > 60, "the video's picture is on the surface (middle reads \(c))")
                    save(pic.image, "3-video-output-pixels.png")
                }
                snap("3-video")
                stage.gridOnAll = true
            }),
            (0.5, {
                note("5 Grid on All")
                check(stage.drawLayers(width: 100, height: 100).allSatisfy { $0.uniforms.info.x == PictureCode.grid.rawValue }, "every surface shows the grid")
                snap("4-grid-on-all")
                stage.gridOnAll = false
                stage.editing = false
            }),
            (0.5, {
                note("6 Edit off: the output is clean, ready for the show")
                snap("5-show")
                defaults?.set(false, forKey: "learnMode")
            }),
            (0.5, {
                note("7 Learn Mode off: no info icons")
                snap("6-learn-off")
                defaults?.set(true, forKey: "learnMode")
                picture(InfoCard(term: Terms.surface), to: dir.appendingPathComponent("info-surface.png"))
                picture(InfoCard(term: Terms.keystone), to: dir.appendingPathComponent("info-keystone.png"))
            }),
            (0.8, {
                note("8 Quit and reopen")
                stage.saveNow()
                let file = stage.file
                check(SetupFile.read(from: file) == stage.setup, "the saved file reads back the same")
                let again = Stage(file: file)
                check(again.setup == stage.setup, "a fresh start finds every surface where it was left")
                check(!again.editing, "with surfaces already there, it opens with Edit off (the wall is clean)")
                let text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
                check(text.contains("\"version\" : 1"), "the file has its version number")
                note(failures == 0 ? "ALL PASS" : "\(failures) FAILED")
            }),
        ]

        // Each step starts only after the one before it has finished.
        func run(_ index: Int) {
            guard index < steps.count else { exit(failures == 0 ? 0 : 1) }
            let (wait, step) = steps[index]
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                step()
                run(index + 1)
            }
        }
        run(0)
    }

    /// The real windows, held in four states six seconds apart, for
    /// photographing from outside: the empty start, two surfaces with a
    /// corner picked, the video surface picked, then the show (Edit off,
    /// Learn Mode off). Each state's start is written to test-log.txt.
    @MainActor
    static func holdForPictures(stage: Stage, output: OutputController, seconds: Double) {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
        var log: [String] = []
        func note(_ line: String) {
            log.append(String(format: "%.1f ", ProcessInfo.processInfo.systemUptime) + line)
            if let dir = folder { try? log.joined(separator: "\n").write(to: dir.appendingPathComponent("test-log.txt"), atomically: true, encoding: .utf8) }
        }
        NSApp.activate(ignoringOtherApps: true)
        output.place()
        defaults?.set(true, forKey: "learnMode")
        note("a empty")
        var wall = "", flat = ""
        let states: [() -> Void] = [
            {
                stage.addSurface()
                wall = stage.selectedSurface ?? ""
                stage.rename(wall, to: "Back wall")
                stage.addSurface()
                flat = stage.selectedSurface ?? ""
                stage.rename(flat, to: "Flat")
                stage.setVideo(media.appendingPathComponent("bars-16x9.mp4"), for: flat)
                let spots: [String: [Point2]] = [
                    wall: [Point2(0.14, 0.14), Point2(0.56, 0.22), Point2(0.55, 0.80), Point2(0.12, 0.88)],
                    flat: [Point2(0.64, 0.18), Point2(0.90, 0.12), Point2(0.92, 0.86), Point2(0.66, 0.80)],
                ]
                for (id, points) in spots {
                    guard let s = stage.setup.surface(id) else { continue }
                    for (c, p) in zip(s.output, points) { stage.moveCorner(c, to: p) }
                }
                stage.selectedSurface = wall
                stage.selectedCorner = stage.setup.surface(wall)?.output[1]
                note("b two surfaces, a corner picked")
            },
            {
                stage.selectedSurface = flat
                note("c the video surface picked")
            },
            {
                stage.editing = false
                defaults?.set(false, forKey: "learnMode")
                note("d the show: Edit off, Learn Mode off")
            },
        ]
        for (i, state) in states.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds * Double(i + 1)) { state() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds * Double(states.count + 1)) {
            defaults?.set(true, forKey: "learnMode")
            exit(0)
        }
    }

    /// A picture of one view on its own, for looking at the design.
    @MainActor
    static func picture<V: View>(_ view: V, to url: URL) {
        let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
        host.frame.size = host.fittingSize
        let win = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        win.appearance = NSAppearance(named: .darkAqua)
        win.contentView = host
        win.orderBack(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: url)
            }
            win.orderOut(nil)
        }
    }
}
