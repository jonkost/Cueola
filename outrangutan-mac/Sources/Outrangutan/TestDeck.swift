import AppKit
import OutrangutanCore

/// A pretend Stream Deck: takes the app's reports like the real one, puts
/// the key pictures back together, and presses keys and turns dials.
///
/// It is as strict as the real deck. A report of the wrong size, a picture
/// for a key the deck does not have, a part out of order, a picture that
/// does not decode to the key's size, or anything sent after the deck was
/// closed is written down as a fault, so a test can say PASS or FAIL
/// instead of a person reading the numbers.
final class FakeDeckTransport: DeckTransport {
    let productID: Int
    let serial = "TEST0001"
    var onInput: (([UInt8]) -> Void)?
    var onGone: (() -> Void)?
    private let lock = NSLock()
    private var partial: [Int: [UInt8]] = [:]
    private var nextPart: [Int: Int] = [:]
    private var stripPartial: [UInt8] = []
    private var stripNextPart = 0
    private var _keyImages: [Int: [UInt8]] = [:]
    private var _stripImage: [UInt8] = []
    private var _features: [[UInt8]] = []
    private var _reports = 0
    private var _closed = false
    private var _sequence: [String] = []
    private var _faults: [String] = []
    private var _goodKeys = Set<Int>()
    private var _stripGood = false

    init(productID: Int) { self.productID = productID }

    var model: StreamDeckProtocol.Model { StreamDeckProtocol.model(productID: productID)! }
    var keyImages: [Int: [UInt8]] { lock.lock(); defer { lock.unlock() }; return _keyImages }
    var stripImage: [UInt8] { lock.lock(); defer { lock.unlock() }; return _stripImage }
    var features: [[UInt8]] { lock.lock(); defer { lock.unlock() }; return _features }
    var reports: Int { lock.lock(); defer { lock.unlock() }; return _reports }
    /// True once the app closed this deck: like the real one, it takes
    /// nothing after that.
    var closed: Bool { lock.lock(); defer { lock.unlock() }; return _closed }
    /// Everything the deck took, in order: "reset", "brightness", then
    /// "key 1", "key 2"... as each picture completes, and "strip".
    var sequence: [String] { lock.lock(); defer { lock.unlock() }; return _sequence }
    /// What the real deck would have refused or shown wrong.
    var faults: [String] { lock.lock(); defer { lock.unlock() }; return _faults }
    /// How many keys hold a picture that decodes to the key's size.
    var goodPictures: Int { lock.lock(); defer { lock.unlock() }; return _goodKeys.count }
    /// True once the strip holds a picture that decodes to the strip's size.
    var stripGood: Bool { lock.lock(); defer { lock.unlock() }; return _stripGood }

    private func fault(_ text: String) { _faults.append(text) }

    func write(_ r: [UInt8]) {
        lock.lock(); defer { lock.unlock() }
        guard !_closed else { fault("a report came after the deck was closed"); return }
        _reports += 1
        let m = model
        let size = m.packet == .original ? 8191 : 1024
        guard r.count == size else { fault("report \(_reports) is \(r.count) bytes, not \(size)"); return }
        guard r[0] == 0x02 else { fault(String(format: "report %d starts with %02x, not 02", _reports, r[0])); return }
        if r[1] == 0x07 && m.packet == .gen2 {
            let key = Int(r[2]), last = r[3] == 1, len = Int(r[4]) | (Int(r[5]) << 8), part = Int(r[6]) | (Int(r[7]) << 8)
            guard len > 0, len <= size - 8 else { fault("key \(key + 1) part \(part) says it holds \(len) bytes"); return }
            took(key: key, part: part, last: last, bytes: r[8..<(8 + len)])
        } else if r[1] == 0x01 && m.packet != .gen2 {
            // The Mini's and the 2017 deck's form: no length, the picture
            // fills the report, and the 2017 deck counts parts from 1.
            let key = StreamDeckProtocol.wireKey(Int(r[5]) - 1, model: m), last = r[4] == 1
            let part = m.packet == .mini ? Int(r[2]) : Int(r[2]) - 1
            took(key: key, part: part, last: last, bytes: r[16...])
        } else if r[1] == 0x0c, let strip = m.strip {
            let last = r[10] == 1, part = Int(r[11]) | (Int(r[12]) << 8), len = Int(r[13]) | (Int(r[14]) << 8)
            if part != stripNextPart { fault("strip part \(part) came when part \(stripNextPart) was due") }
            stripNextPart = part + 1
            guard len > 0, len <= size - 16 else { fault("strip part \(part) says it holds \(len) bytes"); return }
            stripPartial += r[16..<(16 + len)]
            if last {
                _stripImage = stripPartial; stripPartial = []; stripNextPart = 0
                let w = strip.encodeRotated ? strip.height : strip.width, h = strip.encodeRotated ? strip.width : strip.height
                _stripGood = decodes(_stripImage, name: "the strip", width: w, height: h)
                _sequence.append("strip")
            }
        } else {
            fault(String(format: "report %d is a kind this deck does not take: %02x", _reports, r[1]))
        }
    }

    /// One part of a key's picture.
    private func took(key: Int, part: Int, last: Bool, bytes: ArraySlice<UInt8>) {
        let m = model
        guard key >= 0, key < m.keys else { fault("a picture for key \(key + 1), but this deck has \(m.keys) keys"); return }
        let due = nextPart[key, default: 0]
        if part != due { fault("key \(key + 1): part \(part) came when part \(due) was due") }
        nextPart[key] = part + 1
        partial[key, default: []] += bytes
        guard last else { return }
        var image = partial[key] ?? []
        partial[key] = nil; nextPart[key] = nil
        if m.imageFormat == .bmp, image.count >= 6 {
            // The last report is padded; a bitmap says its own length.
            let n = Int(image[2]) | (Int(image[3]) << 8) | (Int(image[4]) << 16) | (Int(image[5]) << 24)
            if n <= image.count { image = Array(image.prefix(n)) }
        }
        _keyImages[key] = image
        _sequence.append("key \(key + 1)")
        if decodes(image, name: "key \(key + 1)", width: m.keyPixels, height: m.keyPixels) { _goodKeys.insert(key) } else { _goodKeys.remove(key) }
    }

    /// True when the bytes are a picture of this size, in the form this
    /// deck wants (a 24-bit bitmap with its rows counted, or a JPEG).
    private func decodes(_ bytes: [UInt8], name: String, width: Int, height: Int) -> Bool {
        if model.imageFormat == .bmp && !name.hasPrefix("the strip") {
            guard bytes.count >= 54, bytes[0] == 0x42, bytes[1] == 0x4d else { fault("\(name) is not a BMP"); return false }
            let rows = Int(bytes[22]) | (Int(bytes[23]) << 8), bits = Int(bytes[28]) | (Int(bytes[29]) << 8)
            guard rows == height, bits == 24 else { fault("\(name) BMP says \(rows) rows at \(bits) bits, not \(height) at 24"); return false }
        }
        guard let rep = NSBitmapImageRep(data: Data(bytes)) else { fault("\(name) does not decode as a picture"); return false }
        guard rep.pixelsWide == width, rep.pixelsHigh == height else {
            fault("\(name) is \(rep.pixelsWide)x\(rep.pixelsHigh), not \(width)x\(height)"); return false
        }
        return true
    }

    func writeFeature(_ r: [UInt8]) {
        lock.lock(); defer { lock.unlock() }
        guard !_closed else { fault("a feature report came after the deck was closed"); return }
        let want = model.packet == .gen2 ? 32 : 17
        if r.count != want { fault("feature report is \(r.count) bytes, not \(want)") }
        _features.append(r)
        let reset = StreamDeckProtocol.resetReport(model: model), bright = StreamDeckProtocol.brightnessReport(model: model, percent: 0)
        if r.count >= 2 && r[0] == reset[0] && r[1] == reset[1] { _sequence.append("reset") }
        else if r.count >= 2 && r[0] == bright[0] && r[1] == bright[1] { _sequence.append("brightness") }
        else { _sequence.append(String(format: "feature %02x", r.first ?? 0)) }
    }

    func close() {
        onInput = nil
        lock.lock(); _closed = true; lock.unlock()
    }

    /// Yanks the cable. The app hears the deck is gone, and the deck
    /// forgets everything it was shown, like a fresh one plugged in later.
    func unplug() {
        lock.lock()
        partial = [:]; nextPart = [:]; stripPartial = []; stripNextPart = 0
        _keyImages = [:]; _stripImage = []; _features = []; _reports = 0; _closed = false
        _sequence = []; _faults = []; _goodKeys = []; _stripGood = false
        lock.unlock()
        onInput = nil
        onGone?()
    }

    /// What the deck took last: "03 02" is the reset that darkens it.
    var lastFeature: String { features.last.map { String(format: "%02x %02x", $0[0], $0[1]) } ?? "-" }

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

    /// A finger on the strip: 1 is a tap, 2 a long press, 3 a flick.
    func touch(zone: Int, gesture: UInt8) {
        guard let strip = model.strip else { return }
        var d = [UInt8](repeating: 0, count: 16)
        d[0] = 0x01; d[1] = 0x02; d[4] = gesture
        let x = zone * (strip.width / strip.zones) + 10
        d[6] = UInt8(x & 0xff); d[7] = UInt8((x >> 8) & 0xff)
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
    /// The "deck" test: a pretend XL (unplugged and plugged back in along
    /// the way), then a pretend Stream Deck +, then a pretend Mini.
    @MainActor
    static func deckSteps(engine: Engine, dir: URL, note: @escaping (String) -> Void, state: @escaping (String) -> Void) -> Steps {
        let media = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../demo-media").standardized
        let deck = StreamDeckController(engine: engine)
        let xl = FakeDeckTransport(productID: 0x006c)
        let plus = FakeDeckTransport(productID: 0x0084)
        let mini = FakeDeckTransport(productID: 0x0063)
        weak var ghost: FakeDeckTransport?
        var wasOn = true
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
        /// Says PASS when the deck took a right-sized picture for every key
        /// (and the strip), reset then brightness came before any of them,
        /// and the deck found nothing to refuse.
        func judge(_ t: FakeDeckTransport, _ label: String) {
            let m = t.model, px = m.keyPixels
            let first = Array(t.sequence.prefix(2))
            let ok = t.goodPictures == m.keys && first == ["reset", "brightness"] && t.faults.isEmpty && (m.strip == nil || t.stripGood)
            var text = "\(label) \(t.goodPictures) of \(m.keys) pictures \(px)x\(px)" + (m.imageFormat == .bmp ? " BMP" : "")
            if let s = m.strip { text += ", strip \(s.width)x\(s.height) \(t.stripGood ? "ok" : "MISSING")" }
            text += ", \(first.isEmpty ? "nothing" : first.joined(separator: " then ")) first, \(t.faults.count) faults, \(t.reports) reports: \(ok ? "PASS" : "FAIL")"
            note(text)
            for f in t.faults.prefix(6) { note("   fault: " + f) }
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
                judge(xl, "b")
                faces("   the keys at rest (standby is 1_Intro)")
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
                // The USB hub hiccups: the only deck goes away (after what
                // was already on its way to it has landed).
                deck.writes.sync {}
                xl.unplug()
                let ok = deck.state == .looking && deck.message.contains("unplugged")
                note("i the XL unplugged: \(deck.state), \(deck.message): \(ok ? "PASS" : "FAIL")")
            }),
            (0.5, {
                // And comes back two seconds later: every key is drawn again.
                deck.attach(xl)
            }),
            (1.0, {
                judge(xl, "j the XL plugged back in:")
                let standby = deck.faces.count > 8 && deck.faces[8].rim == DeckFaces.colors.standby
                note("   standby rim back on cue 17's key: \(standby ? "PASS" : "FAIL")")
                deck.attach(plus)
            }),
            (1.5, {
                note("k \(deck.modelName): \(deck.message)")
                note("   the XL went dark when the + took over: its last feature report is \(xl.lastFeature) (03 02 = reset)")
                judge(plus, "   the +:")
                faces("   keys")
                save(plus.sheet(), "deck-plus.png")
                if let strip = NSImage(data: Data(plus.stripImage)) { save(strip, "deck-plus-strip.png") }
                // A press on the deck that was set aside must do nothing.
                xl.press([0])
                note("   GO on the dark XL: on air \(engine.pictureCue?.name ?? "nothing"): \(engine.pictureCue == nil ? "PASS" : "FAIL")")
                plus.turn(dial: 0, by: 5)
                note("l dial 1 up five clicks: gain \(String(format: "%.2f", engine.masterGain))")
                plus.pressDial(0)
                note("   dial 1 pressed: gain \(engine.masterGain)")
                plus.pressDial(0)
                note("   pressed again: gain \(String(format: "%.2f", engine.masterGain))")
                plus.turn(dial: 1, by: 2)
                note("m dial 2 turned: standby \(engine.standbyCue?.name ?? "-")")
                plus.pressDial(1)
            }),
            (1.2, {
                state("n dial 2 pressed (GO)")
                if let strip = NSImage(data: Data(plus.stripImage)) { save(strip, "deck-plus-strip-onair.png") }
                engine.allStop()
            }),
            (0.5, {
                plus.touch(zone: 1, gesture: 3)
                plus.touch(zone: 1, gesture: 2)
                plus.touch(zone: 0, gesture: 3)
                note("o a flick and a long press on the standby zone, a flick on VOL: on air \(engine.pictureCue?.name ?? "nothing"), gain \(String(format: "%.2f", engine.masterGain))")
                plus.touch(zone: 1, gesture: 1)
            }),
            (0.8, {
                state("p a tap on the standby zone (GO)")
                engine.allStop()
                // The Mini from the show rig: bitmaps turned on their side,
                // the older report form, six keys.
                deck.attach(mini)
            }),
            (1.5, {
                note("q \(deck.modelName): \(deck.message)")
                judge(mini, "   the Mini:")
                faces("   keys")
                save(mini.sheet(), "deck-mini.png")
                mini.press([0])    // GO
            }),
            (0.8, {
                state("r GO pressed on the Mini")
                mini.press([5])    // its one pad
            }),
            (0.5, {
                note("s pad key pressed on the Mini: sounding " + engine.pads.sounding.keys.compactMap { engine.pads.pad(id: $0)?.name }.joined(separator: ", "))
                engine.allStop()
                // A fourth deck plugged in takes over; unplugged, the XL (dark
                // and waiting all this time) takes over again, and nothing
                // holds on to the deck that left.
                do {
                    let third = FakeDeckTransport(productID: 0x0080)
                    deck.attach(third)
                    ghost = third
                    note("t a MK.2 plugged in: \(deck.modelName) drives; the Mini went dark: \(mini.lastFeature)")
                    deck.writes.sync {}
                    third.unplug()
                }
                plus.unplug()
                mini.unplug()
            }),
            (0.5, {
                note("u the MK.2, the + and the Mini unplugged: \(deck.modelName) drives again (\(deck.state)), \(deck.message)")
                note("   the deck that left is " + (ghost == nil ? "freed" : "STILL HELD"))
                judge(xl, "   the XL again:")
                wasOn = deck.enabled
                deck.enabled = false
            }),
            (0.5, {
                note("v deck off in Settings: \(deck.message)")
                note("   the XL's last report is \(xl.lastFeature) (03 02 = reset, dark), closed: \(xl.closed), faults after: \(xl.faults.count)")
                deck.enabled = wasOn
            }),
        ]
    }
}
