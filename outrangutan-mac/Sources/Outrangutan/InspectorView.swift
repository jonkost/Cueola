import OutrangutanCore
import AppKit
import SwiftUI

/// The Inspector: every setting for the cue standing by. Changes save at
/// once. Volume and framing change on air right away; timing counts from
/// the cue's next GO.
struct InspectorView: View {
    @ObservedObject var engine: Engine

    var body: some View {
        if let cue = engine.standbyCue {
            Form {
                cueSection(cue)
                timingSection(cue)
                if !cue.kind.holds { trimSection(cue) }
                fadeSection(cue)
                if cue.kind.hasPicture { pictureSection(cue) }
            }
            .formStyle(.grouped)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3").font(.system(size: 28)).foregroundStyle(.tertiary)
                Text("Click a cue to see its settings.").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Sections

    private func cueSection(_ cue: Cue) -> some View {
        Section("Cue") {
            TextField("Name", text: bind(cue, \.name))
            TextField("Notes", text: bind(cue, \.notes), axis: .vertical)
                .lineLimit(1...4)
            Toggle("Fire on GO", isOn: bind(cue, \.armed))
                .help("Off: GO skips this cue. The rundown and the deck can still fire it.")
        }
    }

    private func timingSection(_ cue: Cue) -> some View {
        Section {
            seconds("Pre-wait", bind(cue, \.preWait), step: 0.5)
            Picker("After it starts", selection: bind(cue, \.continueMode)) {
                ForEach(ContinueMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            if cue.kind.holds {
                seconds("On screen for", bind(cue, \.duration), step: 0.5)
            }
            Picker("At the end", selection: bind(cue, \.endAction)) {
                ForEach(endChoices(cue), id: \.self) { Text(endLabel($0, cue)).tag($0) }
            }
        } header: {
            Text("Timing")
        } footer: {
            Text(timingNote(cue)).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func trimSection(_ cue: Cue) -> some View {
        Section {
            seconds("Start at", bind(cue, \.trimIn), step: 0.1)
            seconds("Stop at", Binding(
                get: { engine.cues.first { $0.id == cue.id }?.trimOut ?? 0 },
                set: { v in engine.update(cue.id) { $0.trimOut = v > 0 ? v : nil } }
            ), step: 0.1)
            Toggle("Loop", isOn: bind(cue, \.loop))
            HStack {
                Text("Volume")
                Slider(value: bind(cue, \.volume), in: 0...1)
                Text("\(Int((live(cue).volume * 100).rounded()))%")
                    .monospacedDigit()
                    .frame(width: 44, alignment: .trailing)
            }
        } header: {
            Text("Trim and sound")
        } footer: {
            Text("Stop at 0 plays to the end. Length after trim: \(Timecode.short(engine.playLength(live(cue)))).")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func fadeSection(_ cue: Cue) -> some View {
        Section {
            seconds("Fade in", bind(cue, \.fadeIn), step: 0.1)
            seconds("Fade out", bind(cue, \.fadeOut), step: 0.1)
            seconds("Dissolve in", bind(cue, \.xfade), step: 0.1)
            Picker("Curve", selection: bind(cue, \.fadeCurve)) {
                ForEach(FadeCurve.allCases, id: \.self) { Text($0.label).tag($0) }
            }
        } header: {
            Text("Fades")
        } footer: {
            Text("Fade in comes up from black and silence. Fade out ends before the cue does. Dissolve in blends from whatever is on air on the same lane.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func pictureSection(_ cue: Cue) -> some View {
        Section("Picture") {
            if cue.kind == .matte {
                ColorPicker("Color", selection: Binding(
                    get: { Color(nsColor: NSColor(hex: live(cue).color) ?? .black) },
                    set: { c in engine.update(cue.id) { $0.color = NSColor(c).hexString } }
                ), supportsOpacity: false)
            } else {
                Picker("Framing", selection: bind(cue, \.fit)) {
                    ForEach(Fit.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                HStack {
                    Text("Size")
                    Slider(value: bind(cue, \.scale), in: 0.25...2)
                    Text("\(Int((live(cue).scale * 100).rounded()))%")
                        .monospacedDigit()
                        .frame(width: 44, alignment: .trailing)
                }
                number("Move right", bind(cue, \.posX), unit: "%", step: 1)
                number("Move down", bind(cue, \.posY), unit: "%", step: 1)
                Button("Reset framing") {
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

    private func timingNote(_ cue: Cue) -> String {
        var parts: [String] = []
        if cue.preWait > 0 { parts.append("Waits \(format(cue.preWait)) after GO.") }
        parts.append(cue.continueMode.help)
        if cue.kind.holds {
            parts.append(cue.duration > 0 ? "Counts down \(format(cue.duration)), then \(cue.endAction == .black ? "fades to black" : "stays up")." : "Holds until the next picture cue.")
        }
        return parts.joined(separator: " ")
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

    private func seconds(_ label: String, _ value: Binding<Double>, step: Double) -> some View {
        number(label, value, unit: "s", step: step, minimum: 0)
    }

    private func number(_ label: String, _ value: Binding<Double>, unit: String, step: Double, minimum: Double = -1000) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, value: value, format: .number.precision(.fractionLength(0...2)))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
                .frame(width: 64)
            Text(unit).foregroundStyle(.secondary).frame(width: 14, alignment: .leading)
            Stepper(label, value: value, in: minimum...100000, step: step).labelsHidden()
        }
    }
}
