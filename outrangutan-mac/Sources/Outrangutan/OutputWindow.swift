import AppKit
import AVFoundation

/// The four picture layers on the output. Two video layers let one clip
/// dissolve into the next; two still layers do the same for stills and
/// mattes.
enum PictureSlot: String, CaseIterable {
    case a, b, s1, s2
    var isStill: Bool { self == .s1 || self == .s2 }
}

/// The output: the picture that goes to air.
///
/// On a second screen it fills that screen edge to edge, with no title bar
/// and no menu bar. With only one screen it opens as a normal window so you
/// can still see it while you build the show.
final class OutputWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    let pictureView = OutputView()
    /// Called when someone closes a windowed output with its close button.
    var onClose: (() -> Void)?

    var isOpen: Bool { window?.isVisible ?? false }
    /// Where the output is now, in words, for the show log.
    private(set) var placement = "closed"

    /// Opens the output on the named screen, or moves it there if it is
    /// already open.
    func open(on screenName: String?, title: String = "Outrangutan Output") {
        let control = NSApp.mainWindow?.screen ?? NSScreen.main
        // A picked screen that is missing never falls back to some other
        // screen: that could be another output's screen. It opens as a
        // window instead, until the screen is back.
        let target = screenName != nil
            ? NSScreen.screens.first { $0.localizedName == screenName }
            : NSScreen.screens.first { $0 != control }
        window?.orderOut(nil)

        let win: NSWindow
        if let screen = target, screen != control {
            // Its own screen: edge to edge, above the menu bar.
            win = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            win.level = .screenSaver
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.setFrame(screen.frame, display: true)
            placement = "full screen on \u{201C}\(screen.localizedName)\u{201D}"
        } else {
            // Same screen as the controls: a normal window you can move and size.
            let frame = NSRect(x: 0, y: 0, width: 960, height: 540)
            win = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .miniaturizable],
                           backing: .buffered, defer: false)
            win.title = title
            win.delegate = self
            win.contentAspectRatio = NSSize(width: 16, height: 9)
            win.center()
            placement = "a window on this screen"
        }
        win.isReleasedWhenClosed = false
        win.backgroundColor = .black
        win.contentView = pictureView
        win.orderFront(nil)
        window = win
    }

    func close() {
        window?.delegate = nil
        window?.orderOut(nil)
        window = nil
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        onClose?()
    }
}

/// Black background with the four picture layers.
final class OutputView: NSView {
    private let videoA = AVPlayerLayer()
    private let videoB = AVPlayerLayer()
    private let still1 = CALayer()
    private let still2 = CALayer()
    private var frames: [PictureSlot: Cue] = [:]
    private var identifyLayer: CALayer?
    private let standbyLayer = CATextLayer()

    /// Words shown while no picture is up. Empty shows black.
    var standbyText = "" { didSet { updateStandby() } }

    /// The picture slots with something showing; for test mode.
    var visibleSlots: [PictureSlot] { PictureSlot.allCases.filter { !layerFor($0).isHidden } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        for sub in [videoA, videoB, still1, still2] {
            sub.isHidden = true
            sub.opacity = 1
            sub.backgroundColor = NSColor.clear.cgColor
            sub.actions = ["contents": NSNull(), "hidden": NSNull(), "bounds": NSNull(), "position": NSNull(),
                           "opacity": NSNull(), "transform": NSNull(), "zPosition": NSNull(),
                           "backgroundColor": NSNull()]
            layer?.addSublayer(sub)
        }
        standbyLayer.isHidden = true
        standbyLayer.alignmentMode = .center
        standbyLayer.isWrapped = true
        standbyLayer.foregroundColor = NSColor.white.cgColor
        standbyLayer.font = NSFont.systemFont(ofSize: 10, weight: .semibold)
        standbyLayer.zPosition = -1
        standbyLayer.actions = ["contents": NSNull(), "hidden": NSNull(), "bounds": NSNull(), "position": NSNull(), "fontSize": NSNull()]
        layer?.addSublayer(standbyLayer)
    }

    /// The standby words show only while every picture layer is empty.
    private func updateStandby() {
        quietly {
            let empty = PictureSlot.allCases.allSatisfy { layerFor($0).isHidden }
            standbyLayer.string = standbyText
            standbyLayer.isHidden = standbyText.isEmpty || !empty
            standbyLayer.fontSize = max(12, bounds.height * 0.07)
            standbyLayer.contentsScale = window?.backingScaleFactor ?? 2
            let h = standbyLayer.fontSize * 3
            standbyLayer.frame = CGRect(x: bounds.width * 0.08, y: (bounds.height - h) / 2, width: bounds.width * 0.84, height: h)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func layerFor(_ slot: PictureSlot) -> CALayer {
        switch slot {
        case .a: return videoA
        case .b: return videoB
        case .s1: return still1
        case .s2: return still2
        }
    }

    override func layout() {
        super.layout()
        quietly {
            for slot in PictureSlot.allCases {
                let l = layerFor(slot)
                l.transform = CATransform3DIdentity
                l.frame = bounds
                if let cue = frames[slot] { place(l, cue) }
            }
        }
        updateStandby()
    }

    /// Puts a video player on a layer, on top of the others.
    func showVideo(_ player: AVPlayer, in slot: PictureSlot, cue: Cue, opacity: Float) {
        quietly {
            guard let l = layerFor(slot) as? AVPlayerLayer else { return }
            l.player = player
            frames[slot] = cue
            style(slot, cue)
            l.opacity = opacity
            l.isHidden = false
            raise(slot)
        }
        updateStandby()
    }

    /// Shows a still picture or a matte color on a still layer, on top.
    func showStill(_ image: NSImage?, in slot: PictureSlot, cue: Cue, opacity: Float) {
        quietly {
            let l = layerFor(slot)
            l.contents = image
            frames[slot] = cue
            style(slot, cue)
            l.opacity = opacity
            l.isHidden = false
            raise(slot)
        }
        updateStandby()
    }

    /// Applies a cue's framing to a layer that is already showing, for
    /// changes made in the Inspector while the cue is on air.
    func restyle(_ slot: PictureSlot, _ cue: Cue) {
        guard frames[slot] != nil else { return }
        quietly {
            frames[slot] = cue
            style(slot, cue)
        }
    }

    private func style(_ slot: PictureSlot, _ cue: Cue) {
        let l = layerFor(slot)
        if let v = l as? AVPlayerLayer {
            v.videoGravity = cue.fit == .cover ? .resizeAspectFill : (cue.fit == .fill ? .resize : .resizeAspect)
        } else {
            l.backgroundColor = cue.kind == .matte ? (NSColor(hex: cue.color) ?? .black).cgColor : NSColor.clear.cgColor
            l.contentsGravity = cue.fit == .cover ? .resizeAspectFill : (cue.fit == .fill ? .resize : .resizeAspect)
        }
        place(l, cue)
    }

    func setOpacity(_ slot: PictureSlot, _ value: Float) {
        quietly { layerFor(slot).opacity = value }
    }

    func hide(_ slot: PictureSlot) {
        quietly {
            let l = layerFor(slot)
            l.isHidden = true
            if slot.isStill { l.contents = nil; l.backgroundColor = NSColor.clear.cgColor }
            if let v = l as? AVPlayerLayer { v.player = nil }
            frames[slot] = nil
        }
        updateStandby()
    }

    func black() { PictureSlot.allCases.forEach(hide) }

    /// True while the standby words are showing, for tests.
    var standbyShowing: Bool { !standbyLayer.isHidden }

    /// Names of what this output shows now, for tests.
    var showing: [String] {
        PictureSlot.allCases.compactMap { slot in
            guard let cue = frames[slot], !layerFor(slot).isHidden else { return nil }
            return cue.name
        }
    }

    /// A big number and name over the picture for three seconds, so you can
    /// tell which screen is which output.
    func identify(number: Int, label: String) {
        identifyLayer?.removeFromSuperlayer()
        let box = CALayer()
        box.frame = bounds
        box.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
        box.zPosition = 10_000
        let scale = window?.backingScaleFactor ?? 2
        let big = CATextLayer()
        big.string = "\(number)"
        big.font = NSFont.systemFont(ofSize: 10, weight: .bold)
        big.fontSize = bounds.height * 0.45
        big.alignmentMode = .center
        big.foregroundColor = NSColor.white.cgColor
        big.contentsScale = scale
        big.frame = CGRect(x: 0, y: bounds.height * 0.3, width: bounds.width, height: bounds.height * 0.55)
        let name = CATextLayer()
        name.string = label
        name.font = NSFont.systemFont(ofSize: 10, weight: .semibold)
        name.fontSize = bounds.height * 0.07
        name.alignmentMode = .center
        name.foregroundColor = NSColor.white.cgColor
        name.contentsScale = scale
        name.frame = CGRect(x: 0, y: bounds.height * 0.16, width: bounds.width, height: bounds.height * 0.1)
        box.addSublayer(big)
        box.addSublayer(name)
        layer?.addSublayer(box)
        identifyLayer = box
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self, weak box] in
            box?.removeFromSuperlayer()
            if self?.identifyLayer === box { self?.identifyLayer = nil }
        }
    }

    /// Scale and position, like the web app: position is a percent of the
    /// screen, then the picture is scaled around its center.
    private func place(_ l: CALayer, _ cue: Cue) {
        let dx = bounds.width * cue.posX / 100
        let dy = -bounds.height * cue.posY / 100   // + is down on the web, up on a Mac layer
        l.transform = CATransform3DScale(CATransform3DMakeTranslation(dx, dy, 0), cue.scale, cue.scale, 1)
    }

    private func raise(_ slot: PictureSlot) {
        let top = PictureSlot.allCases.map { layerFor($0).zPosition }.max() ?? 0
        layerFor(slot).zPosition = top + 1
    }

    private func quietly(_ body: () -> Void) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        body()
        CATransaction.commit()
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
