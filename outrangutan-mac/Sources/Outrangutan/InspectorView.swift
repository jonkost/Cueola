import OutrangutanCore
import AppKit
import SwiftUI

/// The Inspector: every setting for the cue standing by, one group at a
/// time. Changes save at once. Volume and framing change on air right away;
/// timing counts from the cue's next GO.
struct InspectorView: View {
    @ObservedObject var engine: Engine
    @ObservedObject private var obs = ObsClient.shared
    @AppStorage("inspector.cueTab") private var tab = "cue"

    var body: some View {
        if let cue = engine.standbyCue {
            VStack(spacing: 0) {
                InspectorTabs(tabs: tabs(for: cue), selection: $tab)
                Divider()
                InspectorPage {
                    if engine.locked { LockedNote() }
                    Group {
                        switch tab {
                        case "timing": timing(cue)
                        case "sound": sound(cue)
                        case "fades": fades(cue)
                        case "picture": picture(cue)
                        default: general(cue)
                        }
                    }
                    .disabled(engine.locked)
                }
            }
            .id(cue.kind)   // re-check the tab list when the kind changes
        } else {
            InspectorEmpty(title: "No cue standing by", symbol: "slider.horizontal.3",
                           message: "Click a cue to see its settings.")
        }
    }

    private func tabs(for cue: Cue) -> [InspectorTab] {
        var t = [InspectorTab(id: "cue", title: "Cue", symbol: "info.circle"),
                 InspectorTab(id: "timing", title: "Timing", symbol: "clock")]
        if !cue.kind.holds { t.append(InspectorTab(id: "sound", title: "Trim and Sound", symbol: "speaker.wave.2")) }
        t.append(InspectorTab(id: "fades", title: "Fades", symbol: "circle.lefthalf.filled"))
        if cue.kind.hasPicture { t.append(InspectorTab(id: "picture", title: "Picture", symbol: "photo")) }
        return t
    }

    // MARK: Pages

    @ViewBuilder
    private func general(_ cue: Cue) -> some View {
        InspectorSection(title: "Cue") {
            TextField("Name", text: bind(cue, \.name)).textFieldStyle(.roundedBorder)
            TextField("Notes", text: bind(cue, \.notes), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...5)
            InspectorRow("Color") {
                HStack(spacing: 6) {
                    ForEach(CueLabel.allCases, id: \.self) { l in
                        let on = live(cue).label == l
                        Button { engine.update(cue.id) { $0.label = l } } label: {
                            ZStack {
                                Circle().fill(l == .none ? Color.secondary.opacity(0.15) : ControlView.color(l))
                                if l == .none { Image(systemName: "nosign").font(.caption2).foregroundStyle(.secondary) }
                            }
                            .frame(width: 18, height: 18)
                            .overlay(Circle().strokeBorder(Color.primary.opacity(on ? 0.9 : 0), lineWidth: 2).padding(-3))
                        }
                        .buttonStyle(.plain)
                        .help(l.label)
                        .accessibilityLabel("Color \(l.label)")
                    }
                }
            }
            InspectorRow("Fire on GO") { Toggle("", isOn: bind(cue, \.armed)).labelsHidden().toggleStyle(.switch) }
                .help("Off: GO skips this cue. The rundown and the deck can still fire it.")
            InspectorRow("Hotkey") {
                Picker("Hotkey", selection: bind(cue, \.hotkey)) {
                    Text("None").tag("")
                    ForEach(PadBoard.keys, id: \.self) { k in
                        Text(k.uppercased() + hotkeyNote(k, for: cue)).tag(k)
                    }
                }
                .labelsHidden().frame(width: 150)
            }
            .help("A key that fires this cue from anywhere, wherever the standby is. A pad with the same key wins.")
        }
        InspectorSection(title: "Sound effect with this cue",
                         note: "The pad fires when the cue starts (after the wait), plays through it, and fades out when the cue leaves air.") {
            InspectorRow("Pad") {
                Picker("Pad", selection: bind(cue, \.sfxPadId)) {
                    Text("None").tag("")
                    ForEach(engine.pads.banks) { bank in
                        ForEach(engine.pads.pads.filter { $0.bank == bank.id }.sorted { $0.slot < $1.slot }) { pad in
                            Text("\(bank.name): \(pad.emoji.isEmpty ? "" : pad.emoji + " ")\(pad.name)").tag(pad.id)
                        }
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 180, alignment: .trailing)
            }
            if !live(cue).sfxPadId.isEmpty {
                NumberField(label: "After", value: bind(cue, \.sfxDelay), step: 0.5)
            }
        }
        obsSection(cue)
        if cue.kind != .matte {
            InspectorSection(title: "File") {
                Text(cue.url.lastPathComponent).foregroundStyle(cue.fileIsThere ? .secondary : Color.orange)
                    .lineLimit(1).truncationMode(.middle)
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([cue.url]) }
            }
        }
    }

    /// Who else has a hotkey, so a clash is seen before it is picked.
    private func hotkeyNote(_ k: String, for cue: Cue) -> String {
        if let pad = engine.pads.pad(forKey: k) { return " (pad \u{201C}\(pad.name)\u{201D})" }
        if let other = engine.cues.first(where: { $0.hotkey == k && $0.id != cue.id }) { return " (cue \u{201C}\(other.name)\u{201D})" }
        return ""
    }

    @ViewBuilder
    private func timing(_ cue: Cue) -> some View {
        InspectorSection(title: "Start", note: startNote(cue)) {
            NumberField(label: "Pre-wait", value: bind(cue, \.preWait), step: 0.5)
            InspectorRow("After it starts") {
                Picker("After it starts", selection: bind(cue, \.continueMode)) {
                    ForEach(ContinueMode.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 190)
            }
        }
        InspectorSection(title: "End", note: endNote(cue)) {
            if cue.kind.holds {
                NumberField(label: "On screen for", value: bind(cue, \.duration), step: 0.5)
            }
            InspectorRow("At the end") {
                Picker("At the end", selection: bind(cue, \.endAction)) {
                    ForEach(endChoices(cue), id: \.self) { Text(endLabel($0, cue)).tag($0) }
                }
                .labelsHidden().frame(maxWidth: 170, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func sound(_ cue: Cue) -> some View {
        InspectorSection(title: "Trim",
                         note: "Drag the yellow handles, or type the times. Stop at 0 plays to the end. Length after trim: \(Timecode.short(engine.playLength(live(cue)))).") {
            if let length = engine.durations[cue.id], length > 0 {
                TrimBar(url: cue.url, length: length, trimIn: bind(cue, \.trimIn),
                        trimOut: Binding(get: { live(cue).trimOut }, set: { v in engine.update(cue.id) { $0.trimOut = v } }))
            }
            NumberField(label: "Start at", value: bind(cue, \.trimIn), step: 0.1)
            NumberField(label: "Stop at", value: Binding(
                get: { live(cue).trimOut ?? 0 },
                set: { v in engine.update(cue.id) { $0.trimOut = v > 0 ? v : nil } }
            ), step: 0.1)
            InspectorRow("Loop") { Toggle("", isOn: bind(cue, \.loop)).labelsHidden().toggleStyle(.switch) }
        }
        InspectorSection(title: "Sound") {
            PercentSlider(label: "Volume", value: bind(cue, \.volume))
        }
    }

    @ViewBuilder
    private func fades(_ cue: Cue) -> some View {
        InspectorSection(title: "Fades",
                         note: "Fade in comes up from black and silence. Fade out ends before the cue does. Dissolve in blends from whatever is on air on the same lane.") {
            NumberField(label: "Fade in", value: bind(cue, \.fadeIn), step: 0.1)
            NumberField(label: "Fade out", value: bind(cue, \.fadeOut), step: 0.1)
            NumberField(label: "Dissolve in", value: bind(cue, \.xfade), step: 0.1)
            InspectorRow("Curve") {
                Picker("Curve", selection: bind(cue, \.fadeCurve)) {
                    ForEach(FadeCurve.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .labelsHidden().frame(maxWidth: 150, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func picture(_ cue: Cue) -> some View {
        InspectorSection(title: "Output") {
            InspectorRow("Shows on") {
                Picker("Shows on", selection: bind(cue, \.output)) {
                    ForEach(engine.outputs) { Text($0.label).tag($0.id) }
                    Divider()
                    Text("Every output").tag(0)
                }
                .labelsHidden().frame(maxWidth: 170, alignment: .trailing)
            }
        }
        if cue.kind == .matte {
            InspectorSection(title: "Color") {
                InspectorRow("Color") {
                    ColorPicker("Color", selection: Binding(
                        get: { Color(nsColor: NSColor(hex: live(cue).color) ?? .black) },
                        set: { c in engine.update(cue.id) { $0.color = NSColor(c).hexString } }
                    ), supportsOpacity: false).labelsHidden()
                }
            }
        } else {
            InspectorSection(title: "Framing") {
                InspectorRow("Fit") {
                    Picker("Fit", selection: bind(cue, \.fit)) {
                        ForEach(Fit.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .labelsHidden().frame(maxWidth: 170, alignment: .trailing)
                }
                PercentSlider(label: "Size", value: bind(cue, \.scale), range: 0.25...2)
                NumberField(label: "Move right", value: bind(cue, \.posX), unit: "%", step: 1, range: -100...100)
                NumberField(label: "Move down", value: bind(cue, \.posY), unit: "%", step: 1, range: -100...100)
                Button("Reset Framing") {
                    engine.update(cue.id) { $0.fit = .contain; $0.scale = 1; $0.posX = 0; $0.posY = 0 }
                }
            }
        }
        if cue.kind == .video { keySection(cue) }
    }

    @ViewBuilder
    private func keySection(_ cue: Cue) -> some View {
        let k = live(cue).key
        InspectorSection(title: "Key", note: keyNote(k.mode)) {
            Picker("Key", selection: bind(cue, \.key.mode)) {
                ForEach(KeyMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            if k.mode == .chroma {
                InspectorRow("Key color") { colorWell(cue, \.key.color) }
            }
            if k.mode == .chroma || k.mode == .luma {
                PercentSlider(label: "Similarity", value: bind(cue, \.key.sim))
                PercentSlider(label: "Smoothness", value: bind(cue, \.key.smooth), range: 0...0.5)
            }
            if k.mode != .off {
                InspectorRow("Background") { colorWell(cue, \.key.bg) }
            }
        }
    }

    private func keyNote(_ mode: KeyMode) -> String {
        switch mode {
        case .off: return "Takes a color, the dark parts, or the file's own see-through parts out of the picture."
        case .chroma: return "Pixels close to the key color go away. Raise Similarity until the screen is gone; Smoothness softens the edge."
        case .luma: return "Dark pixels go away: graphics made on black. Raise Similarity to take out more."
        case .alpha: return "Uses the file's own see-through parts, like a ProRes 4444 graphic."
        }
    }

    private func colorWell(_ cue: Cue, _ path: WritableKeyPath<Cue, String>) -> some View {
        ColorPicker("", selection: Binding(
            get: { Color(nsColor: NSColor(hex: live(cue)[keyPath: path]) ?? .black) },
            set: { c in engine.update(cue.id) { $0[keyPath: path] = NSColor(c).hexString } }
        ), supportsOpacity: false)
        .labelsHidden()
    }

    @ViewBuilder
    private func obsSection(_ cue: Cue) -> some View {
        let c = live(cue)
        InspectorSection(title: "OBS", note: obs.isConnected ? nil : "Connect OBS in Settings, OBS, to pick its scenes. Actions run only while it is connected.") {
            InspectorRow("When it starts") {
                Picker("When it starts", selection: bind(cue, \.obs.action)) {
                    ForEach(ObsAction.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .labelsHidden().frame(maxWidth: 170, alignment: .trailing)
            }
            if c.obs.action == .scene {
                InspectorRow("Scene") { scenePicker(cue, \.obs.scene, none: "Pick a scene") }
            }
            InspectorRow("Fire when OBS shows") { scenePicker(cue, \.obsTriggerScene, none: "Never") }
                .help("When OBS switches to this scene, this cue stands by and fires.")
        }
    }

    /// OBS's scenes when it is connected; a typed name when it is not.
    @ViewBuilder
    private func scenePicker(_ cue: Cue, _ path: WritableKeyPath<Cue, String>, none: String) -> some View {
        let value = live(cue)[keyPath: path]
        if obs.scenes.isEmpty {
            TextField(none, text: bind(cue, path)).textFieldStyle(.roundedBorder).frame(maxWidth: 170, alignment: .trailing)
        } else {
            Picker(none, selection: bind(cue, path)) {
                Text(none).tag("")
                if !value.isEmpty && !obs.scenes.contains(value) { Text(value + " (not in OBS)").tag(value) }
                ForEach(obs.scenes, id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden().frame(maxWidth: 170, alignment: .trailing)
        }
    }

    // MARK: Words

    private func endChoices(_ cue: Cue) -> [EndAction] {
        switch cue.kind {
        case .video: return [.stop, .hold, .black]
        case .audio: return [.stop, .black]
        // A still never cuts to black on its own (the web app's rule).
        case .still, .matte: return [.hold, .black]
        }
    }

    private func endLabel(_ action: EndAction, _ cue: Cue) -> String {
        if cue.kind == .audio { return action == .black ? "Fade out" : "Stop" }
        if cue.kind.holds && action == .hold { return "Stay up" }
        return action.label
    }

    private func startNote(_ cue: Cue) -> String {
        (cue.preWait > 0 ? "Waits \(format(cue.preWait)) after GO. " : "") + cue.continueMode.help
    }

    private func endNote(_ cue: Cue) -> String? {
        guard cue.kind.holds else { return nil }
        return cue.duration > 0
            ? "Counts down \(format(cue.duration)), then \(cue.endAction == .black ? "fades to black" : "stays up")."
            : "Holds until the next picture cue."
    }

    private func format(_ s: Double) -> String {
        s == s.rounded() ? "\(Int(s)) s" : String(format: "%.1f s", s)
    }

    // MARK: Fields

    private func live(_ cue: Cue) -> Cue { engine.cues.first { $0.id == cue.id } ?? cue }

    private func bind<T>(_ cue: Cue, _ path: WritableKeyPath<Cue, T>) -> Binding<T> {
        Binding(
            get: { live(cue)[keyPath: path] },
            set: { v in engine.update(cue.id) { $0[keyPath: path] = v } }
        )
    }
}
