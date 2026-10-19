import XCTest
@testable import OutrangutanCore

/// The ring that carries a cue's sound from its player to the sound
/// engine, and the clock that says which frames are due.
final class SoundRingTests: XCTestCase {
    private func push(_ ring: SoundRing, _ values: [Float], at frame: Int) -> Int {
        let r = values.map { -$0 }
        return values.withUnsafeBufferPointer { l in r.withUnsafeBufferPointer { rr in
            ring.push(left: l.baseAddress!, right: rr.baseAddress!, frames: values.count, at: frame)
        } }
    }

    private func pop(_ ring: SoundRing, _ n: Int, due: Int) -> (left: [Float], right: [Float], got: Int) {
        var l = [Float](repeating: 9, count: n), r = [Float](repeating: 9, count: n)
        let got = l.withUnsafeMutableBufferPointer { lp in r.withUnsafeMutableBufferPointer { rp in
            ring.pop(left: lp.baseAddress!, right: rp.baseAddress!, frames: n, due: due)
        } }
        return (l, r, got)
    }

    func testOnlyDueFramesComeOut() {
        let ring = SoundRing(capacity: 64)
        XCTAssertEqual(push(ring, [1, 2, 3, 4, 5, 6], at: 100), 6)
        // The player is at frame 100: nothing is due yet.
        let none = pop(ring, 4, due: 100)
        XCTAssertEqual(none.got, 0)
        XCTAssertEqual(none.left, [0, 0, 0, 0])
        XCTAssertEqual(ring.available, 6, "waiting frames stay")
        // Now at 103: three frames are due, the rest is silence for now.
        let some = pop(ring, 4, due: 103)
        XCTAssertEqual(some.got, 3)
        XCTAssertEqual(some.left, [1, 2, 3, 0])
        XCTAssertEqual(some.right, [-1, -2, -3, 0])
        let rest = pop(ring, 4, due: 200)
        XCTAssertEqual(rest.got, 3)
        XCTAssertEqual(rest.left, [4, 5, 6, 0])
        XCTAssertEqual(ring.tally.dry, 1, "one frame was due with nothing to give: counted once")
    }

    func testPauseHoldsSoundAndResumeCarriesOn() {
        let ring = SoundRing(capacity: 64)
        push(ring, [1, 2, 3, 4], at: 0)
        XCTAssertEqual(pop(ring, 2, due: 2).left, [1, 2])
        // Paused: the due frame stops moving, so every call gives silence.
        for _ in 0..<5 { XCTAssertEqual(pop(ring, 2, due: 2).got, 0) }
        XCTAssertEqual(ring.tally.dry, 0, "silence during a pause is not a dropout")
        XCTAssertEqual(pop(ring, 2, due: 4).left, [3, 4])
    }

    func testOverdueSoundIsSkippedToCatchUp() {
        // Each call hands out 2 frames; 3 or more past that is overdue, and
        // the ring puts up with it for 4 frames before skipping.
        let ring = SoundRing(capacity: 64, catchUp: 2, patience: 4)
        push(ring, (1...20).map(Float.init), at: 0)
        XCTAssertEqual(pop(ring, 2, due: 2).left, [1, 2])
        // The clock jumps 4 frames ahead (a resume re-anchored the player):
        // 6 are due, this call can give 2, so 4 are overdue: past the line.
        // For the first 4 frames the ring carries on, behind.
        XCTAssertEqual(pop(ring, 2, due: 8).left, [3, 4])
        XCTAssertEqual(pop(ring, 2, due: 10).left, [5, 6])
        XCTAssertEqual(ring.tally.late, 0, "not yet: the jump may be the clock settling")
        // Still 4 behind: the patience is used up, so the overdue frames go.
        let after = pop(ring, 2, due: 12)
        XCTAssertEqual(after.left, [11, 12], "the frames due now, not the ones left behind")
        XCTAssertEqual(ring.tally.late, 4)
        XCTAssertEqual(ring.tally.dry, 0, "skipped frames are not a dropout")
        // Back in step: the next call carries straight on.
        XCTAssertEqual(pop(ring, 2, due: 14).left, [13, 14])
        XCTAssertEqual(ring.tally.late, 4)
    }

    func testShortLivedJumpIsNotSkipped() {
        // A clock noted "moving" at GO runs ahead until the player truly
        // starts; the next tick puts it right. Nothing may be skipped.
        let ring = SoundRing(capacity: 64, catchUp: 2, patience: 4)
        push(ring, (1...20).map(Float.init), at: 0)
        XCTAssertEqual(pop(ring, 2, due: 2).left, [1, 2])
        XCTAssertEqual(pop(ring, 2, due: 8).left, [3, 4], "behind, but carrying on")
        XCTAssertEqual(pop(ring, 2, due: 10).left, [5, 6])
        // The tick corrects the clock: 8 is due, 6 handed out, in step.
        XCTAssertEqual(pop(ring, 2, due: 8).left, [7, 8])
        XCTAssertEqual(ring.tally.late, 0)
        // A later jump starts the count again from nothing.
        XCTAssertEqual(pop(ring, 2, due: 16).left, [9, 10])
        XCTAssertEqual(pop(ring, 2, due: 18).left, [11, 12])
        XCTAssertEqual(ring.tally.late, 0)
        XCTAssertEqual(pop(ring, 2, due: 20).left, [19, 20])
        XCTAssertEqual(ring.tally.late, 6)
        // A jump within the line is never skipped: the ring just stays a
        // little behind, as before.
        let small = SoundRing(capacity: 64, catchUp: 2, patience: 0)
        push(small, (1...12).map(Float.init), at: 0)
        XCTAssertEqual(pop(small, 2, due: 2).left, [1, 2])
        XCTAssertEqual(pop(small, 2, due: 6).left, [3, 4])
        XCTAssertEqual(small.tally.late, 0)
        // Overdue with less waiting than the jump: what is there goes, and
        // the rest is counted dry like any sound the player never sent.
        let thin = SoundRing(capacity: 64, catchUp: 2, patience: 0)
        push(thin, [1, 2, 3], at: 0)
        XCTAssertEqual(pop(thin, 2, due: 2).left, [1, 2])
        let gone = pop(thin, 2, due: 20)
        XCTAssertEqual(gone.got, 0)
        XCTAssertEqual(thin.tally.late, 1)
        XCTAssertEqual(thin.available, 0)
    }

    func testSeekStartsOver() {
        let ring = SoundRing(capacity: 64, seekTolerance: 10)
        push(ring, [1, 2, 3], at: 0)
        // A chunk from far away in the file: what was waiting is dropped.
        push(ring, [7, 8], at: 5000)
        XCTAssertEqual(ring.available, 2)
        XCTAssertEqual(pop(ring, 2, due: 5002).left, [7, 8])
    }

    func testRepeatedSoundIsKeptOnce() {
        let ring = SoundRing(capacity: 64, seekTolerance: 10)
        push(ring, [1, 2, 3, 4], at: 0)
        // The same chunk again, the way a paused player repeats itself.
        XCTAssertEqual(push(ring, [1, 2, 3, 4], at: 0), 0)
        XCTAssertEqual(ring.available, 4)
        // A chunk that overlaps what is here: only the new part joins.
        XCTAssertEqual(push(ring, [3, 4, 5, 6], at: 2), 2)
        XCTAssertEqual(pop(ring, 6, due: 100).left, [1, 2, 3, 4, 5, 6])
        // Repeats of sound already handed out are ignored too.
        XCTAssertEqual(push(ring, [5, 6], at: 4), 0)
        XCTAssertEqual(ring.available, 0)
    }

    func testMissingFramesBecomeSilence() {
        let ring = SoundRing(capacity: 64, seekTolerance: 10)
        push(ring, [1, 2], at: 0)
        // Resampling rounds: the next chunk starts at 4, not 2.
        push(ring, [5, 6], at: 4)
        XCTAssertEqual(ring.available, 6)
        XCTAssertEqual(pop(ring, 6, due: 100).left, [1, 2, 0, 0, 5, 6])
    }

    func testWrapsAroundTheEnd() {
        let ring = SoundRing(capacity: 64)
        for chunk in 0..<10 { push(ring, (0..<10).map { Float(chunk * 10 + $0) }, at: chunk * 10) }
        // 100 frames offered into 64 of room: the ring keeps the first 64.
        XCTAssertEqual(ring.available, 64)
        var seen: [Float] = []
        for _ in 0..<8 { seen += pop(ring, 8, due: 1000).left }
        XCTAssertEqual(seen, (0..<64).map(Float.init))
        // The write point has wrapped; the next chunk still reads back in order.
        push(ring, [100, 101, 102], at: 64)
        XCTAssertEqual(pop(ring, 3, due: 1000).left, [100, 101, 102])
    }

    func testFlushForgetsEverything() {
        let ring = SoundRing(capacity: 64)
        push(ring, [1, 2, 3], at: 0)
        ring.flush()
        XCTAssertEqual(ring.available, 0)
        XCTAssertEqual(pop(ring, 2, due: 100).got, 0)
        XCTAssertEqual(ring.tally.dry, 0, "nothing was expected after a flush")
        push(ring, [20, 21], at: 40)
        XCTAssertEqual(pop(ring, 2, due: 42).left, [20, 21])
    }

    func testClockCountsForwardFromTheLastNote() {
        let clock = SoundClock(rate: 48000)
        XCTAssertEqual(clock.dueFrame(host: 5), 0, "nothing noted yet: nothing due")
        clock.note(position: 1.0, speed: 1, host: 10.0)
        XCTAssertEqual(clock.dueFrame(host: 10.0), 48000)
        XCTAssertEqual(clock.dueFrame(host: 10.5), 72000)
        // Paused at 1.5 s: the due frame stops.
        clock.note(position: 1.5, speed: 0, host: 10.5)
        XCTAssertEqual(clock.dueFrame(host: 12.0), 72000)
        clock.stop()
        XCTAssertEqual(clock.dueFrame(host: 20), 0)
    }

    func testDownmix() {
        let mono: [Float] = [1, 2, 3]
        let second: [Float] = [7, 8, 9]
        var l = [Float](repeating: 0, count: 3), r = [Float](repeating: 0, count: 3)
        mono.withUnsafeBufferPointer { m in
            l.withUnsafeMutableBufferPointer { lp in r.withUnsafeMutableBufferPointer { rp in
                Downmix.stereo(first: m.baseAddress!, second: nil, frames: 3, left: lp.baseAddress!, right: rp.baseAddress!)
            } }
        }
        XCTAssertEqual(l, [1, 2, 3]); XCTAssertEqual(r, [1, 2, 3], "one channel plays on both sides")
        mono.withUnsafeBufferPointer { m in second.withUnsafeBufferPointer { s in
            l.withUnsafeMutableBufferPointer { lp in r.withUnsafeMutableBufferPointer { rp in
                Downmix.stereo(first: m.baseAddress!, second: s.baseAddress!, frames: 3, left: lp.baseAddress!, right: rp.baseAddress!)
            } }
        } }
        XCTAssertEqual(l, [1, 2, 3]); XCTAssertEqual(r, [7, 8, 9])
    }
}
