import SwiftUI
import VixelCore

/// The ⓘ beside a word: click it for what the word means and why it
/// matters in a show. Click anywhere else to close it. Nothing opens on
/// hover alone, so it works the same with a touch screen later.
///
/// Learn Mode (View menu) shows or hides every ⓘ, so a pro gets a clean
/// screen.
struct InfoButton: View {
    let term: Term
    @AppStorage("learnMode") private var learnMode = true
    @State private var open = false

    var body: some View {
        if learnMode {
            Button { open.toggle() } label: {
                Image(systemName: "info.circle")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("About \(term.word.lowercased())")
            .popover(isPresented: $open, arrowEdge: .trailing) {
                InfoCard(term: term)
            }
        }
    }
}

/// What an ⓘ opens: the word, a plain sentence, then why it matters.
struct InfoCard: View {
    let term: Term

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(term.word).font(.headline)
            Text(term.means)
            Text("In a show").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                .padding(.top, 4)
            Text(term.inShow)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(width: 300, alignment: .leading)
        .padding(16)
    }
}
