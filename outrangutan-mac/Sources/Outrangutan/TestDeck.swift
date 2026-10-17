import AppKit
import OutrangutanCore

/// A pretend Stream Deck: takes the app's reports like the real one, puts
/// the key pictures back together, and presses keys and turns dials.
final class FakeDeckTransport: DeckTransport {
    let productID: Int
    let serial = "TEST0001"
    var onInput: (([UInt8]) -> Void)?
    var onGone: (() -> Void)?
    private let lock = NSLock()
    private var partial: [Int: [UInt8]] = [:]
    private var stripPartial: [UInt8] = []
    private var _keyImages: [Int: [UInt8]] = [:]
    private var _stripImage: [UInt8] = []
    private var _features: [[UInt8]] = []
    private var _reports = 0

    init(productID: Int) { self.productID = productID }

    var model: StreamDeckProtocol.Model { StreamDeckProtocol.model(productID: productID)! }
    var keyImages: [Int: [UInt8]] { lock.lock(); defer { lock.unlock() }; return _keyImages }
    var stripImage: [UInt8] { lock.lock(); defer { lock.unlock() }; return _stripImage }
    var features: [[UInt8]] { lock.lock(); defer { lock.unlock() }; return _features }
    var reports: Int { lock.lock(); defer { lock.unlock() }; return _reports }

    func write(_ r: [UInt8]) {
        lock.lock(); defer { lock.unlock() }
        _reports += 1
        guard r.count > 16, r[0] == 0x02 else { return }
        if r[1] == 0x07 {
            let key = Int(r[2]), last = r[3] == 1, len = Int(r[4]) | (Int(r[5]) << 8)
            partial[key, default: []] += r[8..<min(r.count, 8 + len)]
            if last { _keyImages[key] = partial[key]; partial[key] = nil }
        } else if r[1] == 0x01 {
            // The Mini's and the 2017 deck's form.
            let key = Int(r[5]) - 1, last = r[4] == 1
            partial[key, default: []] += r[16...]
            if last { _keyImages[key] = partial[key]; partial[key] = nil }
        } else if r[1] == 0x0c {
            let last = r[10] == 1, len = Int(r[13]) | (Int(r[14]) << 8)
            stripPartial += r[16..<min(r.count, 16 + len)]
            if last { _stripImage = stripPartial; stripPartial = [] }
        }
    }

    func writeFeature(_ r: [UInt8]) { lock.lock(); _features.append(r); lock.unlock() }
    func close() {}

    /// Presses the keys (and lets go a moment later).
    func press(_ keys: [Int]) {
        func report(_ down: [Int]) -> [UInt8] {
            let m = model
            var d = [UInt8](repeating: 0, count: m.stateOffset + m.keys)
            d[0] = 0x01
            if m.packet == .gen2 { d[1] = 0x00; d[2] = UInt8(m.keys & 0xff) }
            for k in down { d[m.stateOffset + k] = 1 }
            return d
        }
        onInput?(report(keys))
        onInput?(report([]))
    }

    func turn(dial: Int, by ticks: Int) {
        var d = [UInt8](repeating: 0, count: 16)
        d[0] = 0x01; d[1] = 0x03; d[4] = 0x01; d[5 + dial] = UInt8(bitPattern: Int8(ticks))
        onInput?(d)
    }

    func pressDial(_ dial: Int) {
        var d = [UInt8](repeating: 0, count: 16)
        d[0] = 0x01; d[1] = 0x03; d[4] = 0x00; d[5 + dial] = 1
        onInput?(d)
        d[5 + dial] = 0
        onInput?(d)
    }

    /// Every key's picture laid out as the deck shows it, turned back the
    /// way a person sees it, for looking at the design.
    func sheet() -> NSImage {
        let m = model, px = m.keyPixels, gap = 8
        let w = m.columns * (px + gap) + gap, h = m.rows * (px + gap) + gap
        let sheet = NSImage(size: NSSize(width: w, height: h), flipped: true) { rect in
            NSColor.black.setFill(); rect.fill()
            for (key, bytes) in self.keyImages {
                guard let image = NSImage(data: Data(bytes)) else { continue }
                let col = key % m.columns, row = key / m.columns
                let box = NSRect(x: gap + col * (px + gap), y: gap + row * (px + gap), width: px, height: px)
                NSGraphicsContext.saveGraphicsState()
                let t = NSAffineTransform()
                t.translateX(by: box.midX, yBy: box.midY)
                // Undo what the deck wanted: the flips, then the turn.
                t.rotate(byDegrees: CGFloat(m.rotation))
                t.scaleX(by: m.flipX ? -1 : 1, yBy: m.flipY ? -1 : 1)
                t.concat()
                image.draw(in: NSRect(x: -box.width / 2, y: -box.height / 2, width: box.width, height: box.height),
                           from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                NSGraphicsContext.restoreGraphicsState()
            }
            return true
        }
        return sheet
    }
}

extension TestSnapshot {
    /// The "deck" test: a pretend XL, then a pretend Stream Deck +.
    @MainActor
    static func deckSteps(engine: Engine, dir: URL, note: @escaping (String) -> Void, state: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
        let deck = StreamDeckController(engine: engine)
        let xl = FakeDeckTransport(productID: 0x006c)
        let plus = FakeDeckTransport(productID: 0x0084)
        func save(_ image: NSImage, _ name: String) {
            guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return }
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent(name))
        }
        func faces(_ label: String) {
            let rows = stride(from: 0, to: deck.faces.count, by: deck.model?.columns ?? 8).map { start -> String in
                deck.faces[start..<min(deck.faces.count, start + (deck.model?.columns ?? 8))].map { f in
                    var s = f.label.isEmpty ? (f.emoji.isEmpty ? "\u{00b7}" : f.emoji + " " + f.label) : f.label
                    if !f.top.isEmpty { s = f.top + " " + s }
                    if f.rim == DeckFaces.colors.onAir { s += "*AIR" } else if f.rim == DeckFaces.colors.standby { s += "*SB" } else if !f.rim.isEmpty { s += "*ON" }
                    if f.lit { s += "!" }
                    return s
                }.joined(separator: " | ")
            }
            note(label + ":\n      " + rows.joined(separator: "\n      "))
        }
        return [
            (0.5, {
                var cues: [Cue] = []
                let names = ["1_Intro", "2_Miles 3rd", "3_Band Intro", "4_Uthor 3rd", "5_Question 1 Worm or Traffic", "6_Question 2",
                             "7_Question 3 Who would you hang with", "8_Bars and Tone", "9_Question 4 Water", "10_Full Band Laugh", "11_Credits",
                             "12_Extra", "13_Extra", "14_Extra", "15_Extra", "16_Extra", "17_Page two"]
                for (i, n) in names.enumerated() {
                    cues.append(Cue(name: n, path: media.appendingPathComponent(i % 2 == 0 ? "bars-16x9.mp4" : "still-16x9.png").path,
                                    kind: i % 2 == 0 ? .video : .still, wireID: Cue.newWireID(offsetMs: i)))
                }
                let bank = PadBank(id: "bk_1", name: "Bank 1")
                var pads: [Pad] = []
                for (i, (n, e, f)) in [("Applause", "👏", "demo-applause.wav"), ("Air horn", "📯", "demo-airhorn.wav"), ("Rimshot", "🥁", "demo-rimshot.wav"), ("Aww", "🥹", "demo-aww.wav")].enumerated() {
                    var p = Pad(id: Pad.newID(offsetMs: i), slot: i, bank: "bk_1", name: n, path: media.appendingPathComponent(f).path, key: "")
                    p.emoji = e
                    pads.append(p)
                }
                engine.replaceShow(cues: cues, pads: pads, banks: [bank], multiTrigger: true)
                engine.setGain(0.9)
                deck.attach(xl)
            }),
            (1.5, {
                note("a \(deck.modelName): \(deck.message)")
                note("   reset and brightness went first: " + xl.features.map { String(format: "%02x %02x %02x", $0[0], $0[1], $0[2]) }.joined(separator: ", "))
                note("   \(xl.keyImages.count) key pictures in \(xl.reports) reports; sizes \(xl.keyImages.values.map(\.count).min() ?? 0) to \(xl.keyImages.values.map(\.count).max() ?? 0) bytes")
                faces("b the keys at rest (standby is 1_Intro)")
                save(xl.sheet(), "deck-xl.png")
                xl.press([0])     // GO
            }),
            (0.8, {
                state("c GO pressed on the deck")
                faces("   keys now")
                save(xl.sheet(), "deck-xl-onair.png")
                xl.press([8 + 4])  // cue key 5 on row 2
            }),
            (0.8, {
                state("d cue key 5 pressed")
                xl.press([24])     // first pad
            }),
            (0.5, {
                note("e pad key pressed: sounding " + engine.pads.sounding.keys.compactMap { engine.pads.pad(id: $0)?.name }.joined(separator: ", "))
                xl.press([5, 5])   // VOL -
                xl.press([5])
                note("   VOL - twice: gain \(String(format: "%.2f", engine.masterGain))")
                xl.press([7])      // MUTE
                note("   MUTE: gain \(engine.masterGain)")
                xl.press([7])
                note("   MUTE again: gain \(String(format: "%.2f", engine.masterGain))")
                xl.press([4])      // ALL STOP
            }),
            (0.5, {
                state("f All Stop pressed")
                engine.standbyID = engine.cues[16].id
            }),
            (0.5, {
                faces("g standby on cue 17: the cue keys turn to page two")
                xl.press([8])      // first cue key on page two = cue 17
            }),
            (0.5, {
                state("h first cue key on page two")
                engine.allStop()
                deck.attach(plus)
            }),
            (1.5, {
                note("i \(deck.modelName): \(deck.message)")
                faces("   keys")
                save(plus.sheet(), "deck-plus.png")
                if let strip = NSImage(data: Data(plus.stripImage)) { save(strip, "deck-plus-strip.png") }
                note("   strip picture: \(plus.stripImage.count) bytes")
                plus.turn(dial: 0, by: 5)
                note("j dial 1 up five clicks: gain \(String(format: "%.2f", engine.masterGain))")
                plus.pressDial(0)
                note("   dial 1 pressed: gain \(engine.masterGain)")
                plus.pressDial(0)
                note("   pressed again: gain \(String(format: "%.2f", engine.masterGain))")
                plus.turn(dial: 1, by: 2)
                note("k dial 2 turned: standby \(engine.standbyCue?.name ?? "-")")
                plus.pressDial(1)
            }),
            (1.2, {
                state("l dial 2 pressed (GO)")
                if let strip = NSImage(data: Data(plus.stripImage)) { save(strip, "deck-plus-strip-onair.png") }
                engine.allStop()
            }),
        ]
    }
}
