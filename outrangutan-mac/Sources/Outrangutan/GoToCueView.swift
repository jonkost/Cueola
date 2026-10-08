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
                Text(matches.isEmpty ? (text.isEmpty ? "Every cue is listed. Type to narrow it down." : "No cue matches.") : "Return stands by the first match.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Stand By") { standBy() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(matches.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460)
        .onAppear { typing = true }
    }

    private func number(of cue: Cue) -> Int { (engine.cues.firstIndex { $0.id == cue.id } ?? 0) + 1 }

    private func standBy() {
        guard let cue = matches.first else { return }
        engine.standbyID = cue.id
        dismiss()
    }

    /// The cues that fit what was typed: a number picks that cue first
    /// (then cues whose number starts with it); words match the name.
    static func matches(_ text: String, in cues: [Cue]) -> [Cue] {
        let t = text.trimmingCharacters(in: .whitespaces).lowercased()
        if t.isEmpty { return cues }
        if let n = Int(t) {
            let exact = (n >= 1 && n <= cues.count) ? [cues[n - 1]] : []
            let starts = cues.enumerated().filter { i, _ in String(i + 1).hasPrefix(t) && i + 1 != n }.map(\.element)
            return exact + starts
        }
        let words = t.split(separator: " ").map(String.init)
        return cues.filter { cue in
            let name = cue.name.lowercased()
            return words.allSatisfy { name.contains($0) }
        }
    }
}
