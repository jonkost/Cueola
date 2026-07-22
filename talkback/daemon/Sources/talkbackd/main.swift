import Foundation

// talkbackd: one mic, two gated destinations.
// Bus A → physical outputs 1-2, bus B → physical outputs 3-4, momentary,
// driven over a local WebSocket (Stream Deck plugin or the production suite).

func log(_ message: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    FileHandle.standardError.write(Data("[\(stamp)] \(message)\n".utf8))
}

struct Options {
    var deviceName = "UR44"
    var port: UInt16 = 17844
    var sampleRate: Double = 48_000
    var micChannel = 0          // 0-based; UR44 mic input 1
    var rampMs: Double = 8
    var listDevices = false
}

func parseOptions() -> Options {
    var opts = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    func value(after flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        let v = args[i + 1]
        args.removeSubrange(i...(i + 1))
        return v
    }
    if let v = value(after: "--device") { opts.deviceName = v }
    if let v = value(after: "--port"), let p = UInt16(v) { opts.port = p }
    if let v = value(after: "--rate"), let r = Double(v) { opts.sampleRate = r }
    if let v = value(after: "--mic-channel"), let c = Int(v), c >= 1 { opts.micChannel = c - 1 }
    if let v = value(after: "--ramp-ms"), let r = Double(v), r > 0 { opts.rampMs = r }
    if args.contains("--list-devices") { opts.listDevices = true }
    if args.contains("--help") || args.contains("-h") {
        print("""
        talkbackd: mic to two gated output pairs (A = outs 1-2, B = outs 3-4)

        Options:
          --device <name>       Substring match on the audio device name (default: UR44)
          --port <port>         WebSocket control port on 127.0.0.1 (default: 17844)
          --rate <hz>           Preferred sample rate (default: 48000)
          --mic-channel <n>     1-based input channel for the mic (default: 1)
          --ramp-ms <ms>        Gate ramp length, 5-10 ms recommended (default: 8)
          --list-devices        Print all CoreAudio devices and exit

        WebSocket protocol (text frames): "A on" "A off" "B on" "B off" "state?"
        State pushes: {"type":"state","talkA":bool,"talkB":bool}
        """)
        exit(0)
    }
    return opts
}

let opts = parseOptions()

if opts.listDevices {
    for dev in AudioEngine.allDevices() {
        print("\(dev.name)  |  in: \(dev.inputChannels)ch, out: \(dev.outputChannels)ch, \(Int(dev.sampleRate)) Hz")
    }
    exit(0)
}

let state = ControlState()
let engine = AudioEngine(state: state, micChannel: opts.micChannel, rampMilliseconds: opts.rampMs)
let server = WSServer(state: state, port: opts.port)

do {
    try engine.start(deviceNameSubstring: opts.deviceName, preferredSampleRate: opts.sampleRate)
    if let dev = engine.device {
        log("Device: \(dev.name)  in: \(dev.inputChannels)ch  out: \(dev.outputChannels)ch  rate: \(Int(dev.sampleRate)) Hz")
        log("Bus A → outputs 1-2   Bus B → outputs 3-4   mic: input \(opts.micChannel + 1)   ramp: \(opts.rampMs) ms")
    }
    try server.start()
} catch {
    log("FATAL: \(error)")
    exit(1)
}

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
for source in [sigint, sigterm] {
    source.setEventHandler {
        log("Shutting down.")
        server.stop()
        engine.stop()
        exit(0)
    }
    source.resume()
}

RunLoop.main.run()
