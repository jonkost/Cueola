import Foundation

/// One sound in the built-in Library.
public struct LibrarySound: Identifiable, Equatable {
    /// The file's name, without ".wav". It never changes, so a pad or a cue
    /// that uses the sound keeps finding it.
    public let id: String
    public let name: String
    public let emoji: String
    /// One short line: when you would reach for it.
    public let about: String
    /// Made to repeat with no gap, for a pad set to Loop.
    public let loops: Bool
}

/// The Library's sound effects. Every one is made here, from sine waves and
/// noise, so the app ships with no recordings and nothing is borrowed. The
/// same numbers come out every time, on every Mac.
public enum LibrarySounds {
    public static let rate = 48_000.0
    /// Goes up when a sound is changed, so the files are made again.
    public static let version = 1

    public static let all: [LibrarySound] = [
        LibrarySound(id: "applause", name: "Applause", emoji: "👏", about: "A studio audience claps, then fades.", loops: false),
        LibrarySound(id: "ding", name: "Ding", emoji: "🔔", about: "A bell for a right answer.", loops: false),
        LibrarySound(id: "buzzer", name: "Buzzer", emoji: "❌", about: "A low buzz for a wrong answer.", loops: false),
        LibrarySound(id: "ta-da", name: "Ta-Da", emoji: "🎺", about: "A short fanfare for a reveal.", loops: false),
        LibrarySound(id: "sad-trombone", name: "Sad Trombone", emoji: "😢", about: "Four falling notes for a flop.", loops: false),
        LibrarySound(id: "rimshot", name: "Rimshot", emoji: "🥁", about: "Two drums and a cymbal after a joke.", loops: false),
        LibrarySound(id: "drum-roll", name: "Drum Roll", emoji: "🪘", about: "A roll that builds, then a crash.", loops: false),
        LibrarySound(id: "air-horn", name: "Air Horn", emoji: "📯", about: "One loud blast.", loops: false),
        LibrarySound(id: "whoosh", name: "Whoosh", emoji: "💨", about: "A fast pass, left to right, for a transition.", loops: false),
        LibrarySound(id: "pop", name: "Pop", emoji: "🫧", about: "A small pop for a graphic coming on.", loops: false),
        LibrarySound(id: "countdown", name: "Countdown Beeps", emoji: "⏱️", about: "Three short beeps, then a long one.", loops: false),
        LibrarySound(id: "doorbell", name: "Doorbell", emoji: "🚪", about: "Ding, dong.", loops: false),
        LibrarySound(id: "phone-ring", name: "Phone Ring", emoji: "☎️", about: "A desk phone rings twice.", loops: false),
        LibrarySound(id: "clock-tick", name: "Clock Tick", emoji: "🕰️", about: "Tick, tock, four seconds. Loops.", loops: true),
        LibrarySound(id: "heartbeat", name: "Heartbeat", emoji: "❤️", about: "Four slow beats. Loops.", loops: true),
        LibrarySound(id: "crickets", name: "Crickets", emoji: "🦗", about: "Night crickets for an awkward silence. Loops.", loops: true),
        LibrarySound(id: "tone-1k", name: "Tone 1 kHz", emoji: "〰️", about: "Ten seconds of line-up tone at minus 20.", loops: true),
    ]

    public typealias Stereo = (left: [Float], right: [Float])

    /// Makes one sound, or nil for a name the Library does not know.
    public static func render(_ id: String) -> Stereo? {
        switch id {
        case "applause": return applause()
        case "ding": return ding()
        case "buzzer": return buzzer()
        case "ta-da": return taDa()
        case "sad-trombone": return sadTrombone()
        case "rimshot": return rimshot()
        case "drum-roll": return drumRoll()
        case "air-horn": return airHorn()
        case "whoosh": return whoosh()
        case "pop": return pop()
        case "countdown": return countdown()
        case "doorbell": return doorbell()
        case "phone-ring": return phoneRing()
        case "clock-tick": return clockTick()
        case "heartbeat": return heartbeat()
        case "crickets": return crickets()
        case "tone-1k": return tone()
        default: return nil
        }
    }

    /// The sound as a WAV file: 48 kHz, 16 bits, stereo.
    public static func wav(_ sound: Stereo) -> Data {
        let frames = min(sound.left.count, sound.right.count)
        let bytes = frames * 4
        var d = Data(capacity: 44 + bytes)
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes)
        d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(2); u32(Int(rate)); u32(Int(rate) * 4); u16(4); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(bytes)
        var pcm = [Int16](repeating: 0, count: frames * 2)
        for i in 0..<frames {
            pcm[i * 2] = Int16(max(-1, min(1, sound.left[i])) * 32767).littleEndian
            pcm[i * 2 + 1] = Int16(max(-1, min(1, sound.right[i])) * 32767).littleEndian
        }
        pcm.withUnsafeBytes { d.append(contentsOf: $0) }
        return d
    }

    // MARK: The tools every sound is made with

    private static let tau = 2 * Double.pi
    private static func n(_ seconds: Double) -> Int { Int((seconds * rate).rounded()) }
    private static func quiet(_ seconds: Double) -> [Double] { [Double](repeating: 0, count: n(seconds)) }

    /// Random numbers that come out the same every time (the sounds must
    /// not change from one Mac, or one launch, to the next).
    private struct Dice {
        var state: UInt64
        init(_ seed: UInt64) { state = seed &* 0x9E3779B97F4A7C15 &+ 0x1234567 }
        mutating func next() -> Double {
            state &+= 0x9E3779B97F4A7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
            z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
            z ^= z >> 31
            return Double(z >> 11) / Double(1 << 53)
        }
        /// Hiss: a value from -1 to 1.
        mutating func noise() -> Double { next() * 2 - 1 }
    }

    /// A filter that keeps one part of the sound: a band, the highs or the lows.
    private struct Filter {
        var b0 = 0.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0, z1 = 0.0, z2 = 0.0

        static func band(_ hz: Double, q: Double) -> Filter {
            let w = tau * hz / rate, alpha = sin(w) / (2 * q), a0 = 1 + alpha
            return Filter(b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: -2 * cos(w) / a0, a2: (1 - alpha) / a0)
        }
        static func highs(_ hz: Double, q: Double = 0.707) -> Filter {
            let w = tau * hz / rate, alpha = sin(w) / (2 * q), a0 = 1 + alpha, c = cos(w)
            return Filter(b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: -2 * c / a0, a2: (1 - alpha) / a0)
        }
        static func lows(_ hz: Double, q: Double = 0.707) -> Filter {
            let w = tau * hz / rate, alpha = sin(w) / (2 * q), a0 = 1 + alpha, c = cos(w)
            return Filter(b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - alpha) / a0)
        }
        mutating func run(_ x: Double) -> Double {
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
    }

    /// Brings the loudest moment to `peak`, rounds off the two ends so the
    /// sound never clicks, and hands back both sides.
    private static func finish(_ l: [Double], _ r: [Double]? = nil, peak: Double = 0.89, loops: Bool = false) -> Stereo {
        let r = r ?? l
        var top = 0.0
        for i in 0..<l.count { top = max(top, abs(l[i]), abs(r[i])) }
        let gain = top > 0 ? peak / top : 0
        let edge = loops ? 0 : n(0.003)
        var outL = [Float](repeating: 0, count: l.count), outR = outL
        for i in 0..<l.count {
            var g = gain
            if edge > 0 {
                if i < edge { g *= Double(i) / Double(edge) }
                if i >= l.count - edge { g *= Double(l.count - 1 - i) / Double(edge) }
            }
            outL[i] = Float(l[i] * g); outR[i] = Float(r[i] * g)
        }
        return (outL, outR)
    }

    /// A struck bell: a few pure tones that are not quite in tune with each
    /// other, each dying away, the high ones first.
    private static func bell(_ buf: inout [Double], at: Double, hz: Double, ring: Double, gain: Double = 1,
                             parts: [(ratio: Double, level: Double)] = [(1, 1), (2.0, 0.55), (3.01, 0.32), (4.17, 0.18), (5.43, 0.09)]) {
        let start = n(at)
        for (k, part) in parts.enumerated() {
            let f = hz * part.ratio
            guard f < rate * 0.45 else { continue }
            let decay = ring / pow(Double(k + 1), 0.9)
            let count = min(buf.count - start, n(decay * 7))
            guard count > 0 else { continue }
            for i in 0..<count {
                let t = Double(i) / rate
                buf[start + i] += sin(tau * f * t) * exp(-t / decay) * min(1, t / 0.0015) * part.level * gain
            }
        }
    }

    /// A horn note: a buzzy tone whose brightness can open and close and
    /// whose pitch can bend. `pitch`, `bright` (the highest clear frequency)
    /// and `level` are all read at each moment of the note.
    private static func horn(_ buf: inout [Double], at: Double, length: Double, most: Int = 22,
                             pitch: (Double) -> Double, bright: (Double) -> Double, level: (Double) -> Double) {
        let start = n(at), count = min(buf.count - start, n(length))
        guard count > 0 else { return }
        var phase = 0.0
        for i in 0..<count {
            let t = Double(i) / rate
            let f = pitch(t), cut = bright(t)
            phase += tau * f / rate
            var s = 0.0
            var h = 1
            while h <= most && Double(h) * f < rate * 0.45 {
                let x = Double(h) * f / cut
                s += sin(Double(h) * phase) / Double(h) / sqrt(1 + x * x * x * x)
                h += 1
            }
            buf[start + i] += s * level(t)
        }
    }

    /// A drum: a low tone that drops in pitch as it dies away.
    private static func drum(_ buf: inout [Double], at: Double, from: Double, to: Double, ring: Double, gain: Double) {
        let start = n(at), count = min(buf.count - start, n(ring * 7))
        guard count > 0 else { return }
        var phase = 0.0
        for i in 0..<count {
            let t = Double(i) / rate
            phase += tau * (to + (from - to) * exp(-t / (ring * 0.35))) / rate
            buf[start + i] += sin(phase) * exp(-t / ring) * min(1, t / 0.001) * gain
        }
    }

    /// Bursts of hiss, shaped by a filter: snare wires, a cymbal, a clap.
    private static func hiss(_ buf: inout [Double], dice: inout Dice, hits: [(at: Double, ring: Double, gain: Double)], through filters: [Filter]) {
        var raw = [Double](repeating: 0, count: buf.count)
        for hit in hits {
            let start = n(hit.at), count = min(buf.count - start, n(hit.ring * 7))
            guard count > 0 else { continue }
            for i in 0..<count {
                let t = Double(i) / rate
                raw[start + i] += dice.noise() * exp(-t / hit.ring) * hit.gain
            }
        }
        var chain = filters
        for i in 0..<raw.count {
            var y = raw[i]
            for k in chain.indices { y = chain[k].run(y) }
            buf[i] += y
        }
    }

    // MARK: The sounds

    private static func applause() -> Stereo {
        let length = 5.0
        var l = quiet(length), r = quiet(length)
        var dice = Dice(11)
        // Fifty-six pairs of hands, each with its own pitch, pace and seat.
        for _ in 0..<56 {
            var filter = Filter.band(900 + dice.next() * 2200, q: 1.1 + dice.next())
            let pace = 0.2 + dice.next() * 0.13
            let seat = dice.next(), strength = 0.5 + dice.next() * 0.5
            var raw = quiet(length)
            var t = dice.next() * pace
            while t < length {
                let start = n(t), ring = 0.004 + dice.next() * 0.006, amp = strength * (0.7 + dice.next() * 0.3)
                for i in 0..<n(0.03) where start + i < raw.count {
                    raw[start + i] += dice.noise() * amp * exp(-Double(i) / rate / ring)
                }
                t += pace * (0.88 + dice.next() * 0.24)
            }
            let gl = cos(seat * .pi / 2), gr = sin(seat * .pi / 2)
            for i in 0..<raw.count { let y = filter.run(raw[i]); l[i] += y * gl; r[i] += y * gr }
        }
        // The room: a soft wash under the hands.
        var washL = Filter.band(1800, q: 0.5), washR = Filter.band(2100, q: 0.5)
        for i in 0..<l.count {
            l[i] += washL.run(dice.noise()) * 0.5
            r[i] += washR.run(dice.noise()) * 0.5
        }
        // It swells, holds, and dies away.
        for i in 0..<l.count {
            let t = Double(i) / rate
            let fade = min(1, (length - t) / 1.8)
            let e = min(1, t / 0.3) * fade * fade
            l[i] *= e; r[i] *= e
        }
        return finish(l, r)
    }

    private static func ding() -> Stereo {
        var b = quiet(2.2)
        bell(&b, at: 0, hz: 1318.5, ring: 0.7)
        return finish(b, peak: 0.8)
    }

    private static func buzzer() -> Stereo {
        let length = 0.9
        var b = quiet(length)
        var soft = Filter.lows(3200)
        for i in 0..<b.count {
            let t = Double(i) / rate
            var s = 0.0
            // Two square tones a little apart, so the buzz beats.
            for f in [110.0, 116.5] {
                var h = 1
                while Double(h) * f < 6000 { s += sin(tau * Double(h) * f * t) / Double(h); h += 2 }
            }
            b[i] = soft.run(s) * min(1, t / 0.004) * min(1, (length - t) / 0.03)
        }
        return finish(b, peak: 0.8)
    }

    private static func taDa() -> Stereo {
        var b = quiet(2.1)
        func note(_ hz: Double, at: Double, length: Double, gain: Double) {
            horn(&b, at: at, length: length,
                 pitch: { t in hz * (1 + (t > 0.25 ? 0.004 * sin(tau * 5.5 * t) : 0)) },
                 bright: { t in 700 + 2600 * min(1, t / 0.05) * exp(-t / 1.6) },
                 level: { t in min(1, t / 0.02) * min(1, (length - t) / 0.09) * (0.75 + 0.25 * exp(-t / 0.5)) * gain })
        }
        // "Ta": a short chord. "Da": the same chord, wider and held.
        for hz in [392.0, 523.25, 659.25] { note(hz, at: 0, length: 0.14, gain: 0.8) }
        for (hz, gain) in [(261.63, 0.9), (392.0, 0.8), (523.25, 1.0), (659.25, 0.8), (783.99, 0.6)] {
            note(hz, at: 0.21, length: 1.75, gain: gain)
        }
        return finish(b, peak: 0.85)
    }

    private static func sadTrombone() -> Stereo {
        var b = quiet(3.6)
        let notes: [(hz: Double, at: Double, length: Double)] = [(233.08, 0, 0.5), (220, 0.58, 0.5), (207.65, 1.16, 0.5), (196, 1.74, 1.7)]
        for (k, note) in notes.enumerated() {
            let last = k == notes.count - 1
            horn(&b, at: note.at, length: note.length,
                 pitch: { t in
                     // The last note sags, with a wobble.
                     let u = t / note.length
                     let sag = last ? pow(2, -3.0 * max(0, u - 0.35) / 0.65 / 12) : 1
                     return note.hz * sag * (1 + (last ? 0.012 : 0.004) * sin(tau * 5.8 * t))
                 },
                 bright: { t in 420 + 1500 * sin(.pi * min(1, t / note.length)) * (last ? exp(-t / 1.4) + 0.2 : 1) },   // "wah"
                 level: { t in min(1, t / 0.03) * min(1, (note.length - t) / (last ? 0.5 : 0.08)) })
        }
        return finish(b, peak: 0.85)
    }

    private static func rimshot() -> Stereo {
        var b = quiet(1.9)
        var dice = Dice(23)
        // Ba (snare), dum (low tom), tss (cymbal).
        drum(&b, at: 0, from: 260, to: 185, ring: 0.05, gain: 0.7)
        hiss(&b, dice: &dice, hits: [(0, 0.05, 1.6)], through: [.band(2400, q: 0.6)])
        drum(&b, at: 0.19, from: 150, to: 82, ring: 0.11, gain: 1.0)
        hiss(&b, dice: &dice, hits: [(0.19, 0.02, 0.5)], through: [.band(900, q: 0.8)])
        hiss(&b, dice: &dice, hits: [(0.42, 0.32, 1.4)], through: [.highs(6000), .band(9000, q: 0.5)])
        for hz in [3310.0, 4420, 5870, 7140] { bell(&b, at: 0.42, hz: hz, ring: 0.25, gain: 0.05, parts: [(1, 1)]) }
        return finish(b)
    }

    private static func drumRoll() -> Stereo {
        let rollEnds = 2.7
        var b = quiet(4.4)
        var dice = Dice(31)
        // Sticks that speed up and get louder.
        var hits: [(at: Double, ring: Double, gain: Double)] = []
        var t = 0.0
        while t < rollEnds {
            let u = t / rollEnds
            let gain = (0.22 + 0.78 * u * u) * (0.8 + dice.next() * 0.2)
            hits.append((t, 0.03, gain * 1.5))
            drum(&b, at: t, from: 230, to: 180, ring: 0.03, gain: gain * 0.5)
            t += (1 / (15 + 17 * u)) * (0.96 + dice.next() * 0.08)
        }
        hiss(&b, dice: &dice, hits: hits, through: [.band(2600, q: 0.6)])
        // The crash: a kick and a cymbal.
        drum(&b, at: rollEnds + 0.04, from: 140, to: 55, ring: 0.16, gain: 1.3)
        hiss(&b, dice: &dice, hits: [(rollEnds + 0.04, 0.42, 2.2)], through: [.highs(5000), .band(8500, q: 0.4)])
        for hz in [2950.0, 4180, 5530, 6920] { bell(&b, at: rollEnds + 0.04, hz: hz, ring: 0.35, gain: 0.07, parts: [(1, 1)]) }
        return finish(b)
    }

    private static func airHorn() -> Stereo {
        let length = 1.45
        var b = quiet(length)
        var dice = Dice(41)
        var breath = Filter.highs(3000)
        func shape(_ t: Double) -> Double { min(1, t / 0.03) * min(1, (length - t) / 0.12) }
        // Two horns a third apart. Each starts a little flat and wobbles.
        for (hz, lean) in [(349.2, 0.0021), (440.0, 0.0017)] {
            var phase = 0.0
            for i in 0..<b.count {
                let t = Double(i) / rate
                let f = hz * (1 - 0.05 * exp(-t / 0.03)) * (1 + lean * sin(tau * 31 * t) + lean * sin(tau * 17 * t))
                phase += tau * f / rate
                var s = 0.0
                var h = 1
                while h <= 30 && Double(h) * f < rate * 0.4 {
                    let hf = Double(h) * f
                    // A horn's bell makes two bands ring louder.
                    let ringing = 1 + 2.2 * exp(-pow((hf - 1800) / 600, 2)) + 1.3 * exp(-pow((hf - 3200) / 800, 2))
                    s += sin(Double(h) * phase) / pow(Double(h), 0.7) * ringing
                    h += 1
                }
                b[i] += s * shape(t)
            }
        }
        for i in 0..<b.count { b[i] += breath.run(dice.noise()) * 0.25 * shape(Double(i) / rate) }
        return finish(b)
    }

    private static func whoosh() -> Stereo {
        let length = 0.95
        var l = quiet(length), r = quiet(length)
        var dice = Dice(53)
        var low = 0.0, band = 0.0
        for i in 0..<l.count {
            let u = Double(i) / Double(l.count)
            // The pass: quiet and dull, loud and bright, quiet and dull.
            let hump = exp(-pow((u - 0.55) / 0.24, 2))
            let f = 2 * sin(.pi * (250 * pow(26, hump)) / rate)
            let high = dice.noise() - low - 0.9 * band
            band += f * high
            low += f * band
            let y = band * pow(hump, 1.3)
            l[i] = y * cos(u * .pi / 2); r[i] = y * sin(u * .pi / 2)
        }
        return finish(l, r)
    }

    private static func pop() -> Stereo {
        var b = quiet(0.32)
        var dice = Dice(61)
        var phase = 0.0
        for i in 0..<b.count {
            let t = Double(i) / rate
            phase += tau * (330 + 980 * min(1, t / 0.022)) / rate
            b[i] = sin(phase) * exp(-t / 0.035) * min(1, t / 0.001) + (t < 0.003 ? dice.noise() * 0.3 * (1 - t / 0.003) : 0)
        }
        return finish(b, peak: 0.8)
    }

    private static func beep(_ buf: inout [Double], at: Double, length: Double, hz: Double) {
        let start = n(at)
        for i in 0..<n(length) where start + i < buf.count {
            let t = Double(i) / rate
            let e = min(1, t / 0.005) * min(1, (length - t) / 0.008)
            buf[start + i] += (sin(tau * hz * t) + 0.12 * sin(tau * 2 * hz * t)) * e
        }
    }

    private static func countdown() -> Stereo {
        var b = quiet(3.9)
        for k in 0..<3 { beep(&b, at: Double(k), length: 0.16, hz: 880) }
        beep(&b, at: 3, length: 0.8, hz: 1760)
        return finish(b, peak: 0.7)
    }

    private static func doorbell() -> Stereo {
        var b = quiet(3.0)
        let parts: [(ratio: Double, level: Double)] = [(1, 1), (2, 0.45), (3, 0.2), (4.2, 0.12)]
        bell(&b, at: 0, hz: 659.25, ring: 0.9, parts: parts)
        bell(&b, at: 0.62, hz: 523.25, ring: 1.1, parts: parts)
        return finish(b, peak: 0.8)
    }

    private static func phoneRing() -> Stereo {
        var b = quiet(3.6)
        // A hammer between two small bells, twenty-two strikes a second.
        for ring in [0.0, 1.7] {
            var k = 0
            var t = ring
            while t < ring + 1.15 {
                bell(&b, at: t, hz: k % 2 == 0 ? 1340 : 1620, ring: 0.09, gain: 1,
                     parts: [(1, 1), (1.41, 0.7), (2.02, 0.45), (2.6, 0.25)])
                k += 1
                t += 1.0 / 22
            }
        }
        return finish(b, peak: 0.75)
    }

    private static func clockTick() -> Stereo {
        var b = quiet(4.0)
        var dice = Dice(71)
        for k in 0..<8 {
            let at = 0.01 + Double(k) * 0.5, tock = k % 2 == 1
            var one = quiet(4.0)
            hiss(&one, dice: &dice, hits: [(at, 0.004, 1)], through: [.band(tock ? 2300 : 3300, q: 3)])
            for i in 0..<b.count { b[i] += one[i] }
            bell(&b, at: at, hz: tock ? 1150 : 1650, ring: 0.012, gain: 0.25, parts: [(1, 1)])
        }
        return finish(b, peak: 0.6, loops: true)
    }

    private static func heartbeat() -> Stereo {
        var b = quiet(4.0)
        for beat in 0..<4 {
            let at = 0.02 + Double(beat)
            drum(&b, at: at, from: 78, to: 48, ring: 0.075, gain: 1)          // lub
            drum(&b, at: at + 0.27, from: 92, to: 58, ring: 0.055, gain: 0.7)  // dub
        }
        return finish(b, peak: 0.85, loops: true)
    }

    private static func crickets() -> Stereo {
        let length = 4.0
        var l = quiet(length), r = quiet(length)
        var dice = Dice(83)
        // Each cricket: a high tone, three quick pulses, then a rest.
        // The rests divide four seconds evenly, so the loop has no seam.
        for (hz, every, seat, gain) in [(4400.0, 0.5, 0.25, 1.0), (4850.0, 0.8, 0.75, 0.8), (4120.0, 1.0, 0.5, 0.45)] {
            var at = 0.03 + seat * 0.2
            while at < length - 0.1 {
                for pulse in 0..<3 {
                    let start = n(at + Double(pulse) * 0.021)
                    for i in 0..<n(0.013) where start + i < l.count {
                        let t = Double(i) / rate
                        let s = sin(tau * hz * t) * pow(sin(.pi * t / 0.013), 2) * gain
                        l[start + i] += s * cos(seat * .pi / 2); r[start + i] += s * sin(seat * .pi / 2)
                    }
                }
                at += every
            }
        }
        // The night air, very low.
        var air = Filter.band(5200, q: 0.7)
        for i in 0..<l.count { let a = air.run(dice.noise()) * 0.02; l[i] += a; r[i] += a }
        return finish(l, r, peak: 0.4, loops: true)
    }

    private static func tone() -> Stereo {
        var b = quiet(10.0)
        // 1,000 whole waves in every second, so the ten seconds loop clean.
        for i in 0..<b.count { b[i] = sin(tau * 1000 * Double(i) / rate) }
        return finish(b, peak: 0.1, loops: true)     // minus 20 on the meter
    }
}
