import XCTest
import OutrangutanCore

/// The bytes to and from a Stream Deck, checked against Elgato's papers and
/// the open drivers, the same checks the browser's deck code has.
final class StreamDeckProtocolTests: XCTestCase {
    typealias P = StreamDeckProtocol
    let xl = P.model(productID: 0x006c)!
    let plus = P.model(productID: 0x0084)!
    let mini = P.model(productID: 0x0063)!

    func testKeyReportsReadWithTheReportId() {
        // XL: [0x01, 0x00, count lo, count hi, states...]
        var d = [UInt8](repeating: 0, count: 4 + 32)
        d[0] = 0x01; d[2] = 32; d[4 + 0] = 1; d[4 + 5] = 1; d[4 + 31] = 1
        guard case .keys(let states) = P.parseInput(d, model: xl) else { return XCTFail("not keys") }
        XCTAssertEqual(states.count, 32)
        XCTAssertTrue(states[0]); XCTAssertTrue(states[5]); XCTAssertTrue(states[31]); XCTAssertFalse(states[1])
        // Mini: [0x01, states...]
        var m = [UInt8](repeating: 0, count: 1 + 6)
        m[0] = 0x01; m[1 + 2] = 1
        guard case .keys(let ms) = P.parseInput(m, model: mini) else { return XCTFail("not keys") }
        XCTAssertEqual(ms, [false, false, true, false, false, false])
    }

    func testDialsAndTouch() {
        var rot = [UInt8](repeating: 0, count: 16)
        rot[0] = 0x01; rot[1] = 0x03; rot[4] = 0x01; rot[5] = 3; rot[6] = 0xfd; rot[8] = 1
        XCTAssertEqual(P.parseInput(rot, model: plus), .dialsTurned([3, -3, 0, 1]))
        var prs = [UInt8](repeating: 0, count: 16)
        prs[0] = 0x01; prs[1] = 0x03; prs[4] = 0x00; prs[5 + 2] = 1
        XCTAssertEqual(P.parseInput(prs, model: plus), .dialsPressed([false, false, true, false]))
        var touch = [UInt8](repeating: 0, count: 16)
        touch[0] = 0x01; touch[1] = 0x02; touch[4] = 0x01; touch[6] = 0x2c; touch[7] = 0x01   // x = 300: zone 1 of 4
        XCTAssertEqual(P.parseInput(touch, model: plus), .touch(zone: 1, gesture: "tap"))
        // A key report on the Plus still reads as keys.
        var k = [UInt8](repeating: 0, count: 12)
        k[0] = 0x01; k[1] = 0x00; k[4 + 7] = 1
        guard case .keys(let states) = P.parseInput(k, model: plus) else { return XCTFail("not keys") }
        XCTAssertTrue(states[7])
    }

    func testEdges() {
        let e = P.edges(from: [false, true, false], to: [true, false, false])
        XCTAssertEqual(e.downs, [0]); XCTAssertEqual(e.ups, [1])
    }

    func testKeyPicturesAreCutIntoReports() {
        // Every byte of the picture is different from its neighbours, so a
        // slice repeated, skipped or shifted by one shows up when the parts
        // are put back together.
        func picture(_ n: Int) -> [UInt8] { (0..<n).map { UInt8(($0 * 7) & 0xff) } }
        let image = picture(2500)
        let r = P.keyImageReports(model: xl, key: 9, image: image)
        XCTAssertEqual(r.count, 3)
        XCTAssertEqual(r[0].count, 1024)
        XCTAssertEqual(Array(r[0][0..<8]), [0x02, 0x07, 9, 0, 0xf8, 0x03, 0, 0])   // 1016 bytes, page 0, not last
        XCTAssertEqual(Array(r[2][0..<8]), [0x02, 0x07, 9, 1, 0xd4, 0x01, 2, 0])   // 468 bytes, page 2, last
        XCTAssertEqual(r[2][8 + 468], 0)
        // Back together through each report's own length.
        XCTAssertEqual(r.flatMap { Array($0[8..<(8 + (Int($0[4]) | (Int($0[5]) << 8)))]) }, image)
        let miniImage = picture(1500)
        let m = P.keyImageReports(model: mini, key: 2, image: miniImage)
        XCTAssertEqual(m.count, 2)
        XCTAssertEqual(Array(m[0][0..<6]), [0x02, 0x01, 0, 0, 0, 3])
        XCTAssertEqual(Array(m[1][0..<6]), [0x02, 0x01, 1, 0, 1, 3])
        // No length in this form: the picture fills the reports, the last
        // one padded with zeros.
        XCTAssertEqual(Array(m.flatMap { $0[16...] }.prefix(miniImage.count)), miniImage)
        XCTAssertTrue(m[1][(16 + 1500 - 1008)...].allSatisfy { $0 == 0 })
        // The 2017 deck counts keys right to left, so the app's key 0 is its key 4 (byte 5 = 4 + 1).
        let originalImage = picture(15606)
        let o = P.keyImageReports(model: P.model(productID: 0x0060)!, key: 0, image: originalImage)
        XCTAssertEqual(o.count, 2)
        XCTAssertEqual(o[0].count, 8191)
        XCTAssertEqual(Array(o[1][0..<6]), [0x02, 0x01, 2, 0, 1, 5])
        XCTAssertEqual(Array(o.flatMap { $0[16...] }.prefix(originalImage.count)), originalImage)
    }

    func testOriginalDeckCountsKeysRightToLeft() {
        let original = P.model(productID: 0x0060)!
        // Each row is mirrored: 0..4 becomes 4..0, 5..9 becomes 9..5, and so on.
        XCTAssertEqual((0..<15).map { P.wireKey($0, model: original) }, [4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 14, 13, 12, 11, 10])
        // Other decks are left alone.
        XCTAssertEqual(P.wireKey(3, model: xl), 3)
        XCTAssertEqual(P.wireKey(3, model: mini), 3)
        // Picture for the app's key 0 goes to the deck's key 4; key 4 goes to the deck's key 0.
        XCTAssertEqual(P.keyImageReports(model: original, key: 0, image: [1])[0][5], 5)
        XCTAssertEqual(P.keyImageReports(model: original, key: 4, image: [1])[0][5], 1)
        XCTAssertEqual(P.keyImageReports(model: original, key: 12, image: [1])[0][5], 13)
        // The deck's key 4 held down (byte 1 + 4) is the app's key 0; its key 10 is the app's key 14.
        var d = [UInt8](repeating: 0, count: 1 + 15)
        d[0] = 0x01; d[1 + 4] = 1; d[1 + 10] = 1
        guard case .keys(let states) = P.parseInput(d, model: original) else { return XCTFail("not keys") }
        XCTAssertEqual(states.count, 15)
        XCTAssertTrue(states[0]); XCTAssertTrue(states[14])
        XCTAssertFalse(states[4]); XCTAssertFalse(states[10])
        XCTAssertEqual(states.filter { $0 }.count, 2)
    }

    func testStripReportsCarryTheRegion() {
        let r = P.stripImageReports(model: plus, image: [UInt8](repeating: 7, count: 1100))
        XCTAssertEqual(r.count, 2)
        XCTAssertEqual(Array(r[0][0..<16]), [0x02, 0x0c, 0, 0, 0, 0, 0x20, 0x03, 0x64, 0, 0, 0, 0, 0xf0, 0x03, 0])
        XCTAssertEqual(Array(r[1][0..<16]), [0x02, 0x0c, 0, 0, 0, 0, 0x20, 0x03, 0x64, 0, 1, 1, 0, 0x5c, 0, 0])
        let zone = P.stripImageReports(model: plus, image: [1, 2, 3], x: 200, y: 0, width: 200, height: 100)
        XCTAssertEqual(Array(zone[0][2..<10]), [0xc8, 0, 0, 0, 0xc8, 0, 0x64, 0])
        XCTAssertTrue(P.stripImageReports(model: xl, image: [1]).isEmpty)
    }

    func testBrightnessAndReset() {
        XCTAssertEqual(Array(P.brightnessReport(model: xl, percent: 80)[0..<3]), [0x03, 0x08, 80])
        XCTAssertEqual(P.brightnessReport(model: xl, percent: 80).count, 32)
        XCTAssertEqual(Array(P.brightnessReport(model: mini, percent: 130)[0..<6]), [0x05, 0x55, 0xaa, 0xd1, 0x01, 100])
        XCTAssertEqual(P.brightnessReport(model: mini, percent: 50).count, 17)
        XCTAssertEqual(Array(P.resetReport(model: xl)[0..<2]), [0x03, 0x02])
        XCTAssertEqual(Array(P.resetReport(model: mini)[0..<2]), [0x0b, 0x63])
    }

    func testBitmapIsBottomUpBlueFirst() {
        // 2 by 2: top row red, green; bottom row blue, white.
        let rgba: [UInt8] = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]
        let b = P.bmp(width: 2, height: 2, rgba: rgba)
        XCTAssertEqual(b.count, 54 + 8 * 2)
        XCTAssertEqual(Array(b[0..<2]), [0x42, 0x4d])
        XCTAssertEqual(Array(b[54..<60]), [255, 0, 0, 255, 255, 255])     // bottom row first: blue (B,G,R), white
        XCTAssertEqual(Array(b[62..<68]), [0, 0, 255, 0, 255, 0])         // then red, green
    }
}
