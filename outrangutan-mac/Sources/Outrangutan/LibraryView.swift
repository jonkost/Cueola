import AppKit
import OutrangutanCore
import SwiftUI

/// The Library window (Window menu, Option-Command-L, or the books button
/// in the toolbar): the sound effects and demo graphics that come with
/// Outrangutan. Pick one, hear it or look at it, and add it to the show.
struct LibraryView: View {
    @ObservedObject var engine: Engine
    @ObservedObject var library = BuiltInLibrary.shared
    @StateObject private var preview = LibraryPreview()
    @AppStorage("library.tab") private var tab = "sounds"
    @State private var pickedSounds: Set<String> = []
    @State private var pickedGraphic: String?
    /// What the last Add did, in plain words, under the list.
    @State private var said = ""
    @State private var lengths: [String: Double] = [:]
    /// Test mode only: a row to start with picked.
    var startPicked: String?

    private let columns = [GridItem(.adaptive(minimum: 200, maximum: 300), spacing: 20, alignment: .top)]

    var body: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $tab) {
                Text("Sounds").tag("sounds")
                Text("Graphics").tag("graphics")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 240)
            .padding(.top, 20).padding(.bottom, 12)
            if let problem = library.problem {
                ContentUnavailableView("The Library is not ready", systemImage: "exclamationmark.triangle", description: Text(problem))
            } else if !library.ready {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Making the Library\u{2026}").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if tab == "graphics" {
                graphics
            } else {
                sounds
            }
            Divider()
            footer
        }
        .buttonStyle(ActionStyle())
        .onAppear {
            if let startPicked { pickedSounds = [startPicked]; pickedGraphic = startPicked }
            library.prepare { readLengths() }
        }
        .onDisappear { preview.stop() }
        .onChange(of: tab) { _, _ in said = ""; preview.stop() }
    }

    // MARK: Sounds

    private var sounds: some View {
        List(LibrarySounds.all, selection: $pickedSounds) { sound in
            HStack(spacing: 10) {
                Button { preview.toggle(sound, at: library.url(for: sound)) } label: {
                    Image(systemName: preview.playing == sound.id ? "stop.fill" : "play.fill")
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.borderless)
                .help(preview.playing == sound.id ? "Stop" : "Hear \(sound.name)")
                Text(sound.emoji).font(.system(size: 20)).frame(width: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(sound.name)
                    Text(sound.about).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if sound.loops { Image(systemName: "repeat").foregroundStyle(.secondary).help("Made to loop") }
                Text(lengths[sound.id].map(clock) ?? "")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(width: 40, alignment: .trailing)
            }
            .padding(.vertical, 3)
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
        .scrollContentBackground(.hidden)
        .padding(.horizontal, 10)
        // A double-click puts the sound on a pad, like the default button.
        .contextMenu(forSelectionType: String.self) { ids in
            Button("Add to SFX") { addToPads(ids) }.disabled(engine.locked)
            Button("Add to Cues") { addToCues(ids) }.disabled(engine.locked)
        } primaryAction: { ids in
            addToPads(ids)
        }
    }

    private func clock(_ seconds: Double) -> String {
        // A sound shorter than a second still reads as one second, not none.
        let s = max(1, Int(seconds.rounded()))
        return "\(s / 60):" + (s % 60 < 10 ? "0" : "") + "\(s % 60)"
    }

    private func readLengths() {
        for sound in LibrarySounds.all where lengths[sound.id] == nil {
            lengths[sound.id] = library.length(of: sound)
        }
    }

    /// The picked sounds, in the Library's own order.
    private func ordered(_ ids: Set<String>) -> [LibrarySound] {
        LibrarySounds.all.filter { ids.contains($0.id) }
    }

    private func addToPads(_ ids: Set<String>) {
        guard !engine.locked else { said = "Editing is locked."; return }
        var last: Pad?
        var added = 0
        for sound in ordered(ids) {
            guard let pad = engine.pads.addFromLibrary(url: library.url(for: sound), name: sound.name, emoji: sound.emoji, loops: sound.loops) else { break }
            last = pad; added += 1
        }
        let bank = engine.pads.currentBank?.name ?? "the bank"
        if added < ids.count {
            said = added == 0 ? "\(bank) is full. Pick another bank in SFX, or add one, and try again."
                : "\(bank) is full: \(added) of \(ids.count) sounds were added."
        } else if let pad = last {
            let key = pad.key.isEmpty ? "" : ", key \(pad.key.uppercased())"
            said = added == 1 ? "\(pad.name) is on pad \(pad.slot + 1) of \(bank)\(key)." : "\(added) sounds are on the pads of \(bank)."
        }
    }

    private func addToCues(_ ids: Set<String>) {
        guard !engine.locked else { said = "Editing is locked."; return }
        let list = ordered(ids)
        for sound in list { engine.addLibrarySound(sound, at: library.url(for: sound)) }
        if let one = list.first, list.count == 1 { said = "\(one.name) is cue \(engine.cues.count), standing by." }
        else if !list.isEmpty { said = "\(list.count) sounds were added to the end of the cue list." }
    }

    // MARK: Graphics

    private var graphics: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                ForEach(LibraryGraphic.all) { graphic in
                    GraphicTile(graphic: graphic, url: library.url(for: graphic), picked: pickedGraphic == graphic.id)
                        .onTapGesture(count: 2) { pickedGraphic = graphic.id; addGraphic() }
                        .onTapGesture { pickedGraphic = graphic.id }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 20).padding(.top, 4)
        }
    }

    private func addGraphic() {
        guard !engine.locked else { said = "Editing is locked."; return }
        guard let graphic = LibraryGraphic.all.first(where: { $0.id == pickedGraphic }) else { return }
        if engine.addLibraryGraphic(graphic, at: library.url(for: graphic)) != nil {
            said = "\(graphic.name) is cue \(engine.cues.count), standing by, on chroma green."
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 12) {
            Text(note)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            if tab == "graphics" {
                Button("Add to Cues") { addGraphic() }
                    .buttonStyle(ActionStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
                    .disabled(engine.locked || pickedGraphic == nil || !library.ready)
            } else {
                Button("Add to Cues") { addToCues(pickedSounds) }
                    .disabled(engine.locked || pickedSounds.isEmpty || !library.ready)
                Button("Add to SFX") { addToPads(pickedSounds) }
                    .buttonStyle(ActionStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
                    .disabled(engine.locked || pickedSounds.isEmpty || !library.ready)
            }
        }
        .buttonWidth(120)
        .padding(20)
    }

    /// The line under the list: what just happened, or how this tab works.
    private var note: String {
        if engine.locked { return "Editing is locked. Unlock it in the main window to add from the Library." }
        if !said.isEmpty { return said }
        return tab == "graphics"
            ? "Each graphic goes to air on chroma green, for the switcher to key. The Inspector's Key section changes the color behind it."
            : "Click the play button to hear a sound on this Mac's own speakers. Add to SFX puts it on the next empty pad."
    }
}

/// One demo graphic: its picture on chroma green, its name, and what it is.
private struct GraphicTile: View {
    let graphic: LibraryGraphic
    let url: URL
    let picked: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                Color(nsColor: NSColor(hex: BuiltInLibrary.chromaGreen) ?? .green)
                if let image = NSImage(contentsOf: url) {
                    Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(shape)
            .overlay { shape.strokeBorder(picked ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: picked ? 3 : 1) }
            Text(graphic.name)
            Text(graphic.about).font(.callout).foregroundStyle(.secondary).lineLimit(2)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}

/// Window menu: opens the Library.
struct OpenLibraryButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Library") { openWindow(id: "library") }
            .keyboardShortcut("l", modifiers: [.command, .option])
    }
}
