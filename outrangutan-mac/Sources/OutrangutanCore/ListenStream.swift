import Foundation

/// The cloud's live stream, over a plain web request.
///
/// Instead of asking for the show again and again, the Mac can ask the
/// cloud once to keep sending the show every time it changes
/// (`documents:listen`). The cloud answers with one JSON array that never
/// closes while the link is up, one message per element:
///
///     [{ "targetChange": { "targetChangeType": "ADD" } }
///     ,{ "documentChange": { "document": { "fields": ... } } }
///     ,{ "targetChange": { "targetChangeType": "CURRENT" } }
///     ...
///
/// `ListenStreamParser` turns the bytes into messages as they arrive, and
/// `ListenRequest` builds the request and reads the messages.
public struct ListenStreamParser {
    private var depth = 0
    private var inString = false
    private var escaped = false
    private var current: [UInt8] = []

    public init() {}

    /// Feeds one byte. Returns a message when this byte finished one.
    public mutating func feed(_ b: UInt8) -> [String: Any]? {
        if depth == 0 {
            // Between messages: the array's brackets, commas and spaces.
            if b == UInt8(ascii: "{") {
                depth = 1
                current = [b]
                inString = false
                escaped = false
            }
            return nil
        }
        current.append(b)
        if inString {
            if escaped { escaped = false }
            else if b == UInt8(ascii: "\\") { escaped = true }
            else if b == UInt8(ascii: "\"") { inString = false }
            return nil
        }
        switch b {
        case UInt8(ascii: "\""):
            inString = true
        case UInt8(ascii: "{"):
            depth += 1
        case UInt8(ascii: "}"):
            depth -= 1
            if depth == 0 {
                let data = Data(current)
                current = []
                return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            }
        default:
            break
        }
        return nil
    }

    /// Feeds many bytes. Returns every message they finished, in order.
    public mutating func feed(_ bytes: some Sequence<UInt8>) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for b in bytes { if let m = feed(b) { out.append(m) } }
        return out
    }
}

public enum ListenRequest {
    /// Asks the cloud for one show, and only the named parts of it, every
    /// time it changes. (A query with a field list, not a plain document
    /// watch: a plain watch would send the whole show record, rundown and
    /// scripts included, on every change by anyone.)
    public static func body(project: String, code: String, fields: [String]) -> [String: Any] {
        let documents = "projects/\(project)/databases/(default)/documents"
        return [
            "addTarget": [
                "targetId": 1,
                "query": [
                    "parent": documents,
                    "structuredQuery": [
                        "select": ["fields": fields.map { ["fieldPath": $0] }],
                        "from": [["collectionId": "sessions"]],
                        "where": ["fieldFilter": [
                            "field": ["fieldPath": "__name__"],
                            "op": "EQUAL",
                            "value": ["referenceValue": documents + "/sessions/" + code],
                        ]],
                        "limit": 1,
                    ],
                ],
            ],
        ]
    }

    /// A message carrying the show: its fields (in the cloud's written
    /// form) and when it was written. nil for any other message.
    public static func document(in message: [String: Any]) -> (fields: Any?, updateTime: String?)? {
        guard let change = message["documentChange"] as? [String: Any],
              let doc = change["document"] as? [String: Any] else { return nil }
        return (doc["fields"], doc["updateTime"] as? String)
    }

    /// True once the cloud says the first copy is complete and current.
    public static func isCurrent(_ message: [String: Any]) -> Bool {
        (message["targetChange"] as? [String: Any])?["targetChangeType"] as? String == "CURRENT"
    }

    /// What went wrong, when a message says the stream is failing.
    public static func problem(in message: [String: Any]) -> String? {
        if let e = message["error"] as? [String: Any] {
            return (e["message"] as? String) ?? "error \(e["code"] ?? "")"
        }
        if let change = message["targetChange"] as? [String: Any], let cause = change["cause"] as? [String: Any] {
            return (cause["message"] as? String) ?? "the cloud closed the stream"
        }
        return nil
    }

    /// What kind of failure the cloud reported, so the link knows whether
    /// another try the same way can help.
    public enum Failure: Equatable {
        /// The cloud does not take this request at all. Asking again the
        /// same way will not help.
        case refused
        /// This sign-in may not open the show.
        case permission
        /// There is no show with this code.
        case notFound
        /// The cloud asked everyone to slow down for a moment.
        case busy
        /// Anything else: a dropped line, a server hiccup. Worth another try.
        case other
    }

    /// The failure an HTTP status and (when the reply names one) a status
    /// word like "INVALID_ARGUMENT" mean.
    public static func failure(code: Int, status: String?) -> Failure {
        switch (code, status ?? "") {
        case (401, _), (403, _), (_, "UNAUTHENTICATED"), (_, "PERMISSION_DENIED"): return .permission
        case (404, _), (_, "NOT_FOUND"): return .notFound
        case (429, _), (_, "RESOURCE_EXHAUSTED"): return .busy
        case (400, _), (405, _), (501, _), (_, "INVALID_ARGUMENT"), (_, "UNIMPLEMENTED"): return .refused
        default: return .other
        }
    }

    /// The failure a stream message reports, with the cloud's words. The
    /// cloud can refuse a request after the line is already open (HTTP 200
    /// and then one `{"error": {"code": 400, "status": "INVALID_ARGUMENT"}}`
    /// element), and that refusal counts the same as one in the status
    /// line. nil when the message is not a failure.
    public static func failure(in message: [String: Any]) -> (kind: Failure, message: String)? {
        guard let words = problem(in: message) else { return nil }
        if let e = message["error"] as? [String: Any] {
            return (failure(code: (e["code"] as? NSNumber)?.intValue ?? 0, status: e["status"] as? String), words)
        }
        // A target the cloud removed carries a gRPC status code, not an HTTP one.
        let cause = (message["targetChange"] as? [String: Any])?["cause"] as? [String: Any]
        switch (cause?["code"] as? NSNumber)?.intValue ?? 0 {
        case 3, 12: return (.refused, words)      // INVALID_ARGUMENT, UNIMPLEMENTED
        case 5: return (.notFound, words)         // NOT_FOUND
        case 7, 16: return (.permission, words)   // PERMISSION_DENIED, UNAUTHENTICATED
        case 8: return (.busy, words)             // RESOURCE_EXHAUSTED
        default: return (.other, words)
        }
    }

    /// Firestore's write times ("2026-10-16T18:24:19.123456Z") as a number
    /// of seconds, so two copies of the show can be put in order. nil when
    /// the text is not a time.
    public static func seconds(_ updateTime: String?) -> Double? {
        guard let t = updateTime, t.count >= 20, t.hasSuffix("Z") else { return nil }
        let main = String(t.prefix(19))               // yyyy-MM-ddTHH:mm:ss
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        guard let date = f.date(from: main + "Z") else { return nil }
        var fraction = 0.0
        let rest = t.dropFirst(19).dropLast()         // ".123456" or ""
        if rest.hasPrefix("."), let v = Double("0" + rest) { fraction = v }
        return date.timeIntervalSince1970 + fraction
    }
}
