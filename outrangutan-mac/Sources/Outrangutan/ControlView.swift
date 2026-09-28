import OutrangutanCore
import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The control window: clock and transport on top, cue list in the middle,
/// media and output controls along the bottom.
struct ControlView: View {
    @ObservedObject var engine: Engine
    @ObservedObject var link: ShowLink
    @State private var dropTargeted = false
    @State private var showConnect = false
    @AppStorage("ui.inspector") private var showInspector = true

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                cueList
                if showInspector {
                    Divider()
                    InspectorView(engine: engine)
                        .frame(width: 330)
                }
            }
            Divider()
            footer
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(isPresented: $showConnect) { ConnectView(link: link) }
        .onReceive(NotificationCenter.default.publisher(for: .showConnect)) { _ in showConnect = true }
        .onReceive(NotificationCenter.default.publisher(for: .toggleInspector)) { _ in showInspector.toggle() }
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
        VStack(spacing: 14) {
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(engine.status.rawValue)
                        .font(.system(size: 13, weight: .bold))
                        .fixedSize()
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
                    .foregroundStyle(engine.remaining == nil && engine.status != .pre ? Color.secondary : clockColor)
                    .fixedSize()
            }

            // The transport gets its own row, so every button stays a big
            // target however narrow the window is.
            HStack(spacing: 10) {
                transportButton("GO", key: "Space", color: .green) { engine.go() }
                transportButton(engine.status == .paused ? "Resume" : "Pause", key: "P", color: .yellow, action: engine.togglePause)
                transportButton("Stop", key: "S", color: .orange, action: engine.stop)
                transportButton("Fade", key: "F", color: .purple, action: engine.fadeStopAll)
                transportButton("All Stop", key: "Esc", color: .red, action: engine.allStop)
            }
        }
        .padding(16)
    }

    private func transportButton(_ title: String, key: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(title).font(.system(size: 15, weight: .bold))
                Text(key).font(.system(size: 10, weight: .medium)).opacity(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(color.opacity(0.22), in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(color)
            .contentShape(RoundedRectangle(cornerRadius: 10))
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
        let onAir = cue.id == engine.pictureCue?.id || cue.id == engine.soundCue?.id
        let waiting = cue.id == engine.pendingCue?.id
        return HStack(spacing: 10) {
            Text("\(number)")
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
            icon(cue)
            Text(cue.name).font(.system(size: 15)).lineLimit(1)
            if !cue.fileIsThere {
                Label("File missing", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 6)
            if !cue.armed { chip("SKIP", .gray) }
            if cue.preWait > 0 { chip("PRE \(Timecode.short(cue.preWait))", .yellow) }
            if cue.continueMode != .manual { chip(cue.continueMode == .autoFollow ? "FOLLOW" : "CONT", .blue) }
            if cue.loop { Image(systemName: "repeat").foregroundStyle(.secondary) }
            if cue.xfade > 0 { Image(systemName: "circle.lefthalf.filled").foregroundStyle(.secondary).help("Dissolves in") }
            if waiting { chip("PRE-WAIT", .orange, solid: true) }
            if onAir { chip("ON AIR", .red, solid: true) }
            Text(durationText(cue))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 56, alignment: .trailing)
        }
        .padding(.vertical, 4)
        .opacity(cue.armed ? 1 : 0.55)
        .contextMenu {
            if cue.kind != .matte {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([cue.url]) }
            }
            Button(cue.armed ? "Skip on GO" : "Fire on GO") { engine.update(cue.id) { $0.armed.toggle() } }
            Button("Remove", role: .destructive) { engine.remove(ids: [cue.id]) }
        }
    }

    @ViewBuilder
    private func icon(_ cue: Cue) -> some View {
        if cue.kind == .matte {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color(nsColor: NSColor(hex: cue.color) ?? .black))
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1))
                .frame(width: 16, height: 12)
                .frame(width: 20)
        } else {
            Image(systemName: cue.kind.symbol)
                .frame(width: 20)
                .foregroundStyle(cue.kind == .audio ? Color.cyan : (cue.kind == .still ? Color.yellow : Color.purple))
        }
    }

    private func chip(_ text: String, _ color: Color, solid: Bool = false) -> some View {
        Text(text)
            .font(.system(size: 10.5, weight: .bold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(solid ? color : color.opacity(0.2), in: Capsule())
            .foregroundStyle(solid ? Color.white : color)
    }

    // MARK: Media and output

    private var footer: some View {
        HStack(spacing: 12) {
            Button {
                chooseFiles()
            } label: {
                Label("Add Media", systemImage: "plus")
            }

            Menu {
                Button("Black") { engine.addMatte(color: "#000000", name: "Black") }
                Button("White") { engine.addMatte(color: "#FFFFFF", name: "White") }
                Button("Gray") { engine.addMatte(color: "#808080", name: "Gray") }
                Button("Chroma green") { engine.addMatte(color: "#00B140", name: "Chroma green") }
                Button("Chroma blue") { engine.addMatte(color: "#0047BB", name: "Chroma blue") }
            } label: {
                Label("Add Matte", systemImage: "square.fill")
            }
            .fixedSize()
            .help("A solid color picture. Change its color in the Inspector.")

            if let notice = engine.notice {
                Label(notice, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.orange)
                    .lineLimit(1)
            }

            Spacer()

            LinkBadge(link: link) { showConnect = true }

            Picker("Output screen", selection: $engine.outputScreen) {
                Text("Second screen (automatic)").tag(String?.none)
                ForEach(NSScreen.screens.map(\.localizedName), id: \.self) { name in
                    Text(name).tag(String?.some(name))
                }
            }
            .frame(maxWidth: 260)

            Button {
                showInspector.toggle()
            } label: {
                Image(systemName: "sidebar.right")
            }
            .help(showInspector ? "Hide the Inspector (Command-I)" : "Show the Inspector (Command-I)")

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
        if engine.status == .pre, let p = engine.preRemaining { return Timecode.dropFrame(p) }
        if let r = engine.remaining { return Timecode.dropFrame(r) }
        return engine.status == .holding ? "HOLD" : "00:00:00;00"
    }

    private var clockColor: Color {
        if engine.status == .pre { return .orange }
        guard let r = engine.remaining else { return .primary }
        return r <= 10 ? .red : (r <= 30 ? .yellow : .primary)
    }

    private var statusColor: Color {
        switch engine.status {
        case .ready: return .secondary
        case .pre: return .orange
        case .playing: return .red
        case .paused: return .yellow
        case .holding: return .purple
        }
    }

    private var onAirText: String {
        let names = [engine.pictureCue?.name, engine.soundCue?.name].compactMap { $0 }
        if names.isEmpty, let p = engine.pendingCue { return "Waiting to start: " + p.name }
        return names.isEmpty ? "Nothing on air" : "On air: " + names.joined(separator: " + ")
    }

    private var standbyText: String {
        guard let cue = engine.standbyCue, let i = engine.cues.firstIndex(of: cue) else { return "Standby: nothing" }
        return "Standby: \(i + 1). \(cue.name)"
    }

    private func durationText(_ cue: Cue) -> String {
        if cue.kind.holds { return cue.duration > 0 ? Timecode.short(cue.duration) : "HOLD" }
        if cue.loop { return "LOOP" }
        guard engine.durations[cue.id] != nil else { return "" }
        return Timecode.short(engine.playLength(cue))
    }
}
