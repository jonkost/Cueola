import Foundation

/// Talking to an Elgato Stream Deck over USB, byte by byte. No screen and no
/// USB in here, so the tests can check every report against the numbers in
/// Elgato's HID papers (docs.elgato.com/streamdeck/hid) and the open
/// drivers (node-elgato-stream-deck, python-elgato-streamdeck).
///
/// The Mac hands over input reports WITH their report id as the first byte
/// (always 0x01 on a Stream Deck), and takes output and feature reports the
/// same way, so every offset here is the paper's own offset.
public enum StreamDeckProtocol {
    public static let elgatoVendorID = 0x0fd9

    /// How a key picture is handed over.
    public enum ImageFormat: Equatable { case jpeg, bmp }

    /// How key pictures are cut into USB reports.
    public enum PacketFormat: Equatable {
        /// The 2019-and-later decks: 1024-byte reports, an 8-byte header.
        case gen2
        /// The Mini: 1024-byte reports, a 16-byte header.
        case mini
        /// The 2017 original: 8191-byte reports, a 16-byte header.
        case original
    }

    /// The touch screen on a Stream Deck +.
    public struct Strip: Equatable {
        public var width: Int
        public var height: Int
        public var zones: Int
        /// The + XL wants its strip picture turned on its side (100 wide,
        /// 1200 tall) while the draw command keeps the upright numbers.
        public var encodeRotated: Bool
        public init(width: Int, height: Int, zones: Int, encodeRotated: Bool = false) {
            self.width = width; self.height = height; self.zones = zones; self.encodeRotated = encodeRotated
        }
    }

    public struct Model: Equatable {
        public var productID: Int
        public var name: String
        public var keys: Int
        public var columns: Int
        public var keyPixels: Int
        public var imageFormat: ImageFormat
        /// Turn the drawn picture this many degrees counterclockwise, then
        /// flip, before handing it over, so it reads upright on the key.
        public var rotation: Int
        public var flipX: Bool
        public var flipY: Bool
        public var packet: PacketFormat
        public var dials: Int
        public var strip: Strip?
        /// Where the key states start in a key report (the paper's offset).
        public var stateOffset: Int { packet == .gen2 ? 4 : 1 }
        public var rows: Int { (keys + columns - 1) / columns }
        /// True for a deck this app has never been tried on.
        public var untried: Bool

        public init(productID: Int, name: String, keys: Int, columns: Int, keyPixels: Int, imageFormat: ImageFormat,
                    rotation: Int, flipX: Bool, flipY: Bool, packet: PacketFormat, dials: Int = 0, strip: Strip? = nil, untried: Bool = false) {
            self.productID = productID; self.name = name; self.keys = keys; self.columns = columns; self.keyPixels = keyPixels
            self.imageFormat = imageFormat; self.rotation = rotation; self.flipX = flipX; self.flipY = flipY
            self.packet = packet; self.dials = dials; self.strip = strip; self.untried = untried
        }
    }

    /// Every deck this app knows, by Elgato's product number.
    public static let models: [Int: Model] = [
        0x0060: Model(productID: 0x0060, name: "Stream Deck (2017)", keys: 15, columns: 5, keyPixels: 72, imageFormat: .bmp,
                      rotation: 0, flipX: true, flipY: true, packet: .original, untried: true),
        0x0063: Model(productID: 0x0063, name: "Stream Deck Mini", keys: 6, columns: 3, keyPixels: 80, imageFormat: .bmp,
                      rotation: 90, flipX: false, flipY: true, packet: .mini, untried: true),
        0x0090: Model(productID: 0x0090, name: "Stream Deck Mini (MK.2)", keys: 6, columns: 3, keyPixels: 80, imageFormat: .bmp,
                      rotation: 90, flipX: false, flipY: true, packet: .mini, untried: true),
        0x006d: Model(productID: 0x006d, name: "Stream Deck (v2)", keys: 15, columns: 5, keyPixels: 72, imageFormat: .jpeg,
                      rotation: 0, flipX: true, flipY: true, packet: .gen2),
        0x0080: Model(productID: 0x0080, name: "Stream Deck MK.2", keys: 15, columns: 5, keyPixels: 72, imageFormat: .jpeg,
                      rotation: 0, flipX: true, flipY: true, packet: .gen2),
        0x006c: Model(productID: 0x006c, name: "Stream Deck XL", keys: 32, columns: 8, keyPixels: 96, imageFormat: .jpeg,
                      rotation: 0, flipX: true, flipY: true, packet: .gen2),
        0x008f: Model(productID: 0x008f, name: "Stream Deck XL (v2)", keys: 32, columns: 8, keyPixels: 96, imageFormat: .jpeg,
                      rotation: 0, flipX: true, flipY: true, packet: .gen2),
        0x0084: Model(productID: 0x0084, name: "Stream Deck +", keys: 8, columns: 4, keyPixels: 120, imageFormat: .jpeg,
                      rotation: 0, flipX: false, flipY: false, packet: .gen2, dials: 4,
                      strip: Strip(width: 800, height: 100, zones: 4)),
        0x00c6: Model(productID: 0x00c6, name: "Stream Deck + XL", keys: 36, columns: 9, keyPixels: 112, imageFormat: .jpeg,
                      rotation: 90, flipX: false, flipY: false, packet: .gen2, dials: 6,
                      strip: Strip(width: 1200, height: 100, zones: 6, encodeRotated: true), untried: true),
    ]

    public static func model(productID: Int) -> Model? { models[productID] }

    // MARK: What the deck sends

    public enum Input: Equatable {
        /// Every key, pressed or not, in order.
        case keys([Bool])
        /// Each dial's turn since the last report: clockwise is positive.
        case dialsTurned([Int])
        case dialsPressed([Bool])
        /// A touch on the strip: which zone, and a tap, a long press or a flick.
        case touch(zone: Int, gesture: String)
        case unknown
    }

    public static func parseInput(_ d: [UInt8], model: Model) -> Input {
        guard d.count >= 2 else { return .unknown }
        let command = model.packet == .gen2 ? d[1] : 0
        if command == 0x03 && model.dials > 0 {
            guard d.count > 4 else { return .unknown }
            let values = (0..<model.dials).map { i -> UInt8 in d.count > 5 + i ? d[5 + i] : 0 }
            if d[4] == 0x01 { return .dialsTurned(values.map { Int(Int8(bitPattern: $0)) }) }
            return .dialsPressed(values.map { $0 == 1 })
        }
        if command == 0x02, let strip = model.strip {
            guard d.count > 7 else { return .unknown }
            let gesture = d[4] == 2 ? "long" : (d[4] == 3 ? "flick" : "tap")
            let x = Int(d[6]) | (Int(d[7]) << 8)
            let zone = min(strip.zones - 1, max(0, x / max(1, strip.width / strip.zones)))
            return .touch(zone: zone, gesture: gesture)
        }
        let off = model.stateOffset
        return .keys((0..<model.keys).map { i in d.count > off + i && d[off + i] == 1 })
    }

    /// Which keys just went down and which just came up.
    public static func edges(from old: [Bool], to new: [Bool]) -> (downs: [Int], ups: [Int]) {
        var downs: [Int] = [], ups: [Int] = []
        for i in new.indices {
            let was = old.indices.contains(i) && old[i]
            if new[i] && !was { downs.append(i) } else if !new[i] && was { ups.append(i) }
        }
        return (downs, ups)
    }

    // MARK: What the Mac sends

    /// A key picture, cut into reports. Each report starts with its id.
    public static func keyImageReports(model: Model, key: Int, image: [UInt8]) -> [[UInt8]] {
        guard !image.isEmpty else { return [] }
        let size: Int, header: Int
        switch model.packet {
        case .gen2: size = 1024; header = 8
        case .mini: size = 1024; header = 16
        case .original: size = 8191; header = 16
        }
        let payloadMax = size - header
        var reports: [[UInt8]] = []
        var sent = 0, page = 0
        while sent < image.count {
            let len = min(payloadMax, image.count - sent)
            let last = sent + len >= image.count
            var r = [UInt8](repeating: 0, count: size)
            r[0] = 0x02
            switch model.packet {
            case .gen2:
                r[1] = 0x07; r[2] = UInt8(key & 0xff); r[3] = last ? 1 : 0
                r[4] = UInt8(len & 0xff); r[5] = UInt8((len >> 8) & 0xff)
                r[6] = UInt8(page & 0xff); r[7] = UInt8((page >> 8) & 0xff)
            case .mini:
                r[1] = 0x01; r[2] = UInt8(page & 0xff); r[3] = 0; r[4] = last ? 1 : 0; r[5] = UInt8((key + 1) & 0xff)
            case .original:
                r[1] = 0x01; r[2] = UInt8((page + 1) & 0xff); r[3] = 0; r[4] = last ? 1 : 0; r[5] = UInt8((key + 1) & 0xff)
            }
            r.replaceSubrange(header..<(header + len), with: image[sent..<(sent + len)])
            reports.append(r)
            sent += len; page += 1
        }
        return reports
    }

    /// A picture for a part of the strip (the whole strip when the region is
    /// left out), cut into reports.
    public static func stripImageReports(model: Model, image: [UInt8], x: Int = 0, y: Int = 0, width: Int? = nil, height: Int? = nil) -> [[UInt8]] {
        guard let strip = model.strip, !image.isEmpty else { return [] }
        let w = width ?? strip.width, h = height ?? strip.height
        let size = 1024, header = 16, payloadMax = size - header
        var reports: [[UInt8]] = []
        var sent = 0, index = 0
        func put16(_ r: inout [UInt8], _ at: Int, _ v: Int) { r[at] = UInt8(v & 0xff); r[at + 1] = UInt8((v >> 8) & 0xff) }
        while sent < image.count {
            let len = min(payloadMax, image.count - sent)
            let last = sent + len >= image.count
            var r = [UInt8](repeating: 0, count: size)
            r[0] = 0x02; r[1] = 0x0c
            put16(&r, 2, x); put16(&r, 4, y); put16(&r, 6, w); put16(&r, 8, h)
            r[10] = last ? 1 : 0
            put16(&r, 11, index); put16(&r, 13, len)
            r.replaceSubrange(header..<(header + len), with: image[sent..<(sent + len)])
            reports.append(r)
            sent += len; index += 1
        }
        return reports
    }

    /// The brightness feature report, 0 to 100.
    public static func brightnessReport(model: Model, percent: Int) -> [UInt8] {
        let pct = UInt8(min(100, max(0, percent)))
        if model.packet == .gen2 {
            var r = [UInt8](repeating: 0, count: 32)
            r[0] = 0x03; r[1] = 0x08; r[2] = pct
            return r
        }
        var r = [UInt8](repeating: 0, count: 17)
        r[0] = 0x05; r[1] = 0x55; r[2] = 0xaa; r[3] = 0xd1; r[4] = 0x01; r[5] = pct
        return r
    }

    /// The feature report that clears every key and the strip.
    public static func resetReport(model: Model) -> [UInt8] {
        if model.packet == .gen2 {
            var r = [UInt8](repeating: 0, count: 32)
            r[0] = 0x03; r[1] = 0x02
            return r
        }
        var r = [UInt8](repeating: 0, count: 17)
        r[0] = 0x0b; r[1] = 0x63
        return r
    }

    /// A 24-bit Windows bitmap of a square picture, bottom row first, as
    /// the 2017 deck and the Mini want it. `rgba` is top row first.
    public static func bmp(width: Int, height: Int, rgba: [UInt8]) -> [UInt8] {
        let rowBytes = (width * 3 + 3) / 4 * 4
        let pixelBytes = rowBytes * height
        var out = [UInt8](repeating: 0, count: 54 + pixelBytes)
        func put32(_ at: Int, _ v: Int) { for i in 0..<4 { out[at + i] = UInt8((v >> (8 * i)) & 0xff) } }
        func put16(_ at: Int, _ v: Int) { out[at] = UInt8(v & 0xff); out[at + 1] = UInt8((v >> 8) & 0xff) }
        out[0] = 0x42; out[1] = 0x4d                 // "BM"
        put32(2, out.count); put32(10, 54)
        put32(14, 40); put32(18, width); put32(22, height); put16(26, 1); put16(28, 24)
        put32(34, pixelBytes); put32(38, 2835); put32(42, 2835)
        for y in 0..<height {
            let src = (height - 1 - y) * width * 4
            let dst = 54 + y * rowBytes
            for x in 0..<width {
                out[dst + x * 3] = rgba[src + x * 4 + 2]       // blue
                out[dst + x * 3 + 1] = rgba[src + x * 4 + 1]   // green
                out[dst + x * 3 + 2] = rgba[src + x * 4]       // red
            }
        }
        return out
    }
}
