import AppKit
import SwiftUI

@main
struct OutrangutanApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // One show, one control window.
        Window("Outrangutan", id: "main") {
            ControlView(engine: appDelegate.engine, link: appDelegate.link, files: appDelegate.files, scopes: appDelegate.scopes)
                .frame(minWidth: 960, minHeight: 600)
        }
        .commands {
            FileCommands(files: appDelegate.files)
            CommandGroup(after: .sidebar) {
                Button("Show or Hide Inspector") {
                    NotificationCenter.default.post(name: .toggleInspector, object: nil)
                }
                .keyboardShortcut("i")
                MonitorToggles()
            }
            PlaybackCommands(engine: appDelegate.engine)
            CommandGroup(before: .windowList) {
                OpenLogButton()
                Divider()
            }
        }

        // The show log: its own window, from the Window menu or Command-L.
        Window("Show Log", id: "log") {
            ShowLogView(log: appDelegate.engine.log) { [files = appDelegate.files] in files.showName }
        }
        .defaultSize(width: 720, height: 480)

        Settings {
            SettingsView(engine: appDelegate.engine, midi: appDelegate.midi)
        }
    }
}

/// The File menu: show files, and connecting to a show in the cloud.
struct FileCommands: Commands {
    @ObservedObject var files: ShowFiles

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Show") { files.newShow() }
                .keyboardShortcut("n")
                .disabled(files.engine.locked)
            Button("Open Show\u{2026}") { files.chooseAndOpen() }
                .keyboardShortcut("o")
                .disabled(files.engine.locked)
            Divider()
            Button("Connect to a Show\u{2026}") {
                NotificationCenter.default.post(name: .showConnect, object: nil)
            }
            .keyboardShortcut("k")
        }
        CommandGroup(replacing: .printItem) {
            Button("Print Cue Sheet\u{2026}") { Printer.printCueSheet(engine: files.engine, showName: files.showName) }
                .keyboardShortcut("p")
                .disabled(!files.hasShow)
        }
        CommandGroup(replacing: .saveItem) {
            Button("Save Show") { files.save() }
                .keyboardShortcut("s")
            Button("Save Show As\u{2026}") { files.saveAs() }
                .keyboardShortcut("s", modifiers: [.command, .shift])
            if let file = files.currentFile {
                Button("Show the Show File in Finder") { NSWorkspace.shared.activateFileViewerSelecting([file]) }
            }
        }
    }
}

/// View menu: the program preview strip and its scopes.
struct MonitorToggles: View {
    @AppStorage("ui.monitor") private var showMonitor = true
    @AppStorage("ui.scopes") private var showScopes = true

    var body: some View {
        Toggle("Program Preview", isOn: $showMonitor)
            .keyboardShortcut("p", modifiers: [.command, .option])
        Toggle("Scopes", isOn: $showScopes)
            .keyboardShortcut("s", modifiers: [.command, .option])
            .disabled(!showMonitor)
    }
}

/// Window menu: opens the show log.
struct OpenLogButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Show Log") { openWindow(id: "log") }
            .keyboardShortcut("l")
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
    @ObservedObject var keys = KeyMap.shared

    var body: some Commands {
        CommandMenu("Playback") {
            Button("GO (\(keys.name(.go)))") { engine.go() }
            Button(engine.status == .paused ? "Resume (\(keys.name(.pause)))" : "Pause (\(keys.name(.pause)))") { engine.togglePause() }
            Button("Stop (\(keys.name(.stop)))") { engine.stop() }
            Button("Fade and Stop All (\(keys.name(.fade)))") { engine.fadeStopAll() }
            Button("All Stop (\(keys.name(.allStop)))") { engine.allStop() }
            Divider()
            Toggle("Lock Editing", isOn: $engine.locked)
                .keyboardShortcut("l", modifiers: [.command, .shift])
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
    lazy var files = ShowFiles(engine: engine)
    lazy var midi = MidiInput(engine: engine)
    lazy var direct = DirectLink(link: link)
    lazy var scopes = Scopes(engine: engine)
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
        // Show keys work anywhere in the app, except while typing in a box.
        // (Test mode has them too: it stays in the background, so only the
        // test's own pretend key presses reach it.)
        keyWatcher = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if NSApp.keyWindow?.firstResponder is NSText { return event }
            if !event.modifierFlags.intersection([.command, .control, .option]).isEmpty { return event }
            // Settings is waiting for a new key: let it have this one.
            if KeyMap.shared.recording != nil { return event }
            // Holding a key down never fires it twice.
            if let action = KeyMap.shared.action(for: event) {
                if !event.isARepeat { self.engine.perform(action) }
                return nil
            }
            // A pad's hotkey hits it.
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            if let pad = self.engine.pads.pad(forKey: key) {
                if !event.isARepeat { self.engine.pads.fire(pad.id) }
                return nil
            }
            return event
        }
        _ = link
        _ = midi
        _ = direct
        if TestSnapshot.isOn { return TestSnapshot.runIfAsked(engine: engine, link: link, files: files, midi: midi, scopes: scopes) }
        NSApp.activate(ignoringOtherApps: true)

        // Tell macOS a show is running: never nap this app, never slow its
        // timers, never let the screens go to sleep.
        showActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .latencyCritical, .idleDisplaySleepDisabled],
            reason: "Outrangutan is running a show"
        )

    }

    /// A show file double-clicked in Finder, or dropped on the Dock icon.
    func application(_ application: NSApplication, open urls: [URL]) {
        guard !TestSnapshot.isOn, let url = urls.first else { return }
        files.open(url)
    }

    func applicationWillTerminate(_ notification: Notification) {
        engine.quitting()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
