import AppKit
import AVFoundation

/// The output: the picture that goes to air.
///
/// On a second screen it fills that screen edge to edge, with no title bar
/// and no menu bar. With only one screen it opens as a normal window so you
/// can still see it while you build the show.
final class OutputWindowController {
    private var window: NSWindow?
    private let pictureView = OutputView()

    var isOpen: Bool { window?.isVisible ?? false }

    /// Opens the output on the named screen, or moves it there if it is
    /// already open.
    func open(on screenName: String?) {
        let control = NSApp.mainWindow?.screen ?? NSScreen.main
        let target = NSScreen.screens.first { $0.localizedName == screenName } ?? NSScreen.screens.first { $0 != control }
        window?.orderOut(nil)

        let win: NSWindow
        if let screen = target, screen != control {
            // Its own screen: edge to edge, above the menu bar.
            win = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            win.level = .screenSaver
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.setFrame(screen.frame, display: true)
        } else {
            // Same screen as the controls: a normal window you can move and size.
            let frame = NSRect(x: 0, y: 0, width: 960, height: 540)
            win = NSWindow(contentRect: frame, styleMask: [.titled, .resizable, .miniaturizable],
                           backing: .buffered, defer: false)
            win.title = "Outrangutan Output"
            win.contentAspectRatio = NSSize(width: 16, height: 9)
            win.center()
        }
        win.isReleasedWhenClosed = false
        win.backgroundColor = .black
        win.contentView = pictureView
        win.orderFront(nil)
        window = win
    }

    func close() {
        window?.orderOut(nil)
        window = nil
    }

    func showVideo(_ player: AVPlayer) { pictureView.showVideo(player) }
    func showStill(_ image: NSImage) { pictureView.showStill(image) }
    func black() { pictureView.black() }
}

/// Black background with one layer for video and one for stills.
final class OutputView: NSView {
    private let videoLayer = AVPlayerLayer()
    private let stillLayer = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        videoLayer.videoGravity = .resizeAspect
        videoLayer.backgroundColor = NSColor.black.cgColor
        stillLayer.contentsGravity = .resizeAspect
        for sub in [videoLayer, stillLayer] {
            sub.isHidden = true
            sub.actions = ["contents": NSNull(), "hidden": NSNull(), "bounds": NSNull(), "position": NSNull()]
            layer?.addSublayer(sub)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        videoLayer.frame = bounds
        stillLayer.frame = bounds
        CATransaction.commit()
    }

    func showVideo(_ player: AVPlayer) {
        videoLayer.player = player
        videoLayer.isHidden = false
        stillLayer.isHidden = true
    }

    func showStill(_ image: NSImage) {
        stillLayer.contents = image
        stillLayer.isHidden = false
        videoLayer.isHidden = true
    }

    func black() {
        videoLayer.isHidden = true
        stillLayer.isHidden = true
        stillLayer.contents = nil
    }
}
