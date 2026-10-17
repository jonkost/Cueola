import XCTest
import OutrangutanCore

/// The cloud's live stream arrives in pieces; every piece must be read right.
final class ListenStreamTests: XCTestCase {
    func testMessagesSplitAsTheCloudSendsThem() {
        // The exact shape the cloud answers with: one array, elements on
        // their own lines, a comma between them.
        let text = "[{\n  \"targetChange\": {\n    \"targetChangeType\": \"ADD\",\n    \"targetIds\": [1]\n  }\n}\n,\n{\n  \"documentChange\": {\n    \"document\": {\n      \"name\": \"projects/x/databases/(default)/documents/sessions/ABC\",\n      \"fields\": {\"outrangutan\": {\"mapValue\": {\"fields\": {\"live\": {\"stringValue\": \"a } b\"}}}}},\n      \"updateTime\": \"2026-10-16T18:24:19.5Z\"\n    },\n    \"targetIds\": [1]\n  }\n}\n,\n{\n  \"targetChange\": {\n    \"targetChangeType\": \"CURRENT\"\n  }\n}\n]"
        var parser = ListenStreamParser()
        let messages = parser.feed(Array(text.utf8))
        XCTAssertEqual(messages.count, 3)
        XCTAssertFalse(ListenRequest.isCurrent(messages[0]))
        let doc = ListenRequest.document(in: messages[1])
        XCTAssertNotNil(doc)
        XCTAssertEqual(doc?.updateTime, "2026-10-16T18:24:19.5Z")
        let fields = FirestoreValue.decodeFields(doc?.fields)
        let og = fields["outrangutan"] as? [String: Any]
        XCTAssertEqual(og?["live"] as? String, "a } b")   // a brace inside a string is not the end of a message
        XCTAssertTrue(ListenRequest.isCurrent(messages[2]))
    }

    func testBytesCanArriveOneAtATime() {
        let text = "[{\"a\": {\"b\": \"c\\\"}\"}}\n,{\"d\": 1}]"
        var parser = ListenStreamParser()
        var messages: [[String: Any]] = []
        for b in Array(text.utf8) { if let m = parser.feed(b) { messages.append(m) } }
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(((messages[0]["a"] as? [String: Any])?["b"] as? String), "c\"}")
        XCTAssertEqual((messages[1]["d"] as? NSNumber)?.intValue, 1)
    }

    func testProblemsAreRead() {
        XCTAssertEqual(ListenRequest.problem(in: ["error": ["code": 401, "message": "Sign in first"]]), "Sign in first")
        XCTAssertEqual(ListenRequest.problem(in: ["targetChange": ["targetChangeType": "REMOVE", "cause": ["message": "gone"]]]), "gone")
        XCTAssertNil(ListenRequest.problem(in: ["targetChange": ["targetChangeType": "NO_CHANGE"]]))
    }

    func testRequestAsksForOneShowAndOnlyItsPlaybackParts() {
        let body = ListenRequest.body(project: "cueola", code: "ABC", fields: ["outrangutan", "fixRequests"])
        let target = body["addTarget"] as? [String: Any]
        let query = (target?["query"] as? [String: Any])?["structuredQuery"] as? [String: Any]
        let select = (query?["select"] as? [String: Any])?["fields"] as? [[String: String]]
        XCTAssertEqual(select?.map { $0["fieldPath"] ?? "" }, ["outrangutan", "fixRequests"])
        let whereValue = ((query?["where"] as? [String: Any])?["fieldFilter"] as? [String: Any])?["value"] as? [String: String]
        XCTAssertEqual(whereValue?["referenceValue"], "projects/cueola/databases/(default)/documents/sessions/ABC")
        XCTAssertNotNil(try? JSONSerialization.data(withJSONObject: body))
    }

    func testWriteTimesPutCopiesInOrder() {
        let a = ListenRequest.seconds("2026-10-16T18:24:19Z")
        let b = ListenRequest.seconds("2026-10-16T18:24:19.123456Z")
        let c = ListenRequest.seconds("2026-10-16T18:24:20.1Z")
        XCTAssertNotNil(a); XCTAssertNotNil(b); XCTAssertNotNil(c)
        XCTAssertLessThan(a!, b!)
        XCTAssertLessThan(b!, c!)
        XCTAssertEqual(c! - a!, 1.1, accuracy: 0.001)
        XCTAssertNil(ListenRequest.seconds(nil))
        XCTAssertNil(ListenRequest.seconds("not a time"))
    }
}
