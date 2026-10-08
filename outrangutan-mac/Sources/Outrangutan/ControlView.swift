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
    @ObservedObject private var thumbs = Thumbnails.shared
    @ObservedObject private var keys = KeyMap.shared
    @AppStorage("clock.24hour") private var clock24 = true
    @AppStorage("clock.countUp") private var countUp = false
    @State private var dropTargeted = false
    @State private var showConnect = false
    @State private var showCheck = false
    /// Cues picked in the list. One pick stands that cue by; Shift- or
    /// Command-click picks several, for Remove, Skip, Color and Duplicate.
    @State private var picked: Set<UUID> = []
    @AppStorage("ui.inspector") private var showInspector = true
    @AppStorage("ui.tab") private var tab = "cues"
    @AppStorage("ui.layout") private var layout = "side"
    @AppStorage("ui.transport") private var showTransport = true
    /// With both panels showing, the Inspector follows whatever was touched
    /// last: a cue or a pad.
    @State private var touchedPads = false

    private var inspectorShowsPads: Bool { tab == "pads" || (tab == "both" && touchedPads) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if showMonitor { MonitorStrip(engine: engine, scopes: scopes); Divider() }
            if let point = engine.recovered { recoveryBar(point); Divider() }
            switch tab {
            case "pads": PadBoardView(board: engine.pads)
            case "both":
                if layout == "stacked" {
                    VSplitView {
                        cueList.frame(minHeight: 160)
                        PadBoardView(board: engine.pads).frame(minHeight: 160)
                    }
                } else {
                    HSplitView {
                        cueList.frame(minWidth: 420)
                        PadBoardView(board: engine.pads).frame(minWidth: 360)
                    }
                }
            default: cueList
            }
        }
        .inspector(isPresented: $showInspector) {
            Group {
                if inspectorShowsPads { PadInspectorView(board: engine.pads) } else { InspectorView(engine: engine) }
            }
            .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .toolbar { toolbar }
        // Like any Mac document, the window is named for its show file.
        .navigationTitle(files.currentFile?.deletingPathExtension().lastPathComponent ?? "Outrangutan")
        .navigationSubtitle(link.phase == .linked ? link.message : "")
        .sheet(isPresented: $showConnect) { ConnectView(link: link) }
        .sheet(isPresented: $showCheck) { ShowCheckView(engine: engine, link: link) }
        .onReceive(NotificationCenter.default.publisher(for: .showCheck)) { _ in showCheck = true }
        .onReceive(NotificationCenter.default.publisher(for: .showConnect)) { _ in showConnect = true }
        .onAppear { engine.undoManager = undoManager }
        .onReceive(NotificationCenter.default.publisher(for: .toggleInspector)) { _ in showInspector.toggle() }
        .onChange(of: engine.pads.selectedPadID) { _, id in if id != nil { touchedPads = true } }
        .onChange(of: picked) { _, _ in touchedPads = false }
        .onChange(of: engine.standbyID) { _, _ in touchedPads = false }
        .dropDestination(for: URL.self) { urls, _ in
            guard !engine.locked else { return false }
            if inspectorShowsPads { engine.pads.add(urls: urls) } else { engine.add(urls: urls) }
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
                Label("SFX", systemImage: "square.grid.3x3.fill").tag("pads")
                Label("Both", systemImage: "rectangle.split.2x1").tag("both")
            }
            .pickerStyle(.segmented)
            .labelStyle(.titleAndIcon)
            .help("The cue list, the SFX pads, or both at once (View, Layout picks side by side or stacked)")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { chooseFiles() } label: { Label("Add Media", systemImage: "plus") }
                .help(tab == "pads" ? "Add sounds to the SFX pads" : "Add videos, sounds or stills to the cue list")
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
        }
        ToolbarItemGroup(placement: .primaryAction) {
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
            Button { showCheck = true } label: { Label("Show Check", systemImage: "checkmark.seal") }
                .help("Check everything before the show: media, outputs, sound, power, links")
            Toggle(isOn: $engine.locked) {
                Label(engine.locked ? "Unlock Editing" : "Lock Editing", systemImage: engine.locked ? "lock.fill" : "lock.open")
            }
            .toggleStyle(.button)
            .help(engine.locked ? "Editing is locked. The show still runs. Click to unlock (Shift-Command-L)."
                  : "Lock editing for the show, so a stray click changes nothing (Shift-Command-L)")
        }
        ToolbarItem(placement: .primaryAction) {
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
                        .font(.title2.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(engine.pictureCue != nil || engine.soundCue != nil || engine.pendingCue != nil ? .primary : .secondary)
                        .padding(.top, 2)
                    Label(standbyText, systemImage: "arrow.turn.down.right")
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
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
                        .contentShape(Rectangle())
                        .onTapGesture { countUp.toggle() }
                        .help(countUp ? "Counting up: time played. Click to count down." : "Counting down: time left. Click to count up.")
                        .accessibilityLabel(countUp ? "Time played" : "Time left")
                        .accessibilityAddTraits(.isButton)
                    HStack(spacing: 14) {
                        Button { countUp.toggle() } label: {
                            Label(countUp ? "Played" : "Left", systemImage: countUp ? "arrow.up" : "arrow.down")
                                .font(.title3.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help(countUp ? "Counting up: time played. Click to count down." : "Counting down: time left. Click to count up.")
                        timeOfDay
                    }
                    .padding(.top, 2)
                }
            }

            // The transport gets its own row, so every button stays a big
            // target however narrow the window is. Pros who drive by keys
            // or deck can hide it (View menu).
            if showTransport { GeometryReader { geo in
                // GO takes a third of the row, All Stop a sixth, the three in
                // between share the rest, with a little air around All Stop.
                let gap: CGFloat = 10
                let go = geo.size.width * 0.32
                let all = geo.size.width * 0.16
                let mid = (geo.size.width - go - all - gap * 5) / 3
                HStack(spacing: gap) {
                    transport("GO", symbol: "play.fill", key: keys.name(.go), color: .green, prominent: true) { engine.go() }
                        .frame(width: go)
                    transport(engine.status == .paused ? "Resume" : "Pause", symbol: engine.status == .paused ? "playpause.fill" : "pause.fill",
                              key: keys.name(.pause), color: .yellow, action: engine.togglePause)
                        .frame(width: mid)
                    transport("Stop", symbol: "stop.fill", key: keys.name(.stop), color: .orange, action: engine.stop)
                        .frame(width: mid)
                    transport("Fade", symbol: "chart.line.downtrend.xyaxis", key: keys.name(.fade), color: .purple, action: engine.fadeStopAll)
                        .frame(width: mid)
                    Spacer(minLength: gap)
                    transport("All Stop", symbol: "exclamationmark.octagon.fill", key: keys.name(.allStop), color: .red, prominent: true, action: engine.allStop)
                        .frame(width: all)
                }
            }
            .frame(height: 72) }
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
                VStack(spacing: 0) {
                cueHeader
                Divider()
                List(selection: Binding(get: { picked }, set: { new in
                    picked = new
                    if new.count == 1, let id = new.first { engine.standbyID = id }
                })) {
                    ForEach(Array(engine.cues.enumerated()), id: \.element.id) { index, cue in
                        row(cue, number: index + 1).tag(cue.id)
                    }
                    .onMove(perform: engine.locked ? nil : { engine.move(from: $0, to: $1) })
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .contextMenu(forSelectionType: UUID.self) { ids in cueMenu(ids) }
                .onDeleteCommand {
                    let ids = picked.isEmpty ? Set([engine.standbyID].compactMap { $0 }) : picked
                    if !engine.locked, !ids.isEmpty { engine.remove(ids: ids) }
                }
                // GO moves the standby on: the list follows it.
                .onChange(of: engine.standbyID) { _, id in
                    guard let id, !(picked.count > 1 && picked.contains(id)) else { return }
                    picked = [id]
                }
                .onAppear { if let id = engine.standbyID { picked = [id] } }
                }
            }
        }
    }

    /// Quiet column names over the cue list, lined up with the rows.
    private var cueHeader: some View {
        HStack(spacing: 10) {
            Color.clear.frame(width: 4, height: 1).padding(.trailing, -6)
            Text("#").frame(width: 28, alignment: .trailing)
            Color.clear.frame(width: 48, height: 1)
            Text("CUE")
            Spacer(minLength: 6)
            Text("WAIT").frame(width: 56, alignment: .trailing)
            Color.clear.frame(width: 58, height: 1)
            Text("STATE").frame(width: 66)
            Text("LENGTH").frame(width: 56, alignment: .trailing)
        }
        .font(.caption2.weight(.bold))
        .foregroundStyle(.secondary)
        .padding(.leading, 18)
        .padding(.trailing, 19)
        .padding(.vertical, 6)
    }

    private func row(_ cue: Cue, number: Int) -> some View {
        let onAir = cue.id == engine.pictureCue?.id || cue.id == engine.soundCue?.id
        let waiting = cue.id == engine.pendingCue?.id
        let standby = cue.id == engine.standbyID
        return HStack(spacing: 10) {
            // The cue's color, as a stripe, like a label in Finder.
            Capsule().fill(cue.label == .none ? Color.clear : Self.color(cue.label)).frame(width: 4, height: 22)
                .padding(.trailing, -6)
            // The standby cue's number is green: the one GO fires next,
            // whatever is selected.
            Text("\(number)")
                .font(.body.weight(standby ? .bold : .semibold))
                .monospacedDigit()
                .foregroundStyle(standby ? Color.green : Color.secondary)
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
                if cue.continueMode != .manual { chip(cue.continueMode == .autoFollow ? "FOLLOW" : "CONT", .blue) }
                if cue.output != 1 && cue.kind.hasPicture { chip(cue.output == 0 ? "ALL OUT" : "OUT \(cue.output)", .teal) }
                if cue.key.mode != .off && cue.kind == .video { chip("KEY", .green) }
                if cue.obs.action != .none || !cue.obsTriggerScene.isEmpty { chip("OBS", .indigo) }
            }
            // The pre-wait, as a column: a dash when there is none.
            Text(cue.preWait > 0 ? Timecode.short(cue.preWait) : "\u{2013}")
                .font(.callout)
                .monospacedDigit()
                .foregroundStyle(cue.preWait > 0 ? Color.yellow : Color.secondary.opacity(0.5))
                .frame(width: 56, alignment: .trailing)
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
                else if standby { chip("STANDBY", .green) }
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cue \(number), \(cue.name)\(onAir ? ", on air" : "")")
    }

    @ViewBuilder
    private func icon(_ cue: Cue, onAir: Bool) -> some View {
        // A 16:9 picture of the cue: a frame of the video, the still, the
        // matte's color, or the kind's symbol for sound.
        ZStack {
            RoundedRectangle(cornerRadius: 4).fill(cue.kind == .matte ? Color(nsColor: NSColor(hex: cue.color) ?? .black) : Color.black.opacity(0.35))
            if let image = thumbs.image(for: cue) {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
            } else if cue.kind != .matte {
                Image(systemName: cue.kind.symbol)
                    .symbolRenderingMode(.hierarchical)
                    .symbolEffect(.variableColor.iterative, isActive: onAir && cue.kind == .audio)
                    .foregroundStyle(cue.kind == .audio ? Color.cyan : (cue.kind == .still ? Color.yellow : Color.purple))
            }
        }
        .frame(width: 48, height: 27)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(onAir ? Color.red : Color.secondary.opacity(0.35), lineWidth: onAir ? 2 : 1))
        .accessibilityHidden(true)
    }

    /// The right-click menu for one cue or several picked ones.
    @ViewBuilder
    private func cueMenu(_ ids: Set<UUID>) -> some View {
        let chosen = engine.cues.filter { ids.contains($0.id) }
        let one = chosen.count == 1 ? chosen.first : nil
        let noun = chosen.count == 1 ? "Cue" : "\(chosen.count) Cues"
        if !chosen.isEmpty {
            if let one, one.kind != .matte {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([one.url]) }
            }
            if let one {
                Button("Stand By") { engine.standbyID = one.id }
            }
            let allArmed = chosen.allSatisfy(\.armed)
            Button(allArmed ? "Skip on GO" : "Fire on GO") {
                engine.updateAll(ids, allArmed ? "Skip on GO" : "Fire on GO") { $0.armed = !allArmed }
            }
            .disabled(engine.locked)
            Menu("Color") {
                ForEach(CueLabel.allCases, id: \.self) { l in
                    Button(l.label) { engine.updateAll(ids, "Color") { $0.label = l } }
                }
            }
            .disabled(engine.locked)
            Button("Duplicate \(noun)") { engine.duplicate(ids: ids) }
                .disabled(engine.locked)
            Divider()
            Button("Remove \(noun)", role: .destructive) { engine.remove(ids: ids) }
                .disabled(engine.locked)
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
        if inspectorShowsPads { engine.pads.add(urls: panel.urls) } else { engine.add(urls: panel.urls) }
    }

    // MARK: Words and colors

    static func color(_ label: CueLabel) -> Color {
        switch label {
        case .none: return .clear
        case .blue: return .blue
        case .green: return .green
        case .red: return .red
        case .yellow: return .yellow
        case .purple: return .purple
        case .cyan: return .cyan
        }
    }

    private var clockText: String {
        if engine.status == .pre, let p = engine.preRemaining { return Timecode.dropFrame(p) }
        if let r = engine.remaining {
            if countUp, let length = engine.countingLength, length > 0 { return Timecode.dropFrame(max(0, length - r)) }
            return Timecode.dropFrame(r)
        }
        return engine.status == .holding ? "HOLD" : "00:00:00;00"
    }

    private var clockColor: Color {
        if engine.status == .pre { return .orange }
        if countUp { return .green }
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
