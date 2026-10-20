import SwiftUI

/// Go to Cue (Command-J): type a cue number or a few letters of its name,
/// press Return, and that cue stands by. For long shows, when scrolling
/// to the cue would take longer than typing it.
struct GoToCueView: View {
    @ObservedObject var engine: Engine
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var typing: Bool

    private var matches: [Cue] { Self.matches(text, in: engine.cues) }
    private var blank: Bool { text.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Go to Cue")
                .font(.title3.weight(.semibold))
            TextField("Cue number or name", text: $text)
                .textFieldStyle(.roundedBorder)
                .font(.title3)
                .focused($typing)
                .onSubmit(standBy)
            List(matches.prefix(8), id: \.id) { cue in
                HStack(spacing: 10) {
                    Text("\(number(of: cue))")
                        .font(.body.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(.secondary)
                        .frame(width: 32, alignment: .trailing)
                    Image(systemName: cue.kind.symbol).foregroundStyle(.secondary).frame(width: 18)
                    Text(cue.name).lineLimit(1)
                    Spacer()
                    if cue.id == engine.standbyID { Text("standby").font(.caption).foregroundStyle(.green) }
                }
                .contentShape(Rectangle())
                .onTapGesture { engine.standbyID = cue.id; dismiss() }
            }
            .frame(height: 220)
            HStack {
                Text(blank ? "Every cue is listed. Type to narrow it down." : (matches.isEmpty ? "No cue matches." : "Return stands by the first match."))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Stand By") { standBy() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(ActionStyle(prominent: true))
                    .disabled(blank || matches.isEmpty)
            }
            .buttonWidth(120)
        }
        .padding(20)
        .frame(width: 460)
        .buttonStyle(ActionStyle())
        .onAppear { typing = true }
    }

    private func number(of cue: Cue) -> Int { (engine.cues.firstIndex { $0.id == cue.id } ?? 0) + 1 }

    /// Return with nothing typed just closes the sheet: it must never move
    /// the standby to cue 1 because every cue is listed.
    private func standBy() {
        if blank { dismiss(); return }
        guard let cue = Self.standByTarget(text, in: engine.cues) else { return }
        engine.standbyID = cue.id
        dismiss()
    }

    /// The cue Return stands by: the first match, or none when the box is
    /// empty or nothing matches.
    static func standByTarget(_ text: String, in cues: [Cue]) -> Cue? {
        if text.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        return matches(text, in: cues).first
    }

    /// The cues that fit what was typed: a number picks that cue first
    /// (then cues whose number starts with it); words match the name. A
    /// number that is nobody's cue number is searched as a word too, so
    /// "2024" still finds "2024 Highlights".
    static func matches(_ text: String, in cues: [Cue]) -> [Cue] {
        let t = text.trimmingCharacters(in: .whitespaces).lowercased()
        if t.isEmpty { return cues }
        if let n = Int(t) {
            let exact = (n >= 1 && n <= cues.count) ? [cues[n - 1]] : []
            let starts = cues.enumerated().filter { i, _ in String(i + 1).hasPrefix(t) && i + 1 != n }.map(\.element)
            if !(exact.isEmpty && starts.isEmpty) { return exact + starts }
        }
        let words = t.split(separator: " ").map(String.init)
        return cues.filter { cue in
            let name = cue.name.lowercased()
            return words.allSatisfy { name.contains($0) }
        }
    }
}
