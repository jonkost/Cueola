import AppKit
import SwiftUI

@main
struct OutrangutanApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("Outrangutan") {
            ControlView(engine: appDelegate.engine, link: appDelegate.link)
                .frame(minWidth: 900, minHeight: 560)
                .preferredColorScheme(.dark)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Connect to a Show…") {
                    NotificationCenter.default.post(name: .showConnect, object: nil)
                }
                .keyboardShortcut("k")
            }
            CommandGroup(after: .sidebar) {
                Button("Show or Hide Inspector") {
                    NotificationCenter.default.post(name: .toggleInspector, object: nil)
                }
                .keyboardShortcut("i")
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let engine = Engine()
    lazy var link = ShowLink(engine: engine, store: TestSnapshot.store)
    private var keyWatcher: Any?
    private var showActivity: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        // Test mode stays in the background so it never catches keys someone
        // is typing in another app.
        _ = link
        if TestSnapshot.isOn { return TestSnapshot.runIfAsked(engine: engine, link: link) }
        NSApp.activate(ignoringOtherApps: true)

        // Tell macOS a show is running: never nap this app, never slow its
        // timers, never let the screens go to sleep.
        showActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .latencyCritical, .idleDisplaySleepDisabled],
            reason: "Outrangutan is running a show"
        )

        // Show keys work anywhere in the app, except while typing in a box.
        keyWatcher = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if NSApp.keyWindow?.firstResponder is NSText { return event }
            if !event.modifierFlags.intersection([.command, .control, .option]).isEmpty { return event }
            switch event.keyCode {
            case 49: self.engine.go(); return nil          // Space
            case 53: self.engine.allStop(); return nil     // Esc
            default: break
            }
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "s": self.engine.stop(); return nil
            case "p": self.engine.togglePause(); return nil
            case "f": self.engine.fadeStopAll(); return nil
            default: return event
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
