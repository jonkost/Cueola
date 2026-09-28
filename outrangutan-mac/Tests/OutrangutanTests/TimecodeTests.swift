import XCTest
import OutrangutanCore

/// The Mac clock must read exactly like the web Outrangutan clock.
/// The expected strings come from the web clock (fmtSmpte in outrangutan.js).
final class TimecodeTests: XCTestCase {
    func testDropFrameMatchesTheWebClock() {
        let cases: [(Double, String)] = [
            (0, "00:00:00;00"),
            (1, "00:00:00;29"),
            (59.9, "00:00:59;25"),
            (60.06, "00:00:59;29"),
            (60.07, "00:01:00;02"),
            (600, "00:10:00;00"),
            (3600, "01:00:00;00"),
            (5025.5, "01:23:45;14"),
        ]
        for (seconds, expected) in cases {
            XCTAssertEqual(Timecode.dropFrame(seconds), expected, "at \(seconds) seconds")
        }
    }

    func testShortTime() {
        XCTAssertEqual(Timecode.short(65), "1:05")
        XCTAssertEqual(Timecode.short(3723), "1:02:03")
    }
}
