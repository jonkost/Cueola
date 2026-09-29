import XCTest
import OutrangutanCore

/// The Mac must follow the same command rules as the web Outrangutan
/// (onSessionDoc and consumeCommandQueue in outrangutan.js).
final class CommandInboxTests: XCTestCase {
    let me = "outrangutan_mac1"
    let now: Double = 1_800_000_000_000

    /// Runs one look at the shared record and says what happened.
    struct Look {
        var ran: [String] = []
        var panics = 0
        var gains: [Double] = []
        var acks: [WireAck] = []
    }

    func look(_ inbox: CommandInbox, _ og: [String: Any], at time: Double? = nil,
              result: WireResult = .done) -> Look {
        var out = Look()
        out.acks = inbox.handle(og, now: time ?? now,
                                run: { out.ran.append($0.action + ($0.cueId.isEmpty ? "" : ":" + $0.cueId)); return result },
                                panic: { out.panics += 1 },
                                gain: { out.gains.append($0) })
        return out
    }

    func cmd(_ id: String, _ action: String, orig: String? = nil, ts: Double? = nil,
             sender: String = "flowmingo_pro", cueId: String = "") -> [String: Any] {
        let t = ts ?? now
        return ["commandId": id, "origId": orig ?? id, "ts": t, "expiresAt": t + 8000,
                "by": "Director", "sender": sender, "action": action, "cueId": cueId, "padId": ""]
    }

    func testFirstLookIsABaseline() {
        let inbox = CommandInbox(sender: me)
        let first = look(inbox, ["command": cmd("a", "go")])
        XCTAssertEqual(first.ran, [], "a command from before we joined must not run")
        let second = look(inbox, ["command": cmd("b", "go")])
        XCTAssertEqual(second.ran, ["go"])
        XCTAssertEqual(second.acks.first?.origId, "b")
        XCTAssertEqual(second.acks.first?.result.ok, true)
    }

    func testARetryIsAnsweredButNeverRunTwice() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, [:])
        let fire = look(inbox, ["command": cmd("c1", "cue", orig: "o1", cueId: "og_1")], result: .refused("cue og_1 is not on this Mac"))
        XCTAssertEqual(fire.ran, ["cue:og_1"])
        let retry = look(inbox, ["command": cmd("c2", "cue", orig: "o1", cueId: "og_1")])
        XCTAssertEqual(retry.ran, [], "same origId must not run again")
        XCTAssertEqual(retry.acks.first?.commandId, "c2")
        XCTAssertEqual(retry.acks.first?.result, .refused("cue og_1 is not on this Mac"), "the retry gets the first answer")
    }

    func testOwnWritesAreSkipped() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, [:])
        let own = look(inbox, ["command": cmd("m1", "go", sender: me)])
        XCTAssertEqual(own.ran, [])
        XCTAssertEqual(own.acks, [])
    }

    func testQueueOnFirstLookRunsOnlyFreshEntries() {
        let inbox = CommandInbox(sender: me)
        let queue = [cmd("old", "go", ts: now - 60_000), cmd("fresh", "cue", ts: now - 2_000, cueId: "og_2")]
        let first = look(inbox, ["commandQueue": queue])
        XCTAssertEqual(first.ran, ["cue:og_2"], "within 10 seconds still runs, older is skipped")
    }

    func testAStopCancelsOlderFiresInTheSameLook() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, ["commandQueue": []])
        let queue = [cmd("g1", "go", ts: now - 500), cmd("s1", "stop", ts: now - 100)]
        let l = look(inbox, ["commandQueue": queue])
        XCTAssertEqual(l.ran, ["stop"])
        let refused = l.acks.first { $0.commandId == "g1" }
        XCTAssertEqual(refused?.result, .refused("superseded by stop"))
    }

    func testExpiredQueueEntriesAreDropped() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, ["commandQueue": []])
        // A fresh command first teaches this Mac the rundown's clock
        // (like the web version, a stale command alone cannot tell).
        _ = look(inbox, ["commandQueue": [cmd("f1", "stop")]])
        var stale = cmd("x1", "go", ts: now - 40_000)
        stale["expiresAt"] = now - 30_000
        let l = look(inbox, ["commandQueue": [stale]])
        XCTAssertEqual(l.ran, [])
        XCTAssertEqual(l.acks, [], "the sender already gave up on it")
    }

    func testTheSlotCopyOfAQueuedCommandRunsOnce() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, ["commandQueue": []])
        let c = cmd("q1", "go")
        let l = look(inbox, ["commandQueue": [c], "command": c])
        XCTAssertEqual(l.ran, ["go"])
    }

    func testPanicLaneRunsOnceAndIsAnswered() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, [:])
        let pn: [String: Any] = ["id": "p1", "origId": "po1", "ts": now, "by": "Director", "sender": "flowmingo_pro"]
        let l = look(inbox, ["panic": pn, "command": cmd("p1c", "panic", orig: "po1")])
        XCTAssertEqual(l.panics, 1)
        XCTAssertEqual(l.ran, [], "the slot copy of the same panic must not run again")
        XCTAssertTrue(l.acks.contains { $0.commandId == "p1" && $0.result.ok })
    }

    func testGainIsClampedAndOwnGainIsSkipped() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, ["gain": ["v": 0.5, "id": "g0", "ts": now, "sender": "flowmingo_pro"]])
        let l = look(inbox, ["gain": ["v": 3.0, "id": "g1", "ts": now, "sender": "flowmingo_pro"]])
        XCTAssertEqual(l.gains, [1.2])
        let own = look(inbox, ["gain": ["v": 0.2, "id": "g2", "ts": now, "sender": me]])
        XCTAssertEqual(own.gains, [])
    }

    func testDriftedClocksStillAgreeOnTooOld() {
        // The rundown Mac's clock runs an hour behind this one.
        let inbox = CommandInbox(sender: me)
        let behind = now - 3_600_000
        _ = look(inbox, ["commandQueue": []])
        // A live command teaches the offset.
        _ = look(inbox, ["commandQueue": [cmd("t1", "go", ts: behind)]])
        // A new command stamped on the slow clock is fresh, not an hour stale.
        let l = look(inbox, ["commandQueue": [cmd("t1", "go", ts: behind), cmd("t2", "stop", ts: behind + 1000)]], at: now + 1000)
        XCTAssertEqual(l.ran, ["stop"])
    }

    func testRejoinDoesNotReplayAFire() {
        let inbox = CommandInbox(sender: me)
        _ = look(inbox, ["commandQueue": []])
        let c = cmd("r1", "go")
        XCTAssertEqual(look(inbox, ["commandQueue": [c]]).ran, ["go"])
        inbox.reset()
        XCTAssertEqual(look(inbox, ["commandQueue": [c]]).ran, [], "rejoining must not fire it again")
    }
}

final class DirectLinkRuleTests: XCTestCase {
    private func cmd(_ id: String, _ action: String, ts: Double) -> WireCommand {
        WireCommand(commandId: id, ts: ts, expiresAt: ts + 8000, sender: "flowmingo_x", action: action, cueId: "og_1")
    }

    func testADirectFireRunsOnceWhenItsCloudCopyArrives() {
        let inbox = CommandInbox(sender: "mac")
        var runs = 0
        _ = inbox.handle([:], now: 1000, run: { _ in .done }, panic: {}, gain: { _ in })   // joined
        let go = cmd("out_1", "cue", ts: 1000)
        XCTAssertEqual(inbox.direct(go, now: 1010, run: { _ in runs += 1; return .done }, panic: {}).result, .done)
        let acks = inbox.handle(["command": ["commandId": "out_1", "origId": "out_1", "ts": 1000.0, "sender": "flowmingo_x", "action": "cue", "cueId": "og_1"],
                                 "commandQueue": [["commandId": "out_1", "origId": "out_1", "ts": 1000.0, "expiresAt": 9000.0, "sender": "flowmingo_x", "action": "cue", "cueId": "og_1"]]],
                                now: 1300, run: { _ in runs += 1; return .done }, panic: {}, gain: { _ in })
        XCTAssertEqual(runs, 1)
        XCTAssertEqual(acks.map(\.origId), ["out_1"])
        XCTAssertEqual(acks.first?.result, .done)
    }

    func testAFireThatAlreadyPlayedIsNeverCalledSuperseded() {
        let inbox = CommandInbox(sender: "mac")
        _ = inbox.handle([:], now: 1000, run: { _ in .done }, panic: {}, gain: { _ in })
        _ = inbox.direct(cmd("out_1", "cue", ts: 1000), now: 1000, run: { _ in .done }, panic: {})
        _ = inbox.direct(cmd("out_2", "stop", ts: 1100), now: 1100, run: { _ in .done }, panic: {})
        let q: [[String: Any]] = [
            ["commandId": "out_1", "origId": "out_1", "ts": 1000.0, "expiresAt": 9000.0, "sender": "flowmingo_x", "action": "cue", "cueId": "og_1"],
            ["commandId": "out_2", "origId": "out_2", "ts": 1100.0, "expiresAt": 9100.0, "sender": "flowmingo_x", "action": "stop"],
        ]
        let acks = inbox.handle(["commandQueue": q], now: 1400, run: { _ in XCTFail("nothing runs twice"); return .done }, panic: {}, gain: { _ in })
        XCTAssertEqual(acks.map(\.result), [.done, .done])
    }

    func testADirectPanicCoversThePanicLane() {
        let inbox = CommandInbox(sender: "mac")
        var panics = 0
        _ = inbox.handle([:], now: 1000, run: { _ in .done }, panic: {}, gain: { _ in })
        _ = inbox.direct(cmd("out_9", "panic", ts: 1000), now: 1000, run: { _ in .done }, panic: { panics += 1 })
        _ = inbox.handle(["panic": ["id": "out_9", "origId": "out_9", "ts": 1000.0, "sender": "flowmingo_x"]],
                         now: 1200, run: { _ in .done }, panic: { panics += 1 }, gain: { _ in })
        XCTAssertEqual(panics, 1)
    }

    func testALateDirectCommandIsRefused() {
        let inbox = CommandInbox(sender: "mac")
        let ack = inbox.direct(cmd("out_3", "go", ts: 1000), now: 20_000, run: { _ in XCTFail("too late to run"); return .done }, panic: {})
        XCTAssertFalse(ack.result.ok)
    }

    func testAnOldCloudVolumeNeverUndoesADirectOne() {
        let inbox = CommandInbox(sender: "mac")
        var levels: [Double] = []
        let old: [String: Any] = ["gain": ["id": "g_old", "v": 0.9, "sender": "flowmingo_x"]]
        _ = inbox.handle(old, now: 1000, run: { _ in .done }, panic: {}, gain: { levels.append($0) })   // joined: baseline
        inbox.directGain(id: "g_direct", value: 0.3) { levels.append($0) }
        _ = inbox.handle(old, now: 1200, run: { _ in .done }, panic: {}, gain: { levels.append($0) })
        _ = inbox.handle(old, now: 1400, run: { _ in .done }, panic: {}, gain: { levels.append($0) })
        XCTAssertEqual(levels, [0.3], "the stale 0.9 in the record must not come back")
    }

    func testADirectVolumeIsNotAppliedAgainFromTheCloud() {
        let inbox = CommandInbox(sender: "mac")
        var levels: [Double] = []
        _ = inbox.handle([:], now: 1000, run: { _ in .done }, panic: {}, gain: { _ in })
        inbox.directGain(id: "g1", value: 0.4) { levels.append($0) }
        _ = inbox.handle(["gain": ["id": "g1", "v": 0.4, "sender": "flowmingo_x"]], now: 1100, run: { _ in .done }, panic: {}, gain: { levels.append($0) })
        XCTAssertEqual(levels, [0.4])
    }
}
