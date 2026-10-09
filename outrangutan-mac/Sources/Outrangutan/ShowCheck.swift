import AppKit
import IOKit.ps
import SwiftUI

/// Show Check: everything that can bite in the middle of a show, checked in
/// one go before it starts, each with a way to fix it.
struct CheckItem: Identifiable {
    enum Level: Int { case problem, warning, good }
    let id = UUID()
    let level: Level
    let title: String
    var detail = ""
    var fix: (label: String, action: () -> Void)?
}

enum ShowCheck {
    @MainActor static func run(engine: Engine, link: ShowLink, obs: ObsClient) -> [CheckItem] {
        var items: [CheckItem] = []

        // Media
        let lostCues = engine.cues.enumerated().filter { !$0.element.fileIsThere }
        if engine.cues.isEmpty {
            items.append(CheckItem(level: .warning, title: "The cue list is empty", detail: "Add media, or open a show file."))
        } else if lostCues.isEmpty {
            items.append(CheckItem(level: .good, title: "Every cue's file is here", detail: ShowFiles.count(engine.cues.count, "cue")))
        } else {
            let names = lostCues.prefix(3).map { "\($0.offset + 1). \($0.element.name)" }.joined(separator: ", ")
            let first = lostCues[0].element.id
            items.append(CheckItem(level: .problem, title: "\(ShowFiles.count(lostCues.count, "cue")) can't find \(lostCues.count == 1 ? "its file" : "their files")",
                                   detail: names + (lostCues.count > 3 ? ", and more" : "") + (lostCues.count == 1 ? ". It was moved or deleted." : ". They were moved or deleted."),
                                   fix: ("Stand By the First", { engine.standbyID = first })))
        }
        let lostPads = engine.pads.pads.filter { !$0.fileIsThere || engine.pads.length($0.id) == nil }
        if !engine.pads.pads.isEmpty {
            items.append(lostPads.isEmpty
                ? CheckItem(level: .good, title: "Every pad is loaded", detail: ShowFiles.count(engine.pads.pads.count, "pad"))
                : CheckItem(level: .problem, title: "\(ShowFiles.count(lostPads.count, "pad")) won't play",
                            detail: lostPads.prefix(3).map(\.name).joined(separator: ", ") + ": the file is missing or would not load."))
        }
        if engine.standbyCue == nil && !engine.cues.isEmpty {
            items.append(CheckItem(level: .warning, title: "Nothing is standing by", detail: "GO does nothing until a cue stands by.",
                                   fix: ("Stand By Cue 1", { engine.standbyID = engine.cues.first?.id })))
        }

        // Outputs
        let screens = NSScreen.screens.map(\.localizedName)
        for output in engine.outputs {
            if let name = output.screen, !screens.contains(name) {
                items.append(CheckItem(level: .problem, title: "\(output.label): its screen is not connected",
                                       detail: "\u{201C}\(name)\u{201D} is missing. Plug it in, or pick another screen in Settings, Outputs."))
            }
        }
        let closed = engine.outputs.filter { !engine.openOutputs.contains($0.id) }
        if closed.isEmpty {
            items.append(CheckItem(level: .good, title: engine.outputs.count == 1 ? "The output is open" : "Every output is open",
                                   detail: engine.outputs.map(\.label).joined(separator: ", ")))
        } else {
            items.append(CheckItem(level: .warning, title: "\(closed.map(\.label).joined(separator: ", ")) \(closed.count == 1 ? "is" : "are") closed",
                                   detail: "Pictures on a closed output go nowhere.",
                                   fix: ("Open All Outputs", { engine.openOutput() })))
        }
        if screens.count < 2 {
            items.append(CheckItem(level: .warning, title: "Only one screen is connected",
                                   detail: "The output opens as a window on this screen. Connect the program screen or the switcher's input."))
        }

        // Sound
        let lostDevices = [engine.audio.cueDevice, engine.audio.padDevice].compactMap { $0 }
            + engine.outputs.compactMap(\.audioDevice)
        let missing = Set(lostDevices.filter { AudioDevices.device(uid: $0) == nil })
        items.append(missing.isEmpty
            ? CheckItem(level: .good, title: "Sound devices are connected",
                        detail: "Cues play to \(engine.cueSound.isOn ? engine.cueSound.note : (AudioDevices.device(uid: engine.audio.cueDevice)?.name ?? AudioDevices.defaultOutput()?.name ?? "the Mac"))")
            : CheckItem(level: .problem, title: "A sound device is missing",
                        detail: "\(missing.count == 1 ? "A device" : "\(missing.count) devices") picked in Settings, Sound or Outputs is unplugged. That sound goes to the Mac's own output instead."))
        if engine.masterGain < 0.05 {
            items.append(CheckItem(level: .warning, title: "The master volume is all the way down",
                                   fix: ("Set to 100%", { engine.setGain(1) })))
        }

        // Power and disk
        if onBattery() {
            items.append(CheckItem(level: .warning, title: "This Mac is on battery", detail: "Plug in the power adapter so it can't run down mid-show."))
        } else {
            items.append(CheckItem(level: .good, title: "Plugged in"))
        }
        if ProcessInfo.processInfo.isLowPowerModeEnabled {
            items.append(CheckItem(level: .warning, title: "Low Power Mode is on",
                                   detail: "It can slow video. Turn it off in System Settings, Battery."))
        }
        if let free = freeSpace(), free < 5_000_000_000 {
            items.append(CheckItem(level: .warning, title: "The disk is nearly full",
                                   detail: String(format: "%.1f GB free. Recordings and opened shows need room.", Double(free) / 1e9)))
        }

        // Links
        if !link.code.isEmpty {
            items.append(link.phase == .linked
                ? CheckItem(level: .good, title: "Connected to show \(link.code)", detail: "The rundown and KeyWi Bird reach this Mac.")
                : CheckItem(level: .problem, title: "Not hearing show \(link.code)", detail: link.message + ". The rundown's fires won't arrive until it reconnects."))
        } else {
            items.append(CheckItem(level: .warning, title: "Not connected to a show",
                                   detail: "Only this Mac's own keys run it. Connect to take fires from the rundown and KeyWi Bird.",
                                   fix: ("Connect\u{2026}", { NotificationCenter.default.post(name: .showConnect, object: nil) })))
        }
        let usesObs = engine.cues.contains { $0.obs.action != .none || !$0.obsTriggerScene.isEmpty }
        if usesObs && !obs.isConnected {
            items.append(CheckItem(level: .warning, title: "Cues use OBS, but OBS is not connected",
                                   fix: ("Connect OBS", { obs.connect() })))
        }

        // Last: the lock.
        items.append(engine.locked
            ? CheckItem(level: .good, title: "Editing is locked")
            : CheckItem(level: .warning, title: "Editing is not locked", detail: "Lock it so a stray click can't change the show.",
                        fix: ("Lock Editing", { engine.locked = true })))
        return items.sorted { $0.level.rawValue < $1.level.rawValue }
    }

    static func onBattery() -> Bool {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() else { return false }
        return (type as String) == kIOPSBatteryPowerValue
    }

    static func freeSpace() -> Int64? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return (try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
    }
}

/// The Show Check sheet.
struct ShowCheckView: View {
    let engine: Engine
    let link: ShowLink
    @State private var items: [CheckItem] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: problems == 0 && warnings == 0 ? "checkmark.seal.fill" : (problems > 0 ? "xmark.octagon.fill" : "exclamationmark.triangle.fill"))
                    .font(.largeTitle)
                    .foregroundStyle(problems > 0 ? Color.red : (warnings > 0 ? Color.orange : Color.green))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Show Check").font(.title2.weight(.semibold))
                    Text(summary).foregroundStyle(.secondary)
                }
            }
            .padding(20)
            Divider()
            List(items) { item in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: symbol(item.level)).foregroundStyle(color(item.level)).font(.title3).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).font(.body.weight(.medium))
                        if !item.detail.isEmpty { Text(item.detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                    }
                    Spacer()
                    if let fix = item.fix {
                        Button(fix.label) { fix.action(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { refresh() } }
                            .buttonWidth(150)
                    }
                }
                .padding(.vertical, 3)
            }
            .listStyle(.inset(alternatesRowBackgrounds: true))
            Divider()
            HStack {
                Button("Check Again") { refresh() }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
                    .buttonStyle(ActionStyle(prominent: true))
            }
            .padding(16)
            .buttonWidth(120)
        }
        .frame(width: 560, height: 560)
        .buttonStyle(ActionStyle())
        .onAppear(perform: refresh)
    }

    private var problems: Int { items.filter { $0.level == .problem }.count }
    private var warnings: Int { items.filter { $0.level == .warning }.count }
    private var summary: String {
        if problems == 0 && warnings == 0 { return "Ready for the show." }
        return [problems > 0 ? ShowFiles.count(problems, "problem") : nil, warnings > 0 ? ShowFiles.count(warnings, "thing", "things") + " to look at" : nil]
            .compactMap { $0 }.joined(separator: " and ") + "."
    }

    private func refresh() { items = ShowCheck.run(engine: engine, link: link, obs: ObsClient.shared) }

    private func symbol(_ l: CheckItem.Level) -> String {
        switch l {
        case .problem: return "xmark.octagon.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .good: return "checkmark.circle.fill"
        }
    }

    private func color(_ l: CheckItem.Level) -> Color {
        switch l {
        case .problem: return .red
        case .warning: return .orange
        case .good: return .green
        }
    }
}
