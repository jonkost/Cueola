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
            FileCommands(files: appDelegate.files, watch: appDelegate.watch)
            CommandGroup(after: .sidebar) {
                Button("Show or Hide Inspector") {
                    NotificationCenter.default.post(name: .toggleInspector, object: nil)
                }
                .keyboardShortcut("i")
                MonitorToggles()
            }
            PlaybackCommands(engine: appDelegate.engine)
            CommandGroup(after: .pasteboard) {
                Divider()
                DuplicateButton(engine: appDelegate.engine)
            }
            CommandGroup(replacing: .help) { HelpButton() }
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

        // Help, in plain words (Help menu, Command-?).
        Window("Outrangutan Help", id: "help") { HelpView() }
            .defaultSize(width: 860, height: 560)

        Settings {
            SettingsView(engine: appDelegate.engine, midi: appDelegate.midi, watch: appDelegate.watch)
        }
    }
}

/// The File menu: show files, and connecting to a show in the cloud.
struct FileCommands: Commands {
    @ObservedObject var files: ShowFiles
    let watch: WatchFolder

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Show") { files.newShow() }
                .keyboardShortcut("n")
                .disabled(files.engine.locked)
            Button("Open Show\u{2026}") { files.chooseAndOpen() }
                .keyboardShortcut("o")
                .disabled(files.engine.locked)
            Button("Watch a Folder\u{2026}") { watch.choose() }
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

/// Edit menu: a copy of the cue standing by.
struct DuplicateButton: View {
    @ObservedObject var engine: Engine

    var body: some View {
        Button("Duplicate Cue") { if let id = engine.standbyID { engine.duplicate(id) } }
            .keyboardShortcut("d")
            .disabled(engine.locked || engine.standbyID == nil)
    }
}

/// View menu: the program preview strip and its scopes.
struct MonitorToggles: View {
    @AppStorage("ui.monitor") private var showMonitor = true
    @AppStorage("ui.scopes") private var showScopes = true
    @AppStorage("ui.tab") private var tab = "cues"

    var body: some View {
        Button("Cues") { tab = "cues" }.keyboardShortcut("1")
        Button("Pads") { tab = "pads" }.keyboardShortcut("2")
        Divider()
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
            Button("Show Check\u{2026}") { NotificationCenter.default.post(name: .showCheck, object: nil) }
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
    let obs = ObsClient.shared
    lazy var watch = WatchFolder(engine: engine)
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
            // A sheet (Connect, Record a Sound) or Settings is in front: its
            // own buttons get the keys, never GO.
            if let key = NSApp.keyWindow, key.sheetParent != nil || key.identifier?.rawValue.contains("Settings") == true { return event }
            if !event.modifierFlags.intersection([.command, .control, .option]).isEmpty { return event }
            // Settings is waiting for a new key: let it have this one.
            if KeyMap.shared.recording != nil { return event }
            // Holding a key down never fires it twice.
            if let action = KeyMap.shared.action(for: event) {
                if !event.isARepeat { self.engine.perform(action) }
                return nil
            }
            // Up and down arrows move the standby, unless a list, slider or
            // menu has the keys (it uses the arrows itself).
            if event.keyCode == 125 || event.keyCode == 126 {
                if NSApp.keyWindow?.firstResponder is NSControl { return event }
                self.engine.moveStandby(event.keyCode == 125 ? 1 : -1)
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
        _ = watch
        obs.onScene = { [weak self] scene in self?.engine.obsSceneChanged(scene) }
        obs.onLog = { [weak self] kind, text in self?.engine.log.add(kind, text, from: "OBS") }
        engine.onCueBegan = { [weak self] cue in self?.obs.fire(cue.obs, for: cue.name) }
        if TestSnapshot.isOn { return TestSnapshot.runIfAsked(engine: engine, link: link, files: files, midi: midi, scopes: scopes, watch: watch) }
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
