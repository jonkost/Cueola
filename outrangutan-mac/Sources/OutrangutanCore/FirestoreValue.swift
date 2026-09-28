import Foundation

/// Turns plain values into the cloud's written form and back.
///
/// The show's shared record lives in Firestore. Its web address (REST) form
/// wraps every value in a label: `{"stringValue": "GO"}`,
/// `{"integerValue": "12"}`, `{"mapValue": {"fields": {...}}}` and so on.
/// Numbers follow the web app: a whole number is written as an integer,
/// anything else as a double.
public enum FirestoreValue {
    public static func encode(_ value: Any?) -> [String: Any] {
        switch value {
        case nil, is NSNull:
            return ["nullValue": NSNull()]
        case let b as Bool:
            return ["booleanValue": b]
        case let s as String:
            return ["stringValue": s]
        case let i as Int:
            return ["integerValue": String(i)]
        case let d as Double:
            if d.isFinite, d == d.rounded(), abs(d) <= 9_007_199_254_740_991 {
                return ["integerValue": String(Int64(d))]
            }
            return ["doubleValue": d.isFinite ? d : 0]
        case let a as [Any]:
            return ["arrayValue": ["values": a.map { encode($0) }]]
        case let m as [String: Any]:
            return ["mapValue": ["fields": m.mapValues { encode($0) }]]
        default:
            return ["stringValue": String(describing: value!)]
        }
    }

    public static func decode(_ value: Any?) -> Any {
        guard let v = value as? [String: Any] else { return NSNull() }
        if let s = v["stringValue"] as? String { return s }
        if let b = v["booleanValue"] as? Bool { return b }
        if let i = v["integerValue"] as? String { return NSNumber(value: Int64(i) ?? 0) }
        if let i = v["integerValue"] as? NSNumber { return i }
        if let d = v["doubleValue"] as? NSNumber { return NSNumber(value: d.doubleValue) }
        if let t = v["timestampValue"] as? String { return t }
        if let m = v["mapValue"] as? [String: Any] { return decodeFields(m["fields"]) }
        if let a = v["arrayValue"] as? [String: Any] { return ((a["values"] as? [Any]) ?? []).map { decode($0) } }
        return NSNull()
    }

    public static func decodeFields(_ fields: Any?) -> [String: Any] {
        ((fields as? [String: Any]) ?? [:]).mapValues { decode($0) }
    }

    /// A field path for an update, like `outrangutan.live`. A part that is
    /// not a plain name gets backquotes, the way Firestore wants it.
    public static func fieldPath(_ parts: [String]) -> String {
        parts.map { part in
            let plain = part.range(of: "^[A-Za-z_][A-Za-z_0-9]*$", options: .regularExpression) != nil
            return plain ? part : "`" + part.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "`", with: "\\`") + "`"
        }.joined(separator: ".")
    }

    /// Builds the nested body for a patch of several dotted field paths, for
    /// example ["outrangutan.live": [...]] becomes
    /// {outrangutan: {live: [...]}} in written form.
    public static func patchBody(_ updates: [[String]: Any]) -> [String: Any] {
        var tree: [String: Any] = [:]
        for (path, value) in updates { insert(&tree, path[...], value) }
        return ["fields": tree.mapValues { encode($0) }]
    }

    private static func insert(_ tree: inout [String: Any], _ path: ArraySlice<String>, _ value: Any) {
        guard let head = path.first else { return }
        if path.count == 1 { tree[head] = value; return }
        var child = (tree[head] as? [String: Any]) ?? [:]
        insert(&child, path.dropFirst(), value)
        tree[head] = child
    }
}
