import AppKit
import SwiftUI
import VixelCore

@main
struct VixelApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // One setup, one control window.
        Window("Vixel", id: "main") {
            ControlView(stage: appDelegate.stage, output: appDelegate.output)
                .frame(minWidth: 980, minHeight: 600)
                .defaultAppStorage(TestSnapshot.defaults ?? .standard)
        }
        .defaultSize(width: 1280, height: 780)
        .commands {
            // Vixel has one setup and saves it by itself: no New, Open or Save.
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .saveItem) {}
            SurfaceCommands(stage: appDelegate.stage)
            CommandGroup(after: .sidebar) {
                Divider()
                LearnModeToggle()
            }
            CommandGroup(before: .windowList) {
                Button("Show Output") { appDelegate.output.place() }
                    .keyboardShortcut("0")
                Divider()
            }
        }
    }
}

/// The Surface menu: the same tools as the toolbar, with keys.
struct SurfaceCommands: Commands {
    @ObservedObject var stage: Stage

    var body: some Commands {
        CommandMenu("Surface") {
            Button("Add Surface") { stage.addSurface() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Delete Surface\u{2026}") { stage.askingToDelete = stage.selectedSurface }
                .keyboardShortcut(.delete, modifiers: [.command])
                .disabled(stage.selectedSurface == nil)
            Divider()
            Toggle("Edit", isOn: $stage.editing)
                .keyboardShortcut("e")
            Toggle("Grid on All", isOn: $stage.gridOnAll)
                .keyboardShortcut("g")
        }
    }
}

/// View menu: Learn Mode shows or hides every ⓘ.
struct LearnModeToggle: View {
    @AppStorage("learnMode") private var learnMode = true

    var body: some View {
        Toggle("Learn Mode", isOn: $learnMode)
            .keyboardShortcut("l", modifiers: [.command, .shift])
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let stage = Stage(file: TestSnapshot.setupFile ?? SetupFile.standard)
    lazy var output = OutputController(stage: stage)
    private var keyWatcher: Any?
    private var showActivity: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if let icon = Bundle.main.image(forResource: "Vixel") { NSApp.applicationIconImage = icon }
        if MapRenderer.shared == nil {
            let alert = NSAlert()
            alert.messageText = "This Mac's graphics cannot draw Vixel's picture."
            alert.informativeText = "Vixel needs a Mac with Metal graphics."
            alert.runModal()
        }

        // The arrow keys move the picked corner: 1 pixel, or 10 with Shift.
        // Escape lets go of it. Typing in a box always wins.
        keyWatcher = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if NSApp.modalWindow != nil || NSApp.keyWindow?.firstResponder is NSText { return event }
            if !event.modifierFlags.intersection([.command, .control, .option]).isEmpty { return event }
            let step: Double = event.modifierFlags.contains(.shift) ? 10 : 1
            let move: (Double, Double)?
            switch event.keyCode {
            case 123: move = (-step, 0)     // left
            case 124: move = (step, 0)      // right
            case 125: move = (0, step)      // down
            case 126: move = (0, -step)     // up
            case 53:                        // Escape
                if self.stage.selectedCorner != nil { self.stage.selectedCorner = nil; return nil }
                return event
            default: move = nil
            }
            if let (dx, dy) = move, self.stage.nudgeSelectedCorner(dx: dx, dy: dy) { return nil }
            return event
        }

        // Tell macOS a show may be running: never let the screens sleep, and
        // never slow the picture down.
        showActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .latencyCritical, .idleDisplaySleepDisabled],
            reason: "Vixel is sending a picture to the output"
        )

        if TestSnapshot.isOn { return TestSnapshot.run(stage: stage, output: output) }
        NSApp.activate(ignoringOtherApps: true)
        // Once the control window is up, put the output where it belongs.
        output.placeWhenReady()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stage.saveNow()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
