import AVFoundation
import CoreImage
import AppKit

/// How a video cue is keyed, the same settings as the web app's Key section.
/// - chroma: pixels near the key color go away.
/// - luma: dark pixels go away (graphics on black).
/// - alpha: the file's own see-through parts (ProRes 4444 and the like).
/// What goes away is filled with the background color.
enum KeyMode: String, Codable, CaseIterable {
    case off, chroma, luma, alpha

    var label: String {
        switch self {
        case .off: return "Off"
        case .chroma: return "Chroma"
        case .luma: return "Luma"
        case .alpha: return "Alpha"
        }
    }
}

struct VideoKey: Codable, Equatable {
    var mode: KeyMode = .off
    var color = "#00B140"       // the key color, chroma only
    var sim: Double = 0.3       // how close to the key color counts as the key
    var smooth: Double = 0.1    // how soft the edge is
    var bg = "#000000"          // what shows where the key takes the picture away

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = (try? c.decode(KeyMode.self, forKey: .mode)) ?? .off
        color = (try? c.decode(String.self, forKey: .color)) ?? "#00B140"
        sim = (try? c.decode(Double.self, forKey: .sim)) ?? 0.3
        smooth = (try? c.decode(Double.self, forKey: .smooth)) ?? 0.1
        bg = (try? c.decode(String.self, forKey: .bg)) ?? "#000000"
    }
}

/// The key, applied to every frame on the graphics card at full resolution,
/// with Apple's own image filters. The settings live in a box, so changes in
/// the Inspector show on the very next frame, even on air.
///
/// Matches the web keyer: the distance and brightness are measured on the
/// picture as it looks (gamma-encoded), with a soft edge from `sim` to
/// `sim + smooth`.
final class Keyer {
    private let lock = NSLock()
    private var settings: VideoKey

    init(_ settings: VideoKey) { self.settings = settings }

    func update(_ new: VideoKey) {
        lock.lock(); settings = new; lock.unlock()
    }

    private var current: VideoKey {
        lock.lock(); defer { lock.unlock() }
        return settings
    }

    /// A video composition that runs the key on `asset`.
    func composition(for asset: AVAsset) -> AVVideoComposition {
        AVVideoComposition(asset: asset) { [weak self] request in
            let source = request.sourceImage.clampedToExtent()
            let out = self?.apply(source, extent: request.sourceImage.extent) ?? request.sourceImage
            request.finish(with: out.cropped(to: request.sourceImage.extent), context: nil)
        }
    }

    func apply(_ image: CIImage, extent: CGRect) -> CIImage {
        let k = current
        let bg = CIImage(color: CIColor(color: NSColor(hex: k.bg) ?? .black) ?? .black).cropped(to: extent)
        let mask: CIImage
        switch k.mode {
        case .off:
            return image
        case .alpha:
            return image.composited(over: bg)
        case .chroma:
            let key = NSColor(hex: k.color)?.usingColorSpace(.sRGB) ?? .green
            // |pixel - key| per channel, squared, summed, square root. The
            // difference is taken both ways and clamped, so it never needs a
            // negative number (some graphics paths cut those off).
            let seen = image.applyingFilter("CILinearToSRGBToneCurve")
            let over = seen.applyingFilter("CIColorMatrix", parameters: [
                "inputBiasVector": CIVector(x: -key.redComponent, y: -key.greenComponent, z: -key.blueComponent, w: 0),
            ]).applyingFilter("CIColorClamp")
            let under = seen.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: -1, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: -1, z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: -1, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: key.redComponent, y: key.greenComponent, z: key.blueComponent, w: 0),
            ]).applyingFilter("CIColorClamp")
            let diff = over.applyingFilter("CIColorMatrix", parameters: [
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            ]).applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: under])
                .applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                                                               "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1)])
            let squared = diff.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: diff])
            let sum = squared.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 1, y: 1, z: 1, w: 0), "inputGVector": CIVector(x: 1, y: 1, z: 1, w: 0),
                "inputBVector": CIVector(x: 1, y: 1, z: 1, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            ])
            let distance = sum.applyingFilter("CIGammaAdjust", parameters: ["inputPower": 0.5])
            mask = ramp(distance, from: k.sim, width: k.smooth)
        case .luma:
            let l = image.applyingFilter("CILinearToSRGBToneCurve").applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 0.299, y: 0.587, z: 0.114, w: 0), "inputGVector": CIVector(x: 0.299, y: 0.587, z: 0.114, w: 0),
                "inputBVector": CIVector(x: 0.299, y: 0.587, z: 0.114, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            ])
            mask = ramp(l, from: k.sim, width: k.smooth)
        }
        return image.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: bg, kCIInputMaskImageKey: mask])
    }

    /// 0 below `from`, 1 above `from + width`, a smooth step in between
    /// (the web keyer's smoothstep).
    private func ramp(_ image: CIImage, from: Double, width: Double) -> CIImage {
        let w = max(0.001, width)
        let linear = image.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 1 / w, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 1 / w, y: 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 1 / w, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            "inputBiasVector": CIVector(x: -from / w, y: -from / w, z: -from / w, w: 0),
        ]).applyingFilter("CIColorClamp")
        // t * t * (3 - 2t): the same soft edge as the web's smoothstep.
        let t2 = linear.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: linear])
        let threeMinus = linear.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: -2, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: -2, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: -2, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            "inputBiasVector": CIVector(x: 3, y: 3, z: 3, w: 0),
        ])
        return t2.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: threeMinus])
            .applyingFilter("CIColorClamp")
    }
}
