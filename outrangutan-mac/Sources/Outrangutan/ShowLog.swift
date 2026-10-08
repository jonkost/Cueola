import AppKit
import SwiftUI

/// The show log: every GO, stop, pad hit, command from the show and problem,
/// with the time and who asked for it. Use it to talk through a show after
/// class.
///
/// Each day's log is also written, line by line, to
/// ~/Library/Application Support/Outrangutan/Logs/<date>.txt, so a crash
/// never loses it.
final class ShowLog: ObservableObject {
    enum Kind: String, CaseIterable {
        case cue, stop, panic, pause, pad, link, output, file, problem

        var label: String {
            switch self {
            case .cue: return "GO"
            case .stop: return "Stop"
            case .panic: return "All Stop"
            case .pause: return "Pause"
            case .pad: return "SFX"
            case .link: return "Link"
            case .output: return "Output"
            case .file: return "Show"
            case .problem: return "Problem"
            }
        }

        var symbol: String {
            switch self {
            case .cue: return "play.fill"
            case .stop: return "stop.fill"
            case .panic: return "exclamationmark.octagon.fill"
            case .pause: return "pause.fill"
            case .pad: return "square.grid.3x3.fill"
            case .link: return "antenna.radiowaves.left.and.right"
            case .output: return "rectangle.on.rectangle"
            case .file: return "doc"
            case .problem: return "exclamationmark.triangle.fill"
            }
        }

        var color: Color {
            switch self {
            case .cue: return .green
            case .stop: return .orange
            case .panic: return .red
            case .pause: return .yellow
            case .pad: return .purple
            case .link: return .blue
            case .output: return .teal
            case .file: return .secondary
            case .problem: return .orange
            }
        }
    }

    struct Entry: Identifiable, Equatable {
        let id = UUID()
        let time: Date
        let kind: Kind
        let text: String
        let from: String

        var clock: String { ShowLog.clockFormat.string(from: time) }
        var line: String { "\(clock)  \(kind.label.padding(toLength: 8, withPad: " ", startingAt: 0))  \(text)  (\(from))" }
    }

    @Published private(set) var entries: [Entry] = []
    static let most = 5000
    static let thisMac = "This Mac"

    static let clockFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    private static var off: Bool { ProcessInfo.processInfo.environment["OUTRANGUTAN_SNAPSHOT"] != nil }

    static var folder: URL {
        ShowStore.fileURL.deletingLastPathComponent().appendingPathComponent("Logs", isDirectory: true)
    }

    func add(_ kind: Kind, _ text: String, from: String = ShowLog.thisMac) {
        let entry = Entry(time: Date(), kind: kind, text: text, from: from)
        entries.append(entry)
        if entries.count > Self.most { entries.removeFirst(entries.count - Self.most) }
        write(entry)
    }

    func clear() { entries.removeAll() }

    /// The whole log as plain text, one line per entry.
    var text: String { entries.map(\.line).joined(separator: "\n") + "\n" }

    private func write(_ entry: Entry) {
        guard !Self.off else { return }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let url = Self.folder.appendingPathComponent(f.string(from: entry.time) + ".txt")
        let data = Data((entry.line + "\n").utf8)
        do {
            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
            if let h = try? FileHandle(forWritingTo: url) {
                defer { try? h.close() }
                try h.seekToEnd()
                try h.write(contentsOf: data)
            } else {
                try data.write(to: url)
            }
        } catch {
            NSLog("Outrangutan could not write the show log: \(error)")
        }
    }
}

/// The Show Log window: a table of what happened, newest at the bottom.
struct ShowLogView: View {
    @ObservedObject var log: ShowLog
    let showName: () -> String
    @State private var search = ""
    @State private var kinds: Set<ShowLog.Kind> = Set(ShowLog.Kind.allCases)
    @State private var confirmClear = false

    private var shown: [ShowLog.Entry] {
        log.entries.filter { e in
            kinds.contains(e.kind) && (search.isEmpty || e.text.localizedCaseInsensitiveContains(search)
                                       || e.from.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        Group {
            if log.entries.isEmpty {
                ContentUnavailableView("Nothing Logged Yet", systemImage: "list.bullet.clipboard",
                                       description: Text("Every GO, stop, pad and command from the show lands here as it happens."))
            } else {
                ScrollViewReader { proxy in
                    Table(shown) {
                        TableColumn("Time") { e in
                            Text(e.clock).monospacedDigit().foregroundStyle(.secondary)
                        }
                        .width(min: 64, ideal: 70, max: 80)
                        TableColumn("What") { e in
                            Label {
                                Text(e.text)
                            } icon: {
                                Image(systemName: e.kind.symbol).foregroundStyle(e.kind.color)
                            }
                            .help(e.kind.label)
                        }
                        TableColumn("From") { e in
                            Text(e.from).foregroundStyle(.secondary)
                        }
                        .width(min: 90, ideal: 140, max: 220)
                    }
                    .onChange(of: log.entries.count) { _, _ in
                        if let last = shown.last { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        }
        .frame(minWidth: 560, minHeight: 320)
        .searchable(text: $search, placement: .toolbar, prompt: "Search the log")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Menu {
                    ForEach(ShowLog.Kind.allCases, id: \.self) { kind in
                        Toggle(isOn: Binding(get: { kinds.contains(kind) },
                                             set: { if $0 { kinds.insert(kind) } else { kinds.remove(kind) } })) {
                            Label(kind.label, systemImage: kind.symbol)
                        }
                    }
                    Divider()
                    Button("Show Everything") { kinds = Set(ShowLog.Kind.allCases) }
                } label: {
                    Label("Show", systemImage: kinds.count == ShowLog.Kind.allCases.count
                          ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .help("Pick what the log shows")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { exportLog() } label: { Label("Export", systemImage: "square.and.arrow.up") }
                    .help("Save the log as a text file")
                    .disabled(log.entries.isEmpty)
                Button { Printer.printLog(shown, showName: showName()) } label: { Label("Print", systemImage: "printer") }
                    .help("Print the log, or save it as a PDF")
                    .disabled(log.entries.isEmpty)
                Button { NSWorkspace.shared.activateFileViewerSelecting([ShowLog.folder]) } label: {
                    Label("Log Files", systemImage: "folder")
                }
                .help("Every day's log is also saved here, even after a crash")
                Button(role: .destructive) { confirmClear = true } label: { Label("Clear", systemImage: "trash") }
                    .help("Clear this window. The day's log file keeps everything.")
                    .disabled(log.entries.isEmpty)
            }
        }
        .confirmationDialog("Clear the log window?", isPresented: $confirmClear) {
            Button("Clear", role: .destructive) { log.clear() }
        } message: {
            Text("Today's log file keeps every line.")
        }
        .navigationTitle("Show Log")
        .navigationSubtitle(showName())
    }

    private func exportLog() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        panel.nameFieldStringValue = "\(showName()) Log \(f.string(from: Date())).txt"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? ("Show log: \(showName())\n\n" + log.text).write(to: url, atomically: true, encoding: .utf8)
    }
}
