import XCTest
@testable import OutrangutanCore

final class MidiRouterTests: XCTestCase {
    func testNamesMatchTheWebApp() {
        XCTAssertEqual(MidiRouter.key(status: 0x90, d1: 60), "n:0:60")
        XCTAssertEqual(MidiRouter.key(status: 0xB3, d1: 7), "cc:3:7")
        XCTAssertEqual(MidiRouter.label("n:0:60"), "C4, channel 1")
        XCTAssertEqual(MidiRouter.label("cc:3:7"), "CC 7, channel 4")
    }

    func testLearningNeverFiresTheTouchThatTaughtIt() {
        var r = MidiRouter()
        r.learning = true
        XCTAssertEqual(r.handle(status: 0x80, d1: 60, d2: 0), .none, "a release cannot learn")
        XCTAssertEqual(r.handle(status: 0x90, d1: 60, d2: 100), .learned("n:0:60"))
        XCTAssertFalse(r.learning)
        XCTAssertEqual(r.map["n:0:60"]?.action, .go)
        // The same press bouncing, then its release: nothing fires.
        XCTAssertEqual(r.handle(status: 0x90, d1: 60, d2: 90), .none)
        XCTAssertEqual(r.handle(status: 0x80, d1: 60, d2: 0), .none)
        // The next press fires.
        XCTAssertEqual(r.handle(status: 0x90, d1: 60, d2: 100), .fire(MidiBinding(action: .go)))
        // A note-on with velocity 0 is a release.
        XCTAssertEqual(r.handle(status: 0x90, d1: 60, d2: 0), .none)
    }

    func testAButtonOnACCFiresOnceGoingUp() {
        var r = MidiRouter(map: ["cc:0:20": MidiBinding(action: .stop)])
        XCTAssertEqual(r.handle(status: 0xB0, d1: 20, d2: 127), .fire(MidiBinding(action: .stop)))
        XCTAssertEqual(r.handle(status: 0xB0, d1: 20, d2: 100), .none, "still held")
        XCTAssertEqual(r.handle(status: 0xB0, d1: 20, d2: 0), .none)
        XCTAssertEqual(r.handle(status: 0xB0, d1: 20, d2: 127), .fire(MidiBinding(action: .stop)))
    }

    func testAFaderSetsTheLevel() {
        var r = MidiRouter()
        r.learning = true
        XCTAssertEqual(r.handle(status: 0xB0, d1: 7, d2: 64), .learned("cc:0:7"))
        XCTAssertEqual(r.map["cc:0:7"]?.action, .master)
        XCTAssertEqual(r.handle(status: 0xB0, d1: 7, d2: 30), .none, "silent until let go")
        XCTAssertEqual(r.handle(status: 0xB0, d1: 7, d2: 0), .none)
        XCTAssertEqual(r.handle(status: 0xB0, d1: 7, d2: 127), .master(1))
    }

    func testOtherMessagesAreIgnored() {
        var r = MidiRouter(map: ["n:0:60": MidiBinding(action: .go)])
        XCTAssertEqual(r.handle(status: 0xE0, d1: 0, d2: 64), .none, "pitch bend")
        XCTAssertEqual(r.handle(status: 0x91, d1: 60, d2: 100), .none, "another channel")
    }
}
