import OutrangutanCore
import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The control window: clock and transport on top, the cue list or the pad
/// board below, the Inspector on the right, and the everyday tools in the
/// window's toolbar.
struct ControlView: View {
    @ObservedObject var engine: Engine
    @ObservedObject var link: ShowLink
    @ObservedObject var files: ShowFiles
    let scopes: Scopes
    @AppStorage("ui.monitor") private var showMonitor = true
    @Environment(\.undoManager) private var undoManager
    @ObservedObject private var keys = KeyMap.shared
    @AppStorage("clock.24hour") private var clock24 = true
    @State private var dropTargeted = false
    @State private var showConnect = false
    @AppStorage("ui.inspector") private var showInspector = true
    @AppStorage("ui.tab") private var tab = "cues"

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if showMonitor { MonitorStrip(engine: engine, scopes: scopes); Divider() }
            if let point = engine.recovered { recoveryBar(point); Divider() }
            if tab == "pads" { PadBoardView(board: engine.pads) } else { cueList }
        }
        .inspector(isPresented: $showInspector) {
            Group {
                if tab == "pads" { PadInspectorView(board: engine.pads) } else { InspectorView(engine: engine) }
            }
            .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .toolbar { toolbar }
        // Like any Mac document, the window is named for its show file.
        .navigationTitle(files.currentFile?.deletingPathExtension().lastPathComponent ?? "Outrangutan")
        .navigationSubtitle(link.phase == .linked ? link.message : "")
        .sheet(isPresented: $showConnect) { ConnectView(link: link) }
        .onReceive(NotificationCenter.default.publisher(for: .showConnect)) { _ in showConnect = true }
        .onAppear { engine.undoManager = undoManager }
        .onReceive(NotificationCenter.default.publisher(for: .toggleInspector)) { _ in showInspector.toggle() }
        .dropDestination(for: URL.self) { urls, _ in
            guard !engine.locked else { return false }
            if tab == "pads" { engine.pads.add(urls: urls) } else { engine.add(urls: urls) }
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

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let working = files.working {
            // Saving or opening a show file runs in the background; the
            // show keeps running and GO still works.
            ToolbarItem(placement: .status) {
                HStack(spacing: 8) {
                    ProgressView(value: files.progress).frame(width: 110)
                    Text(working + "\u{2026}").font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $tab) {
                Label("Cues", systemImage: "list.bullet.rectangle").tag("cues")
                Label("Pads", systemImage: "square.grid.3x3.fill").tag("pads")
            }
            .pickerStyle(.segmented)
            .labelStyle(.titleAndIcon)
            .help("Switch between the cue list and the sound effect pads")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { chooseFiles() } label: { Label("Add Media", systemImage: "plus") }
                .help(tab == "pads" ? "Add sounds to the pads" : "Add videos, sounds or stills to the cue list")
                .disabled(engine.locked)
            if tab == "cues" {
                Menu {
                    Button("Black") { engine.addMatte(color: "#000000", name: "Black") }
                    Button("White") { engine.addMatte(color: "#FFFFFF", name: "White") }
                    Button("Gray") { engine.addMatte(color: "#808080", name: "Gray") }
                    Button("Chroma Green") { engine.addMatte(color: "#00B140", name: "Chroma green") }
                    Button("Chroma Blue") { engine.addMatte(color: "#0047BB", name: "Chroma blue") }
                } label: {
                    Label("Add Matte", systemImage: "square.fill")
                }
                .help("Add a solid color picture. Change its color in the Inspector.")
                .disabled(engine.locked)
            }
            Menu {
                Button(engine.openOutputs.isEmpty ? "Open All Outputs" : "Close All Outputs") { engine.toggleOutput() }
                Divider()
                ForEach(engine.outputs) { output in
                    Toggle(output.label, isOn: Binding(
                        get: { engine.openOutputs.contains(output.id) },
                        set: { $0 ? engine.openOutput(output.id) : engine.closeOutput(output.id) }
                    ))
                }
                Divider()
                Button("Identify Outputs") { engine.identifyOutputs() }.disabled(engine.openOutputs.isEmpty)
                SettingsLink { Text("Outputs and Sound Settings…") }
            } label: {
                Label("Outputs", systemImage: engine.openOutputs.isEmpty ? "rectangle.on.rectangle.slash" : "rectangle.on.rectangle")
            } primaryAction: {
                engine.toggleOutput()
            }
            .help(engine.openOutputs.isEmpty ? "Open the outputs" : "Close the outputs")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Toggle(isOn: $engine.locked) {
                Label(engine.locked ? "Unlock Editing" : "Lock Editing", systemImage: engine.locked ? "lock.fill" : "lock.open")
            }
            .toggleStyle(.button)
            .help(engine.locked ? "Editing is locked. The show still runs. Click to unlock (Shift-Command-L)."
                  : "Lock editing for the show, so a stray click changes nothing (Shift-Command-L)")
            LinkBadge(link: link) { showConnect = true }
        }
        // The Inspector button sits last, at the window's right edge, over
        // the Inspector it opens.
        ToolbarItemGroup(placement: .primaryAction) {
            Button { showInspector.toggle() } label: { Label("Inspector", systemImage: "sidebar.trailing") }
                .help(showInspector ? "Hide the Inspector (Command-I)" : "Show the Inspector (Command-I)")
        }
    }

    // MARK: Clock and transport

    private var header: some View {
        VStack(spacing: 14) {
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(engine.status.rawValue)
                            .font(.subheadline.weight(.bold))
                            .fixedSize()
                            .padding(.horizontal, 10).padding(.vertical, 3)
                            .background(statusColor.opacity(0.22), in: Capsule())
                            .foregroundStyle(statusColor)
                        if engine.locked {
                            Label("LOCKED", systemImage: "lock.fill")
                                .font(.subheadline.weight(.bold))
                                .fixedSize()
                                .padding(.horizontal, 10).padding(.vertical, 3)
                                .background(Color.secondary.opacity(0.18), in: Capsule())
                                .foregroundStyle(.secondary)
                                .help("Editing is locked. The show still runs.")
                        }
                    }
                    Text(onAirText)
                        .font(.title3.weight(.medium))
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
                    Text(standbyText)
                        .font(.callout)
                        .lineLimit(1)
                        .foregroundStyle(.tertiary)
                    if let notice = engine.notice {
                        Label(notice, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(.orange)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 0) {
                    // SF Pro with fixed-width digits, so the clock never jiggles.
                    Text(clockText)
                        .font(.system(size: 60, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(engine.remaining == nil && engine.status != .pre ? Color.secondary : clockColor)
                        .fixedSize()
                        .accessibilityLabel("Time left")
                    timeOfDay
                }
            }

            // The transport gets its own row, so every button stays a big
            // target however narrow the window is.
            HStack(spacing: 10) {
                transport("GO", symbol: "play.fill", key: keys.name(.go), color: .green, prominent: true) { engine.go() }
                transport(engine.status == .paused ? "Resume" : "Pause", symbol: engine.status == .paused ? "playpause.fill" : "pause.fill",
                          key: keys.name(.pause), color: .yellow, action: engine.togglePause)
                transport("Stop", symbol: "stop.fill", key: keys.name(.stop), color: .orange, action: engine.stop)
                transport("Fade", symbol: "chart.line.downtrend.xyaxis", key: keys.name(.fade), color: .purple, action: engine.fadeStopAll)
                transport("All Stop", symbol: "exclamationmark.octagon.fill", key: keys.name(.allStop), color: .red, prominent: true, action: engine.allStop)
            }
        }
        .padding(16)
    }

    /// Shown after Outrangutan closed mid-show: what was on air, and a way
    /// to pick up from there.
    private func recoveryBar(_ point: RecoveryPoint) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.uturn.backward.circle.fill")
                .font(.title2)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Outrangutan closed during the show")
                    .font(.headline)
                Text("\u{201C}\(point.name)\u{201D} was on air" + (point.offset > 0 ? " at \(Timecode.short(point.offset))." : "."))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Dismiss") { engine.recovered = nil }
            Button(point.offset > 0 ? "Stand By at \(Timecode.short(point.offset))" : "Stand By That Cue") {
                engine.standbyRecovered()
            }
            .buttonStyle(.borderedProminent)
            .help("The cue stands by. Its next GO starts where it left off.")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.orange.opacity(0.1))
    }

    /// The time of day, under the big clock. Click it to switch between a
    /// 24-hour and a 12-hour clock.
    private var timeOfDay: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Button {
                clock24.toggle()
            } label: {
                Label(Self.timeText(context.date, twentyFour: clock24), systemImage: "clock")
                    .font(.title3.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help(clock24 ? "Time of day. Click for a 12-hour clock." : "Time of day. Click for a 24-hour clock.")
            .accessibilityLabel("Time of day")
        }
    }

    static func timeText(_ date: Date, twentyFour: Bool) -> String {
        let f = DateFormatter()
        f.dateFormat = twentyFour ? "HH:mm:ss" : "h:mm:ss a"
        return f.string(from: date)
    }

    /// A native Mac button, extra large for show use. GO and All Stop are
    /// filled with their color; the others are standard buttons whose
    /// symbol carries the color, since a plain Mac button is always gray.
    @ViewBuilder
    private func transport(_ title: String, symbol: String, key: String, color: Color, prominent: Bool = false,
                           action: @escaping () -> Void) -> some View {
        // Symbol, word and key stacked on one center line, so every button
        // lines up with its neighbors.
        let label = VStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(prominent ? Color.white : color)
                .frame(height: 24)
            Text(title).font(.headline)
            Text(key).font(.caption2).opacity(0.75)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
        Group {
            if prominent {
                Button(action: action) { label }.buttonStyle(.borderedProminent).tint(color)
            } else {
                Button(action: action) { label }.buttonStyle(.bordered)
            }
        }
        .controlSize(.extraLarge)
        .focusable(false)
        .help("\(title) (\(key))")
    }

    // MARK: Cue list

    private var cueList: some View {
        Group {
            if engine.cues.isEmpty {
                ContentUnavailableView {
                    Label("No Cues Yet", systemImage: "film.stack")
                } description: {
                    Text("Drag videos, sounds or stills here, or click Add Media in the toolbar.")
                } actions: {
                    Button("Add Media") { chooseFiles() }
                }
            } else {
                List(selection: $engine.standbyID) {
                    ForEach(Array(engine.cues.enumerated()), id: \.element.id) { index, cue in
                        row(cue, number: index + 1).tag(cue.id)
                    }
                    .onMove(perform: engine.locked ? nil : { engine.move(from: $0, to: $1) })
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .onDeleteCommand {
                    if !engine.locked, let id = engine.standbyID { engine.remove(ids: [id]) }
                }
            }
        }
    }

    private func row(_ cue: Cue, number: Int) -> some View {
        let onAir = cue.id == engine.pictureCue?.id || cue.id == engine.soundCue?.id
        let waiting = cue.id == engine.pendingCue?.id
        return HStack(spacing: 10) {
            Text("\(number)")
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
            icon(cue, onAir: onAir)
            Text(cue.name).font(.body).lineLimit(1)
            if !cue.fileIsThere {
                Label("File missing", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 6)
            // Settings tags, right-aligned against the icon columns.
            HStack(spacing: 4) {
                if !cue.armed { chip("SKIP", .gray) }
                if cue.preWait > 0 { chip("PRE \(Timecode.short(cue.preWait))", .yellow) }
                if cue.continueMode != .manual { chip(cue.continueMode == .autoFollow ? "FOLLOW" : "CONT", .blue) }
                if cue.output != 1 && cue.kind.hasPicture { chip(cue.output == 0 ? "ALL OUT" : "OUT \(cue.output)", .teal) }
                if cue.key.mode != .off && cue.kind == .video { chip("KEY", .green) }
                if cue.obs.action != .none || !cue.obsTriggerScene.isEmpty { chip("OBS", .indigo) }
            }
            // The small icons each keep their own column, shown or not, so
            // they line up from row to row.
            HStack(spacing: 2) {
                slot(cue.xfade > 0, "circle.lefthalf.filled", "Dissolves in")
                slot(cue.loop, "repeat", "Loops")
                slot(!cue.sfxPadId.isEmpty, "square.grid.3x3.fill", "Brings a pad with it")
            }
            Group {
                if waiting { chip("PRE-WAIT", .orange, solid: true) }
                else if onAir { chip("ON AIR", .red, solid: true) }
                else { Color.clear.frame(height: 1) }
            }
            .frame(width: 66, alignment: .center)
            Text(durationText(cue))
                .font(.callout)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 56, alignment: .trailing)
        }
        .padding(.vertical, 3)
        .opacity(cue.armed ? 1 : 0.55)
        .contextMenu {
            if cue.kind != .matte {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([cue.url]) }
            }
            Button(cue.armed ? "Skip on GO" : "Fire on GO") { engine.update(cue.id) { $0.armed.toggle() } }
                .disabled(engine.locked)
            Button("Duplicate") { engine.duplicate(cue.id) }
                .disabled(engine.locked)
            Divider()
            Button("Remove", role: .destructive) { engine.remove(ids: [cue.id]) }
                .disabled(engine.locked)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cue \(number), \(cue.name)\(onAir ? ", on air" : "")")
    }

    @ViewBuilder
    private func icon(_ cue: Cue, onAir: Bool) -> some View {
        if cue.kind == .matte {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color(nsColor: NSColor(hex: cue.color) ?? .black))
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1))
                .frame(width: 16, height: 12)
                .frame(width: 20)
        } else {
            Image(systemName: cue.kind.symbol)
                .symbolRenderingMode(.hierarchical)
                .symbolEffect(.variableColor.iterative, isActive: onAir && cue.kind == .audio)
                .frame(width: 20)
                .foregroundStyle(cue.kind == .audio ? Color.cyan : (cue.kind == .still ? Color.yellow : Color.purple))
        }
    }

    /// One icon column in a cue row: the symbol when the setting is on, an
    /// empty space the same size when it is off.
    private func slot(_ on: Bool, _ symbol: String, _ help: String) -> some View {
        Image(systemName: symbol)
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(width: 18)
            .opacity(on ? 1 : 0)
            .help(on ? help : "")
            .accessibilityHidden(!on)
    }

    private func chip(_ text: String, _ color: Color, solid: Bool = false) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(solid ? color : color.opacity(0.2), in: Capsule())
            .foregroundStyle(solid ? Color.white : color)
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = tab == "pads" ? [.audio] : [.movie, .audio, .image]
        panel.prompt = "Add"
        guard panel.runModal() == .OK else { return }
        if tab == "pads" { engine.pads.add(urls: panel.urls) } else { engine.add(urls: panel.urls) }
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
