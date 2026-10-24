import AppKit
import SwiftUI

/// One screen the output can go to.
struct ScreenChoice: Identifiable, Equatable {
    var id: String { name }
    let name: String
    /// Its size in real pixels.
    let pixels: CGSize
    /// True for the screen the control window is on.
    let isControl: Bool
}

/// The output: the picture that goes to the wall.
///
/// On a screen of its own it fills that screen edge to edge, above the menu
/// bar and the Dock, with no title bar and no pointer. With only one
/// screen it opens as a normal window, so you can work at your desk.
@MainActor
final class OutputController: NSObject, ObservableObject, NSWindowDelegate {
    @Published private(set) var screens: [ScreenChoice] = []
    /// The screen the output fills now; nil while it is a window or closed.
    @Published private(set) var fullScreenOn: String?
    @Published private(set) var isOpen = false

    private let stage: Stage
    private var window: NSWindow?
    private var watchers: [NSObjectProtocol] = []

    init(stage: Stage) {
        self.stage = stage
        super.init()
        let center = NotificationCenter.default
        // A projector plugged in or unplugged, or a screen changing size.
        watchers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.place() }
        })
        // The control window moved to another screen.
        watchers.append(center.addObserver(forName: NSWindow.didChangeScreenNotification, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, let moved = note.object as? NSWindow, moved !== self.window, moved.toolbar != nil else { return }
                self.place()
            }
        })
    }

    /// The screen with the control window (the one with the toolbar).
    static var controlScreen: NSScreen? {
        NSApp.windows.first { $0.toolbar != nil && $0.isVisible }?.screen ?? NSScreen.main ?? NSScreen.screens.first
    }

    /// The screens, by name, with their real pixel sizes.
    func refreshScreens() {
        let control = Self.controlScreen
        screens = NSScreen.screens.map {
            ScreenChoice(name: $0.localizedName, pixels: $0.convertRectToBacking($0.frame).size, isControl: $0 == control)
        }
    }

    /// The screen the output should fill: the one picked, or with nothing
    /// picked, the first screen that is not the control screen. A picked
    /// screen that is unplugged never falls back to another screen: the
    /// output waits as a window until it is back.
    private func target() -> NSScreen? {
        let control = Self.controlScreen
        let found: NSScreen?
        if let name = stage.setup.outputScreen {
            found = NSScreen.screens.first { $0.localizedName == name }
        } else {
            found = NSScreen.screens.first { $0 != control }
        }
        return found == control ? nil : found
    }

    /// Opens the output where it belongs, or moves it there.
    func place() {
        refreshScreens()
        let own = target()
        if let win = window, own?.localizedName == fullScreenOn {
            // Already in the right place: keep the window, follow the size.
            if let own { win.setFrame(own.frame, display: true) }
            if !win.isVisible { win.orderFront(nil) }
            isOpen = true
            return
        }
        window?.delegate = nil
        window?.orderOut(nil)

        let win: NSWindow
        if let screen = own {
            win = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            win.level = .screenSaver
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.setFrame(screen.frame, display: true)
            fullScreenOn = screen.localizedName
        } else {
            let pixels = stage.outputPixels
            let aspect = pixels.height > 0 ? pixels.width / pixels.height : 16.0 / 10.0
            let frame = NSRect(x: 0, y: 0, width: 800, height: (800 / aspect).rounded())
            win = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
            win.title = "Vixel Output"
            win.contentAspectRatio = frame.size
            win.delegate = self
            // Beside the control window, never on top of it.
            if let control = NSApp.windows.first(where: { $0.toolbar != nil && $0.isVisible }), let screen = control.screen {
                let area = screen.visibleFrame
                win.setFrameTopLeftPoint(NSPoint(x: area.maxX - win.frame.width - 20, y: area.maxY - 20))
            } else {
                win.center()
            }
            fullScreenOn = nil
        }
        win.isReleasedWhenClosed = false
        win.backgroundColor = .black
        win.contentView = OutputContent(stage: stage, hidesPointer: own != nil)
        if TestSnapshot.isOn && TestSnapshot.hold == nil { win.orderBack(nil) } else { win.orderFront(nil) }
        window = win
        isOpen = true
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        fullScreenOn = nil
        isOpen = false
    }

    /// The output window, for test mode's pictures.
    var debugWindow: NSWindow? { window }
}

/// The output's content: the picture, and the editing marks on top.
final class OutputContent: NSView {
    private let hidesPointer: Bool
    private var pointerHidden = false

    init(stage: Stage, hidesPointer: Bool) {
        self.hidesPointer = hidesPointer
        super.init(frame: .zero)
        let picture = makeMapView(stage: stage, role: .output)
        let marks = NSHostingView(rootView: EditMarks(stage: stage, role: .output))
        for view in [picture, marks] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: leadingAnchor),
                view.trailingAnchor.constraint(equalTo: trailingAnchor),
                view.topAnchor.constraint(equalTo: topAnchor),
                view.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // The pointer hides while it is over a full-screen output, so it never
    // shows on the wall.
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        guard hidesPointer else { return }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseEntered(with event: NSEvent) {
        guard hidesPointer, !pointerHidden else { return }
        NSCursor.hide()
        pointerHidden = true
    }

    override func mouseExited(with event: NSEvent) {
        guard pointerHidden else { return }
        NSCursor.unhide()
        pointerHidden = false
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        if newWindow == nil, pointerHidden {
            NSCursor.unhide()
            pointerHidden = false
        }
    }

    // Clicks pass through to nothing: the output only shows.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
