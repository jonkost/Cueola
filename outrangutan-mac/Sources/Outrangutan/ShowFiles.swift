import AppKit
import OutrangutanCore
import UniformTypeIdentifiers

/// Show files: New, Open and Save in the File menu.
///
/// The show on this Mac always saves itself. A show file is a copy to carry
/// around: the cue list, the pads and every media file in one .ogshow, the
/// same file the web Outrangutan saves. So a show built in the browser opens
/// here, and a show saved here opens in the browser.
@MainActor
final class ShowFiles: ObservableObject {
    /// What is happening, while a file is being written or read.
    @Published private(set) var working: String?
    @Published private(set) var progress: Double = 0
    /// The show file this show was last opened from or saved to.
    @Published private(set) var currentFile: URL? {
        didSet { if !TestSnapshot.isOn { UserDefaults.standard.set(currentFile?.path, forKey: "showFile") } }
    }

    let engine: Engine
    static let type = UTType("live.cueola.outrangutan.show") ?? UTType(filenameExtension: ShowArchive.fileExtension) ?? .zip

    init(engine: Engine) {
        self.engine = engine
        if !TestSnapshot.isOn, let path = UserDefaults.standard.string(forKey: "showFile"),
           FileManager.default.fileExists(atPath: path) {
            currentFile = URL(fileURLWithPath: path)
        }
    }

    var hasShow: Bool { !engine.cues.isEmpty || !engine.pads.pads.isEmpty }

    /// The show's name: its file's name, or a plain one before it is saved.
    var showName: String { currentFile?.deletingPathExtension().lastPathComponent ?? "Outrangutan Show" }

    // MARK: Menu commands

    func newShow() {
        askToReplace(message: "Start a new show?",
                     info: "This clears the cue list and the pads on this Mac.") { [self] in
            engine.replaceShow(cues: [], pads: [], banks: [], multiTrigger: nil)
            currentFile = nil
            engine.log.add(.file, "Started a new show")
        }
    }

    func chooseAndOpen() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [Self.type, .json]
        panel.message = "Choose a show saved by Outrangutan, on the Mac or on the web."
        panel.prompt = "Open"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    /// Opens a show file, after checking it is one.
    func open(_ url: URL) {
        guard working == nil else { return }
        let payload: [String: Any]
        do { payload = try Self.readManifest(url) } catch {
            alert("That file isn't an Outrangutan show.", error.localizedDescription)
            return
        }
        let show = payload["show"] as? [String: Any] ?? [:]
        let nCues = (show["cues"] as? [Any])?.count ?? 0, nPads = (show["pads"] as? [Any])?.count ?? 0
        askToReplace(message: "Open \u{201C}\(url.deletingPathExtension().lastPathComponent)\u{201D}?",
                     info: "It has \(Self.count(nCues, "cue")) and \(Self.count(nPads, "pad")). It replaces the show on this Mac. Its media is copied to the Outrangutan folder in Movies.") { [self] in
            Task { await self.load(url, payload: payload) }
        }
    }

    func save() {
        if let url = currentFile { Task { await write(to: url) } } else { saveAs() }
    }

    func saveAs() {
        guard hasShow else { return alert("Nothing to save yet.", "Add a cue or a pad first.") }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [Self.type]
        panel.nameFieldStringValue = currentFile?.lastPathComponent ?? Self.defaultName()
        panel.message = "The show file holds the cues, the pads and all their media. The web Outrangutan opens it too."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await write(to: url) }
    }

    // MARK: Saving

    /// Writes the show to a file. Media is copied in the background, so
    /// the show keeps running while it saves.
    @discardableResult
    func write(to url: URL) async -> Bool {
        guard working == nil else { return false }
        let pack: Pack
        do { pack = try makePack() } catch {
            alert("Could not save the show.", error.localizedDescription)
            return false
        }
        working = "Saving \u{201C}\(url.deletingPathExtension().lastPathComponent)\u{201D}"
        progress = 0
        defer { working = nil }
        let total = max(1, pack.totalBytes)
        let result: Error? = await Task.detached(priority: .utility) {
            // Write next to the old file first, so a failed save never
            // leaves half a show where the good one was.
            let temp = url.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).ogshow")
            do {
                let w = try ShowArchive.Writer(url: temp)
                try w.add(name: "show.json", data: pack.manifest)
                var done: UInt64 = 0
                for entry in pack.entries {
                    switch entry.source {
                    case .data(let d):
                        try w.add(name: entry.name, data: d)
                        done += UInt64(d.count)
                    case .file(let f):
                        let before = done
                        try w.add(name: entry.name, file: f) { n in
                            let p = Double(before + n) / Double(total)
                            Task { @MainActor [weak self] in self?.progress = p }
                        }
                        done += entry.size
                    }
                }
                try w.finish()
                _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
                return nil
            } catch {
                try? FileManager.default.removeItem(at: temp)
                return error
            }
        }.value
        if let result {
            alert("Could not save the show.", result as? ShowArchive.Failure == .tooBig
                  ? "A show file holds up to 4 GB, the same as the web app's. Try trimming long videos."
                  : result.localizedDescription)
            return false
        }
        currentFile = url
        engine.notice = nil
        engine.log.add(.file, "Saved the show file \u{201C}\(url.lastPathComponent)\u{201D}")
        return true
    }

    struct Pack: Sendable {
        enum Source: Sendable { case data(Data), file(URL) }
        struct Entry: Sendable { let name: String; let source: Source; let size: UInt64 }
        let manifest: Data
        let entries: [Entry]
        var totalBytes: UInt64 { entries.reduce(0) { $0 + $1.size } }
    }

    /// Builds show.json in the web app's shape, and the list of media to copy.
    func makePack() throws -> Pack {
        var entries: [Pack.Entry] = []
        var mediaIndex: [String: Any] = [:]
        var idForPath: [String: String] = [:]

        func media(path: String, kind: String, duration: Double) -> String? {
            if let id = idForPath[path] { return id }
            let url = URL(fileURLWithPath: path)
            guard FileManager.default.fileExists(atPath: path) else { return nil }
            let id = Self.mediaID()
            let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.uint64Value ?? 0
            let file = "media/" + id
            entries.append(.init(name: file, source: .file(url), size: size))
            mediaIndex[id] = ["name": url.lastPathComponent, "mime": Self.mime(url), "kind": kind, "duration": duration,
                              "thumb": NSNull(), "width": 0, "height": 0, "file": file]
            idForPath[path] = id
            return id
        }

        var cues: [[String: Any]] = []
        for (i, cue) in engine.cues.enumerated() {
            var mediaId: Any = NSNull()
            var mac: [String: Any] = ["kind": cue.kind.rawValue]
            if cue.kind == .matte {
                // The web app has no matte type: its mattes are a picture of
                // one color. Send one of those, and mark it so the Mac makes
                // it a matte again.
                let id = Self.mediaID(), file = "media/" + id
                let png = Self.mattePNG(cue.color)
                entries.append(.init(name: file, source: .data(png), size: UInt64(png.count)))
                mediaIndex[id] = ["name": cue.name + ".png", "mime": "image/png", "kind": "image", "duration": 0,
                                  "thumb": NSNull(), "width": 1920, "height": 1080, "file": file]
                mediaId = id
                mac["color"] = cue.color
            } else if let id = media(path: cue.path, kind: cue.kind.wireType, duration: engine.durations[cue.id] ?? 0) {
                mediaId = id
            }
            let web: [CueKind: String] = [.video: "var(--video)", .audio: "var(--green)", .still: "var(--yellow)", .matte: "var(--yellow)"]
            cues.append([
                "id": cue.wireID ?? Cue.newWireID(offsetMs: i), "num": i + 1, "name": cue.name,
                "type": cue.kind.wireType, "mediaId": mediaId, "color": cue.label.web ?? web[cue.kind]!,
                "srcW": 0, "srcH": 0, "broken": false,
                "preWait": cue.preWait, "continueMode": cue.continueMode.rawValue,
                "duration": cue.kind.holds ? cue.duration : (engine.durations[cue.id] ?? 0), "thumb": NSNull(),
                "trimIn": cue.trimIn, "trimOut": cue.trimOut.map { $0 as Any } ?? NSNull(),
                "volume": cue.volume, "loop": cue.loop, "armed": cue.armed, "notes": cue.notes,
                "eq": ["low": 0, "mid": 0, "high": 0], "comp": false,
                "fadeIn": cue.fadeIn, "fadeOut": cue.fadeOut, "fadeCurve": cue.fadeCurve.rawValue, "xfade": cue.xfade,
                "endAction": cue.endAction.rawValue,
                "fit": cue.kind == .matte ? "cover" : cue.fit.rawValue, "scale": cue.scale, "posX": cue.posX, "posY": cue.posY,
                "output": cue.output,
                "key": ["mode": cue.key.mode.rawValue, "color": cue.key.color.lowercased(), "sim": cue.key.sim,
                        "smooth": cue.key.smooth, "bg": cue.key.bg.lowercased()],
                "obs": ["action": cue.obs.action.rawValue, "scene": cue.obs.scene], "obsTriggerScene": cue.obsTriggerScene,
                "sfxPadId": cue.sfxPadId, "sfxDelay": cue.sfxDelay,
                "mac": mac,
            ])
        }

        var pads: [[String: Any]] = []
        for pad in engine.pads.pads {
            let length = engine.pads.length(pad.id) ?? 0
            pads.append([
                "id": pad.id, "slot": pad.slot, "bank": pad.bank, "name": pad.name, "emoji": pad.emoji,
                "mediaId": media(path: pad.path, kind: "audio", duration: length) ?? NSNull(),
                "color": pad.color, "key": pad.key, "gain": pad.gain, "loop": pad.loop,
                "fadeIn": pad.fadeIn, "fadeOut": pad.fadeOut, "dur": length,
                "eq": ["low": pad.eq.low, "mid": pad.eq.mid, "high": pad.eq.high], "comp": pad.comp,
                "trimIn": pad.trimIn, "trimOut": pad.trimOut.map { $0 as Any } ?? NSNull(),
                "retrigger": pad.retrigger.rawValue,
            ])
        }
        let banks = engine.pads.banks.map { ["id": $0.id, "name": $0.name, "padCount": $0.padCount] as [String: Any] }
        let outputs = engine.outputs.map {
            ["id": $0.id, "label": $0.label, "screenId": NSNull(), "sinkId": NSNull(), "audioOn": false] as [String: Any]
        }
        let payload: [String: Any] = [
            "kind": "outrangutan-show", "app": "outrangutan", "schema": 3, "container": "zip",
            "exportedAt": Int(Date().timeIntervalSince1970 * 1000), "savedBy": "Outrangutan for Mac",
            "show": ["cues": cues, "pads": pads, "banks": banks, "currentBankId": engine.pads.currentBankID,
                     "outputs": outputs, "selectedId": engine.standbyCue?.wireID ?? NSNull()] as [String: Any],
            "mediaIndex": mediaIndex,
        ]
        let manifest = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return Pack(manifest: manifest, entries: entries)
    }

    // MARK: Opening

    /// Reads show.json from a show file (a zip, or the web app's older
    /// single JSON file) and checks it is an Outrangutan show.
    nonisolated static func readManifest(_ url: URL) throws -> [String: Any] {
        let head = (try? FileHandle(forReadingFrom: url).read(upToCount: 2)) ?? Data()
        let data = head == Data("PK".utf8) ? try ShowArchive.Reader(url: url).data("show.json") : try Data(contentsOf: url)
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              payload["kind"] as? String == "outrangutan-show",
              let show = payload["show"] as? [String: Any], show["cues"] is [Any]
        else { throw ShowFileError.notAShow }
        return payload
    }

    enum ShowFileError: LocalizedError {
        case notAShow
        var errorDescription: String? { "It may be a different kind of file, or it may be damaged." }
    }

    /// Copies the media out, then swaps the show in.
    @discardableResult
    func load(_ url: URL, payload: [String: Any], mediaFolder: URL? = nil) async -> Bool {
        let name = url.deletingPathExtension().lastPathComponent
        let folder = mediaFolder ?? Self.freshFolder(named: name)
        working = "Opening \u{201C}\(name)\u{201D}"
        progress = 0
        defer { working = nil }
        let mediaIndex = payload["mediaIndex"] as? [String: Any] ?? [:]
        let legacy = payload["media"] as? [String: Any] ?? [:]
        let result: Result<[String: String], Error> = await Task.detached(priority: .userInitiated) {
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                var paths: [String: String] = [:]
                var used = Set<String>()
                if !mediaIndex.isEmpty {
                    let zip = try ShowArchive.Reader(url: url)
                    let total = Double(max(1, mediaIndex.values.reduce(UInt64(0)) { sum, m in
                        sum + zip.size(((m as? [String: Any])?["file"] as? String) ?? "")
                    }))
                    var done: UInt64 = 0
                    for (id, raw) in mediaIndex {
                        guard let m = raw as? [String: Any], let file = m["file"] as? String, zip.has(file) else { continue }
                        let dest = Self.destination(in: folder, name: m["name"] as? String, mime: m["mime"] as? String, id: id, used: &used)
                        let before = done
                        try zip.extract(file, to: dest) { n in
                            let p = Double(before + n) / total
                            Task { @MainActor [weak self] in self?.progress = p }
                        }
                        done += zip.size(file)
                        paths[id] = dest.path
                    }
                } else {
                    // The web app's older show files carry media as text.
                    for (id, raw) in legacy {
                        guard let m = raw as? [String: Any], let text = m["data"] as? String,
                              let comma = text.firstIndex(of: ","),
                              let bytes = Data(base64Encoded: String(text[text.index(after: comma)...])) else { continue }
                        let dest = Self.destination(in: folder, name: m["name"] as? String, mime: m["mime"] as? String, id: id, used: &used)
                        try bytes.write(to: dest)
                        paths[id] = dest.path
                    }
                }
                return .success(paths)
            } catch {
                return .failure(error)
            }
        }.value
        guard case .success(let paths) = result else {
            if case .failure(let e) = result { alert("Could not open the show.", e.localizedDescription) }
            return false
        }
        let show = payload["show"] as? [String: Any] ?? [:]
        let settings = show["settings"] as? [String: Any] ?? [:]
        let cues = Self.cues(from: show["cues"] as? [Any] ?? [], paths: paths,
                             curve: FadeCurve(rawValue: settings["fadeCurve"] as? String ?? "") ?? .linear)
        let pads = Self.pads(from: show["pads"] as? [Any] ?? [], paths: paths)
        var banks = (show["banks"] as? [Any] ?? []).compactMap { raw -> PadBank? in
            guard let b = raw as? [String: Any], let id = Wire.string(b["id"]), !id.isEmpty else { return nil }
            var bank = PadBank(id: id, name: Wire.string(b["name"]) ?? "Bank")
            bank.padCount = min(PadBoard.padCountMax, max(PadBoard.padCount, Int(Wire.number(b["padCount"]) ?? 0)))
            return bank
        }
        if banks.isEmpty { banks = [PadBank.make("Bank 1")] }
        let bankIDs = Set(banks.map(\.id))
        let placed = pads.map { pad -> Pad in
            var p = pad
            if !bankIDs.contains(p.bank) { p.bank = banks[0].id }
            return p
        }
        engine.replaceShow(cues: cues, pads: placed, banks: banks, multiTrigger: settings["multiTrigger"] as? Bool)
        if let selected = Wire.string(show["selectedId"]), let c = engine.cue(wireID: selected) { engine.standbyID = c.id }
        currentFile = url.pathExtension.lowercased() == ShowArchive.fileExtension ? url : nil
        engine.log.add(.file, "Opened \u{201C}\(url.lastPathComponent)\u{201D}: \(Self.count(cues.count, "cue")), \(Self.count(placed.count, "pad"))")
        let lostCues = cues.filter { !$0.fileIsThere }.count, lostPads = placed.filter { !$0.fileIsThere }.count
        let lost = [lostCues > 0 ? Self.count(lostCues, "cue") : nil, lostPads > 0 ? Self.count(lostPads, "pad") : nil].compactMap { $0 }
        engine.notice = lost.isEmpty ? nil : lost.joined(separator: " and ") + " came without a file."
        return true
    }

    nonisolated static func cues(from list: [Any], paths: [String: String], curve: FadeCurve) -> [Cue] {
        list.enumerated().compactMap { i, raw in
            guard let c = raw as? [String: Any] else { return nil }
            let mac = c["mac"] as? [String: Any]
            let type = Wire.string(c["type"]) ?? "video"
            var kind: CueKind = type == "audio" ? .audio : (type == "image" ? .still : .video)
            if mac?["kind"] as? String == "matte" { kind = .matte }
            let path = kind == .matte ? "" : (Wire.string(c["mediaId"]).flatMap { paths[$0] } ?? "")
            let id = Wire.string(c["id"]).flatMap { $0.isEmpty ? nil : $0 } ?? Cue.newWireID(offsetMs: i)
            var cue = Cue(name: Wire.string(c["name"]) ?? "Untitled", path: path, kind: kind, wireID: id)
            if kind == .matte { cue.color = (mac?["color"] as? String).flatMap { NSColor(hex: $0)?.hexString } ?? "#000000" }
            cue.preWait = max(0, Wire.number(c["preWait"]) ?? 0)
            cue.continueMode = ContinueMode(rawValue: Wire.string(c["continueMode"]) ?? "") ?? .manual
            if let end = EndAction(rawValue: Wire.string(c["endAction"]) ?? "") { cue.endAction = end }
            if kind.holds { cue.duration = max(0, Wire.number(c["duration"]) ?? 0) }
            cue.trimIn = max(0, Wire.number(c["trimIn"]) ?? 0)
            cue.trimOut = Wire.number(c["trimOut"]).flatMap { $0 > cue.trimIn ? $0 : nil }
            cue.loop = c["loop"] as? Bool ?? false
            cue.volume = min(1, max(0, Wire.number(c["volume"]) ?? 1))
            cue.fadeIn = max(0, Wire.number(c["fadeIn"]) ?? 0)
            cue.fadeOut = max(0, Wire.number(c["fadeOut"]) ?? 0)
            cue.xfade = max(0, Wire.number(c["xfade"]) ?? 0)
            cue.fadeCurve = FadeCurve(rawValue: Wire.string(c["fadeCurve"]) ?? "") ?? curve
            cue.fit = kind == .matte ? .contain : (Fit(rawValue: Wire.string(c["fit"]) ?? "") ?? .contain)
            cue.scale = min(4, max(0.1, Wire.number(c["scale"]) ?? 1))
            cue.posX = Wire.number(c["posX"]) ?? 0
            cue.posY = Wire.number(c["posY"]) ?? 0
            cue.output = min(4, max(0, Int(Wire.number(c["output"]) ?? 1)))
            cue.sfxPadId = Wire.string(c["sfxPadId"]) ?? ""
            cue.sfxDelay = max(0, Wire.number(c["sfxDelay"]) ?? 0)
            cue.notes = Wire.string(c["notes"]) ?? ""
            cue.armed = c["armed"] as? Bool ?? true
            if let o = c["obs"] as? [String: Any] {
                cue.obs.action = ObsAction(rawValue: Wire.string(o["action"]) ?? "") ?? .none
                cue.obs.scene = Wire.string(o["scene"]) ?? ""
            }
            cue.obsTriggerScene = Wire.string(c["obsTriggerScene"]) ?? ""
            // The web gives every cue a color; its kind's own color means none was picked.
            let kindColor = ["video": "var(--video)", "audio": "var(--green)", "image": "var(--yellow)"][type]
            if let color = Wire.string(c["color"]), color != kindColor { cue.label = CueLabel(web: color) }
            if kind == .video, let k = c["key"] as? [String: Any] {
                cue.key.mode = KeyMode(rawValue: Wire.string(k["mode"]) ?? "") ?? .off
                cue.key.color = NSColor(hex: Wire.string(k["color"]) ?? "")?.hexString ?? "#00B140"
                cue.key.sim = min(1, max(0, Wire.number(k["sim"]) ?? 0.3))
                cue.key.smooth = min(0.5, max(0, Wire.number(k["smooth"]) ?? 0.1))
                cue.key.bg = NSColor(hex: Wire.string(k["bg"]) ?? "")?.hexString ?? "#000000"
            }
            return cue
        }
    }

    nonisolated static func pads(from list: [Any], paths: [String: String]) -> [Pad] {
        var seenKeys = Set<String>()
        return list.compactMap { raw in
            guard let p = raw as? [String: Any], let id = Wire.string(p["id"]), !id.isEmpty else { return nil }
            let path = Wire.string(p["mediaId"]).flatMap { paths[$0] } ?? ""
            var key = Wire.string(p["key"]) ?? ""
            if seenKeys.contains(key) { key = "" } else if !key.isEmpty { seenKeys.insert(key) }
            var pad = Pad(id: id, slot: max(0, Int(Wire.number(p["slot"]) ?? 0)), bank: Wire.string(p["bank"]) ?? "",
                          name: Wire.string(p["name"]) ?? "Pad", path: path, key: key)
            pad.emoji = String((Wire.string(p["emoji"]) ?? "").prefix(4))
            pad.color = webColor(Wire.string(p["color"]))
            pad.gain = min(1.5, max(0, Wire.number(p["gain"]) ?? 1))
            pad.loop = p["loop"] as? Bool ?? false
            pad.fadeIn = max(0, Wire.number(p["fadeIn"]) ?? 0)
            pad.fadeOut = max(0, Wire.number(p["fadeOut"]) ?? 0)
            pad.trimIn = max(0, Wire.number(p["trimIn"]) ?? 0)
            pad.trimOut = Wire.number(p["trimOut"]).flatMap { $0 > pad.trimIn ? $0 : nil }
            if let eq = p["eq"] as? [String: Any] {
                let band = { (k: String) in min(12, max(-12, Wire.number(eq[k]) ?? 0)) }
                pad.eq = PadEQ(low: band("low"), mid: band("mid"), high: band("high"))
            }
            pad.comp = p["comp"] as? Bool ?? false
            pad.retrigger = Retrigger(rawValue: Wire.string(p["retrigger"]) ?? "") ?? .restart
            return pad
        }
    }

    /// The web app names its colors; the Mac keeps the hex.
    nonisolated static func webColor(_ value: String?) -> String {
        let named = ["var(--purple)": "#AF52DE", "var(--accent)": "#AF52DE", "var(--cyan)": "#64D2FF",
                     "var(--green)": "#30D158", "var(--yellow)": "#FFD60A", "var(--red)": "#FF453A",
                     "var(--video)": "#0A84FF", "var(--orange)": "#FF9F0A"]
        guard let value else { return PadBoard.palette[0] }
        if let hex = named[value] { return hex }
        return NSColor(hex: value)?.hexString ?? PadBoard.palette[0]
    }

    // MARK: Little helpers

    private func askToReplace(message: String, info: String, then go: @escaping () -> Void) {
        guard hasShow else { return go() }
        let a = NSAlert()
        a.messageText = message
        a.informativeText = info + (engine.status == .ready ? "" : " What is on air stops.")
        a.addButton(withTitle: "Save First\u{2026}")
        a.addButton(withTitle: "Don\u{2019}t Save")
        a.addButton(withTitle: "Cancel")
        a.buttons[1].hasDestructiveAction = true
        switch a.runModal() {
        case .alertFirstButtonReturn:
            let panel = NSSavePanel()
            panel.allowedContentTypes = [Self.type]
            panel.nameFieldStringValue = currentFile?.lastPathComponent ?? Self.defaultName()
            guard panel.runModal() == .OK, let url = panel.url else { return }
            Task { if await self.write(to: url) { go() } }
        case .alertSecondButtonReturn:
            go()
        default:
            return
        }
    }

    /// The last problem, for the test log.
    private(set) var lastProblem: String?

    private func alert(_ message: String, _ info: String) {
        lastProblem = message + " " + info
        // Test mode never waits on a button press.
        if TestSnapshot.isOn { return }
        let a = NSAlert()
        a.messageText = message
        a.informativeText = info
        a.runModal()
    }

    nonisolated static func count(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }

    nonisolated static func defaultName() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return "Outrangutan Show \(f.string(from: Date())).ogshow"
    }

    nonisolated static func mediaID() -> String {
        "m_" + String((0..<7).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
    }

    nonisolated static func mime(_ url: URL) -> String {
        UTType(filenameExtension: url.pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
    }

    /// A new folder for a show's media: Movies, Outrangutan, the show's name.
    nonisolated static func freshFolder(named name: String) -> URL {
        let movies = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask)[0]
        let base = movies.appendingPathComponent("Outrangutan", isDirectory: true)
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        var folder = base.appendingPathComponent(clean, isDirectory: true)
        var n = 2
        while FileManager.default.fileExists(atPath: folder.path) {
            folder = base.appendingPathComponent("\(clean) \(n)", isDirectory: true)
            n += 1
        }
        return folder
    }

    /// Where one media file goes: its own name, with the right extension so
    /// the Mac knows how to play it, and never on top of another file.
    nonisolated static func destination(in folder: URL, name: String?, mime: String?, id: String, used: inout Set<String>) -> URL {
        var file = (name ?? "").replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        if file.isEmpty || file.hasPrefix(".") { file = id }
        if (file as NSString).pathExtension.isEmpty,
           let ext = mime.flatMap({ UTType(mimeType: $0) })?.preferredFilenameExtension {
            file += "." + ext
        }
        let stem = (file as NSString).deletingPathExtension, ext = (file as NSString).pathExtension
        var candidate = file
        var n = 2
        while used.contains(candidate.lowercased()) {
            candidate = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            n += 1
        }
        used.insert(candidate.lowercased())
        return folder.appendingPathComponent(candidate)
    }

    /// A 1920 by 1080 picture of one color, for the web app's mattes.
    static func mattePNG(_ hex: String) -> Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1920, pixelsHigh: 1080, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        (NSColor(hex: hex) ?? .black).setFill()
        NSRect(x: 0, y: 0, width: 1920, height: 1080).fill()
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:]) ?? Data()
    }
}
