import XCTest
@testable import OutrangutanCore

final class ScopeMathTests: XCTestCase {
    private func picture(_ colors: [(UInt8, UInt8, UInt8)], width: Int, height: Int) -> [UInt8] {
        // Vertical bars, one color per equal-width stripe.
        var px: [UInt8] = []
        for _ in 0..<height {
            for x in 0..<width {
                let c = colors[x * colors.count / width]
                px += [c.0, c.1, c.2, 255]
            }
        }
        return px
    }

    func testWhiteAndBlackSitAtTheTopAndBottomOfTheWaveform() {
        let px = picture([(0, 0, 0), (255, 255, 255)], width: 8, height: 4)
        let w = ScopeMath.waveform(rgba: px, width: 8, height: 4, columns: 2)
        XCTAssertEqual(w[0 * 2 + 0], 16, "left half all black")
        XCTAssertEqual(w[255 * 2 + 1], 16, "right half all white")
        XCTAssertEqual(w.reduce(0, +), 32)
    }

    func testGrayIsTheMiddleOfTheVectorscope() {
        let p = ScopeMath.point(128, 128, 128, size: 256)
        XCTAssertEqual(p.x, 128, accuracy: 1)
        XCTAssertEqual(p.y, 128, accuracy: 1)
    }

    func testRedGoesUpAndBlueGoesRight() {
        let red = ScopeMath.point(255, 0, 0, size: 256)
        let blue = ScopeMath.point(0, 0, 255, size: 256)
        XCTAssertLessThan(red.y, 128, "red is above the middle")
        XCTAssertGreaterThan(blue.x, 200, "blue is far right")
        // The broadcast wheel order around the circle: red is up-left of
        // magenta, magenta up-right, blue right, and so on.
        let yellow = ScopeMath.point(255, 255, 0, size: 256)
        XCTAssertLessThan(yellow.x, 128)
        XCTAssertGreaterThan(yellow.y, red.y)
    }

    func testColorBarsLandOnTheirTargets() {
        let bars = ScopeMath.barTargets.map { (UInt8($0.r), UInt8($0.g), UInt8($0.b)) }
        let px = picture(bars, width: 60, height: 2)
        let v = ScopeMath.vectorscope(rgba: px, width: 60, height: 2, size: 128)
        for t in ScopeMath.barTargets {
            let p = ScopeMath.point(t.r, t.g, t.b, size: 128)
            XCTAssertEqual(v[p.y * 128 + p.x], 20, "\(t.name) bar")
        }
    }
}
