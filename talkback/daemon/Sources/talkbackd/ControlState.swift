import Foundation

/// Shared momentary talk state, per-bus volume, and live levels. The API layer
/// flips flags and gains; the render thread only ever reads them, and writes
/// back one peak level per buffer for the meters. Every slot is an aligned
/// 32-bit load/store (Floats travel as their bit pattern), atomic on arm64, and
/// the render callback re-reads every cycle — so a torn read is not possible
/// and a stale read lasts at most one buffer.
final class ControlState {
    private let flagA: UnsafeMutablePointer<UInt32>
    private let flagB: UnsafeMutablePointer<UInt32>
    private let gainABits: UnsafeMutablePointer<UInt32>
    private let gainBBits: UnsafeMutablePointer<UInt32>
    private let levelMicBits: UnsafeMutablePointer<UInt32>
    private let levelABits: UnsafeMutablePointer<UInt32>
    private let levelBBits: UnsafeMutablePointer<UInt32>

    /// Called (off the render thread) whenever a flag or gain changes, for
    /// state broadcast. Levels deliberately do NOT fire this — they stream on
    /// their own timer.
    var onChange: ((Bool, Bool) -> Void)?

    init() {
        flagA = Self.slot(0)
        flagB = Self.slot(0)
        gainABits = Self.slot(Float(1).bitPattern)
        gainBBits = Self.slot(Float(1).bitPattern)
        levelMicBits = Self.slot(0)
        levelABits = Self.slot(0)
        levelBBits = Self.slot(0)
    }

    deinit {
        for ptr in [flagA, flagB, gainABits, gainBBits, levelMicBits, levelABits, levelBBits] {
            ptr.deallocate()
        }
    }

    private static func slot(_ initial: UInt32) -> UnsafeMutablePointer<UInt32> {
        let ptr = UnsafeMutablePointer<UInt32>.allocate(capacity: 1)
        ptr.pointee = initial
        return ptr
    }

    var talkA: Bool { flagA.pointee != 0 }
    var talkB: Bool { flagB.pointee != 0 }
    var gainA: Float { Float(bitPattern: gainABits.pointee) }
    var gainB: Float { Float(bitPattern: gainBBits.pointee) }
    var levels: (mic: Float, a: Float, b: Float) {
        (Float(bitPattern: levelMicBits.pointee),
         Float(bitPattern: levelABits.pointee),
         Float(bitPattern: levelBBits.pointee))
    }

    func set(bus: Bus, on: Bool) {
        let ptr = (bus == .a) ? flagA : flagB
        let newValue: UInt32 = on ? 1 : 0
        guard ptr.pointee != newValue else { return }
        ptr.pointee = newValue
        onChange?(talkA, talkB)
    }

    func set(bus: Bus, gain: Float) {
        let clamped = max(0, min(1, gain))
        let ptr = (bus == .a) ? gainABits : gainBBits
        let newValue = clamped.bitPattern
        guard ptr.pointee != newValue else { return }
        ptr.pointee = newValue
        onChange?(talkA, talkB)
    }

    /// Render thread only: one peak per buffer, mic pre-gate, buses post-gate.
    func storeLevels(mic: Float, a: Float, b: Float) {
        levelMicBits.pointee = mic.bitPattern
        levelABits.pointee = a.bitPattern
        levelBBits.pointee = b.bitPattern
    }

    enum Bus { case a, b }
}
