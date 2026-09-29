import Foundation

/// The math behind the waveform and the vectorscope, in HD video's own
/// color terms (Rec. 709), the same as a broadcast scope.
///
/// - Waveform: for each column of the picture, how many pixels sit at each
///   brightness, from black (0) at the bottom to white (255) at the top.
/// - Vectorscope: where each pixel's color sits on the color wheel. The
///   middle is gray; the farther out, the stronger the color.
public enum ScopeMath {
    /// Brightness (luma) of one pixel, 0 to 255.
    @inline(__always)
    public static func luma(_ r: Double, _ g: Double, _ b: Double) -> Double {
        0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /// Color difference of one pixel: (blue minus luma, red minus luma),
    /// each -128 to 127.
    @inline(__always)
    public static func chroma(_ r: Double, _ g: Double, _ b: Double) -> (cb: Double, cr: Double) {
        (-0.1146 * r - 0.3854 * g + 0.5 * b, 0.5 * r - 0.4542 * g - 0.0458 * b)
    }

    /// Counts for the waveform: `columns` wide, 256 tall, row 0 is black.
    /// `rgba` is width by height pixels, four bytes each.
    public static func waveform(rgba: [UInt8], width: Int, height: Int, columns: Int) -> [UInt32] {
        var counts = [UInt32](repeating: 0, count: columns * 256)
        guard width > 0, height > 0, rgba.count >= width * height * 4 else { return counts }
        rgba.withUnsafeBufferPointer { p in
            for y in 0..<height {
                var i = y * width * 4
                for x in 0..<width {
                    let l = Int(luma(Double(p[i]), Double(p[i + 1]), Double(p[i + 2])).rounded())
                    let c = x * columns / width
                    counts[min(255, max(0, l)) * columns + c] &+= 1
                    i += 4
                }
            }
        }
        return counts
    }

    /// Counts for the vectorscope: `size` by `size`, the middle is gray.
    /// Blue is to the right, red is up, like a broadcast scope.
    public static func vectorscope(rgba: [UInt8], width: Int, height: Int, size: Int) -> [UInt32] {
        var counts = [UInt32](repeating: 0, count: size * size)
        guard width > 0, height > 0, rgba.count >= width * height * 4 else { return counts }
        rgba.withUnsafeBufferPointer { p in
            for i in stride(from: 0, to: width * height * 4, by: 4) {
                let (x, y) = point(Double(p[i]), Double(p[i + 1]), Double(p[i + 2]), size: size)
                counts[y * size + x] &+= 1
            }
        }
        return counts
    }

    /// Where a color lands on a `size` by `size` vectorscope (row 0 at the top).
    public static func point(_ r: Double, _ g: Double, _ b: Double, size: Int) -> (x: Int, y: Int) {
        let (cb, cr) = chroma(r, g, b)
        let half = Double(size) / 2
        let x = Int((half + cb / 128 * half).rounded(.down))
        let y = Int((half - cr / 128 * half).rounded(.down))
        return (min(size - 1, max(0, x)), min(size - 1, max(0, y)))
    }

    /// The six color bar targets at 75 percent, for the vectorscope's boxes:
    /// red, magenta, blue, cyan, green, yellow.
    public static let barTargets: [(name: String, r: Double, g: Double, b: Double)] = [
        ("R", 191, 0, 0), ("MG", 191, 0, 191), ("B", 0, 0, 191),
        ("CY", 0, 191, 191), ("G", 0, 191, 0), ("YL", 191, 191, 0),
    ]
}
