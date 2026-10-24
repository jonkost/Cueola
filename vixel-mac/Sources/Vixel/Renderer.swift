import AppKit
import Metal
import QuartzCore
import simd
import VixelCore

/// One surface, in the form the graphics card reads (the `Layer` in
/// Shaders.swift, number for number).
struct LayerUniforms {
    var toSquare: simd_float3x3
    var toPicture: simd_float3x3
    var color: SIMD4<Float>
    var info: SIMD4<Float>
}

/// One surface, ready to draw: its numbers, and the video frame if it
/// shows one.
struct DrawLayer {
    var uniforms: LayerUniforms
    var texture: MTLTexture?
}

/// What each kind of picture is called on the graphics card.
enum PictureCode: Float {
    case grid = 0, crosshair, bars, color, video, black
}

/// Draws the surfaces with Metal. One for the whole app: the output and
/// the preview in the control window both draw through it.
final class MapRenderer {
    static let shared = MapRenderer()

    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    /// Bound when a surface shows no video, so the card always has a picture.
    private let empty: MTLTexture

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
        do {
            let library = try device.makeLibrary(source: Shaders.source, options: nil)
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = library.makeFunction(name: "coverAll")
            d.fragmentFunction = library.makeFunction(name: "drawSurface")
            let color = d.colorAttachments[0]!
            color.pixelFormat = .bgra8Unorm
            // A surface covers whatever is under it; its soft edge mixes in.
            color.isBlendingEnabled = true
            color.sourceRGBBlendFactor = .one
            color.sourceAlphaBlendFactor = .one
            color.destinationRGBBlendFactor = .oneMinusSourceAlpha
            color.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            pipeline = try device.makeRenderPipelineState(descriptor: d)
        } catch {
            FileHandle.standardError.write("Vixel: the graphics card could not set up the picture: \(error)\n".data(using: .utf8)!)
            return nil
        }
        let s = MTLSamplerDescriptor()
        s.minFilter = .linear
        s.magFilter = .linear
        s.sAddressMode = .clampToEdge
        s.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: s) else { return nil }
        let t = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: 1, height: 1, mipmapped: false)
        guard let empty = device.makeTexture(descriptor: t) else { return nil }
        var black: UInt32 = 0xFF00_0000
        empty.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &black, bytesPerRow: 4)
        self.device = device
        self.queue = queue
        self.sampler = sampler
        self.empty = empty
    }

    /// Draws one frame into a view's drawable: black, then each surface.
    func draw(_ layers: [DrawLayer], pass: MTLRenderPassDescriptor, drawable: MTLDrawable) {
        guard let buffer = queue.makeCommandBuffer() else { return }
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        encode(layers, into: encoder)
        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
    }

    private func encode(_ layers: [DrawLayer], into encoder: MTLRenderCommandEncoder) {
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentSamplerState(sampler, index: 0)
        for layer in layers {
            var u = layer.uniforms
            encoder.setFragmentBytes(&u, length: MemoryLayout<LayerUniforms>.stride, index: 0)
            encoder.setFragmentTexture(layer.texture ?? empty, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        }
    }

    /// Draws one frame off screen and hands back its pixels, the same way
    /// the output draws it. For test mode and its pictures.
    func picture(_ layers: [DrawLayer], width: Int, height: Int) -> RenderedPicture? {
        guard width > 0, height > 0 else { return nil }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .managed
        guard let target = device.makeTexture(descriptor: d), let buffer = queue.makeCommandBuffer() else { return nil }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = target
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return nil }
        encode(layers, into: encoder)
        encoder.endEncoding()
        if let blit = buffer.makeBlitCommandEncoder() {
            blit.synchronize(resource: target)
            blit.endEncoding()
        }
        buffer.commit()
        buffer.waitUntilCompleted()
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        target.getBytes(&bytes, bytesPerRow: width * 4, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        return RenderedPicture(width: width, height: height, bgra: bytes)
    }
}

/// A frame drawn off screen: its pixels, blue-green-red-alpha, top row first.
struct RenderedPicture {
    let width: Int
    let height: Int
    let bgra: [UInt8]

    /// Red, green and blue at one pixel, 0 to 255.
    func rgb(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int) {
        let i = (min(max(y, 0), height - 1) * width + min(max(x, 0), width - 1)) * 4
        return (Int(bgra[i + 2]), Int(bgra[i + 1]), Int(bgra[i]))
    }

    var image: CGImage? {
        let info = CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)
        guard let provider = CGDataProvider(data: Data(bgra) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info, provider: provider,
                       decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}

extension Homography {
    /// The same warp in the graphics card's form (single precision, column
    /// by column), scaled so its biggest number is 1. Scaling a warp does
    /// not change where it sends anything.
    var metal: simd_float3x3 {
        let big = m.map(abs).max() ?? 1
        let k = big > 0 ? 1 / big : 1
        let f = m.map { Float($0 * k) }
        return simd_float3x3(columns: (SIMD3(f[0], f[3], f[6]), SIMD3(f[1], f[4], f[7]), SIMD3(f[2], f[5], f[8])))
    }
}

extension NSColor {
    /// "#RRGGBB" to a color.
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = Int(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                  blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    var hexString: String {
        let c = usingColorSpace(.sRGB) ?? self
        return String(format: "#%02X%02X%02X", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
    }
}
