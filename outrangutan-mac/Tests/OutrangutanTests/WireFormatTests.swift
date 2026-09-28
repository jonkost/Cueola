import XCTest
import OutrangutanCore

/// What the Mac writes must look like what the web Outrangutan writes.
final class WireFormatTests: XCTestCase {
    func testWholeNumbersAreIntegers() {
        XCTAssertEqual(FirestoreValue.encode(12.0)["integerValue"] as? String, "12")
        XCTAssertEqual(FirestoreValue.encode(1.5)["doubleValue"] as? Double, 1.5)
        XCTAssertEqual(FirestoreValue.encode("GO")["stringValue"] as? String, "GO")
        XCTAssertEqual(FirestoreValue.encode(true)["booleanValue"] as? Bool, true)
        XCTAssertNotNil(FirestoreValue.encode(NSNull())["nullValue"])
    }

    func testRoundTrip() {
        let value: [String: Any] = ["status": "play", "remaining": 12.0, "hold": false, "list": ["a", 2.0]]
        let back = FirestoreValue.decode(FirestoreValue.encode(value)) as? [String: Any]
        XCTAssertEqual(back?["status"] as? String, "play")
        XCTAssertEqual((back?["remaining"] as? NSNumber)?.intValue, 12)
        XCTAssertEqual(back?["hold"] as? Bool, false)
        XCTAssertEqual((back?["list"] as? [Any])?.count, 2)
    }

    func testFieldPathsQuoteOddNames() {
        XCTAssertEqual(FirestoreValue.fieldPath(["outrangutan", "live"]), "outrangutan.live")
        XCTAssertEqual(FirestoreValue.fieldPath(["fixRequests", "9abc", "status"]), "fixRequests.`9abc`.status")
    }

    func testPatchBodyNestsPaths() {
        let body = FirestoreValue.patchBody([["outrangutan", "cues"]: ["x": 1.0], ["outrangutan", "cuesTs"]: 5.0])
        let fields = body["fields"] as? [String: Any]
        let og = FirestoreValue.decode(fields?["outrangutan"]) as? [String: Any]
        XCTAssertNotNil(og?["cues"])
        XCTAssertEqual((og?["cuesTs"] as? NSNumber)?.intValue, 5)
    }

    func testHeldStillSaysHold() {
        var s = LiveState()
        s.status = .play; s.cueId = "og_1"; s.name = "Still"; s.type = "image"; s.remaining = nil
        let p = LivePacket.make(s, ts: 1, seq: 1, sender: "m", build: "mac")
        XCTAssertTrue(p["remaining"] is NSNull)
        XCTAssertEqual(p["hold"] as? Bool, true)
        XCTAssertNil(p["offset"])
    }

    func testVideoPacket() {
        var s = LiveState()
        s.status = .play; s.cueId = "og_2"; s.name = "Bars"; s.type = "video"
        s.duration = 99.6; s.remaining = 41.4; s.offset = 58.23
        let p = LivePacket.make(s, ts: 1, seq: 7, sender: "m", build: "mac")
        XCTAssertEqual(p["remaining"] as? Double, 41)
        XCTAssertEqual(p["offset"] as? Double, 58.2)
        XCTAssertEqual(p["dur"] as? Double, 100)
        XCTAssertEqual(p["proto"] as? Int, 4)
        XCTAssertEqual(p["seq"] as? Int, 7)
        XCTAssertNil(p["hold"])
    }

    func testIdlePacketHasNoCue() {
        let p = LivePacket.make(LiveState(), ts: 1, seq: 1, sender: "m", build: "mac")
        XCTAssertEqual(p["status"] as? String, "idle")
        XCTAssertNil(p["cueId"])
        let outputs = p["outputs"] as? [String: Any]
        XCTAssertEqual(outputs?["status"] as? String, "closed")
        XCTAssertEqual((p["armed"] as? [String: Any])?["armed"] as? Bool, true)
    }
}

/// Fade shapes must match curveK in the web app.
final class FadeCurveTests: XCTestCase {
    func testShapes() {
        XCTAssertEqual(FadeCurve.linear.shape(0.25), 0.25, accuracy: 1e-9)
        XCTAssertEqual(FadeCurve.s.shape(0.25), 0.25 * 0.25 * (3 - 0.5), accuracy: 1e-9)
        XCTAssertEqual(FadeCurve.log.shape(0.5), pow(0.5, 2.2), accuracy: 1e-9)
        for c in FadeCurve.allCases {
            XCTAssertEqual(c.shape(0), 0, accuracy: 1e-9)
            XCTAssertEqual(c.shape(1), 1, accuracy: 1e-9)
            XCTAssertEqual(c.shape(2), 1, accuracy: 1e-9, "past the end stays at the end")
        }
    }
}

/// Several outputs read like the web app's outputStatus().
final class OutputsPacketTests: XCTestCase {
    func testOneOfTwoOpenIsDegraded() {
        var s = LiveState()
        s.outputList = [OutputLive(id: 1, label: "Program", open: true), OutputLive(id: 2, label: "IMAG", open: false)]
        let o = LivePacket.outputs(s, now: 1)
        XCTAssertEqual(o["status"] as? String, "degraded")
        XCTAssertEqual(o["total"] as? Int, 2)
        XCTAssertEqual(o["open"] as? Int, 1)
        XCTAssertEqual(o["detail"] as? String, "1 of 2 outputs ready · IMAG closed")
        XCTAssertEqual((o["items"] as? [[String: Any]])?.map { $0["id"] as? String }, ["1", "2"])
    }

    func testAllOpenIsReady() {
        var s = LiveState()
        s.outputList = [OutputLive(id: 1, label: "Program", open: true)]
        XCTAssertEqual(LivePacket.outputs(s, now: 1)["status"] as? String, "ready")
    }
}
