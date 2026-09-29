import AppKit
import SwiftUI

/// Settings (Outrangutan menu, Command-comma): how the app looks, the
/// outputs, and where sound goes.
struct SettingsView: View {
    @ObservedObject var engine: Engine

    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("General", systemImage: "gearshape") }
            OutputSettings(engine: engine)
                .tabItem { Label("Outputs", systemImage: "rectangle.on.rectangle") }
            SoundSettings(engine: engine)
                .tabItem { Label("Sound", systemImage: "speaker.wave.2") }
            KeySettings(board: engine.pads)
                .tabItem { Label("Keys", systemImage: "keyboard") }
        }
        .frame(width: 560, height: 470)
    }
}

/// How the app looks. The output is always black behind the picture.
enum Appearance: String, CaseIterable {
    case system, dark, light

    var label: String {
        switch self {
        case .system: return "Match the Mac"
        case .dark: return "Dark"
        case .light: return "Light"
        }
    }

    func apply() {
        switch self {
        case .system: NSApp.appearance = nil
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        }
    }
}

struct GeneralSettings: View {
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(Appearance.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
                }
                .pickerStyle(.radioGroup)
                .onChange(of: appearance) { _, value in (Appearance(rawValue: value) ?? .system).apply() }
            } footer: {
                Text("Dark is easiest on the eyes in a control room.").foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

struct OutputSettings: View {
    @ObservedObject var engine: Engine
    @State private var screens = NSScreen.screens.map(\.localizedName)
    @State private var devices = AudioDevices.outputs()

    var body: some View {
        Form {
            ForEach($engine.outputs) { $output in
                Section {
                    TextField("Name", text: $output.label)
                    Picker("Screen", selection: $output.screen) {
                        Text("Pick one on its own").tag(String?.none)
                        ForEach(screens, id: \.self) { Text($0).tag(String?.some($0)) }
                    }
                    Picker("Video sound", selection: $output.audioDevice) {
                        Text("Same as cue sound").tag(String?.none)
                        ForEach(devices) { Text($0.name).tag(String?.some($0.uid)) }
                    }
                } header: {
                    HStack {
                        Text("Output \(output.id)")
                        Spacer()
                        Toggle("Open", isOn: Binding(
                            get: { engine.openOutputs.contains(output.id) },
                            set: { $0 ? engine.openOutput(output.id) : engine.closeOutput(output.id) }
                        ))
                        .toggleStyle(.switch)
                        .controlSize(.small)
                        if engine.outputs.count > 1 {
                            Button("Remove", role: .destructive) { engine.removeOutput(output.id) }
                                .buttonStyle(.borderless)
                        }
                    }
                }
            }
            Section {
                HStack {
                    Button("Add Output") { engine.addOutput() }
                        .disabled(engine.outputs.count >= OutputConfig.most)
                    Button("Identify") { engine.identifyOutputs() }
                        .disabled(engine.openOutputs.isEmpty)
                        .help("Shows each open output's number on its screen for three seconds.")
                    Spacer()
                    Button("Check Screens Again") {
                        screens = NSScreen.screens.map(\.localizedName)
                        devices = AudioDevices.outputs()
                    }
                }
            } footer: {
                Text("A cue picks its output in the Inspector's Picture tab. With one screen, an output opens as a window.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

struct SoundSettings: View {
    @ObservedObject var engine: Engine
    @State private var devices = AudioDevices.outputs()

    var body: some View {
        Form {
            Section {
                Picker("Plays to", selection: $engine.audio.cueDevice) {
                    Text("The Mac's sound output").tag(String?.none)
                    ForEach(devices) { Text($0.name).tag(String?.some($0.uid)) }
                }
            } header: {
                Text("Cue sound")
            } footer: {
                Text("Sound cues, and the sound of videos whose output has no sound device of its own. Plays on the device's first two channels.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Picker("Plays to", selection: $engine.audio.padDevice) {
                    Text("The Mac's sound output").tag(String?.none)
                    ForEach(devices) { Text($0.name).tag(String?.some($0.uid)) }
                }
                Picker("Channels", selection: $engine.audio.padFirstChannel) {
                    ForEach(pairs, id: \.self) { first in
                        Text("\(first + 1) and \(first + 2)").tag(first)
                    }
                }
                .disabled(pairs.count < 2)
            } header: {
                Text("Pads")
            } footer: {
                Text("On an audio interface with more than two outputs, pads can play on their own pair, for their own fader on the board.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Check Sound Devices Again") { devices = AudioDevices.outputs() }
            }
        }
        .formStyle(.grouped)
    }

    /// Channel pairs the pad device offers: 0 is 1 and 2, 2 is 3 and 4, and so on.
    private var pairs: [Int] {
        let device = AudioDevices.device(uid: engine.audio.padDevice) ?? AudioDevices.defaultOutput()
        let channels = device?.channels ?? 2
        return stride(from: 0, to: max(2, channels) - 1, by: 2).map { $0 }
    }
}
