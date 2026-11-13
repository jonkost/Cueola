import XCTest
@testable import OutrangutanCore

/// The built-in Library's sound effects, made from sine waves and noise.
final class LibrarySoundsTests: XCTestCase {
    func testEverySoundIsMadeAndIsNotSilentOrClipped() {
        for sound in LibrarySounds.all {
            guard let made = LibrarySounds.render(sound.id) else { return XCTFail("\(sound.name) was not made") }
            XCTAssertEqual(made.left.count, made.right.count, sound.name)
            let seconds = Double(made.left.count) / LibrarySounds.rate
            XCTAssertGreaterThan(seconds, 0.2, sound.name)
            XCTAssertLessThanOrEqual(seconds, 10.0, sound.name)
            var peak: Float = 0
            var sum: Float = 0
            for i in 0..<made.left.count {
                XCTAssertFalse(made.left[i].isNaN || made.right[i].isNaN, sound.name)
                peak = max(peak, abs(made.left[i]), abs(made.right[i]))
                sum += made.left[i] * made.left[i]
            }
            XCTAssertGreaterThan(peak, 0.05, "\(sound.name) is silent")
            XCTAssertLessThanOrEqual(peak, 0.9, "\(sound.name) is too hot")
            XCTAssertGreaterThan((sum / Float(made.left.count)).squareRoot(), 0.003, "\(sound.name) is nearly silent")
        }
    }

    func testNamesAreUniqueAndUnknownNamesMakeNothing() {
        XCTAssertEqual(Set(LibrarySounds.all.map(\.id)).count, LibrarySounds.all.count)
        XCTAssertEqual(Set(LibrarySounds.all.map(\.name)).count, LibrarySounds.all.count)
        XCTAssertNil(LibrarySounds.render("laugh-track"))
    }

    func testTheSameSoundComesOutEveryTime() {
        let a = LibrarySounds.render("applause")!, b = LibrarySounds.render("applause")!
        XCTAssertEqual(a.left, b.left)
        XCTAssertEqual(a.right, b.right)
    }

    func testToneIsOneKilohertzAtMinusTwenty() {
        let tone = LibrarySounds.render("tone-1k")!
        XCTAssertEqual(tone.left.count, 480_000)
        XCTAssertEqual(tone.left.max()!, 0.1, accuracy: 0.001)
        // Rising through zero once every 48 samples: 1,000 times a second.
        var crossings = 0
        for i in 1..<48_000 where tone.left[i - 1] < 0 && tone.left[i] >= 0 { crossings += 1 }
        XCTAssertEqual(crossings, 999, accuracy: 1)
    }

    func testLoopingSoundsStartAndEndQuiet() {
        for sound in LibrarySounds.all where sound.loops {
            let made = LibrarySounds.render(sound.id)!
            XCTAssertLessThan(abs(made.left.first!), 0.02, sound.name)
            XCTAssertLessThan(abs(made.left.last!), 0.02, sound.name)
        }
    }

    func testWavFileIsWellFormed() {
        let sound: LibrarySounds.Stereo = ([0, 0.5, -0.5, 1], [0, -0.5, 0.5, -1])
        let wav = LibrarySounds.wav(sound)
        XCTAssertEqual(wav.count, 44 + 16)
        XCTAssertEqual(String(decoding: wav[0..<4], as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: wav[8..<12], as: UTF8.self), "WAVE")
        XCTAssertEqual(wav[22], 2, "two channels")
        XCTAssertEqual(UInt32(wav[24]) | UInt32(wav[25]) << 8 | UInt32(wav[26]) << 16, 48_000)
        XCTAssertEqual(wav[34], 16, "16 bits")
        // The second frame's left sample: half scale, low byte first.
        let half = Int16(bitPattern: UInt16(wav[48]) | UInt16(wav[49]) << 8)
        XCTAssertEqual(half, 16383)
    }
}
