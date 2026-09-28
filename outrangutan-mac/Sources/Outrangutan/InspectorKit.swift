import SwiftUI

/// Building blocks for inspectors, following Cueola's inspector standard
/// (DESIGN_GUIDELINES.md, modeled on Keynote): icon tabs on top pick one
/// group at a time, a small caption names it, and each group is one flat
/// page. Section headers are bold text, sections are split by hairlines,
/// and there are no boxes inside boxes.

/// One tab of an inspector.
struct InspectorTab: Hashable {
    let id: String
    let title: String
    let symbol: String
}

/// Icon tabs plus the caption under them.
struct InspectorTabs: View {
    let tabs: [InspectorTab]
    @Binding var selection: String

    var body: some View {
        VStack(spacing: 6) {
            Picker("", selection: $selection) {
                ForEach(tabs, id: \.id) { tab in
                    Image(systemName: tab.symbol)
                        .accessibilityLabel(tab.title)
                        .help(tab.title)
                        .tag(tab.id)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text((tabs.first { $0.id == selection } ?? tabs.first)?.title.uppercased() ?? "")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .tracking(0.6)
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .onAppear {
            if !tabs.contains(where: { $0.id == selection }), let first = tabs.first { selection = first.id }
        }
    }
}

/// One flat page of an inspector.
struct InspectorPage<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
        }
    }
}

/// A bold header, its rows, and a hairline under it.
struct InspectorSection<Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content
            if let note {
                Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Divider() }
    }
}

/// A label on the left, its control on the right.
struct InspectorRow<Control: View>: View {
    let label: String
    @ViewBuilder var control: Control

    init(_ label: String, @ViewBuilder control: () -> Control) {
        self.label = label
        self.control = control()
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(label).foregroundStyle(.primary)
            Spacer(minLength: 8)
            control
        }
        .frame(minHeight: 24)
    }
}

/// A number with a unit and a stepper, like "2.5 s".
struct NumberField: View {
    let label: String
    @Binding var value: Double
    var unit = "s"
    var step: Double = 0.5
    var range: ClosedRange<Double> = 0...100_000

    var body: some View {
        InspectorRow(label) {
            TextField(label, value: $value, format: .number.precision(.fractionLength(0...2)))
                .labelsHidden()
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 70)
            Text(unit).foregroundStyle(.secondary).frame(width: 16, alignment: .leading)
            Stepper(label, value: $value, in: range, step: step).labelsHidden()
        }
    }
}

/// A slider with its value shown as a percent.
struct PercentSlider: View {
    let label: String
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1

    var body: some View {
        InspectorRow(label) {
            Slider(value: $value, in: range).frame(maxWidth: 150)
            Text("\(Int((value * 100).rounded()))%")
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .trailing)
        }
    }
}

/// An empty inspector: Apple's standard "nothing here" layout.
struct InspectorEmpty: View {
    let title: String
    let symbol: String
    let message: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(message))
    }
}
