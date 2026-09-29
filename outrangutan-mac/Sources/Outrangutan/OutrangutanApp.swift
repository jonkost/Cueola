import AppKit
import SwiftUI

@main
struct OutrangutanApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // One show, one control window.
        Window("Outrangutan", id: "main") {
            ControlView(engine: appDelegate.engine, link: appDelegate.link)
                .frame(minWidth: 960, minHeight: 600)
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
            PlaybackCommands(engine: appDelegate.engine)
        }

        Settings {
            SettingsView(engine: appDelegate.engine)
        }
    }
}

/// The Playback menu: every show control, with its key.
///
/// The keys are written into the item names instead of being set as menu
/// shortcuts. A menu shortcut on a plain key (Space, S) could fire while
/// someone is typing a cue name; the app's own key handler already skips
/// text boxes.
struct PlaybackCommands: Commands {
    @ObservedObject var engine: Engine

    var body: some Commands {
        CommandMenu("Playback") {
            Button("GO (Space)") { engine.go() }
            Button(engine.status == .paused ? "Resume (P)" : "Pause (P)") { engine.togglePause() }
            Button("Stop (S)") { engine.stop() }
            Button("Fade and Stop All (F)") { engine.fadeStopAll() }
            Button("All Stop (Esc)") { engine.allStop() }
            Divider()
            Button(engine.openOutputs.isEmpty ? "Open All Outputs" : "Close All Outputs") { engine.toggleOutput() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Button("Identify Outputs") { engine.identifyOutputs() }
                .disabled(engine.openOutputs.isEmpty)
            Divider()
            Button("Stop All Pads") { engine.pads.stopAll() }
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
        // The Dock tile always shows the app's own icon, even if the Dock
        // remembered an older one.
        if let icon = Bundle.main.image(forResource: "Outrangutan") { NSApp.applicationIconImage = icon }
        (Appearance(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "") ?? .system).apply()
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
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            switch key {
            case "s": self.engine.stop(); return nil
            case "p": self.engine.togglePause(); return nil
            case "f": self.engine.fadeStopAll(); return nil
            default:
                // A pad's hotkey hits it. Holding the key down does not repeat.
                if let pad = self.engine.pads.pad(forKey: key) {
                    if !event.isARepeat { self.engine.pads.fire(pad.id) }
                    return nil
                }
                return event
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
