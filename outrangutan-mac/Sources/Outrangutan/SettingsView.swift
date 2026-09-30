import AppKit
import SwiftUI

/// Settings (Outrangutan menu, Command-comma): how the app looks, the
/// outputs, and where sound goes.
struct SettingsView: View {
    @ObservedObject var engine: Engine
    let midi: MidiInput
    let watch: WatchFolder

    var body: some View {
        TabView {
            GeneralSettings(watch: watch)
                .tabItem { Label("General", systemImage: "gearshape") }
            OutputSettings(engine: engine)
                .tabItem { Label("Outputs", systemImage: "rectangle.on.rectangle") }
            SoundSettings(engine: engine)
                .tabItem { Label("Sound", systemImage: "speaker.wave.2") }
            KeySettings(board: engine.pads)
                .tabItem { Label("Keys", systemImage: "keyboard") }
            MidiSettings(midi: midi, engine: engine)
                .tabItem { Label("MIDI", systemImage: "pianokeys") }
            ObsSettings(obs: ObsClient.shared)
                .tabItem { Label("OBS", systemImage: "video.circle") }
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
    let watch: WatchFolder

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
            WatchFolderSection(watch: watch)
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
                TextField("Standby text", text: $engine.standbyText, prompt: Text("Empty shows black"))
            } footer: {
                Text("Words every output shows while nothing is on air, like the show's name or \u{201C}We'll be right back.\u{201D}")
                    .foregroundStyle(.secondary)
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
    @State private var fallback = AudioDevices.defaultOutput()

    var body: some View {
        Form {
            Section {
                Picker("Plays to", selection: $engine.audio.cueDevice) {
                    Text("The Mac's sound output").tag(String?.none)
                    ForEach(devices) { Text($0.name).tag(String?.some($0.uid)) }
                }
                Picker("Channels", selection: $engine.audio.cueFirstChannel) {
                    ForEach(pairs(for: engine.audio.cueDevice, picked: engine.audio.cueFirstChannel), id: \.self) { first in
                        Text(pairName(first, on: engine.audio.cueDevice)).tag(first)
                    }
                }
                .disabled(pairs(for: engine.audio.cueDevice, picked: engine.audio.cueFirstChannel).count < 2)
            } header: {
                Text("Cue sound")
            } footer: {
                Text("Sound cues, and the sound of videos whose output has no sound device of its own. On an audio interface, cue sound can take its own pair, for its own fader on the board. A change of pair takes effect with the next cue.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Picker("Plays to", selection: $engine.audio.padDevice) {
                    Text("The Mac's sound output").tag(String?.none)
                    ForEach(devices) { Text($0.name).tag(String?.some($0.uid)) }
                }
                Picker("Channels", selection: $engine.audio.padFirstChannel) {
                    ForEach(pairs(for: engine.audio.padDevice, picked: engine.audio.padFirstChannel), id: \.self) { first in
                        Text(pairName(first, on: engine.audio.padDevice)).tag(first)
                    }
                }
                .disabled(pairs(for: engine.audio.padDevice, picked: engine.audio.padFirstChannel).count < 2)
                Toggle("Duck cue sound under pads", isOn: $engine.audio.duckUnderPads)
                Picker("By", selection: $engine.audio.duckDb) {
                    Text("6 dB (a little)").tag(6.0)
                    Text("12 dB (half as loud)").tag(12.0)
                    Text("20 dB (well under)").tag(20.0)
                }
                .disabled(!engine.audio.duckUnderPads)
            } header: {
                Text("Pads")
            } footer: {
                Text("On an audio interface with more than two outputs, pads can play on their own pair, for their own fader on the board. Ducking turns the cue sound down while any pad sounds (a music bed under a stinger), and brings it back up over about a second.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Check Sound Devices Again") { devices = AudioDevices.outputs(); fallback = AudioDevices.defaultOutput() }
            }
        }
        .formStyle(.grouped)
    }

    /// Channel pairs a device offers: 0 is 1 and 2, 2 is 3 and 4, and so on.
    /// The pair already picked is always listed, even when the device that
    /// offered it is unplugged, so the choice shows and can be changed.
    private func pairs(for uid: String?, picked: Int) -> [Int] {
        let channels = device(uid)?.channels ?? 2
        var pairs = stride(from: 0, to: max(2, channels) - 1, by: 2).map { $0 }
        if !pairs.contains(picked) { pairs.append(picked) }
        return pairs
    }

    private func pairName(_ first: Int, on uid: String?) -> String {
        let missing = first + 2 > (device(uid)?.channels ?? 2)
        return "\(first + 1) and \(first + 2)" + (missing ? " (not on this device)" : "")
    }

    /// From the list already fetched: asking the Mac for its sound devices
    /// on every redraw is slow enough to hold up a cue starting.
    private func device(_ uid: String?) -> AudioDevice? {
        devices.first { $0.uid == uid } ?? fallback
    }
}
