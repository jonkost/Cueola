import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The sound effect board: bank tabs on top, a grid of pads below. Click a
/// pad to hit it, drop a sound on a pad to load it.
struct PadBoardView: View {
    @ObservedObject var board: PadBoard
    @State private var renaming: PadBank?
    @State private var newName = ""

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: 12)]

    var body: some View {
        VStack(spacing: 0) {
            bankBar
            Divider()
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    if let bank = board.currentBank {
                        ForEach(0..<bank.padCount, id: \.self) { slot in
                            if let pad = board.pad(bank: bank.id, slot: slot) {
                                PadTile(board: board, pad: pad)
                            } else {
                                EmptyPadTile(board: board, slot: slot)
                            }
                        }
                        if bank.padCount < PadBoard.padCountMax {
                            Button { board.addSlot() } label: {
                                Label("Add a pad", systemImage: "plus")
                                    .frame(maxWidth: .infinity, minHeight: 96)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(14)
            }
        }
        .alert("Rename bank", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let bank = renaming, let i = board.banks.firstIndex(where: { $0.id == bank.id }), !newName.isEmpty {
                    board.banks[i].name = newName
                }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    private var bankBar: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(board.banks) { bank in
                        let on = bank.id == board.currentBankID
                        Button(bank.name) {
                            board.currentBankID = bank.id
                            board.selectedPadID = nil
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(on ? Color.accentColor.opacity(0.3) : Color.secondary.opacity(0.12), in: Capsule())
                        .contextMenu {
                            Button("Rename…") { newName = bank.name; renaming = bank }
                            if board.banks.count > 1 {
                                Button("Remove bank and its pads", role: .destructive) { board.removeBank(bank.id) }
                            }
                        }
                    }
                    Button { board.addBank() } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                        .padding(6)
                        .help("Add a bank")
                }
            }
            Spacer()
            Toggle("Several at once", isOn: $board.multiTrigger)
                .toggleStyle(.switch)
                .controlSize(.small)
                .help("Off: hitting a pad stops every other pad.")
            Button("Stop pads") { board.stopAll() }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}

/// One loaded pad.
struct PadTile: View {
    @ObservedObject var board: PadBoard
    let pad: Pad
    @State private var dropTargeted = false

    var body: some View {
        let selected = board.selectedPadID == pad.id
        let color = Color(nsColor: NSColor(hex: pad.color) ?? .systemPurple)
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: board.sounding[pad.id] == nil)) { context in
            let sounding = board.sounding[pad.id] != nil
            let progress = board.progress(pad.id, now: context.date)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(pad.emoji.isEmpty ? " " : pad.emoji).font(.system(size: 22))
                    Spacer()
                    if !pad.key.isEmpty {
                        Text(pad.key.uppercased())
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 4))
                    }
                }
                Spacer(minLength: 0)
                Text(pad.name).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                HStack(spacing: 6) {
                    if pad.loop { Image(systemName: "repeat") }
                    if pad.retrigger != .restart { Text(pad.retrigger.label.uppercased()) }
                    if !pad.fileIsThere { Label("File missing", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                    Spacer()
                    if let len = board.length(pad.id) { Text(String(format: "%.1fs", len)).monospacedDigit() }
                }
                .font(.system(size: 10.5, weight: .semibold))
                .opacity(0.8)
                // How far along it is. A loop shows a full, steady bar.
                GeometryReader { g in
                    Capsule().fill(.white.opacity(0.18))
                        .overlay(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.9))
                                .frame(width: sounding ? g.size.width * (progress ?? 1) : 0)
                        }
                }
                .frame(height: 4)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(color.opacity(sounding ? 0.85 : 0.35), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.white : (dropTargeted ? Color.accentColor : .clear), lineWidth: 2))
            .foregroundStyle(.white)
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .onTapGesture {
            board.selectedPadID = pad.id
            board.fire(pad.id)
        }
        .contextMenu {
            Button("Edit") { board.selectedPadID = pad.id }
            Button("Stop") { board.stop(pad.id) }
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([pad.url]) }
            Button("Clear pad", role: .destructive) { board.clear(pad.id) }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first(where: PadBoard.isSound) else { return false }
            board.assign(url: url, slot: pad.slot)
            return true
        } isTargeted: { dropTargeted = $0 }
        .help("Click to play. Drop a sound here to replace it.")
    }
}

/// An empty slot: drop a sound on it, or click to pick one.
struct EmptyPadTile: View {
    @ObservedObject var board: PadBoard
    let slot: Int
    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "plus.circle").font(.system(size: 20))
            Text("Drop a sound").font(.system(size: 12))
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 96)
        .background(RoundedRectangle(cornerRadius: 12).strokeBorder(dropTargeted ? Color.accentColor : Color.secondary.opacity(0.35),
                                                                     style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4])))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { choose() }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first(where: PadBoard.isSound) else { return false }
            board.assign(url: url, slot: slot)
            return true
        } isTargeted: { dropTargeted = $0 }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.prompt = "Load"
        if panel.runModal() == .OK, let url = panel.url { board.assign(url: url, slot: slot) }
    }
}

/// Every setting for the selected pad.
struct PadInspectorView: View {
    @ObservedObject var board: PadBoard

    var body: some View {
        if let pad = board.selectedPad {
            Form {
                Section("Pad") {
                    TextField("Name", text: bind(pad, \.name))
                    TextField("Emoji", text: Binding(get: { live(pad).emoji }, set: { v in board.update(pad.id) { $0.emoji = String(v.prefix(4)) } }))
                    ColorPicker("Color", selection: Binding(
                        get: { Color(nsColor: NSColor(hex: live(pad).color) ?? .systemPurple) },
                        set: { c in board.update(pad.id) { $0.color = NSColor(c).hexString } }
                    ), supportsOpacity: false)
                    Picker("Hotkey", selection: bind(pad, \.key)) {
                        Text("None").tag("")
                        ForEach(PadBoard.keys, id: \.self) { Text($0.uppercased()).tag($0) }
                    }
                }
                Section {
                    HStack {
                        Text("Volume")
                        Slider(value: bind(pad, \.gain), in: 0...1.5)
                        Text("\(Int((live(pad).gain * 100).rounded()))%").monospacedDigit().frame(width: 44, alignment: .trailing)
                    }
                    Picker("Hit again", selection: bind(pad, \.retrigger)) {
                        ForEach(Retrigger.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Toggle("Loop", isOn: bind(pad, \.loop))
                    number("Fade in", bind(pad, \.fadeIn), step: 0.1)
                    number("Fade out", bind(pad, \.fadeOut), step: 0.1)
                    number("Start at", bind(pad, \.trimIn), step: 0.1)
                    number("Stop at", Binding(get: { live(pad).trimOut ?? 0 }, set: { v in board.update(pad.id) { $0.trimOut = v > 0 ? v : nil } }), step: 0.1)
                } header: {
                    Text("Playing")
                } footer: {
                    Text("Restart starts over. Layer plays another copy on top. Toggle stops it on the second hit. Fade out is used when the pad fades with its clip. Stop at 0 plays to the end.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Sound") {
                    eqSlider("Low", bind(pad, \.eq.low))
                    eqSlider("Mid", bind(pad, \.eq.mid))
                    eqSlider("High", bind(pad, \.eq.high))
                    Toggle("Compressor", isOn: bind(pad, \.comp))
                }
                Section("File") {
                    Text(pad.url.lastPathComponent).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    HStack {
                        Button("Replace…") { replace(pad) }
                        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([pad.url]) }
                        Spacer()
                        Button("Clear pad", role: .destructive) { board.clear(pad.id) }
                    }
                }
            }
            .formStyle(.grouped)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "square.grid.3x3").font(.system(size: 28)).foregroundStyle(.tertiary)
                Text("Right-click a pad and choose Edit, or click one to play it and see its settings.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func live(_ pad: Pad) -> Pad { board.pad(id: pad.id) ?? pad }

    private func bind<T>(_ pad: Pad, _ path: WritableKeyPath<Pad, T>) -> Binding<T> {
        Binding(get: { live(pad)[keyPath: path] }, set: { v in board.update(pad.id) { $0[keyPath: path] = v } })
    }

    private func number(_ label: String, _ value: Binding<Double>, step: Double) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, value: value, format: .number.precision(.fractionLength(0...2)))
                .labelsHidden().multilineTextAlignment(.trailing).frame(width: 64)
            Text("s").foregroundStyle(.secondary)
            Stepper(label, value: value, in: 0...100000, step: step).labelsHidden()
        }
    }

    private func eqSlider(_ label: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(label).frame(width: 36, alignment: .leading)
            Slider(value: value, in: -12...12, step: 0.5)
            Text(String(format: "%+.1f dB", value.wrappedValue)).monospacedDigit().frame(width: 62, alignment: .trailing)
        }
    }

    private func replace(_ pad: Pad) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.prompt = "Use"
        if panel.runModal() == .OK, let url = panel.url { board.assign(url: url, slot: pad.slot) }
    }
}
