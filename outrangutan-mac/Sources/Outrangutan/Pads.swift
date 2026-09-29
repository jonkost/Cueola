import AppKit
import AVFoundation
import OutrangutanCore
import UniformTypeIdentifiers

/// How a pad behaves when it is hit again while it still sounds.
enum Retrigger: String, Codable, CaseIterable {
    case restart   // starts over
    case poly      // plays another copy on top ("Layer")
    case toggle    // a second hit stops it

    var label: String {
        switch self {
        case .restart: return "Restart"
        case .poly: return "Layer"
        case .toggle: return "Toggle"
        }
    }
}

/// Three-band EQ in decibels, -12 to +12, like the web app's pad EQ.
struct PadEQ: Codable, Equatable {
    var low: Double = 0
    var mid: Double = 0
    var high: Double = 0
}

/// One sound effect pad. Field names match the web app's pads.
struct Pad: Identifiable, Codable, Equatable {
    var id: String                  // the name the rundown and KeyWi Bird use
    var slot: Int                   // place on its bank, from 0
    var bank: String                // bank id
    var name: String
    var emoji = ""
    var path: String
    var color = "#AF52DE"
    var key = ""                    // hotkey, "" for none
    var gain: Double = 1            // 0 to 1.5
    var loop = false
    var fadeIn: Double = 0
    var fadeOut: Double = 0         // used when a tied pad fades out with its clip
    var trimIn: Double = 0
    var trimOut: Double?
    var eq = PadEQ()
    var comp = false
    var retrigger: Retrigger = .restart

    var url: URL { URL(fileURLWithPath: path) }
    var fileIsThere: Bool { FileManager.default.fileExists(atPath: path) }

    init(id: String, slot: Int, bank: String, name: String, path: String, key: String) {
        self.id = id; self.slot = slot; self.bank = bank; self.name = name; self.path = path; self.key = key
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slot = try c.decode(Int.self, forKey: .slot)
        bank = try c.decode(String.self, forKey: .bank)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Pad"
        emoji = try c.decodeIfPresent(String.self, forKey: .emoji) ?? ""
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#AF52DE"
        key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        gain = try c.decodeIfPresent(Double.self, forKey: .gain) ?? 1
        loop = try c.decodeIfPresent(Bool.self, forKey: .loop) ?? false
        fadeIn = try c.decodeIfPresent(Double.self, forKey: .fadeIn) ?? 0
        fadeOut = try c.decodeIfPresent(Double.self, forKey: .fadeOut) ?? 0
        trimIn = try c.decodeIfPresent(Double.self, forKey: .trimIn) ?? 0
        trimOut = try c.decodeIfPresent(Double.self, forKey: .trimOut)
        eq = try c.decodeIfPresent(PadEQ.self, forKey: .eq) ?? PadEQ()
        comp = try c.decodeIfPresent(Bool.self, forKey: .comp) ?? false
        retrigger = try c.decodeIfPresent(Retrigger.self, forKey: .retrigger) ?? .restart
    }

    static func newID(offsetMs: Int = 0) -> String {
        let ms = Int(Date().timeIntervalSince1970 * 1000) + offsetMs
        let tail = String((0..<3).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
        return "p_" + Cue.padded(ms) + tail
    }
}

/// A page of pads.
struct PadBank: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var padCount = PadBoard.padCount

    static func make(_ name: String) -> PadBank {
        PadBank(id: "bk_" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36), name: name)
    }
}

/// A left and right level meter, 0 to 1. Kept apart from the pad board so
/// only the meter redraws when the level moves.
final class LevelMeter: ObservableObject {
    @Published private(set) var left: Float = 0
    @Published private(set) var right: Float = 0
    @Published private(set) var clipped = false

    /// Takes the loudest sample of the latest slice of sound. The meter falls
    /// back slowly, like a real one.
    func take(_ l: Float, _ r: Float) {
        left = max(l, left * 0.82)
        right = max(r, right * 0.82)
        if l >= 0.99 || r >= 0.99 { clipped = true }
    }

    func resetClip() { clipped = false }
}

/// The sound effect board: banks of pads, each with its own EQ, compressor
/// and volume, all running on the Mac's audio engine. Sounds load into
/// memory ahead of time, so a pad fires the moment it is hit.
final class PadBoard: ObservableObject {
    static let padCount = 12          // pads per bank to start
    static let padCountMax = 20       // the most a bank can hold
    /// Hotkeys handed out in this order, the same as the web app. S, P and F
    /// are left out because they are show keys.
    static let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "q", "w", "e", "r", "t", "y", "u", "i", "o", "k"]

    @Published var banks: [PadBank] { didSet { changed() } }
    @Published var pads: [Pad] { didSet { changed() } }
    @Published var multiTrigger: Bool { didSet { changed() } }
    @Published var currentBankID: String
    @Published var selectedPadID: String?
    /// Pads sounding now: when each started and how long it runs (nil loops).
    @Published private(set) var sounding: [String: (start: Date, length: Double?)] = [:]

    /// The pads' level, for the meter.
    let meter = LevelMeter()
    /// Called after any change that should be saved and republished.
    var onChange: (() -> Void)?
    /// Called each time a pad fires, with how long it runs (nil for a loop).
    var onFire: ((Pad, Double?) -> Void)?

    private let audio = AVAudioEngine()
    private let bus = AVAudioMixerNode()
    private var channels: [String: PadChannel] = [:]
    private let fader = Fader()
    private var masterGain: Double = 1
    private var tie: (cueID: UUID, padID: String, timer: Timer?)?
    private var loading = false

    init(banks: [PadBank]?, pads: [Pad]?, multiTrigger: Bool?) {
        let b = (banks?.isEmpty == false) ? banks! : [PadBank.make("Bank 1")]
        self.banks = b
        self.pads = pads ?? []
        self.multiTrigger = multiTrigger ?? true
        currentBankID = b[0].id
        audio.attach(bus)
        audio.connect(bus, to: audio.mainMixerNode, format: nil)
        // Measure what the pads send out, for the meter.
        bus.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
            guard let data = buffer.floatChannelData else { return }
            let n = Int(buffer.frameLength), chans = Int(buffer.format.channelCount)
            var peaks: [Float] = [0, 0]
            for c in 0..<min(2, chans) {
                var m: Float = 0
                for i in 0..<n { m = max(m, abs(data[c][i])) }
                peaks[c] = m
            }
            if chans == 1 { peaks[1] = peaks[0] }
            DispatchQueue.main.async { self?.meter.take(peaks[0], peaks[1]) }
        }
        // When the sound hardware changes (an interface plugged in or out),
        // the engine stops. Start it again and carry on.
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
            self?.restartAudio()
        }
        loading = true
        self.pads.forEach { channel(for: $0, rewire: false) }
        loading = false
        startAudio()
    }

    var currentBank: PadBank? { banks.first { $0.id == currentBankID } }
    var selectedPad: Pad? { pads.first { $0.id == selectedPadID } }

    func pad(id: String) -> Pad? { pads.first { $0.id == id } }
    func pad(bank: String, slot: Int) -> Pad? { pads.first { $0.bank == bank && $0.slot == slot } }

    // MARK: Playing

    /// Hits a pad. Returns a refusal the rundown can show when it cannot play.
    @discardableResult
    func fire(_ id: String) -> WireResult {
        guard let pad = pad(id: id) else { return .refused("pad is not on this Mac") }
        guard pad.fileIsThere else { return .refused("\(pad.name) has no media on this Mac") }
        startAudio()
        guard let ch = channel(for: pad), let buffer = ch.buffer else { return .refused("\(pad.name) would not load") }
        if !multiTrigger { pads.filter { $0.id != id }.forEach { stop($0.id) } }
        if pad.retrigger == .toggle && ch.isSounding { stop(id); return .done }
        if pad.retrigger == .restart || !multiTrigger { ch.stopAll() }
        fader.cancel("pad-" + id)
        ch.gainMixer.outputVolume = pad.fadeIn > 0 ? 0 : Float(pad.gain)
        guard ch.play(buffer, loop: pad.loop, ended: { [weak self] in self?.voiceEnded(id) }) else {
            return .refused("the Mac's sound output is not ready")
        }
        if pad.fadeIn > 0 {
            fader.run("pad-" + id, from: 0, to: 1, seconds: pad.fadeIn) { v in ch.gainMixer.outputVolume = Float(v * pad.gain) }
        }
        let length: Double? = pad.loop ? nil : Double(buffer.frameLength) / buffer.format.sampleRate
        sounding[id] = (Date(), length)
        onFire?(pad, length)
        return .done
    }

    func stop(_ id: String) {
        fader.cancel("pad-" + id)
        channels[id]?.stopAll()
        sounding[id] = nil
    }

    func stopAll() {
        cancelTie()
        for id in channels.keys { stop(id) }
    }

    /// Fades every sounding pad out, then stops it.
    func fadeOutAll(seconds: Double = 1) {
        cancelTie()
        for id in sounding.keys {
            guard let ch = channels[id] else { continue }
            let from = Double(ch.gainMixer.outputVolume)
            fader.run("pad-" + id, from: 1, to: 0, seconds: seconds, apply: { v in ch.gainMixer.outputVolume = Float(from * v) },
                      done: { [weak self] in self?.stop(id) })
        }
    }

    /// Sends the pads to a sound device, on a chosen pair of its channels
    /// (0 is channels 1 and 2, 2 is channels 3 and 4, and so on). nil is the
    /// Mac's default output. Stops whatever pads are sounding.
    func setOutput(device uid: String?, firstChannel: Int) {
        channels.values.forEach { $0.stopAll() }
        sounding.removeAll()
        audio.stop()
        if let unit = audio.outputNode.audioUnit, let dev = AudioDevices.device(uid: uid) ?? AudioDevices.defaultOutput() {
            var id = dev.objectID
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                 &id, UInt32(MemoryLayout<AudioDeviceID>.size))
            // The channel map says which of our two channels feeds each of
            // the device's channels; -1 leaves a channel silent.
            let total = dev.channels
            var map = [Int32](repeating: -1, count: total)
            if total >= 2 {
                let first = min(max(0, firstChannel), total - 2)
                map[first] = 0
                map[first + 1] = 1
            } else if total == 1 {
                map[0] = 0
            }
            let size = UInt32(map.count * MemoryLayout<Int32>.size)
            if AudioUnitSetProperty(unit, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Output, 0, &map, size) != noErr {
                AudioUnitSetProperty(unit, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Global, 0, &map, size)
            }
            channelMapNote = "\(dev.name), channels \(map.firstIndex(of: 0).map { "\($0 + 1) and \($0 + 2)" } ?? "1")"
        }
        // Two channels into the device; the map places them.
        let rate = audio.outputNode.outputFormat(forBus: 0).sampleRate
        if rate > 0, let stereo = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) {
            audio.connect(audio.mainMixerNode, to: audio.outputNode, format: stereo)
        }
        startAudio()
    }

    /// Where the pads are going, in words, for the Settings window.
    @Published private(set) var channelMapNote = ""

    func setMaster(_ gain: Double) {
        masterGain = gain
        bus.outputVolume = Float(min(1, gain))
    }

    /// How long a pad plays, after trim, in seconds. nil until it loads.
    func length(_ id: String) -> Double? {
        guard let b = channels[id]?.buffer else { return nil }
        return Double(b.frameLength) / b.format.sampleRate
    }

    /// How far along a pad is: 0 to 1, or nil for a loop. For the tiles.
    func progress(_ id: String, now: Date = Date()) -> Double? {
        guard let s = sounding[id], let length = s.length, length > 0 else { return nil }
        return min(1, now.timeIntervalSince(s.start) / length)
    }

    // MARK: A pad tied to a cue

    /// A cue can bring a pad with it (after a delay). The pad plays through
    /// the clip and fades out when the clip leaves air. Matches the web app.
    func tie(_ cue: Cue) {
        untie(fade: true)
        guard !cue.sfxPadId.isEmpty, pad(id: cue.sfxPadId) != nil else { return }
        let padID = cue.sfxPadId
        if cue.sfxDelay > 0 {
            let t = Timer(timeInterval: cue.sfxDelay, repeats: false) { [weak self] _ in
                guard let self, self.tie?.cueID == cue.id else { return }
                self.tie?.timer = nil
                self.fire(padID)
            }
            RunLoop.main.add(t, forMode: .common)
            tie = (cue.id, padID, t)
        } else {
            tie = (cue.id, padID, nil)
            fire(padID)
        }
    }

    /// The tied cue left air: a pad still sounding fades out.
    func cueLeftAir(_ cueID: UUID) {
        if tie?.cueID == cueID { untie(fade: true) }
    }

    private func untie(fade: Bool) {
        guard let t = tie else { return }
        tie = nil
        t.timer?.invalidate()
        guard fade, let pad = pad(id: t.padID), let ch = channels[pad.id], ch.isSounding else { return }
        let seconds = max(0.2, pad.fadeOut > 0 ? pad.fadeOut : 0.7)
        let from = Double(ch.gainMixer.outputVolume)
        fader.run("pad-" + pad.id, from: 1, to: 0, seconds: seconds, apply: { v in ch.gainMixer.outputVolume = Float(from * v) },
                  done: { [weak self] in self?.stop(pad.id) })
    }

    private func cancelTie() {
        tie?.timer?.invalidate()
        tie = nil
    }

    // MARK: Editing

    /// Puts a sound file on a pad slot of the current bank.
    func assign(url: URL, slot: Int) {
        guard let bank = currentBank else { return }
        let name = url.deletingPathExtension().lastPathComponent
        if let i = pads.firstIndex(where: { $0.bank == bank.id && $0.slot == slot }) {
            stop(pads[i].id)
            channels[pads[i].id] = nil
            pads[i].path = url.path
            pads[i].name = name
            channel(for: pads[i])
            selectedPadID = pads[i].id
        } else {
            var pad = Pad(id: Pad.newID(offsetMs: slot), slot: slot, bank: bank.id, name: name, path: url.path, key: nextFreeKey())
            pad.color = PadBoard.palette[slot % PadBoard.palette.count]
            pads.append(pad)
            channel(for: pad)
            selectedPadID = pad.id
        }
    }

    /// Fills the next empty slots of the current bank with sound files.
    func add(urls: [URL]) {
        guard let bank = currentBank else { return }
        var free = (0..<PadBoard.padCountMax).filter { pad(bank: bank.id, slot: $0) == nil }
        for url in urls where Self.isSound(url) {
            guard !free.isEmpty else { break }
            let slot = free.removeFirst()
            if slot >= bank.padCount, let i = banks.firstIndex(where: { $0.id == bank.id }) {
                banks[i].padCount = min(PadBoard.padCountMax, slot + 1)
            }
            assign(url: url, slot: slot)
        }
    }

    func clear(_ id: String) {
        stop(id)
        channels[id] = nil
        pads.removeAll { $0.id == id }
        if selectedPadID == id { selectedPadID = nil }
    }

    /// Changes a pad's settings. Volume, EQ and compressor change at once,
    /// even while it sounds; trim counts from its next hit.
    func update(_ id: String, _ change: (inout Pad) -> Void) {
        guard let i = pads.firstIndex(where: { $0.id == id }) else { return }
        let before = pads[i]
        var pad = before
        change(&pad)
        pad.gain = min(1.5, max(0, pad.gain))
        pad.trimIn = max(0, pad.trimIn)
        if let out = pad.trimOut, out <= pad.trimIn { pad.trimOut = nil }
        pad.eq.low = min(12, max(-12, pad.eq.low)); pad.eq.mid = min(12, max(-12, pad.eq.mid)); pad.eq.high = min(12, max(-12, pad.eq.high))
        if !pad.key.isEmpty {
            // A hotkey belongs to one pad at a time.
            for j in pads.indices where j != i && pads[j].key == pad.key { pads[j].key = "" }
        }
        pads[i] = pad
        if let ch = channels[id] {
            ch.setSound(eq: pad.eq, comp: pad.comp)
            if !fader.isRunning("pad-" + id) { ch.gainMixer.outputVolume = Float(pad.gain) }
            if pad.trimIn != before.trimIn || pad.trimOut != before.trimOut {
                ch.stopAll()
                sounding[id] = nil
                ch.buffer = PadChannel.load(pad)
            }
        }
    }

    /// Swaps in a whole new set of banks and pads, from a show file.
    func replace(banks newBanks: [PadBank], pads newPads: [Pad], multiTrigger newMulti: Bool?) {
        stopAll()
        audio.stop()
        channels.removeAll()
        loading = true
        banks = newBanks.isEmpty ? [PadBank.make("Bank 1")] : newBanks
        pads = newPads
        if let newMulti { multiTrigger = newMulti }
        currentBankID = banks[0].id
        selectedPadID = nil
        pads.forEach { channel(for: $0, rewire: false) }
        loading = false
        startAudio()
        onChange?()
    }

    func addBank() {
        let bank = PadBank.make("Bank \(banks.count + 1)")
        banks.append(bank)
        currentBankID = bank.id
        selectedPadID = nil
    }

    func removeBank(_ id: String) {
        guard banks.count > 1 else { return }
        pads.filter { $0.bank == id }.forEach { clear($0.id) }
        banks.removeAll { $0.id == id }
        if currentBankID == id { currentBankID = banks[0].id }
    }

    func addSlot() {
        guard let i = banks.firstIndex(where: { $0.id == currentBankID }) else { return }
        banks[i].padCount = min(PadBoard.padCountMax, banks[i].padCount + 1)
    }

    func pad(forKey key: String) -> Pad? {
        key.isEmpty ? nil : pads.first { $0.key == key }
    }

    static func isSound(_ url: URL) -> Bool {
        guard let t = UTType(filenameExtension: url.pathExtension.lowercased()) else { return false }
        return t.conforms(to: .audio)
    }

    static let palette = ["#AF52DE", "#FF9F0A", "#30D158", "#0A84FF", "#FF375F", "#64D2FF", "#FFD60A", "#BF5AF2"]

    // MARK: Inside

    private func nextFreeKey() -> String {
        let used = Set(pads.map(\.key))
        return PadBoard.keys.first { !used.contains($0) } ?? ""
    }

    private func changed() {
        guard !loading else { return }
        onChange?()
    }

    private func voiceEnded(_ id: String) {
        guard let ch = channels[id], !ch.isSounding else { return }
        sounding[id] = nil
    }

    @discardableResult
    private func channel(for pad: Pad, rewire: Bool = true) -> PadChannel? {
        if let ch = channels[pad.id] { return ch }
        guard pad.fileIsThere, let buffer = PadChannel.load(pad) else { return nil }
        let ch = PadChannel(engine: audio, output: bus, format: buffer.format)
        ch.buffer = buffer
        ch.setSound(eq: pad.eq, comp: pad.comp)
        ch.gainMixer.outputVolume = Float(pad.gain)
        channels[pad.id] = ch
        if rewire { self.rewire() }
        return ch
    }

    /// New sound paths only go live when the audio engine starts, so after
    /// adding a pad it restarts. This happens while building the board,
    /// never from a hit, so a show in progress is never interrupted by it.
    private func rewire() {
        channels.values.forEach { $0.stopAll() }
        sounding.removeAll()
        audio.stop()
        startAudio()
    }

    private func startAudio() {
        guard !audio.isRunning else { return }
        audio.prepare()
        try? audio.start()
    }

    private func restartAudio() {
        channels.values.forEach { $0.stopAll() }
        sounding.removeAll()
        startAudio()
    }
}

/// One pad's sound path: up to four copies playing at once, then EQ,
/// compressor and volume.
final class PadChannel {
    let merge = AVAudioMixerNode()
    let eq = AVAudioUnitEQ(numberOfBands: 3)
    let comp = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
        componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_DynamicsProcessor,
        componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))
    let gainMixer = AVAudioMixerNode()
    private var voices: [AVAudioPlayerNode] = []
    private var busy: [Bool] = []
    private var generation: [Int] = []
    private let engine: AVAudioEngine
    var buffer: AVAudioPCMBuffer?

    init(engine: AVAudioEngine, output: AVAudioNode, format: AVAudioFormat) {
        self.engine = engine
        for n in [merge, eq, comp, gainMixer] as [AVAudioNode] { engine.attach(n) }
        // All four copies are wired up front, so a hit never has to add one.
        for _ in 0..<4 {
            let v = AVAudioPlayerNode()
            engine.attach(v)
            engine.connect(v, to: merge, fromBus: 0, toBus: merge.nextAvailableInputBus, format: format)
            voices.append(v); busy.append(false); generation.append(0)
        }
        engine.connect(merge, to: eq, format: nil)
        engine.connect(eq, to: comp, format: nil)
        engine.connect(comp, to: gainMixer, format: nil)
        // Every pad gets its own input on the board's mixer, so adding a pad
        // never unplugs another one.
        let bus = (output as? AVAudioMixerNode)?.nextAvailableInputBus ?? 0
        engine.connect(gainMixer, to: output, fromBus: 0, toBus: bus, format: nil)
        // The web app's pad EQ: low shelf 180 Hz, a bell at 1.1 kHz, high shelf 4.5 kHz.
        let bands: [(AVAudioUnitEQFilterType, Float)] = [(.lowShelf, 180), (.parametric, 1100), (.highShelf, 4500)]
        for (i, (type, hz)) in bands.enumerated() {
            eq.bands[i].filterType = type
            eq.bands[i].frequency = hz
            eq.bands[i].bandwidth = 1.5
            eq.bands[i].bypass = false
        }
    }

    deinit {
        voices.forEach { $0.stop(); engine.detach($0) }
        [merge, eq, comp, gainMixer].forEach { engine.detach($0) }
    }

    var isSounding: Bool { busy.contains(true) }

    func setSound(eq values: PadEQ, comp on: Bool) {
        eq.bands[0].gain = Float(values.low)
        eq.bands[1].gain = Float(values.mid)
        eq.bands[2].gain = Float(values.high)
        // The web app's compressor: threshold -22 dB, fast attack, a quick release.
        comp.bypass = !on
        let u = comp.audioUnit
        AudioUnitSetParameter(u, kDynamicsProcessorParam_Threshold, kAudioUnitScope_Global, 0, -22, 0)
        AudioUnitSetParameter(u, kDynamicsProcessorParam_HeadRoom, kAudioUnitScope_Global, 0, 4, 0)
        AudioUnitSetParameter(u, kDynamicsProcessorParam_AttackTime, kAudioUnitScope_Global, 0, 0.004, 0)
        AudioUnitSetParameter(u, kDynamicsProcessorParam_ReleaseTime, kAudioUnitScope_Global, 0, 0.22, 0)
    }

    /// Plays the buffer on a free copy (or the oldest one if all four are
    /// busy). Returns false, and plays nothing, if the sound path is not
    /// ready: the audio engine would stop the whole app otherwise.
    @discardableResult
    func play(_ buffer: AVAudioPCMBuffer, loop: Bool, ended: @escaping () -> Void) -> Bool {
        guard engine.isRunning else { return false }
        let i = voiceIndex(for: buffer.format)
        guard engine.outputConnectionPoints(for: voices[i], outputBus: 0).isEmpty == false else { return false }
        let v = voices[i]
        generation[i] += 1
        let gen = generation[i]
        v.stop()
        busy[i] = true
        v.scheduleBuffer(buffer, at: nil, options: loop ? [.loops] : [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.generation[i] == gen else { return }
                self.busy[i] = false
                ended()
            }
        }
        v.play()
        return true
    }

    func stopAll() {
        for i in voices.indices {
            generation[i] += 1
            busy[i] = false
            voices[i].stop()
        }
    }

    private func voiceIndex(for format: AVAudioFormat) -> Int {
        busy.firstIndex(of: false) ?? 0
    }

    /// Reads a pad's sound (after trim) into memory.
    static func load(_ pad: Pad) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: pad.url) else { return nil }
        let rate = file.processingFormat.sampleRate
        let start = AVAudioFramePosition(max(0, pad.trimIn) * rate)
        let end = min(file.length, pad.trimOut.map { AVAudioFramePosition($0 * rate) } ?? file.length)
        guard end > start, let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(end - start)) else { return nil }
        file.framePosition = start
        try? file.read(into: buffer, frameCount: AVAudioFrameCount(end - start))
        return buffer
    }
}
