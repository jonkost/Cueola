import AppKit

/// Draws the Library's demo graphics: a lower third, a bug and an OTS box.
/// Each is 1920 by 1080 and see-through everywhere but the graphic itself,
/// so Outrangutan can put chroma green (or any color) behind it. No green
/// is used in the graphics, so a chroma key takes none of them away. The
/// edges are solid, with no soft shadow: a shadow over green keys badly.
enum LibraryArt {
    static let size = CGSize(width: 1920, height: 1080)

    private static let navy = NSColor(srgbRed: 0.05, green: 0.16, blue: 0.30, alpha: 1)
    private static let blue = NSColor(srgbRed: 0.09, green: 0.39, blue: 0.80, alpha: 1)
    private static let red = NSColor(srgbRed: 0.82, green: 0.12, blue: 0.24, alpha: 1)
    private static let gold = NSColor(srgbRed: 1.0, green: 0.72, blue: 0.11, alpha: 1)

    /// The graphic as a PNG file, or nil for a name the Library does not know.
    static func png(_ id: String) -> Data? {
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
                                  bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        defer { NSGraphicsContext.restoreGraphicsState() }
        switch id {
        case "lower-third": lowerThird()
        case "bug": bug()
        case "ots": ots(ctx)
        default: return nil
        }
        guard let image = ctx.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }

    /// Words, drawn so their middle sits on `midY`.
    private static func text(_ words: String, size: CGFloat, weight: NSFont.Weight, color: NSColor,
                             x: CGFloat, midY: CGFloat, centeredIn width: CGFloat? = nil, kern: CGFloat = 0) {
        let s = NSAttributedString(string: words, attributes: [
            .font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .kern: kern,
        ])
        let box = s.size()
        let left = width.map { x + ($0 - box.width) / 2 } ?? x
        s.draw(at: NSPoint(x: left, y: midY - box.height / 2))
    }

    /// A name and a title, low on the left, inside the title-safe area.
    private static func lowerThird() {
        red.setFill()
        NSRect(x: 150, y: 130, width: 24, height: 170).fill()
        NSColor.white.setFill()
        NSRect(x: 174, y: 204, width: 960, height: 96).fill()
        navy.setFill()
        NSRect(x: 174, y: 130, width: 760, height: 74).fill()
        text("Jordan Lee", size: 62, weight: .bold, color: navy, x: 208, midY: 252)
        text("Student Reporter", size: 38, weight: .semibold, color: .white, x: 208, midY: 167)
    }

    /// A small station mark in the lower right corner.
    private static func bug() {
        let box = NSRect(x: 1500, y: 108, width: 270, height: 108)
        navy.setFill()
        NSBezierPath(roundedRect: box, xRadius: 22, yRadius: 22).fill()
        NSColor.white.setStroke()
        let rim = NSBezierPath(roundedRect: box.insetBy(dx: 3, dy: 3), xRadius: 19, yRadius: 19)
        rim.lineWidth = 6
        rim.stroke()
        // A red disc with a white "play" mark.
        let center = NSPoint(x: box.minX + 58, y: box.midY)
        red.setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - 32, y: center.y - 32, width: 64, height: 64)).fill()
        let play = NSBezierPath()
        play.move(to: NSPoint(x: center.x - 10, y: center.y + 17))
        play.line(to: NSPoint(x: center.x - 10, y: center.y - 17))
        play.line(to: NSPoint(x: center.x + 19, y: center.y))
        play.close()
        NSColor.white.setFill()
        play.fill()
        text("CAMPUS", size: 30, weight: .heavy, color: .white, x: box.minX + 106, midY: box.midY + 19, kern: 1.5)
        text("NEWS", size: 30, weight: .heavy, color: gold, x: box.minX + 106, midY: box.midY - 19, kern: 1.5)
    }

    /// An over-the-shoulder box, upper right: a picture area and a title.
    private static func ots(_ ctx: CGContext) {
        let box = NSRect(x: 1150, y: 440, width: 620, height: 500)
        let strip: CGFloat = 96
        NSColor.white.setFill()
        NSBezierPath(roundedRect: box, xRadius: 26, yRadius: 26).fill()
        let inside = box.insetBy(dx: 10, dy: 10)
        ctx.saveGState()
        NSBezierPath(roundedRect: inside, xRadius: 17, yRadius: 17).addClip()
        NSGradient(starting: navy, ending: blue)?.draw(in: inside, angle: 90)
        red.setFill()
        NSRect(x: inside.minX, y: inside.minY, width: inside.width, height: strip).fill()
        ctx.restoreGState()
        text("WEATHER", size: 52, weight: .heavy, color: .white, x: inside.minX, midY: inside.minY + strip / 2,
             centeredIn: inside.width, kern: 3)
        let look = NSImage.SymbolConfiguration(pointSize: 210, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white, gold]))
        if let symbol = NSImage(systemSymbolName: "cloud.sun.fill", accessibilityDescription: nil)?.withSymbolConfiguration(look) {
            let s = symbol.size
            let mid = NSPoint(x: inside.midX, y: inside.minY + strip + (inside.height - strip) / 2)
            symbol.draw(in: NSRect(x: mid.x - s.width / 2, y: mid.y - s.height / 2, width: s.width, height: s.height))
        }
    }
}
