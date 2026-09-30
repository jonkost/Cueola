import Foundation

/// A cue player's clock, as the cue sound engine sees it: where the cue
/// was at a known moment, and how fast it is going (0 while paused).
///
/// The deck notes the player's position every tick; the engine's sound
/// thread asks where the cue is right now and gets the answer by counting
/// forward from the last note. Written on the main thread, read on the
/// sound thread.
public final class SoundClock {
    public let rate: Double                 // frames per second of the ring
    private var position: Double = 0        // seconds into the cue's file
    private var speed: Double = 0           // 1 playing, 0 paused or stopped
    private var at: Double = 0              // host seconds when noted
    // The lock lives at one fixed address, never copied with the object.
    private let lock: UnsafeMutablePointer<os_unfair_lock>

    public init(rate: Double = 48000) {
        self.rate = rate
        lock = .allocate(capacity: 1)
        lock.initialize(to: os_unfair_lock())
    }

    deinit { lock.deallocate() }

    /// Notes that the cue was at `position` seconds, going at `speed`, at
    /// host time `host` (seconds on a clock that never jumps).
    public func note(position: Double, speed: Double, host: Double) {
        os_unfair_lock_lock(lock)
        self.position = position; self.speed = speed; self.at = host
        os_unfair_lock_unlock(lock)
    }

    /// The frame of the cue's file that is due right now, at host time
    /// `host`, counted at the ring's rate.
    public func dueFrame(host: Double) -> Int {
        os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
        let seconds = position + max(0, host - at) * speed
        return Int((seconds * rate).rounded(.down))
    }

    public func stop() { note(position: 0, speed: 0, host: 0) }
}

/// A line of stereo sound between two threads: a cue's player drops sound
/// in at one end, each chunk stamped with where in the file it belongs,
/// and the sound engine takes out only what the player's clock says is
/// due. So the sound follows the picture even when the player hands over
/// sound early, keeps handing it over during a pause, or seeks.
///
/// The player writes and the engine reads, each on its own thread.
/// Neither waits on the other for more than a few microseconds, and nothing
/// is allocated once the ring exists, so both can run on a sound thread.
public final class SoundRing {
    public let capacity: Int
    /// A chunk landing this far from where the last one ended, in frames,
    /// counts as a seek: the ring starts over at the chunk's time.
    public let seekTolerance: Int
    private var left: [Float]
    private var right: [Float]
    private var head = 0            // next frame to read
    private var count = 0           // frames waiting
    private var headFrame = 0       // the file frame the oldest waiting frame belongs to
    private var hasData = false     // anything arrived since the last flush
    private var pushed = 0
    private var delivered = 0
    private var dry = 0
    private var lastGave = 0
    private var restarts = 0
    private var lastStamp = 0
    private let lock: UnsafeMutablePointer<os_unfair_lock>

    /// For checking the stamps: the last chunk's file frame, and how many
    /// times the ring started over because a chunk landed far from the
    /// last one (a seek, or bad stamps).
    public var stamps: (last: Int, restarts: Int) {
        os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
        return (lastStamp, restarts)
    }

    /// Five seconds of room by default: a player can run well ahead.
    public init(capacity: Int = 240000, seekTolerance: Int = 12000) {
        self.capacity = max(64, capacity)
        self.seekTolerance = max(0, seekTolerance)
        left = [Float](repeating: 0, count: self.capacity)
        right = [Float](repeating: 0, count: self.capacity)
        lock = .allocate(capacity: 1)
        lock.initialize(to: os_unfair_lock())
    }

    deinit { lock.deallocate() }

    /// Frames waiting to be read.
    public var available: Int {
        os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
        return count
    }

    /// How the ring has done since it was made: frames dropped in, real
    /// frames handed out, and frames that were due but had not arrived
    /// (silence went out instead: a dropout, if it happens mid-cue).
    public var tally: (pushed: Int, delivered: Int, dry: Int) {
        os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
        return (pushed, delivered, dry)
    }

    /// Forgets everything waiting.
    public func flush() {
        os_unfair_lock_lock(lock)
        head = 0; count = 0; hasData = false; lastGave = 0
        os_unfair_lock_unlock(lock)
    }

    /// Drops `frames` frames in, the first of them belonging at file frame
    /// `frame`. Returns how many fit; frames that do not fit are lost
    /// rather than making the reader wait.
    @discardableResult
    public func push(left l: UnsafePointer<Float>, right r: UnsafePointer<Float>, frames: Int, at frame: Int) -> Int {
        guard frames > 0 else { return 0 }
        os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
        let expected = headFrame + count
        lastStamp = frame
        var skip = 0
        if !hasData || abs(frame - expected) > seekTolerance {
            // A seek, or the first sound: start over at this chunk's time.
            if hasData { restarts += 1 }
            head = 0; count = 0; headFrame = frame; hasData = true
        } else if frame < expected {
            // The player handed over sound the ring already has (it repeats
            // the chunk it is on while paused, and can hand a chunk over
            // twice). Keep only the part that is new.
            skip = expected - frame
            if skip >= frames { return 0 }
        } else if frame > expected {
            // A few frames missing (resampling rounds): silence fills them,
            // so what follows still lands on time.
            let gap = min(frame - expected, capacity - count)
            var tail = (head + count) % capacity
            var done = 0
            while done < gap {
                let run = min(gap - done, capacity - tail)
                left.withUnsafeMutableBufferPointer { $0.baseAddress!.advanced(by: tail).update(repeating: 0, count: run) }
                right.withUnsafeMutableBufferPointer { $0.baseAddress!.advanced(by: tail).update(repeating: 0, count: run) }
                done += run
                tail = (tail + run) % capacity
            }
            count += gap
        }
        let n = min(frames - skip, capacity - count)
        var tail = (head + count) % capacity
        var done = 0
        while done < n {
            let run = min(n - done, capacity - tail)
            left.withUnsafeMutableBufferPointer { $0.baseAddress!.advanced(by: tail).update(from: l.advanced(by: skip + done), count: run) }
            right.withUnsafeMutableBufferPointer { $0.baseAddress!.advanced(by: tail).update(from: r.advanced(by: skip + done), count: run) }
            done += run
            tail = (tail + run) % capacity
        }
        count += n
        pushed += n
        return n
    }

    /// Takes up to `frames` frames out into the two buffers, but only
    /// frames belonging before file frame `due`. Whatever it does not give
    /// comes out as silence. Returns how many real frames it gave.
    @discardableResult
    public func pop(left l: UnsafeMutablePointer<Float>, right r: UnsafeMutablePointer<Float>, frames: Int, due: Int) -> Int {
        guard frames > 0 else { return 0 }
        os_unfair_lock_lock(lock)
        let wanted = hasData ? max(0, min(frames, due - headFrame)) : 0
        let n = min(wanted, count)
        var done = 0
        while done < n {
            let run = min(n - done, capacity - head)
            left.withUnsafeBufferPointer { l.advanced(by: done).update(from: $0.baseAddress!.advanced(by: head), count: run) }
            right.withUnsafeBufferPointer { r.advanced(by: done).update(from: $0.baseAddress!.advanced(by: head), count: run) }
            done += run
            head = (head + run) % capacity
        }
        count -= n
        headFrame += n
        delivered += n
        // Due but not here: the player is behind, or the file just ended.
        // Counted once per gap, not once per call while the gap lasts.
        if wanted > n && (n > 0 || lastGave > 0) { dry += wanted - n }
        lastGave = n
        os_unfair_lock_unlock(lock)
        if n < frames {
            l.advanced(by: n).update(repeating: 0, count: frames - n)
            r.advanced(by: n).update(repeating: 0, count: frames - n)
        }
        return n
    }
}

/// Turns any number of sound channels into a left and a right, the way the
/// cue players' sound reaches the engine: one channel plays on both sides,
/// two pass through, and more than two use the first two (the left and
/// right of surround sound).
public enum Downmix {
    /// `first` is the first channel; `second` is the second, or nil for a
    /// one-channel sound. Nothing is allocated: it runs on the sound thread.
    public static func stereo(first: UnsafePointer<Float>, second: UnsafePointer<Float>?, frames: Int,
                              left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>) {
        guard frames > 0 else { return }
        left.update(from: first, count: frames)
        right.update(from: second ?? first, count: frames)
    }
}
