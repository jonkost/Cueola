import AVFoundation
import SwiftUI

/// Records a sound effect from the Mac's microphone (or an audio interface's
/// input) straight onto a pad. Recordings are kept in Music, Outrangutan
/// Recordings, as plain CAF files.
///
/// macOS asks once for permission to use the microphone; after that, a
/// click on Record starts at once.
final class Recorder: ObservableObject {
    enum State: Equatable { case idle, asking, denied, recording, done(URL) }

    @Published private(set) var state: State = .idle
    @Published private(set) var seconds: Double = 0
    let meter = LevelMeter()

    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var started = Date()
    private var clock: Timer?

    /// Test mode records into its own folder, never the real Music folder.
    static var testFolder: URL?
    static var folder: URL {
        testFolder ?? FileManager.default.urls(for: .musicDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Outrangutan Recordings", isDirectory: true)
    }

    /// Asks for the microphone if needed, then starts recording.
    func start(named name: String) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            begin(named: name)
        case .notDetermined:
            state = .asking
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async { ok ? self.begin(named: name) : (self.state = .denied) }
            }
        default:
            state = .denied
        }
    }

    func stop() {
        guard state == .recording else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        finish()
    }

    func reset() {
        if state == .recording { stop() }
        state = .idle
        seconds = 0
    }

    /// Opens a new file for `format`. The pretend microphone in test mode
    /// uses this and `write` directly.
    func open(named name: String, format: AVAudioFormat) throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        var url = Self.folder.appendingPathComponent((clean.isEmpty ? "Recording" : clean) + ".caf")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = Self.folder.appendingPathComponent("\(clean.isEmpty ? "Recording" : clean) \(n).caf")
            n += 1
        }
        file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: format.commonFormat,
                               interleaved: format.isInterleaved)
        started = Date()
        seconds = 0
        state = .recording
    }

    /// Adds sound to the recording and moves the meter.
    func write(_ buffer: AVAudioPCMBuffer) {
        try? file?.write(from: buffer)
        guard let data = buffer.floatChannelData else { return }
        let n = Int(buffer.frameLength), chans = Int(buffer.format.channelCount)
        var peaks: [Float] = [0, 0]
        for c in 0..<min(2, chans) {
            var m: Float = 0
            for i in 0..<n { m = max(m, abs(data[c][i])) }
            peaks[c] = m
        }
        if chans == 1 { peaks[1] = peaks[0] }
        DispatchQueue.main.async { self.meter.take(peaks[0], peaks[1]) }
    }

    /// Closes the file.
    func finish() {
        clock?.invalidate(); clock = nil
        guard let url = file?.url else { state = .idle; return }
        file = nil
        seconds = Date().timeIntervalSince(started)
        state = .done(url)
    }

    // MARK: Inside

    private func begin(named name: String) {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else { state = .denied; return }
        do {
            try open(named: name, format: format)
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in self?.write(buffer) }
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            state = .idle
            return
        }
        clock = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.seconds = Date().timeIntervalSince(self.started)
            // Five minutes is plenty for a sound effect.
            if self.seconds > 300 { self.stop() }
        }
    }
}

/// The Record a Sound sheet: name it, record, listen back on the pad.
struct RecordSheet: View {
    @ObservedObject var board: PadBoard
    @StateObject private var recorder = Recorder()
    let slot: Int
    @State private var name = "New sound"
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Record a Sound").font(.title2.weight(.semibold))
            TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                .disabled(recorder.state == .recording)
            HStack(spacing: 14) {
                Button {
                    recorder.state == .recording ? recorder.stop() : recorder.start(named: name)
                } label: {
                    Label(recorder.state == .recording ? "Stop" : "Record",
                          systemImage: recorder.state == .recording ? "stop.fill" : "record.circle")
                        .frame(minWidth: 90)
                }
                .buttonStyle(ActionStyle(prominent: true, tint: .red))
                .tint(.red)
                .controlSize(.large)
                Text(String(format: "%d:%04.1f", Int(recorder.seconds) / 60, recorder.seconds.truncatingRemainder(dividingBy: 60)))
                    .font(.title3.weight(.medium)).monospacedDigit()
                    .foregroundStyle(recorder.state == .recording ? Color.red : Color.secondary)
                Spacer()
                LevelMeterView(meter: recorder.meter, label: "IN")
            }
            Text(status).font(.callout).foregroundStyle(recorder.state == .denied ? Color.orange : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Cancel", role: .cancel) { recorder.reset(); dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                if case .done(let url) = recorder.state {
                    Button("Record Again") { try? FileManager.default.removeItem(at: url); recorder.reset() }
                    Button("Put It on the Pad") {
                        board.assign(url: url, slot: slot)
                        dismiss()
                    }
                    .buttonStyle(ActionStyle(prominent: true, tint: .red))
                    .keyboardShortcut(.defaultAction)
                }
            }
            .buttonWidth(140)
        }
        .padding(24)
        .frame(width: 440)
        .buttonStyle(ActionStyle())
    }

    private var status: String {
        switch recorder.state {
        case .idle: return "Records from the Mac's sound input (System Settings, Sound, Input)."
        case .asking: return "macOS is asking to let Outrangutan use the microphone."
        case .denied: return "Outrangutan can't use the microphone. Allow it in System Settings, Privacy & Security, Microphone, then try again."
        case .recording: return "Recording. Press Stop when you are done."
        case .done(let url): return "Recorded \(url.lastPathComponent). Trim it on the pad afterwards with the trim bar."
        }
    }
}
