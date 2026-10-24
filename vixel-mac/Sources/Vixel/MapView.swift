import AppKit
import MetalKit
import SwiftUI

/// Which picture a map view is: the real output, or the small copy in the
/// control window.
enum MapRole {
    case output, preview
}

/// The picture, drawn by the graphics card at the view's real pixel size,
/// every time the screen refreshes.
final class MapView: MTKView, MTKViewDelegate {
    private let stage: Stage
    let role: MapRole

    init(stage: Stage, role: MapRole) {
        self.stage = stage
        self.role = role
        super.init(frame: .zero, device: MapRenderer.shared?.device)
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        // No color matching: the projector gets exactly the pixels Vixel draws.
        (layer as? CAMetalLayer)?.colorspace = nil
        preferredFramesPerSecond = 60
        delegate = self
    }

    required init(coder: NSCoder) { fatalError("not used") }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        if role == .output { stage.outputDrew(at: size) }
    }

    func draw(in view: MTKView) {
        guard let renderer = MapRenderer.shared, let pass = currentRenderPassDescriptor, let drawable = currentDrawable else { return }
        let size = drawableSize
        if role == .output { stage.outputDrew(at: size) }
        renderer.draw(stage.drawLayers(width: size.width, height: size.height), pass: pass, drawable: drawable)
    }
}

/// Test mode's stand-in for MapView. Window pictures cannot read what the
/// graphics card puts straight on screen, so this one draws the same frame
/// off screen, through the same renderer, and paints it like any view.
final class TestMapView: NSView {
    private let stage: Stage
    let role: MapRole
    private var timer: Timer?

    init(stage: Stage, role: MapRole) {
        self.stage = stage
        self.role = role
        super.init(frame: .zero)
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.needsDisplay = true }
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    deinit { timer?.invalidate() }

    override var isOpaque: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let pixels = convertToBacking(bounds).size
        if role == .output { stage.outputDrew(at: pixels) }
        let layers = stage.drawLayers(width: pixels.width, height: pixels.height)
        guard let picture = MapRenderer.shared?.picture(layers, width: Int(pixels.width), height: Int(pixels.height)),
              let image = picture.image,
              let context = NSGraphicsContext.current?.cgContext else { return }
        context.draw(image, in: bounds)
    }
}

/// Makes the right map view for this launch.
@MainActor
func makeMapView(stage: Stage, role: MapRole) -> NSView {
    // Holding for real pictures uses the real on-screen picture.
    TestSnapshot.isOn && TestSnapshot.hold == nil ? TestMapView(stage: stage, role: role) : MapView(stage: stage, role: role)
}

/// The map view inside SwiftUI, for the preview in the control window.
struct MapPicture: NSViewRepresentable {
    let stage: Stage
    let role: MapRole

    func makeNSView(context: Context) -> NSView { makeMapView(stage: stage, role: role) }
    func updateNSView(_ view: NSView, context: Context) {}
}
