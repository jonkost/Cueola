import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The control window: clock and transport on top, cue list in the middle,
/// media and output controls along the bottom.
struct ControlView: View {
    @ObservedObject var engine: Engine
    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            cueList
            Divider()
            footer
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .dropDestination(for: URL.self) { urls, _ in
            engine.add(urls: urls)
            return true
        } isTargeted: { dropTargeted = $0 }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.accentColor, lineWidth: 3)
                    .padding(6)
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: Clock and transport

    private var header: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text(engine.status.rawValue)
                    .font(.system(size: 13, weight: .bold))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(statusColor.opacity(0.25), in: Capsule())
                    .foregroundStyle(statusColor)
                Text(onAirText)
                    .font(.system(size: 15, weight: .medium))
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
                Text(standbyText)
                    .font(.system(size: 13))
                    .lineLimit(1)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(clockText)
                .font(.system(size: 54, weight: .semibold, design: .monospaced))
                .monospacedDigit()
                .foregroundStyle(engine.remaining == nil ? Color.secondary : clockColor)
                .fixedSize()

            HStack(spacing: 10) {
                transportButton("GO", key: "Space", color: .green, action: engine.go)
                transportButton(engine.status == .paused ? "Resume" : "Pause", key: "P", color: .yellow, action: engine.togglePause)
                transportButton("Stop", key: "S", color: .orange, action: engine.stop)
                transportButton("All Stop", key: "Esc", color: .red, action: engine.allStop)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16)
    }

    private func transportButton(_ title: String, key: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(title).font(.system(size: 15, weight: .bold))
                Text(key).font(.system(size: 10, weight: .medium)).opacity(0.7)
            }
            .frame(width: 74, height: 50)
            .background(color.opacity(0.22), in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(color)
        }
        .buttonStyle(.plain)
        .focusable(false)
    }

    // MARK: Cue list

    private var cueList: some View {
        Group {
            if engine.cues.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "square.and.arrow.down").font(.system(size: 34)).foregroundStyle(.tertiary)
                    Text("Drag videos, sounds or stills here").font(.title3)
                    Text("or use Add Media below.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $engine.standbyID) {
                    ForEach(Array(engine.cues.enumerated()), id: \.element.id) { index, cue in
                        row(cue, number: index + 1).tag(cue.id)
                    }
                    .onMove { engine.cues.move(fromOffsets: $0, toOffset: $1) }
                }
                .onDeleteCommand {
                    if let id = engine.standbyID { engine.remove(ids: [id]) }
                }
            }
        }
    }

    private func row(_ cue: Cue, number: Int) -> some View {
        let onAir = cue == engine.pictureCue || cue == engine.soundCue
        return HStack(spacing: 12) {
            Text("\(number)")
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
            Image(systemName: cue.kind.symbol)
                .frame(width: 20)
                .foregroundStyle(cue.kind == .audio ? Color.cyan : Color.purple)
            Text(cue.name).font(.system(size: 15)).lineLimit(1)
            if !cue.fileIsThere {
                Label("File missing", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.orange)
            }
            Spacer()
            if onAir {
                Text("ON AIR")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.red, in: Capsule())
                    .foregroundStyle(.white)
            }
            Text(durationText(cue))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([cue.url]) }
            Button("Remove", role: .destructive) { engine.remove(ids: [cue.id]) }
        }
    }

    // MARK: Media and output

    private var footer: some View {
        HStack(spacing: 12) {
            Button {
                chooseFiles()
            } label: {
                Label("Add Media", systemImage: "plus")
            }

            if let notice = engine.notice {
                Label(notice, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.orange)
                    .lineLimit(1)
            }

            Spacer()

            Picker("Output screen", selection: $engine.outputScreen) {
                Text("Second screen (automatic)").tag(String?.none)
                ForEach(NSScreen.screens.map(\.localizedName), id: \.self) { name in
                    Text(name).tag(String?.some(name))
                }
            }
            .frame(maxWidth: 320)

            Button {
                engine.toggleOutput()
            } label: {
                Label(engine.outputIsOpen ? "Close Output" : "Open Output",
                      systemImage: engine.outputIsOpen ? "rectangle.slash" : "rectangle.on.rectangle")
            }
        }
        .padding(12)
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.movie, .audio, .image]
        panel.prompt = "Add"
        if panel.runModal() == .OK { engine.add(urls: panel.urls) }
    }

    // MARK: Words and colors

    private var clockText: String {
        if let r = engine.remaining { return Timecode.dropFrame(r) }
        return engine.status == .holding ? "HOLD" : "00:00:00;00"
    }

    private var clockColor: Color {
        guard let r = engine.remaining else { return .primary }
        return r <= 10 ? .red : (r <= 30 ? .yellow : .primary)
    }

    private var statusColor: Color {
        switch engine.status {
        case .ready: return .secondary
        case .playing: return .red
        case .paused: return .yellow
        case .holding: return .purple
        }
    }

    private var onAirText: String {
        let names = [engine.pictureCue?.name, engine.soundCue?.name].compactMap { $0 }
        return names.isEmpty ? "Nothing on air" : "On air: " + names.joined(separator: " + ")
    }

    private var standbyText: String {
        guard let cue = engine.standbyCue, let i = engine.cues.firstIndex(of: cue) else { return "Standby: nothing" }
        return "Standby: \(i + 1). \(cue.name)"
    }

    private func durationText(_ cue: Cue) -> String {
        if cue.kind == .still { return "HOLD" }
        guard let d = engine.durations[cue.id] else { return "" }
        return Timecode.short(d)
    }
}
