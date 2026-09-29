import OutrangutanCore
import AppKit
import SwiftUI

/// The Inspector: every setting for the cue standing by, one group at a
/// time. Changes save at once. Volume and framing change on air right away;
/// timing counts from the cue's next GO.
struct InspectorView: View {
    @ObservedObject var engine: Engine
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
            InspectorRow("Fire on GO") { Toggle("", isOn: bind(cue, \.armed)).labelsHidden().toggleStyle(.switch) }
                .help("Off: GO skips this cue. The rundown and the deck can still fire it.")
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
                .frame(maxWidth: 180)
            }
            if !live(cue).sfxPadId.isEmpty {
                NumberField(label: "After", value: bind(cue, \.sfxDelay), step: 0.5)
            }
        }
        if cue.kind != .matte {
            InspectorSection(title: "File") {
                Text(cue.url.lastPathComponent).foregroundStyle(cue.fileIsThere ? .secondary : Color.orange)
                    .lineLimit(1).truncationMode(.middle)
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([cue.url]) }
            }
        }
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
                .labelsHidden().frame(maxWidth: 170)
            }
        }
    }

    @ViewBuilder
    private func sound(_ cue: Cue) -> some View {
        InspectorSection(title: "Trim",
                         note: "Stop at 0 plays to the end. Length after trim: \(Timecode.short(engine.playLength(live(cue)))).") {
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
                .labelsHidden().frame(maxWidth: 150)
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
                .labelsHidden().frame(maxWidth: 170)
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
                    .labelsHidden().frame(maxWidth: 170)
                }
                PercentSlider(label: "Size", value: bind(cue, \.scale), range: 0.25...2)
                NumberField(label: "Move right", value: bind(cue, \.posX), unit: "%", step: 1, range: -100...100)
                NumberField(label: "Move down", value: bind(cue, \.posY), unit: "%", step: 1, range: -100...100)
                Button("Reset Framing") {
                    engine.update(cue.id) { $0.fit = .contain; $0.scale = 1; $0.posX = 0; $0.posY = 0 }
                }
            }
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
