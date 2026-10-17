import AppKit
import Combine
import IOKit.hid
import OutrangutanCore
import SwiftUI

/// A Stream Deck plugged into this Mac, driven by the app itself: no
/// browser, no Elgato software. GO, Pause, Stop, Fade and All Stop, the cues
/// and the pads on keys, and on a Stream Deck + a volume dial, a standby
/// dial and the clock on the strip.
///
/// One program at a time can hold a deck. Quit the Elgato Stream Deck app,
/// and leave the deck unconnected in KeyWi Bird on this Mac; the deck on
/// the other Mac keeps working through the cloud as before.

/// The wire to one deck: USB, or a pretend one in test mode.
protocol DeckTransport: AnyObject {
    var productID: Int { get }
    var serial: String { get }
    /// Called with every report the deck sends, report id first.
    var onInput: (([UInt8]) -> Void)? { get set }
    /// Called once when the deck is unplugged.
    var onGone: (() -> Void)? { get set }
    func write(_ report: [UInt8])
    func writeFeature(_ report: [UInt8])
    func close()
}

/// What one key shows.
struct DeckFace: Equatable {
    enum Role: Equatable { case none, go, pause, stop, fade, allStop, volumeUp, volumeDown, mute, cue(UUID), pad(String) }
    var role: Role = .none
    var color = "#1a1f27"
    var top = ""              // a small line above the label ("#3")
    var label = ""            // the big words
    var symbol = ""           // an SF Symbol above the label, if any
    var emoji = ""            // a pad's emoji, big
    var rim = ""              // "" or a color: on air, standing by, sounding
    var lit = false           // the whole face bright (Pause while paused, Mute while muted)
    var dim = false           // nothing there to press

    /// Everything that changes the picture, in one string, so a key is
    /// only redrawn when its picture would change.
    var signature: String { "\(role)|\(color)|\(top)|\(label)|\(symbol)|\(emoji)|\(rim)|\(lit)|\(dim)" }
}

/// Draws key faces and the strip, and encodes them the way the deck wants.
enum DeckFaces {
    static let colors = (go: "#1c7a3e", pause: "#5a4a12", stop: "#2e3640", fade: "#243a66", allStop: "#8a1f1f",
                         cue: "#234a8a", pad: "#5a2a8a", volume: "#1f5f4a", blank: "#1a1f27",
                         onAir: "#ff3b30", standby: "#34c759", sounding: "#64d2ff")

    /// A key's picture, as the bytes the deck takes.
    static func keyImage(_ face: DeckFace, model: StreamDeckProtocol.Model) -> [UInt8] {
        let px = model.keyPixels
        let image = NSImage(size: NSSize(width: px, height: px), flipped: false) { rect in
            draw(face, in: rect)
            return true
        }
        return encode(image, width: px, height: px, model: model, rotation: model.rotation, flipX: model.flipX, flipY: model.flipY)
    }

    /// The strip's picture: the volume, what stands by, what is on air and
    /// the clock, one zone each (the clock takes two).
    static func stripImage(volume: Double, muted: Bool, standby: String, onAir: String, clock: String, paused: Bool,
                           model: StreamDeckProtocol.Model) -> [UInt8] {
        guard let strip = model.strip else { return [] }
        let w = strip.width, h = strip.height
        let image = NSImage(size: NSSize(width: w, height: h), flipped: false) { rect in
            NSColor(hex: colors.blank)!.setFill(); rect.fill()
            let zone = CGFloat(w) / CGFloat(strip.zones)
            func box(_ i: Int, _ span: Int = 1) -> NSRect { NSRect(x: zone * CGFloat(i) + 8, y: 6, width: zone * CGFloat(span) - 16, height: CGFloat(h) - 12) }
            // Zone 1: the volume as a bar and a number.
            let v = box(0)
            text("VOL", in: NSRect(x: v.minX, y: v.maxY - 30, width: v.width, height: 26), size: 20, weight: .bold, color: .white.withAlphaComponent(0.7), align: .left)
            text(muted ? "MUTE" : "\(Int((volume * 100).rounded()))%", in: NSRect(x: v.minX, y: v.maxY - 30, width: v.width, height: 26), size: 20, weight: .bold, color: muted ? NSColor(hex: colors.onAir)! : .white, align: .right)
            let track = NSRect(x: v.minX, y: v.minY + 8, width: v.width, height: 14)
            NSColor.white.withAlphaComponent(0.18).setFill(); NSBezierPath(roundedRect: track, xRadius: 7, yRadius: 7).fill()
            var fill = track; fill.size.width = track.width * CGFloat(min(1, volume / 1.2))
            (muted ? NSColor(hex: colors.onAir)! : NSColor(hex: colors.standby)!).setFill()
            NSBezierPath(roundedRect: fill, xRadius: 7, yRadius: 7).fill()
            // Zone 2: standing by.
            let s = box(1)
            text("STANDBY", in: NSRect(x: s.minX, y: s.maxY - 26, width: s.width, height: 22), size: 16, weight: .bold, color: NSColor(hex: colors.standby)!, align: .left)
            text(standby.isEmpty ? "\u{2013}" : standby, in: NSRect(x: s.minX, y: s.minY, width: s.width, height: s.height - 30), size: 22, weight: .semibold, color: .white, align: .left, lines: 2)
            // Zones 3 and 4: on air and the clock.
            let a = box(2, strip.zones - 2)
            let airColor = onAir.isEmpty ? NSColor.white.withAlphaComponent(0.5) : NSColor(hex: paused ? colors.pause : colors.onAir)!
            text(onAir.isEmpty ? "NOTHING ON AIR" : (paused ? "PAUSED" : "ON AIR"), in: NSRect(x: a.minX, y: a.maxY - 26, width: a.width, height: 22), size: 16, weight: .bold, color: airColor, align: .left)
            text(onAir, in: NSRect(x: a.minX, y: a.minY, width: a.width * 0.5, height: a.height - 30), size: 22, weight: .semibold, color: .white, align: .left, lines: 2)
            text(clock, in: NSRect(x: a.minX + a.width * 0.5, y: a.minY, width: a.width * 0.5, height: a.height - 20), size: 48, weight: .semibold, color: .white, align: .right, mono: true)
            return true
        }
        if strip.encodeRotated {
            return encode(image, width: w, height: h, model: model, rotation: 90, flipX: false, flipY: false)
        }
        return encode(image, width: w, height: h, model: model, rotation: 0, flipX: false, flipY: false)
    }

    private static func draw(_ face: DeckFace, in rect: NSRect) {
        let px = rect.width
        var back = NSColor(hex: face.color) ?? .darkGray
        if face.lit { back = back.blended(withFraction: 0.45, of: .white) ?? back }
        if face.dim { back = back.blended(withFraction: 0.6, of: .black) ?? back }
        back.setFill()
        rect.fill()
        if !face.rim.isEmpty, let c = NSColor(hex: face.rim) {
            c.setStroke()
            let path = NSBezierPath(roundedRect: rect.insetBy(dx: px * 0.05, dy: px * 0.05), xRadius: px * 0.12, yRadius: px * 0.12)
            path.lineWidth = px * 0.08
            path.stroke()
        }
        let ink: NSColor = face.dim ? .white.withAlphaComponent(0.45) : .white
        let inset = px * 0.1
        if !face.emoji.isEmpty {
            // A pad: its emoji big, its name small underneath.
            text(face.emoji, in: NSRect(x: 0, y: px * 0.36, width: px, height: px * 0.5), size: px * 0.36, weight: .regular, color: ink, align: .center)
            text(face.label, in: NSRect(x: inset, y: px * 0.08, width: px - 2 * inset, height: px * 0.3), size: px * 0.13, weight: .semibold, color: ink, align: .center, lines: 2)
            return
        }
        if !face.top.isEmpty {
            text(face.top, in: NSRect(x: inset, y: px * 0.72, width: px - 2 * inset, height: px * 0.2), size: px * 0.15, weight: .bold, color: ink.withAlphaComponent(0.75), align: .left)
        }
        if !face.symbol.isEmpty, let symbol = NSImage(systemSymbolName: face.symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: px * 0.3, weight: .bold)) {
            let tinted = symbol.tinted(ink)
            let size = tinted.size
            let scale = min(1, px * 0.34 / max(size.width, size.height))
            let drawn = NSSize(width: size.width * scale, height: size.height * scale)
            tinted.draw(in: NSRect(x: (px - drawn.width) / 2, y: px * 0.5, width: drawn.width, height: drawn.height),
                        from: .zero, operation: .sourceOver, fraction: 1)
            text(face.label, in: NSRect(x: inset, y: px * 0.1, width: px - 2 * inset, height: px * 0.36), size: px * 0.17, weight: .bold, color: ink, align: .center, lines: 2)
            return
        }
        // Words only: as big as fits.
        let top = face.top.isEmpty ? px * 0.85 : px * 0.7
        let big = face.label.count <= 4 && !face.label.contains(" ")
        text(face.label, in: NSRect(x: inset, y: px * 0.1, width: px - 2 * inset, height: top - px * 0.1),
             size: big ? px * 0.3 : px * 0.17, weight: .bold, color: ink, align: .center, lines: big ? 1 : 3)
    }

    /// Words in a box, shrunk to fit, cut with dots when they still do not.
    private static func text(_ string: String, in box: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor,
                             align: NSTextAlignment, lines: Int = 1, mono: Bool = false) {
        guard !string.isEmpty else { return }
        var fontSize = size
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = align
        paragraph.lineBreakMode = lines > 1 ? .byWordWrapping : .byTruncatingTail
        while fontSize > 7 {
            let font = mono ? NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: weight) : NSFont.systemFont(ofSize: fontSize, weight: weight)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
            let s = NSAttributedString(string: string, attributes: attrs)
            let needed = s.boundingRect(with: NSSize(width: box.width, height: 10_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
            let lineHeight = font.ascender - font.descender + font.leading
            // No word may be cut in the middle: the widest one must fit on a line.
            let widest = string.split(separator: " ").map { NSAttributedString(string: String($0), attributes: attrs).size().width }.max() ?? 0
            if needed.height <= min(box.height, lineHeight * CGFloat(lines) + 1) && widest <= box.width + 0.5 && (lines > 1 || needed.width <= box.width + 0.5) {
                // Centered on the box's height.
                let y = box.minY + (box.height - needed.height) / 2
                s.draw(with: NSRect(x: box.minX, y: y, width: box.width, height: needed.height), options: [.usesLineFragmentOrigin, .usesFontLeading])
                return
            }
            fontSize -= max(1, fontSize * 0.08)
        }
        let font = NSFont.systemFont(ofSize: 7, weight: weight)
        paragraph.lineBreakMode = .byTruncatingTail
        NSAttributedString(string: string, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
            .draw(with: box, options: [.usesLineFragmentOrigin])
    }

    /// Turns and flips a drawn picture the way the deck wants it, then
    /// encodes it (JPEG, or a bitmap for the older decks).
    private static func encode(_ image: NSImage, width: Int, height: Int, model: StreamDeckProtocol.Model,
                               rotation: Int, flipX: Bool, flipY: Bool) -> [UInt8] {
        guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
        let turned = (rotation % 360 + 360) % 360
        let outW = (turned == 90 || turned == 270) ? height : width
        let outH = (turned == 90 || turned == 270) ? width : height
        let space = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: outW * 4, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [] }
        ctx.translateBy(x: CGFloat(outW) / 2, y: CGFloat(outH) / 2)
        ctx.scaleBy(x: flipX ? -1 : 1, y: flipY ? -1 : 1)
        ctx.rotate(by: CGFloat(turned) * .pi / 180)   // counterclockwise, like the drivers' rotate
        ctx.draw(source, in: CGRect(x: -CGFloat(width) / 2, y: -CGFloat(height) / 2, width: CGFloat(width), height: CGFloat(height)))
        guard let out = ctx.makeImage() else { return [] }
        switch model.imageFormat {
        case .jpeg:
            let rep = NSBitmapImageRep(cgImage: out)
            return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]).map { [UInt8]($0) } ?? []
        case .bmp:
            guard let data = ctx.data else { return [] }
            let bytes = Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: UInt8.self), count: outW * outH * 4))
            return StreamDeckProtocol.bmp(width: outW, height: outH, rgba: bytes)
        }
    }
}

private extension NSImage {
    func tinted(_ color: NSColor) -> NSImage {
        let copy = NSImage(size: size, flipped: false) { rect in
            self.draw(in: rect)
            color.set()
            rect.fill(using: .sourceAtop)
            return true
        }
        return copy
    }
}

/// The deck itself: which deck is here, what each key does, what each key
/// shows, and what a press, a turn or a tap does.
@MainActor
final class StreamDeckController: ObservableObject {
    enum State: Equatable { case off, looking, connected, trouble }
    @Published private(set) var state: State = .off
    @Published private(set) var message = "Looking for a Stream Deck"
    @Published private(set) var modelName = ""
    /// On or off, remembered. Off lets KeyWi Bird in a browser have the deck.
    @Published var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: "deck.on"); enabledChanged() } }
    @Published var brightness: Int { didSet { UserDefaults.standard.set(brightness, forKey: "deck.brightness"); sendBrightness() } }
    /// The key faces as last drawn, for test mode and the Settings picture.
    private(set) var faces: [DeckFace] = []
    private(set) var model: StreamDeckProtocol.Model?

    static weak var shared: StreamDeckController?

    private let engine: Engine
    private var transport: DeckTransport?
    /// Other decks plugged in at the same time: dark, waiting their turn.
    private var spares: [DeckTransport] = []
    private var finder: HIDDeckFinder?
    private var keyStates: [Bool] = []
    private var dialPressed: [Bool] = []
    private var lastSignatures: [String] = []
    private var lastStrip = ""
    private var paintTimer: Timer?
    private var clockTimer: Timer?
    private var watchers: [AnyCancellable] = []
    private var muteMemory: Double?
    /// Which page of cues the keys show, picked by where the standby is.
    private var cuePage = 0
    let writes = DispatchQueue(label: "live.cueola.outrangutan.deck", qos: .userInteractive)

    init(engine: Engine) {
        self.engine = engine
        enabled = UserDefaults.standard.object(forKey: "deck.on") as? Bool ?? true
        brightness = UserDefaults.standard.object(forKey: "deck.brightness") as? Int ?? 80
        Self.shared = self
        // Any change to the show, what is on air, the pads or the level
        // redraws the keys that changed, a little later so a burst is one draw.
        watchers.append(engine.objectWillChange.sink { [weak self] _ in self?.schedulePaint() })
        watchers.append(engine.pads.objectWillChange.sink { [weak self] _ in self?.schedulePaint() })
        watchers.append(KeyMap.shared.objectWillChange.sink { [weak self] _ in self?.schedulePaint() })
    }

    /// Starts looking for decks on USB. Test mode hands over a pretend deck instead.
    func start() {
        guard finder == nil else { return }
        finder = HIDDeckFinder(io: writes,
                               onFound: { [weak self] t in self?.attach(t) },
                               onProblem: { [weak self] text in self?.trouble(text) })
        enabledChanged()
    }

    private func enabledChanged() {
        if enabled {
            if transport == nil { state = .looking; message = "Looking for a Stream Deck on this Mac" }
            finder?.start()
        } else {
            detach(log: true)
            finder?.stop()
            state = .off
            message = "Off. KeyWi Bird in a browser can have the deck."
        }
    }

    /// A deck appeared (USB, or a pretend one).
    func attach(_ t: DeckTransport) {
        guard enabled || TestSnapshot.isOn else { t.close(); return }
        guard let m = StreamDeckProtocol.model(productID: t.productID) else {
            trouble("An Elgato device this app does not know (product \(String(format: "0x%04x", t.productID))).")
            t.close()
            return
        }
        if let old = transport, old !== t, let oldModel = model {
            // A second deck: the one plugged in last drives the show. The
            // other goes dark and waits; it takes over if this one goes away.
            setAside(old, oldModel)
        }
        spares.removeAll { $0 === t }
        transport = t
        model = m
        modelName = m.name
        keyStates = Array(repeating: false, count: m.keys)
        dialPressed = Array(repeating: false, count: m.dials)
        lastSignatures = Array(repeating: "", count: m.keys)
        lastStrip = ""
        t.onInput = { [weak self] bytes in self?.handle(bytes) }
        t.onGone = { [weak self, weak t] in
            guard let self, let t, self.transport === t else { return }
            self.transport = nil
            self.model = nil
            self.clockTimer?.invalidate(); self.clockTimer = nil
            self.state = self.enabled ? .looking : .off
            self.message = "The Stream Deck was unplugged"
            self.engine.log.add(.link, "\(m.name) unplugged")
            if !self.spares.isEmpty { self.attach(self.spares.removeFirst()) }
        }
        state = .connected
        message = "\(m.name) connected" + (t.serial.isEmpty ? "" : " (\(t.serial))") + (m.untried ? ". This model has not been tried yet; tell Jon how it goes." : "")
        engine.log.add(.link, "\(m.name) connected to this Mac")
        writeFeature(StreamDeckProtocol.resetReport(model: m))
        sendBrightness()
        paint(force: true)
        clockTimer?.invalidate()
        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.paint() }
        }
        RunLoop.main.add(timer, forMode: .common)
        clockTimer = timer
    }

    /// Lets go of every deck: each goes dark, then closes.
    private func detach(log: Bool) {
        spares.forEach(letGo)
        spares = []
        guard let t = transport, let m = model else { return }
        transport = nil
        model = nil
        clockTimer?.invalidate(); clockTimer = nil
        letGo(t)
        if log { engine.log.add(.link, "\(m.name) let go") }
    }

    /// Darkens a deck and closes it, in that order, behind whatever is
    /// still being drawn on it. Nothing new is sent to it after this.
    private func letGo(_ t: DeckTransport) {
        t.onGone = nil
        t.onInput = nil
        let reset = StreamDeckProtocol.model(productID: t.productID).map(StreamDeckProtocol.resetReport)
        writes.async {
            if let reset { t.writeFeature(reset) }
            DispatchQueue.main.async { t.close() }
        }
    }

    /// A deck that is plugged in but not driving the show: dark, its
    /// presses ignored, kept so it can take over when the other goes away.
    private func setAside(_ t: DeckTransport, _ m: StreamDeckProtocol.Model) {
        t.onInput = nil
        t.onGone = { [weak self, weak t] in
            guard let self, let t else { return }
            self.spares.removeAll { $0 === t }
        }
        let reset = StreamDeckProtocol.resetReport(model: m)
        writes.async { t.writeFeature(reset) }
        spares.append(t)
        engine.log.add(.link, "\(m.name) set aside, dark: the deck plugged in last drives the show")
    }

    private func trouble(_ text: String) {
        state = .trouble
        message = text
        engine.log.add(.problem, text)
    }

        private func sendBrightness() {
        guard let m = model else { return }
        writeFeature(StreamDeckProtocol.brightnessReport(model: m, percent: brightness))
    }

    private func writeFeature(_ report: [UInt8]) {
        guard let t = transport else { return }
        writes.async { t.writeFeature(report) }
    }

    // MARK: What each key does

    /// The keys, in the deck's order, for this model: the five show keys,
    /// then the cues (as many as fit, the page the standby is on), then the
    /// pads of the current bank. Decks without a dial get volume keys.
    func roles(for m: StreamDeckProtocol.Model) -> [DeckFace.Role] {
        let cues = engine.cues
        var roles: [DeckFace.Role] = []
        let show: [DeckFace.Role] = [.go, .pause, .stop, .fade, .allStop]
        let volume: [DeckFace.Role] = [.volumeDown, .volumeUp, .mute]
        func cueSlots(_ n: Int) -> [DeckFace.Role] {
            guard n > 0 else { return [] }
            let standbyIndex = cues.firstIndex { $0.id == engine.standbyID } ?? 0
            cuePage = cues.isEmpty ? 0 : standbyIndex / n
            return (0..<n).map { i in
                let index = cuePage * n + i
                return index < cues.count ? .cue(cues[index].id) : .none
            }
        }
        func padSlots(_ n: Int) -> [DeckFace.Role] {
            let bank = engine.pads.currentBank?.id ?? ""
            return (0..<n).map { i in engine.pads.pad(bank: bank, slot: i).map { .pad($0.id) } ?? .none }
        }
        switch (m.columns, m.rows) {
        case (8, 4), (9, 4):
            // XL and + XL: show keys and volume on row 1, two rows of cues, a row of pads.
            roles = show + (m.dials > 0 ? [] : volume)
            while roles.count < m.columns { roles.append(.none) }
            roles += cueSlots(m.columns * 2) + padSlots(m.columns)
        case (5, 3):
            // The 15-key decks: show keys, a row of cues, a row of pads.
            roles = show + cueSlots(5) + padSlots(5)
        case (4, 2):
            // Stream Deck +: four show keys, All Stop and three pads; the
            // dials carry the volume and the standby.
            roles = [.go, .pause, .stop, .fade, .allStop] + padSlots(3)
        case (3, 2):
            roles = [.go, .pause, .stop, .fade, .allStop] + padSlots(1)
        default:
            roles = show + cueSlots(max(0, m.keys - 5))
        }
        while roles.count < m.keys { roles.append(.none) }
        return Array(roles.prefix(m.keys))
    }

    /// What a key shows for its role, right now.
    func face(for role: DeckFace.Role) -> DeckFace {
        var f = DeckFace(role: role)
        let keys = KeyMap.shared
        switch role {
        case .none:
            f.color = DeckFaces.colors.blank; f.dim = true
        case .go:
            f.color = DeckFaces.colors.go; f.label = "GO"; f.symbol = "play.fill"; f.top = keys.name(.go)
            f.dim = engine.standbyCue == nil && !engine.isPaused
        case .pause:
            f.color = DeckFaces.colors.pause; f.label = engine.isPaused ? "RESUME" : "PAUSE"; f.symbol = engine.isPaused ? "playpause.fill" : "pause.fill"
            f.top = keys.name(.pause); f.lit = engine.isPaused
        case .stop:
            f.color = DeckFaces.colors.stop; f.label = "STOP"; f.symbol = "stop.fill"; f.top = keys.name(.stop)
        case .fade:
            f.color = DeckFaces.colors.fade; f.label = "FADE"; f.symbol = "slider.vertical.3"; f.top = keys.name(.fade)
        case .allStop:
            f.color = DeckFaces.colors.allStop; f.label = "ALL STOP"; f.symbol = "exclamationmark.octagon.fill"; f.top = keys.name(.allStop)
        case .volumeUp:
            f.color = DeckFaces.colors.volume; f.label = "VOL +"; f.symbol = "speaker.plus.fill"; f.top = "\(Int((engine.masterGain * 100).rounded()))%"
        case .volumeDown:
            f.color = DeckFaces.colors.volume; f.label = "VOL \u{2212}"; f.symbol = "speaker.minus.fill"; f.top = "\(Int((engine.masterGain * 100).rounded()))%"
        case .mute:
            f.color = DeckFaces.colors.pause; f.label = "MUTE"; f.symbol = "speaker.slash.fill"; f.lit = engine.masterGain <= 0.001
        case .cue(let id):
            guard let i = engine.cues.firstIndex(where: { $0.id == id }) else { f.color = DeckFaces.colors.blank; f.dim = true; break }
            let cue = engine.cues[i]
            f.color = DeckFaces.colors.cue
            f.top = "#\(i + 1)"
            f.label = cue.name.replacingOccurrences(of: "_", with: " ")
            f.dim = !cue.fileIsThere
            if cue.id == engine.pictureCue?.id || cue.id == engine.soundCue?.id || cue.id == engine.pendingCue?.id {
                f.rim = DeckFaces.colors.onAir; f.color = engine.isPaused ? DeckFaces.colors.pause : "#b3261e"
            } else if cue.id == engine.standbyID {
                f.rim = DeckFaces.colors.standby
            }
        case .pad(let id):
            guard let pad = engine.pads.pad(id: id) else { f.color = DeckFaces.colors.blank; f.dim = true; break }
            f.color = pad.color
            f.emoji = pad.emoji.isEmpty ? "\u{266B}" : pad.emoji
            f.label = pad.name.replacingOccurrences(of: "_", with: " ")
            f.dim = !pad.fileIsThere
            if engine.pads.sounding[pad.id] != nil { f.rim = DeckFaces.colors.sounding; f.lit = true }
        }
        return f
    }

    // MARK: Drawing

    private func schedulePaint() {
        guard transport != nil, paintTimer == nil else { return }
        let t = Timer(timeInterval: 0.05, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.paintTimer = nil
                self?.paint()
            }
        }
        RunLoop.main.add(t, forMode: .common)
        paintTimer = t
    }

    /// Draws every key whose picture changed, and the strip.
    func paint(force: Bool = false) {
        guard let t = transport, let m = model else { return }
        let roles = roles(for: m)
        let fresh = roles.map(face(for:))
        faces = fresh
        for (i, f) in fresh.enumerated() where force || f.signature != lastSignatures[i] {
            lastSignatures[i] = f.signature
            let image = DeckFaces.keyImage(f, model: m)
            let reports = StreamDeckProtocol.keyImageReports(model: m, key: i, image: image)
            writes.async { reports.forEach(t.write) }
        }
        if m.strip != nil {
            let onAir = engine.pictureCue?.name ?? engine.soundCue?.name ?? engine.pendingCue?.name ?? ""
            let clock = engine.remaining.map(Timecode.dropFrame) ?? (engine.preRemaining.map(Timecode.dropFrame) ?? "")
            // To the second, and without the hours while they are zero: the
            // strip is small, and a show clip is minutes long.
            var clockShown = String(clock.dropLast(3))
            if clockShown.hasPrefix("00:") { clockShown.removeFirst(3) }
            let signature = "\(engine.masterGain)|\(engine.standbyCue?.name ?? "")|\(onAir)|\(clockShown)|\(engine.isPaused)"
            if force || signature != lastStrip {
                lastStrip = signature
                let image = DeckFaces.stripImage(volume: engine.masterGain, muted: engine.masterGain <= 0.001,
                                                 standby: engine.standbyCue?.name ?? "", onAir: onAir, clock: clockShown,
                                                 paused: engine.isPaused, model: m)
                let reports = StreamDeckProtocol.stripImageReports(model: m, image: image)
                writes.async { reports.forEach(t.write) }
            }
        }
    }

    // MARK: Presses, turns and taps

    private func handle(_ bytes: [UInt8]) {
        guard let m = model else { return }
        switch StreamDeckProtocol.parseInput(bytes, model: m) {
        case .keys(let states):
            let e = StreamDeckProtocol.edges(from: keyStates, to: states)
            keyStates = states
            let roles = roles(for: m)
            for k in e.downs where k < roles.count { press(roles[k]) }
        case .dialsTurned(let ticks):
            for (i, t) in ticks.enumerated() where t != 0 { turn(dial: i, by: t) }
        case .dialsPressed(let pressed):
            for (i, p) in pressed.enumerated() where i < dialPressed.count {
                if p && !dialPressed[i] { pressDial(i) }
                dialPressed[i] = p
            }
        case .touch(let zone, let gesture):
            // A tap on the volume zone mutes and unmutes; on the standby zone,
            // GO. Only a tap: a brush across the strip or a finger resting on
            // it must not fire a cue.
            guard gesture == "tap" else { break }
            if zone == 0 { toggleMute() } else if zone == 1 { engine.run(from: "Stream Deck") { engine.go() } }
        case .unknown:
            break
        }
    }

    /// A key went down.
    func press(_ role: DeckFace.Role) {
        engine.run(from: "Stream Deck") {
            switch role {
            case .none: break
            case .go: engine.go()
            case .pause: engine.togglePause()
            case .stop: engine.stop()
            case .fade: engine.fadeStopAll()
            case .allStop: engine.allStop()
            case .volumeUp: engine.setGain(engine.masterGain + 0.05)
            case .volumeDown: engine.setGain(engine.masterGain - 0.05)
            case .mute: toggleMute()
            case .cue(let id):
                if let cue = engine.cues.first(where: { $0.id == id }) { engine.standbyID = cue.id; engine.go() }
            case .pad(let id):
                _ = engine.pads.fire(id)
            }
        }
    }

    /// Dial 1 is the volume (3% a click); dial 2 moves the standby.
    func turn(dial: Int, by ticks: Int) {
        engine.run(from: "Stream Deck") {
            switch dial {
            case 0:
                muteMemory = nil
                engine.setGain(engine.masterGain + Double(ticks) * 0.03)
            case 1:
                engine.moveStandby(ticks > 0 ? 1 : -1)
            default: break
            }
        }
    }

    /// Pressing dial 1 mutes and unmutes; pressing dial 2 is GO.
    func pressDial(_ dial: Int) {
        engine.run(from: "Stream Deck") {
            switch dial {
            case 0: toggleMute()
            case 1: engine.go()
            default: break
            }
        }
    }

    private func toggleMute() {
        if engine.masterGain > 0.001 {
            muteMemory = engine.masterGain
            engine.setGain(0)
        } else {
            engine.setGain(muteMemory ?? 0.8)
            muteMemory = nil
        }
    }

    /// What the keys do on this model, in words, for Settings and Help.
    var keyGuide: [String] {
        guard let m = model else { return [] }
        var lines = ["Row 1: GO, Pause, Stop, Fade, All Stop" + (m.dials > 0 || m.keys < 15 ? "" : (m.keys > 15 ? ", then VOL \u{2212}, VOL + and MUTE" : ""))]
        switch (m.columns, m.rows) {
        case (8, 4), (9, 4): lines += ["Rows 2 and 3: the cues, \(m.columns * 2) at a time, the page the standby is on", "Row 4: the pads of the current bank"]
        case (5, 3): lines += ["Row 2: the cues, five at a time, the page the standby is on", "Row 3: the pads of the current bank"]
        case (4, 2): lines = ["Keys: GO, Pause, Stop, Fade, All Stop, and the first three pads",
                              "Dial 1: the volume; press it to mute", "Dial 2: moves the standby; press it for GO",
                              "The strip: the volume, what stands by, what is on air and the clock"]
        case (3, 2): lines = ["Keys: GO, Pause, Stop, Fade, All Stop, and the first pad"]
        default: break
        }
        return lines
    }
}

// MARK: USB

/// Finds Elgato decks on USB and opens them.
final class HIDDeckFinder {
    private var manager: IOHIDManager?
    private let io: DispatchQueue
    private let onFound: (DeckTransport) -> Void
    private let onProblem: (String) -> Void
    private var open: [IOHIDDevice: HIDDeckTransport] = [:]
    private var running = false

    init(io: DispatchQueue, onFound: @escaping (DeckTransport) -> Void, onProblem: @escaping (String) -> Void) {
        self.io = io
        self.onFound = onFound
        self.onProblem = onProblem
    }

    func start() {
        guard !running else { return }
        running = true
        let m = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatching(m, [kIOHIDVendorIDKey: StreamDeckProtocol.elgatoVendorID] as CFDictionary)
        let context = Unmanaged.passUnretained(self).toOpaque()
        IOHIDManagerRegisterDeviceMatchingCallback(m, { context, _, _, device in
            guard let context else { return }
            Unmanaged<HIDDeckFinder>.fromOpaque(context).takeUnretainedValue().found(device)
        }, context)
        IOHIDManagerRegisterDeviceRemovalCallback(m, { context, _, _, device in
            guard let context else { return }
            Unmanaged<HIDDeckFinder>.fromOpaque(context).takeUnretainedValue().gone(device)
        }, context)
        IOHIDManagerScheduleWithRunLoop(m, CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue)
        IOHIDManagerOpen(m, IOOptionBits(kIOHIDOptionsTypeNone))
        manager = m
    }

    func stop() {
        guard running, let m = manager else { return }
        running = false
        // The decks are the controller's to darken and close, in order
        // behind what it is still drawing; here they are only forgotten.
        open = [:]
        IOHIDManagerUnscheduleFromRunLoop(m, CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue)
        IOHIDManagerClose(m, IOOptionBits(kIOHIDOptionsTypeNone))
        manager = nil
    }

    private func number(_ device: IOHIDDevice, _ key: String) -> Int {
        (IOHIDDeviceGetProperty(device, key as CFString) as? NSNumber)?.intValue ?? 0
    }

    private func found(_ device: IOHIDDevice) {
        let product = number(device, kIOHIDProductIDKey)
        guard StreamDeckProtocol.model(productID: product) != nil else { return }
        // A deck can show more than one HID face; the one that talks is the
        // one with the big reports.
        guard number(device, kIOHIDMaxInputReportSizeKey) >= 16 else { return }
        guard open[device] == nil else { return }
        let result = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
        guard result == kIOReturnSuccess else {
            onProblem("A Stream Deck is plugged in but could not be opened. Quit the Elgato Stream Deck app, then plug the deck in again.")
            return
        }
        let serial = (IOHIDDeviceGetProperty(device, kIOHIDSerialNumberKey as CFString) as? String) ?? ""
        let t = HIDDeckTransport(device: device, productID: product, serial: serial,
                                 inputSize: max(64, number(device, kIOHIDMaxInputReportSizeKey) + 1), io: io)
        open[device] = t
        onFound(t)
    }

    private func gone(_ device: IOHIDDevice) {
        guard let t = open.removeValue(forKey: device) else { return }
        t.gone()
    }
}

/// One deck on USB. Reports go out on the `io` queue, in order; the handle
/// is closed on that same queue, behind the last report.
final class HIDDeckTransport: DeckTransport {
    private let device: IOHIDDevice
    let productID: Int
    let serial: String
    var onInput: (([UInt8]) -> Void)?
    var onGone: (() -> Void)?
    private let io: DispatchQueue
    private var buffer: UnsafeMutablePointer<UInt8>
    private let bufferSize: Int
    private let lock = NSLock()
    private var isOpen = true     // under `lock`: read on the io queue, flipped from either side
    private var hooked = true     // main thread only: the input callback is registered

    init(device: IOHIDDevice, productID: Int, serial: String, inputSize: Int, io: DispatchQueue) {
        self.device = device
        self.productID = productID
        self.serial = serial
        self.io = io
        bufferSize = inputSize
        buffer = .allocate(capacity: inputSize)
        let context = Unmanaged.passUnretained(self).toOpaque()
        IOHIDDeviceRegisterInputReportCallback(device, buffer, inputSize, { context, _, _, _, _, report, length in
            guard let context, length > 0 else { return }
            let bytes = Array(UnsafeBufferPointer(start: report, count: length))
            let me = Unmanaged<HIDDeckTransport>.fromOpaque(context).takeUnretainedValue()
            DispatchQueue.main.async { me.onInput?(bytes) }
        }, context)
        IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue)
    }

    deinit { buffer.deallocate() }

    func write(_ report: [UInt8]) {
        guard open, let id = report.first else { return }
        report.withUnsafeBufferPointer { p in
            _ = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, CFIndex(id), p.baseAddress!, report.count)
        }
    }

    func writeFeature(_ report: [UInt8]) {
        guard open, let id = report.first else { return }
        report.withUnsafeBufferPointer { p in
            _ = IOHIDDeviceSetReport(device, kIOHIDReportTypeFeature, CFIndex(id), p.baseAddress!, report.count)
        }
    }

    private var open: Bool { lock.lock(); defer { lock.unlock() }; return isOpen }

    /// Marks the deck closed; true the first time only.
    private func shut() -> Bool { lock.lock(); defer { lock.unlock() }; let was = isOpen; isOpen = false; return was }

    /// No more input from the deck. Main thread.
    private func unhook() {
        guard hooked else { return }
        hooked = false
        IOHIDDeviceRegisterInputReportCallback(device, buffer, bufferSize, nil, nil)
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue)
    }

    /// Tells the app once, then forgets the app so nothing holds on. Main thread.
    private func fireGone() {
        onGone?()
        onGone = nil
        onInput = nil
    }

    /// The deck was unplugged (the finder's removal callback, main thread).
    /// The handle is not closed: closing an unplugged device can crash.
    func gone() {
        guard shut() else { return }
        unhook()
        DispatchQueue.main.async { [self] in fireGone() }
    }

    /// Done with the deck (main thread). Reports already on the io queue
    /// still go out; the handle closes behind them.
    func close() {
        guard shut() else { return }
        unhook()
        onGone = nil
        onInput = nil
        io.async { [self] in IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone)) }
    }
}

// MARK: Settings

struct StreamDeckSettings: View {
    @ObservedObject var deck: StreamDeckController

    var body: some View {
        Form {
            Section {
                Toggle("Use a Stream Deck plugged into this Mac", isOn: $deck.enabled)
                LabeledContent("Status") {
                    HStack(spacing: 8) {
                        Circle().fill(light).frame(width: 10, height: 10)
                        Text(deck.message).foregroundStyle(.secondary)
                    }
                }
                Slider(value: Binding(get: { Double(deck.brightness) }, set: { deck.brightness = Int($0) }), in: 10...100, step: 5) {
                    Text("Brightness")
                }
                .disabled(deck.state != .connected)
            } header: {
                Text("Stream Deck")
            } footer: {
                Text("The app drives the deck itself: no browser and no Elgato software. Quit the Elgato Stream Deck app, and leave the deck unconnected in KeyWi Bird on this Mac. A deck on another Mac keeps working through the cloud.")
                    .foregroundStyle(.secondary)
            }
            if deck.state == .connected {
                Section {
                    ForEach(deck.keyGuide, id: \.self) { Text($0) }
                } header: {
                    Text("What the keys do on the \(deck.modelName)")
                } footer: {
                    Text("A cue key fires that cue: red while it is on air, green while it stands by. A pad key fires that pad. The show keys' names show on the keys.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var light: Color {
        switch deck.state {
        case .connected: return .green
        case .looking: return .yellow
        case .trouble: return .red
        case .off: return .gray
        }
    }
}
