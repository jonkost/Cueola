import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The sound effect board: bank tabs on top, a grid of pads below. Click a
/// pad to hit it, drop a sound on a pad to load it.
struct PadBoardView: View {
    @ObservedObject var board: PadBoard
    @State private var renaming: PadBank?
    @State private var newName = ""
    @State private var search = ""
    @State private var recordSlot: Int?
    /// Test mode only: a search to start with.
    var startSearch = ""

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: 12)]

    var body: some View {
        VStack(spacing: 0) {
            bankBar
            Divider()
            ScrollView {
                if !search.isEmpty {
                    found
                } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    if let bank = board.currentBank {
                        ForEach(0..<bank.padCount, id: \.self) { slot in
                            if let pad = board.pad(bank: bank.id, slot: slot) {
                                PadTile(board: board, pad: pad)
                            } else {
                                EmptyPadTile(board: board, slot: slot)
                            }
                        }
                        if bank.padCount < PadBoard.padCountMax && !board.locked {
                            // Shaped like an empty pad, so the grid stays even.
                            Button { board.addSlot() } label: {
                                VStack(spacing: 6) {
                                    Image(systemName: "plus").font(.system(size: 20))
                                    Text("Add a Pad").font(.system(size: 12))
                                }
                                .frame(maxWidth: .infinity, minHeight: 96)
                                .background(RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.secondary.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                                .contentShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.tertiary)
                            .help("Add one more pad to this bank")
                        }
                    }
                }
                .padding(14)
                }
            }
        }
        // Find a pad by name, emoji or key, across every bank.
        .searchable(text: $search, placement: .toolbar, prompt: "Find a Pad")
        .onAppear { if !startSearch.isEmpty { search = startSearch } }
        .sheet(item: Binding(get: { recordSlot.map(SlotID.init) }, set: { recordSlot = $0?.id })) { s in
            RecordSheet(board: board, slot: s.id)
        }
        .onReceive(NotificationCenter.default.publisher(for: .recordPad)) { note in
            if let slot = note.object as? Int { recordSlot = slot }
        }
        .alert("Rename bank", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let bank = renaming { board.renameBank(bank.id, to: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    /// Pads that match the search, bank by bank.
    @ViewBuilder
    private var found: some View {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let hits = board.pads.filter {
            $0.name.lowercased().contains(q) || $0.emoji.contains(q) || $0.key.lowercased() == q
        }
        if hits.isEmpty {
            ContentUnavailableView.search(text: search)
                .padding(.top, 40)
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                ForEach(board.banks) { bank in
                    let inBank = hits.filter { $0.bank == bank.id }.sorted { $0.slot < $1.slot }
                    if !inBank.isEmpty {
                        Section {
                            ForEach(inBank) { PadTile(board: board, pad: $0) }
                        } header: {
                            Text(bank.name).font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .padding(14)
        }
    }

    private func recordIntoNextSlot() {
        guard let bank = board.currentBank else { return }
        let free = (0..<PadBoard.padCountMax).first { board.pad(bank: bank.id, slot: $0) == nil }
        if let free {
            if free >= bank.padCount { board.addSlot() }
            recordSlot = free
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
                                .disabled(board.locked)
                            if board.banks.count > 1 {
                                Button("Remove bank and its pads", role: .destructive) { board.removeBank(bank.id) }
                                    .disabled(board.locked)
                            }
                        }
                    }
                    Button { board.addBank() } label: { Label("Add Bank", systemImage: "plus") }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .padding(.horizontal, 4)
                        .help("Add a bank")
                        .disabled(board.locked)
                }
            }
            Spacer()
            LevelMeterView(meter: board.meter)
            Toggle("Several at once", isOn: $board.multiTrigger)
                .toggleStyle(.switch)
                .controlSize(.small)
                .help("Off: hitting a pad stops every other pad.")
            Button { recordIntoNextSlot() } label: {
                Label("Record", systemImage: "mic")
            }
            .help("Record a sound effect onto the next empty pad")
            .disabled(board.locked)
            Button { board.stopAll() } label: {
                Label("Stop SFX", systemImage: "stop.fill")
            }
            .help("Stops every pad that is playing")
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
                .disabled(board.locked)
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !board.locked, let url = urls.first(where: PadBoard.isSound) else { return false }
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
            Text("Drop a Sound").font(.system(size: 12))
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 96)
        .background(RoundedRectangle(cornerRadius: 12).strokeBorder(dropTargeted ? Color.accentColor : Color.secondary.opacity(0.35),
                                                                     style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4])))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .opacity(board.locked ? 0.4 : 1)
        .onTapGesture { if !board.locked { choose() } }
        .contextMenu {
            Button("Choose a Sound\u{2026}") { choose() }.disabled(board.locked)
            Button("Record a Sound\u{2026}") { NotificationCenter.default.post(name: .recordPad, object: slot) }.disabled(board.locked)
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !board.locked, let url = urls.first(where: PadBoard.isSound) else { return false }
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

/// Every setting for the selected pad, one group at a time.
struct PadInspectorView: View {
    @ObservedObject var board: PadBoard
    @AppStorage("inspector.padTab") private var tab = "pad"

    private let tabs = [
        InspectorTab(id: "pad", title: "Pad", symbol: "square.grid.2x2"),
        InspectorTab(id: "playing", title: "Playing", symbol: "play.circle"),
        InspectorTab(id: "sound", title: "Sound", symbol: "slider.vertical.3"),
        InspectorTab(id: "file", title: "File", symbol: "doc"),
    ]

    var body: some View {
        if let pad = board.selectedPad {
            VStack(spacing: 0) {
                InspectorTabs(tabs: tabs, selection: $tab)
                Divider()
                InspectorPage {
                    if board.locked { LockedNote() }
                    Group {
                        switch tab {
                        case "playing": playing(pad)
                        case "sound": sound(pad)
                        case "file": file(pad)
                        default: general(pad)
                        }
                    }
                    .disabled(board.locked)
                }
            }
        } else {
            InspectorEmpty(title: "No pad selected", symbol: "square.grid.3x3",
                           message: "Click a pad to play it and see its settings, or right-click it and choose Edit.")
        }
    }

    @ViewBuilder
    private func general(_ pad: Pad) -> some View {
        InspectorSection(title: "Pad") {
            TextField("Name", text: bind(pad, \.name)).textFieldStyle(.roundedBorder)
            InspectorRow("Emoji") {
                TextField("Emoji", text: Binding(get: { live(pad).emoji }, set: { v in board.update(pad.id) { $0.emoji = String(v.prefix(4)) } }))
                    .labelsHidden().textFieldStyle(.roundedBorder).frame(width: 70)
            }
            InspectorRow("Color") {
                ColorPicker("Color", selection: Binding(
                    get: { Color(nsColor: NSColor(hex: live(pad).color) ?? .systemPurple) },
                    set: { c in board.update(pad.id) { $0.color = NSColor(c).hexString } }
                ), supportsOpacity: false).labelsHidden()
            }
            InspectorRow("Hotkey") {
                Picker("Hotkey", selection: bind(pad, \.key)) {
                    Text("None").tag("")
                    ForEach(PadBoard.keys, id: \.self) { Text($0.uppercased()).tag($0) }
                }
                .labelsHidden().frame(width: 90)
            }
        }
    }

    @ViewBuilder
    private func playing(_ pad: Pad) -> some View {
        InspectorSection(title: "Playing",
                         note: "Restart starts over. Layer plays another copy on top. Toggle stops it on the second hit.") {
            PercentSlider(label: "Volume", value: bind(pad, \.gain), range: 0...1.5)
            InspectorRow("Hit again") {
                Picker("Hit again", selection: bind(pad, \.retrigger)) {
                    ForEach(Retrigger.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 190)
            }
            InspectorRow("Loop") { Toggle("", isOn: bind(pad, \.loop)).labelsHidden().toggleStyle(.switch) }
        }
        InspectorSection(title: "Fades", note: "Fade out is used when the pad fades out with its cue.") {
            NumberField(label: "Fade in", value: bind(pad, \.fadeIn), step: 0.1)
            NumberField(label: "Fade out", value: bind(pad, \.fadeOut), step: 0.1)
        }
        InspectorSection(title: "Trim", note: "Drag the yellow handles, or type the times. Stop at 0 plays to the end.") {
            if let length = board.fileLength(pad.id), length > 0 {
                TrimBar(url: pad.url, length: length, trimIn: bind(pad, \.trimIn),
                        trimOut: Binding(get: { live(pad).trimOut }, set: { v in board.update(pad.id) { $0.trimOut = v } }))
            }
            NumberField(label: "Start at", value: bind(pad, \.trimIn), step: 0.1)
            NumberField(label: "Stop at", value: Binding(get: { live(pad).trimOut ?? 0 }, set: { v in board.update(pad.id) { $0.trimOut = v > 0 ? v : nil } }), step: 0.1)
        }
    }

    @ViewBuilder
    private func sound(_ pad: Pad) -> some View {
        InspectorSection(title: "EQ", note: "Low at 180 Hz, mid at 1.1 kHz, high at 4.5 kHz, the same as the web app.") {
            eqSlider("Low", bind(pad, \.eq.low))
            eqSlider("Mid", bind(pad, \.eq.mid))
            eqSlider("High", bind(pad, \.eq.high))
        }
        InspectorSection(title: "Dynamics") {
            InspectorRow("Compressor") { Toggle("", isOn: bind(pad, \.comp)).labelsHidden().toggleStyle(.switch) }
        }
    }

    @ViewBuilder
    private func file(_ pad: Pad) -> some View {
        InspectorSection(title: "File") {
            Text(pad.url.lastPathComponent).foregroundStyle(pad.fileIsThere ? .secondary : Color.orange)
                .lineLimit(1).truncationMode(.middle)
            HStack {
                Button("Replace…") { replace(pad) }
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([pad.url]) }
            }
        }
        InspectorSection(title: "Remove") {
            Button("Clear Pad", role: .destructive) { board.clear(pad.id) }
        }
    }

    private func live(_ pad: Pad) -> Pad { board.pad(id: pad.id) ?? pad }

    private func bind<T>(_ pad: Pad, _ path: WritableKeyPath<Pad, T>) -> Binding<T> {
        Binding(get: { live(pad)[keyPath: path] }, set: { v in board.update(pad.id) { $0[keyPath: path] = v } })
    }

    private func eqSlider(_ label: String, _ value: Binding<Double>) -> some View {
        InspectorRow(label) {
            Slider(value: value, in: -12...12, step: 0.5).frame(maxWidth: 150, alignment: .trailing)
            Text(String(format: "%+.1f dB", value.wrappedValue))
                .monospacedDigit().foregroundStyle(.secondary).frame(width: 62, alignment: .trailing)
        }
    }

    private func replace(_ pad: Pad) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.prompt = "Use"
        if panel.runModal() == .OK, let url = panel.url { board.assign(url: url, slot: pad.slot) }
    }
}

/// The pads' level meter: two thin bars, green to yellow to red.
struct LevelMeterView: View {
    @ObservedObject var meter: LevelMeter
    var label = "SFX"
    var width: CGFloat = 90

    var body: some View {
        HStack(spacing: 6) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).fixedSize()
            VStack(spacing: 2) {
                bar(meter.left)
                bar(meter.right)
            }
            .frame(width: width)
            Circle()
                .fill(meter.clipped ? Color.red : Color.secondary.opacity(0.25))
                .frame(width: 7, height: 7)
                .onTapGesture { meter.resetClip() }
                .help(meter.clipped ? "It hit full level. Click to clear." : "Lights red if the sound hits full level.")
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label == "SFX" ? "SFX level" : "Cue sound level")
        .accessibilityValue("\(Int(max(meter.left, meter.right) * 100)) percent")
    }

    private func bar(_ level: Float) -> some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.2))
                Capsule()
                    .fill(LinearGradient(colors: [.green, .green, .yellow, .red], startPoint: .leading, endPoint: .trailing))
                    .mask(alignment: .leading) {
                        Rectangle().frame(width: g.size.width * CGFloat(min(1, Self.meterScale(level))))
                    }
            }
        }
        .frame(height: 4)
    }

    /// Shows level on a decibel scale, -48 dB to 0 dB, so quiet sounds still move.
    static func meterScale(_ level: Float) -> Float {
        guard level > 0 else { return 0 }
        let db = 20 * log10(level)
        return max(0, (db + 48) / 48)
    }
}

/// A pad slot, for the Record sheet.
struct SlotID: Identifiable { let id: Int }

extension Notification.Name {
    static let recordPad = Notification.Name("outrangutan.recordPad")
}
