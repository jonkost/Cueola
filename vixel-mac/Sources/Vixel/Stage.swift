import AppKit
import QuartzCore
import SwiftUI
import VixelCore

/// Everything on stage right now: the setup (saved), what is picked, and
/// the switches that only last while Vixel is open.
@MainActor
final class Stage: ObservableObject {
    /// The corners and surfaces. Every change saves itself a moment later.
    @Published private(set) var setup: Setup
    /// The surface picked in the list or the preview.
    @Published var selectedSurface: String? {
        didSet { if selectedSurface != oldValue { selectedCorner = nil } }
    }
    /// The corner picked for the arrow keys.
    @Published var selectedCorner: String?
    /// While on, the output shows every surface's outline, corners and name,
    /// and corners can be dragged.
    @Published var editing: Bool {
        didSet { if !editing { selectedCorner = nil } }
    }
    /// Puts the grid on every surface at once, for lining up.
    @Published var gridOnAll = false
    /// The output's size in real pixels, as it draws now.
    @Published var outputPixels: CGSize
    /// The surface waiting for "Delete?" to be answered.
    @Published var askingToDelete: String?
    /// Set when the setup could not be saved.
    @Published private(set) var saveProblem: String?

    let file: URL
    let videos = VideoLibrary()
    private var pendingSave: DispatchWorkItem?

    init(file: URL) {
        self.file = file
        let loaded = SetupFile.read(from: file) ?? Setup()
        setup = loaded
        // With surfaces already lined up, the wall starts clean, ready for
        // the show. A new setup starts in Edit.
        editing = loaded.surfaces.isEmpty
        selectedSurface = loaded.surfaces.last?.id
        outputPixels = Self.lastOutputPixels
        videos.keep(only: videoPaths)
    }

    // MARK: Changes

    /// Makes a change to the setup and saves it soon after.
    func change(_ body: (inout Setup) -> Void) {
        var next = setup
        body(&next)
        guard next != setup else { return }
        setup = next
        videos.keep(only: videoPaths)
        scheduleSave()
    }

    func addSurface() {
        var id = ""
        change { id = $0.addSurface() }
        selectedSurface = id
        editing = true
    }

    func deleteSurface(_ id: String) {
        let index = setup.surfaces.firstIndex { $0.id == id }
        change { $0.deleteSurface(id) }
        if selectedSurface == id {
            // Pick the neighbour, so Delete can be pressed again.
            let left = setup.surfaces
            selectedSurface = left.isEmpty ? nil : left[min(index ?? 0, left.count - 1)].id
        }
    }

    func moveCorner(_ id: String, to p: Point2) { change { $0.moveCorner(id, to: p) } }

    /// The arrow keys: the picked corner moves 1 pixel, or 10 with Shift.
    func nudgeSelectedCorner(dx: Double, dy: Double) -> Bool {
        guard editing, let id = selectedCorner, setup.corner(id) != nil else { return false }
        change { $0.nudgeCorner(id, dx: dx, dy: dy, width: outputPixels.width, height: outputPixels.height) }
        return true
    }

    func setContent(_ id: String, _ content: SurfaceContent) { change { $0.setContent(id, content) } }

    func rename(_ id: String, to name: String) { change { $0.rename(id, to: name) } }

    func setOutputScreen(_ name: String?) { change { $0.outputScreen = name } }

    /// A video file dropped or picked for a surface.
    func setVideo(_ url: URL, for id: String) {
        guard var content = setup.surface(id)?.content else { return }
        content.kind = .video
        content.video = url.path
        setContent(id, content)
    }

    private var videoPaths: Set<String> {
        Set(setup.surfaces.compactMap { $0.content.kind == .video ? $0.content.video : nil })
    }

    // MARK: Saving

    private func scheduleSave() {
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        pendingSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    /// Writes the setup now. Called a moment after every change, and when
    /// Vixel quits.
    func saveNow() {
        pendingSave?.cancel()
        pendingSave = nil
        do {
            try SetupFile.write(setup, to: file)
            saveProblem = nil
        } catch {
            saveProblem = "Not saved: \(error.localizedDescription)"
        }
    }

    // MARK: The output's size

    /// Remembered between launches, so the preview has the projector's shape
    /// even before the projector is plugged in.
    static var lastOutputPixels: CGSize {
        let d = TestSnapshot.defaults ?? .standard
        let w = d.double(forKey: "output.width"), h = d.double(forKey: "output.height")
        // Before any output has drawn: the classroom projector's shape.
        return w > 0 && h > 0 ? CGSize(width: w, height: h) : CGSize(width: 1920, height: 1200)
    }

    /// The output view reports the size it really draws at.
    func outputDrew(at size: CGSize) {
        guard size.width > 0, size.height > 0, size != outputPixels else { return }
        outputPixels = size
        let d = TestSnapshot.defaults ?? .standard
        d.set(Double(size.width), forKey: "output.width")
        d.set(Double(size.height), forKey: "output.height")
    }

    // MARK: Drawing

    /// The surfaces, ready for the graphics card, for a view this many
    /// pixels across. Lines and grid cells follow the output's own pixels,
    /// so the preview is the output in small.
    func drawLayers(width: Double, height: Double) -> [DrawLayer] {
        let out = outputPixels
        let outLine = max(2, (out.width / 960).rounded())
        let line = max(1, outLine * width / max(1, out.width))
        let now = CACurrentMediaTime()
        return setup.surfaces.compactMap { surface in
            guard let warp = setup.warp(surface, width: width, height: height),
                  let toSquare = warp.inverted,
                  let toPicture = Homography(from: Quad.unit, to: surface.input),
                  let shape = setup.outputShape(surface) else { return nil }
            let size = Quad.size(shape.map { Point2($0.x * out.width, $0.y * out.height) })
            let cells = Quad.gridCells(width: size.width, height: size.height)
            var code: PictureCode
            var texture: MTLTexture?
            switch gridOnAll ? .grid : surface.content.kind {
            case .grid: code = .grid
            case .crosshair: code = .crosshair
            case .bars: code = .bars
            case .color: code = .color
            case .video:
                texture = surface.content.video.flatMap { videos.source($0)?.texture(at: now) }
                code = texture == nil ? .black : .video
            }
            let c = (NSColor(hex: surface.content.color) ?? .white).usingColorSpace(.sRGB) ?? .white
            return DrawLayer(
                uniforms: LayerUniforms(
                    toSquare: toSquare.metal,
                    toPicture: toPicture.metal,
                    color: SIMD4(Float(c.redComponent), Float(c.greenComponent), Float(c.blueComponent), 1),
                    info: SIMD4(code.rawValue, Float(cells.columns), Float(cells.rows), Float(line))
                ),
                texture: texture
            )
        }
    }

    // MARK: Looking things up

    var selected: Surface? { selectedSurface.flatMap { setup.surface($0) } }

    /// The topmost surface under a point on the output (0 to 1 each way).
    func surface(at p: Point2) -> Surface? {
        setup.surfaces.last { setup.outputShape($0).map { Quad.contains($0, p) } ?? false }
    }
}
