import AppKit
import OutrangutanCore

/// Printing: the cue sheet and the show log. Each is laid out as a simple
/// page and handed to the Mac's print window, which can also save a PDF.
enum Printer {
    /// Prints the cue list and the pad map, for the booth and the crew.
    static func printCueSheet(engine: Engine, showName: String, pdfTo url: URL? = nil) {
        var rows = ""
        for (i, cue) in engine.cues.enumerated() {
            let length = cue.kind.holds ? (cue.duration > 0 ? Timecode.short(cue.duration) : "Holds")
                : (cue.loop ? "Loops" : (engine.durations[cue.id].map { _ in Timecode.short(engine.playLength(cue)) } ?? ""))
            var start = cue.preWait > 0 ? "Waits \(Timecode.short(cue.preWait))" : ""
            if cue.continueMode != .manual { start += (start.isEmpty ? "" : ", ") + cue.continueMode.label }
            let output = !cue.kind.hasPicture ? "Sound" : (cue.output == 0 ? "Every output" : engine.outputLabel(cue.output))
            let pad = engine.pads.pad(id: cue.sfxPadId).map { "\($0.emoji) \($0.name)" } ?? ""
            rows += """
            <tr\(cue.armed ? "" : " class=\"skip\"")><td class="n">\(i + 1)</td>
            <td><b>\(esc(cue.name))</b>\(cue.armed ? "" : " <i>(skipped on GO)</i>")</td>
            <td>\(kindName(cue.kind))</td><td class="n">\(length)</td><td>\(esc(start))</td>
            <td>\(esc(endName(cue)))</td><td>\(esc(output))</td><td>\(esc(pad))</td><td>\(esc(cue.notes))</td></tr>
            """
        }
        var padTables = ""
        for bank in engine.pads.banks {
            let pads = engine.pads.pads.filter { $0.bank == bank.id }.sorted { $0.slot < $1.slot }
            guard !pads.isEmpty else { continue }
            padTables += "<h2>SFX: \(esc(bank.name))</h2><table><tr><th>Key</th><th>Pad</th><th>Length</th><th>Plays</th></tr>"
            for p in pads {
                let len = engine.pads.length(p.id).map { String(format: "%.1f s", $0) } ?? ""
                let plays = p.retrigger.label + (p.loop ? ", loops" : "")
                padTables += "<tr><td class=\"n\"><b>\(esc(p.key.uppercased()))</b></td><td>\(esc(p.emoji)) \(esc(p.name))</td><td class=\"n\">\(len)</td><td>\(esc(plays))</td></tr>"
            }
            padTables += "</table>"
        }
        let summary = "\(ShowFiles.count(engine.cues.count, "cue")), \(ShowFiles.count(engine.pads.pads.count, "pad"))"
        let body = """
        <h1>\(esc(showName))</h1>
        <p class="sub">Cue sheet · \(today()) · \(summary)</p>
        <table><tr><th>#</th><th>Cue</th><th>Type</th><th>Length</th><th>Start</th><th>End</th><th>Shows on</th><th>Pad</th><th>Notes</th></tr>
        \(rows)</table>
        \(padTables)
        """
        run(html: page(body), jobName: "\(showName) Cue Sheet", landscape: true, pdfTo: url)
    }

    /// Prints the show log.
    static func printLog(_ entries: [ShowLog.Entry], showName: String, pdfTo url: URL? = nil) {
        let rows = entries.map {
            "<tr><td class=\"n\">\($0.clock)</td><td>\($0.kind.label)</td><td>\(esc($0.text))</td><td>\(esc($0.from))</td></tr>"
        }.joined()
        let body = """
        <h1>\(esc(showName))</h1>
        <p class="sub">Show log · \(today()) · \(ShowFiles.count(entries.count, "line"))</p>
        <table><tr><th>Time</th><th>What</th><th></th><th>From</th></tr>\(rows)</table>
        """
        run(html: page(body), jobName: "\(showName) Show Log", landscape: false, pdfTo: url)
    }

    // MARK: Inside

    private static func run(html: String, jobName: String, landscape: Bool, pdfTo url: URL?) {
        guard let text = NSAttributedString(html: Data(html.utf8), options: [.characterEncoding: String.Encoding.utf8.rawValue],
                                            documentAttributes: nil) else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.orientation = landscape ? .landscape : .portrait
        info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        // The older text engine lays out tables; the newer one flattens them.
        let view = NSTextView(usingTextLayoutManager: false)
        view.frame = NSRect(x: 0, y: 0, width: width, height: 100)
        view.textStorage?.setAttributedString(text)
        view.isVerticallyResizable = true
        view.textContainer?.widthTracksTextView = true
        view.sizeToFit()
        if let url {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
        }
        let op = NSPrintOperation(view: view, printInfo: info)
        op.jobTitle = jobName
        op.showsPrintPanel = url == nil
        op.showsProgressPanel = url == nil
        op.printPanel.options.insert([.showsOrientation, .showsScaling, .showsPaperSize])
        if url == nil, let window = NSApp.keyWindow ?? NSApp.mainWindow {
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
    }

    private static func page(_ body: String) -> String {
        """
        <html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue'; font-size: 10pt; color: #111; }
        h1 { font-size: 18pt; margin: 0; }
        h2 { font-size: 12pt; margin: 16pt 0 4pt 0; }
        p.sub { color: #555; margin: 2pt 0 10pt 0; }
        table { border-collapse: collapse; width: 100%; }
        th { text-align: left; font-size: 8.5pt; color: #555; border-bottom: 1px solid #999; padding: 3pt 5pt; }
        td { border-bottom: 1px solid #ddd; padding: 4pt 5pt; vertical-align: top; }
        td.n { white-space: nowrap; }
        tr.skip td { color: #888; }
        </style></head><body>\(body)
        <p class="sub" style="margin-top:14pt">Printed from Outrangutan for Mac</p></body></html>
        """
    }

    private static func kindName(_ kind: CueKind) -> String {
        switch kind {
        case .video: return "Video"
        case .audio: return "Sound"
        case .still: return "Still"
        case .matte: return "Matte"
        }
    }

    private static func endName(_ cue: Cue) -> String {
        if cue.kind == .audio { return cue.endAction == .black ? "Fade out" : "Stop" }
        if cue.kind.holds && cue.endAction == .hold { return "Stays up" }
        return cue.endAction.label
    }

    private static func today() -> String {
        let f = DateFormatter()
        f.dateStyle = .long
        return f.string(from: Date())
    }

    private static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}
