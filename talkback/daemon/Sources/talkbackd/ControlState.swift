import Foundation

/// Shared momentary talk state. The API layer flips flags; the render thread
/// only ever reads them. Aligned 32-bit loads/stores are atomic on arm64, and
/// the render callback re-reads every cycle, so a torn read is not possible and
/// a stale read lasts at most one buffer.
final class ControlState {
    private let flagA: UnsafeMutablePointer<UInt32>
    private let flagB: UnsafeMutablePointer<UInt32>

    /// Called (off the render thread) whenever a flag changes, for state broadcast.
    var onChange: ((Bool, Bool) -> Void)?

    init() {
        flagA = UnsafeMutablePointer<UInt32>.allocate(capacity: 1)
        flagB = UnsafeMutablePointer<UInt32>.allocate(capacity: 1)
        flagA.pointee = 0
        flagB.pointee = 0
    }

    deinit {
        flagA.deallocate()
        flagB.deallocate()
    }

    var talkA: Bool { flagA.pointee != 0 }
    var talkB: Bool { flagB.pointee != 0 }

    func set(bus: Bus, on: Bool) {
        let ptr = (bus == .a) ? flagA : flagB
        let newValue: UInt32 = on ? 1 : 0
        guard ptr.pointee != newValue else { return }
        ptr.pointee = newValue
        onChange?(talkA, talkB)
    }

    enum Bus { case a, b }
}
